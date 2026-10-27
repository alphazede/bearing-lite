import { boundHook, withTask } from "./task-opt-in-fixture.mjs";
/**
 * #206 the real write lock honors a parent-accepted Reviewer -> Repair
 * Implementer transition recorded in `.bearing-round.lock`, and only for the
 * frozen receipt's repair write set. Every case drives the shipped hook
 * (`handle()` and the CLI) with native host envelopes against a fresh git
 * checkout and on-disk records; nothing here models the lock.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, "hooks/orchestrator-write-lock.cjs");
const require = createRequire(import.meta.url);
const lock = boundHook(require(HOOK));

const PLAN = "docs/plans/x";
const LISTED = [`${PLAN}/design.md`, `${PLAN}/seit.json`, `${PLAN}/implementation.json`, `${PLAN}/x-technical-plan.md`];
const UNLISTED = `${PLAN}/x-dod-manifest.html`;
const REVIEWER = "reviewer-session-1";
const temps = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A fresh checkout with a frozen receipt and, unless omitted, the parent's transition. */
function checkout({ receipt: patchReceipt = {}, transition: patchTransition = {}, round: patchRound = {}, omit = [] } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "repair-lock-"));
  temps.push(root);
  const git = spawnSync("git", ["init", "-q", "-b", "repair-branch", root], { encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  const candidate = { candidate_ref: "plan-c1", candidate_revision: "r7", candidate_digest: "d".repeat(64) };
  const lineage = { worktree: ".", branch: "repair-branch", generation: 3 };
  const receipt = {
    ...candidate, verdict: "REPAIR_REQUIRED", finding_ids: ["F1"], severity: { F1: "P1" },
    locations: { F1: `${PLAN}/design.md:4` }, reachability: { F1: "reachable" },
    reproducer: { F1: "node --test test/x.test.mjs" }, seit_refs: { F1: "SEIT-1" },
    repair_target: `${PLAN}/design.md`, write_set: LISTED, lineage, ...patchReceipt,
  };
  const bytes = JSON.stringify(receipt);
  mkdirSync(path.join(root, ".bearing/review"), { recursive: true });
  mkdirSync(path.join(root, PLAN), { recursive: true });
  writeFileSync(path.join(root, ".bearing/review/receipt.json"), bytes);
  const transition = {
    accepted_by: "orchestrator", parent_accepted: "REPAIR_REQUIRED", reviewer_context: REVIEWER,
    receipt_path: ".bearing/review/receipt.json", receipt_sha256: createHash("sha256").update(bytes).digest("hex"),
    ...candidate, ...lineage, repair_round: "open", ...patchTransition,
  };
  const round = { candidate: candidate.candidate_ref, plan_dir: PLAN, generation: 3, repair_transition: transition, ...patchRound };
  for (const key of omit) delete round[key];
  if (!omit.includes("record")) writeFileSync(path.join(root, ".bearing-round.lock"), JSON.stringify(round));
  withTask({ cwd: root, session_id: REVIEWER });
  return root;
}

const claudeEdit = (root, file, extra = {}) => ({
  hook_event_name: "PreToolUse", session_id: REVIEWER, cwd: root,
  tool_name: "Edit", tool_input: { file_path: path.join(root, file), old_string: "a", new_string: "b" }, ...extra,
});
const codexPatch = (root, file) => ({
  hook_event_name: "PreToolUse", session_id: REVIEWER, cwd: root, tool_name: "apply_patch",
  tool_input: { command: `*** Begin Patch\n*** Update File: ${file}\n@@\n-a\n+b\n*** End Patch\n` },
});
const verdict = (envelope, role = "reviewer", host = "claude-code") => lock.handle(envelope, { role, host }).hookSpecificOutput;
const denied = (out, pattern) => {
  assert.equal(out.verdict, "DENY_DISPATCH", JSON.stringify(out));
  if (pattern) assert.match(out.reason, pattern);
};

function cliVerdict(root, envelope, role = "reviewer", host = "claude-code") {
  const env = { ...process.env };
  if (role === null) delete env.BEARING_ROLE;
  else env.BEARING_ROLE = role;
  const run = spawnSync(process.execPath, [HOOK, `--host=${host}`], {
    cwd: root, env, input: JSON.stringify(withTask(envelope)), encoding: "utf8", timeout: 10_000,
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stderr).hookSpecificOutput;
}

// I206-R1..R4: frozen review proofs exercise real disk paths and native envelopes.
// Resource group: none; each case owns its temporary checkout and files.
describe("#206 accepted review finding regressions", () => {
  for (const alias of ["unlisted artifact", "parent record", "outside ancestor"]) {
    it(`I206-R1 refuses a listed repair through a symlink to ${alias}`, () => {
      const root = checkout();
      let target;
      if (alias === "outside ancestor") {
        const outside = mkdtempSync(path.join(os.tmpdir(), "repair-outside-"));
        temps.push(outside);
        target = path.join(outside, "design.md");
        writeFileSync(target, "outside original");
        rmSync(path.join(root, PLAN), { recursive: true });
        symlinkSync(outside, path.join(root, PLAN), "dir");
      } else {
        target = path.join(root, alias === "parent record" ? ".bearing-round.lock" : UNLISTED);
        if (alias === "unlisted artifact") writeFileSync(target, "unlisted original");
        symlinkSync(target, path.join(root, LISTED[0]));
      }
      const original = readFileSync(target, "utf8");
      denied(verdict(claudeEdit(root, LISTED[0])));
      denied(verdict(codexPatch(root, LISTED[0]), "reviewer", "codex"));
      denied(cliVerdict(root, claudeEdit(root, LISTED[0])));
      assert.equal(readFileSync(target, "utf8"), original);
    });
  }

  it("I206-R1 prevents the exact Bash write from changing an unlisted symlink target", () => {
    const root = checkout();
    writeFileSync(path.join(root, UNLISTED), "unlisted original");
    symlinkSync(path.join(root, UNLISTED), path.join(root, LISTED[0]));
    const command = `printf modified > ${LISTED[0]}`;
    const out = cliVerdict(root, claudeEdit(root, LISTED[0], { tool_name: "Bash", tool_input: { command } }));
    if (out.verdict === "ALLOW") {
      assert.equal(spawnSync("sh", ["-c", command], { cwd: root, timeout: 10_000 }).status, 0);
    }
    assert.equal(readFileSync(path.join(root, UNLISTED), "utf8"), "unlisted original");
    denied(out);
  });

  it("I206-R1 checks raw ancestors before normalizing symlink traversal", () => {
    const root = checkout();
    const outside = mkdtempSync(path.join(os.tmpdir(), "repair-traversal-"));
    temps.push(outside);
    mkdirSync(path.join(outside, "nested"));
    mkdirSync(path.join(outside, PLAN), { recursive: true });
    writeFileSync(path.join(outside, LISTED[0]), "outside original");
    symlinkSync(path.join(outside, "nested"), path.join(root, "alias"), "dir");
    const raw = `${root}/alias/../${LISTED[0]}`;
    const edit = claudeEdit(root, LISTED[0]);
    edit.tool_input.file_path = raw;
    denied(verdict(edit));
    denied(verdict(codexPatch(root, raw), "reviewer", "codex"));
    denied(cliVerdict(root, claudeEdit(root, LISTED[0], {
      tool_name: "Bash", tool_input: { command: `printf modified > ${raw}` },
    })));
    assert.equal(readFileSync(path.join(outside, LISTED[0]), "utf8"), "outside original");
  });

  it("I206-R2 denies roleless children the parent record while preserving legitimate parents", () => {
    const root = checkout();
    const input = claudeEdit(root, ".bearing-round.lock");
    for (const role of [null, "orchestrator", "coordinator"]) {
      assert.equal(cliVerdict(root, input, role).verdict, "ALLOW");
    }
    denied(cliVerdict(root, { ...input, agent_id: "unassigned-child" }, null), /only the parent controller/);
  });

  it("I206-R3 refuses a shell move of the record source while allowing copies and reads", () => {
    const root = checkout();
    const input = (command) => claudeEdit(root, ".bearing-round.lock", { tool_name: "Bash", tool_input: { command } });
    for (const command of ["cp .bearing-round.lock copied-record.json", "cat .bearing-round.lock"]) {
      assert.equal(cliVerdict(root, input(command)).verdict, "ALLOW", command);
    }
    const command = "mv .bearing-round.lock moved-record.json";
    const out = cliVerdict(root, input(command));
    if (out.verdict === "ALLOW") {
      assert.equal(spawnSync("sh", ["-c", command], { cwd: root, timeout: 10_000 }).status, 0);
    }
    assert.equal(existsSync(path.join(root, ".bearing-round.lock")), true, "parent record must remain in place");
    denied(out, /only the parent controller/);
  });

  it("I206-R4 accepts a native Cursor conversation_id for the same reviewer", () => {
    const root = checkout();
    const input = {
      conversation_id: REVIEWER, generation_id: "cursor-generation", hook_event_name: "preToolUse",
      workspace_roots: [root], cwd: root, tool_name: "Shell", tool_use_id: "repair-write",
      tool_input: { command: `printf repaired > ${LISTED[0]}`, working_directory: root },
    };
    assert.equal(cliVerdict(root, input, "reviewer", "cursor").verdict, "ALLOW");
    denied(cliVerdict(root, { ...input, conversation_id: "other-conversation" }, "reviewer", "cursor"), /reviewer_context_mismatch/);
  });

  it("I206-R4 keeps agent_id ahead of the Cursor conversation identity", () => {
    const root = checkout();
    const input = { ...claudeEdit(root, LISTED[0]), conversation_id: REVIEWER, agent_id: "other-agent", assigned_role: "reviewer" };
    delete input.session_id;
    denied(cliVerdict(root, input, "orchestrator", "cursor"), /reviewer_context_mismatch/);
    assert.equal(cliVerdict(root, { ...input, agent_id: REVIEWER, conversation_id: "other-conversation" }, "orchestrator", "cursor").verdict, "ALLOW");
  });
});

describe("#206 accepted repair transition opens only the frozen write set", () => {
  it("allows every listed planning artifact through handle() on Claude Code and Codex envelopes", () => {
    const root = checkout();
    for (const file of LISTED) {
      assert.equal(verdict(claudeEdit(root, file)).verdict, "ALLOW", file);
      assert.equal(verdict(codexPatch(root, file), "reviewer", "codex").verdict, "ALLOW", file);
    }
    assert.equal(verdict(claudeEdit(root, LISTED[0]), "repair_implementer").verdict, "ALLOW");
  });

  it("allows through the real CLI with BEARING_ROLE from the environment", () => {
    const root = checkout();
    const run = (file) => spawnSync(process.execPath, [HOOK, "--host=claude-code"], {
      input: JSON.stringify(claudeEdit(root, file)), encoding: "utf8",
      env: { ...process.env, BEARING_ROLE: "reviewer" },
    });
    const allowed = run(LISTED[0]);
    assert.equal(allowed.status, 0);
    assert.deepEqual(JSON.parse(allowed.stdout), {});
    assert.equal(JSON.parse(allowed.stderr).hookSpecificOutput.reason, "repair_transition_write_allowed");
    const refused = run(UNLISTED);
    assert.equal(JSON.parse(refused.stdout).hookSpecificOutput.permissionDecision, "deny");
  });

  it("refuses an unlisted planning artifact even with a valid transition", () => {
    denied(verdict(claudeEdit(checkout(), UNLISTED)), /outside_repair_write_set/);
    denied(verdict(codexPatch(checkout(), UNLISTED), "reviewer", "codex"), /outside_repair_write_set/);
  });
});

describe("#206 no valid recorded transition, no repair authority", () => {
  const cases = [
    ["no round record", { omit: ["record"] }, /repair_transition_missing/],
    ["no transition in the record", { omit: ["repair_transition"] }, /repair_transition_missing/],
    ["no parent acceptance", { transition: { parent_accepted: "PENDING" } }, /not_accepted/],
    ["acceptance by a non-parent", { transition: { accepted_by: "reviewer" } }, /not_accepted/],
    ["a closed repair round", { transition: { repair_round: "closed" } }, /repair_round_closed/],
    ["another reviewer context", { transition: { reviewer_context: "other-session" } }, /reviewer_context_mismatch/],
    ["a stale generation", { round: { generation: 4 } }, /stale_lineage/],
    ["a stale candidate", { round: { candidate: "plan-c0" } }, /stale_lineage/],
    ["another branch", { transition: { branch: "main" } }, /stale_lineage: branch/],
    ["another worktree", { transition: { worktree: "../elsewhere" } }, /stale_lineage: worktree/],
    ["an unresolved receipt", { transition: { receipt_path: ".bearing/review/missing.json" } }, /frozen_receipt_unresolved/],
    ["an escaping receipt path", { transition: { receipt_path: "../receipt.json" } }, /frozen_receipt_unresolved/],
    ["an edited receipt", { transition: { receipt_sha256: "0".repeat(64) } }, /frozen_receipt_digest_mismatch/],
    ["a receipt for another candidate", { receipt: { candidate_digest: "e".repeat(64) } }, /frozen_receipt_invalid/],
    ["a receipt that is not REPAIR_REQUIRED", { receipt: { verdict: "ACCEPT" } }, /frozen_receipt_invalid/],
    ["a receipt from another generation", { receipt: { lineage: { worktree: ".", branch: "repair-branch", generation: 2 } } }, /frozen_receipt_invalid/],
  ];
  for (const [name, setup, reason] of cases) {
    it(`refuses ${name}`, () => {
      const root = checkout(setup);
      denied(verdict(claudeEdit(root, LISTED[0])), reason);
      denied(verdict(claudeEdit(root, LISTED[0]), "repair_implementer"), reason);
    });
  }

  it("ignores asserted tool-input or envelope flags and a role rename", () => {
    const root = checkout({ omit: ["record"] });
    const asserted = claudeEdit(root, LISTED[0], {
      parent_accepted: true, repair_transition: true, finding: false,
    });
    asserted.tool_input.repair_transition = { parent_accepted: "REPAIR_REQUIRED", repair_round: "open" };
    asserted.tool_input.parent_accepted = true;
    denied(verdict(asserted), /repair_transition_missing/);
    for (const role of ["repair_implementer", "Repair Implementer", "reviewer.repair"]) {
      denied(verdict(claudeEdit(root, LISTED[0]), role));
    }
  });

  it("refuses the same transition from a different reviewer context or a missing one", () => {
    const root = checkout();
    denied(verdict(claudeEdit(root, LISTED[0], { session_id: "intruder" })), /reviewer_context_mismatch/);
    const anonymous = claudeEdit(root, LISTED[0]);
    delete anonymous.session_id;
    denied(verdict(anonymous), /reviewer_context_mismatch/);
  });

  it("keeps the round record parent-owned: no reviewer or implementer may forge it", () => {
    const root = checkout({ omit: ["record"] });
    for (const role of ["reviewer", "repair_implementer", "implementer", "systems_modeler"]) {
      denied(verdict(claudeEdit(root, ".bearing-round.lock"), role), /only the parent controller/);
      const shell = { hook_event_name: "PreToolUse", session_id: REVIEWER, cwd: root, tool_name: "Bash",
        tool_input: { command: "echo '{}' > .bearing-round.lock" } };
      denied(verdict(shell, role), /only the parent controller/);
    }
    assert.equal(verdict(claudeEdit(root, ".bearing-round.lock"), "coordinator").verdict, "ALLOW");
    assert.equal(lock.handle({ ...claudeEdit(root, ".bearing-round.lock"), session_id: "main" }, { host: "claude-code", role: "orchestrator" })
      .hookSpecificOutput.verdict, "ALLOW");
  });
});

describe("#206 unchanged guards", () => {
  it("keeps bound authors, orchestrator denial, and host fallbacks unchanged", () => {
    const root = checkout();
    assert.equal(verdict(claudeEdit(root, LISTED[0]), "systems_modeler").verdict, "ALLOW");
    denied(verdict(claudeEdit(root, LISTED[0]), "planning_and_design"), /retired_role:planning_and_design/);
    denied(verdict(claudeEdit(root, LISTED[1]), "integration_engineer"), /bound authors/);
    denied(verdict(claudeEdit(root, LISTED[1]), "orchestrator"), /Orchestrator cannot write/);
    // The controller's own design write is still deferred while the review is frozen.
    denied(verdict(claudeEdit(root, LISTED[0]), "orchestrator"), /frozen_candidate/);
    assert.equal(verdict(claudeEdit(root, "src/a.js")).verdict, "ALLOW");
    assert.equal(verdict(claudeEdit(root, LISTED[0]), "reviewer", "kimi").verdict, "UNAVAILABLE");
    // A valid transition never widens another role's authority.
    denied(verdict(claudeEdit(root, LISTED[0]), "test_engineer"), /bound authors/);
  });

  it("is registered on the shipped host write events (prevents a test-only evaluator escape)", () => {
    const hooks = readFileSync(path.join(ROOT, "hooks/hooks.json"), "utf8");
    assert.match(hooks, /orchestrator-write-lock\.cjs/);
    const skill = readFileSync(path.join(ROOT, "skills/reviewer/SKILL.md"), "utf8");
    assert.match(skill, /`repair_transition` in `\.bearing-round\.lock`, `references\/repair-transition\.md`/);
    const reviewer = readFileSync(path.join(ROOT, "skills/reviewer/references/repair-transition.md"), "utf8");
    for (const field of [".bearing-round.lock", "repair_transition", "accepted_by", "reviewer_context",
      "receipt_sha256", "candidate_digest", "worktree", "branch", "generation", "repair_round"]) {
      assert.ok(reviewer.includes(field), field);
    }
    const implementer = readFileSync(path.join(ROOT, "skills/implementer/SKILL.md"), "utf8");
    assert.match(implementer, /\.bearing-round\.lock/);
    assert.match(implementer, /repair_transition/);
  });
});

// Advance authority is parent-owned; the reviewer supplies proof, never scope.
describe("advance-authorized same-session repair", () => {
  const advance = (patch = {}) => checkout({ transition: {
    authorization: "advance", parent_accepted: "IN_SCOPE_REPAIR", repairs_max: 1,
    write_set: LISTED, receipt_sha256: undefined, ...patch,
  } });
  it("pins a validated receipt on first write without another controller action", () => {
    const root = advance();
    assert.equal(verdict(claudeEdit(root, LISTED[0])).verdict, "ALLOW");
    const record = JSON.parse(readFileSync(path.join(root, ".bearing-round.lock")));
    assert.equal(record.repair_transition.receipt_sha256,
      createHash("sha256").update(readFileSync(path.join(root, ".bearing/review/receipt.json"))).digest("hex"));
    assert.equal(verdict(codexPatch(root, LISTED[1]), "reviewer", "codex").verdict, "ALLOW");
    const receipt = path.join(root, ".bearing/review/receipt.json");
    writeFileSync(receipt, readFileSync(receipt, "utf8") + " ");
    denied(verdict(claudeEdit(root, LISTED[0])), /digest_mismatch/);
  });
  it("concurrent first writes pin one unchanged receipt through the real CLI", async () => {
    const root = advance();
    const request = file => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [HOOK, "--host=claude-code"], {
        cwd: root, env: { ...process.env, BEARING_ROLE: "reviewer" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", data => stderr += data);
      child.on("error", reject);
      child.on("close", code => code === 0 ? resolve(JSON.parse(stderr).hookSpecificOutput) : reject(Error(stderr)));
      child.stdin.end(JSON.stringify(claudeEdit(root, file)));
    });
    const results = await Promise.all([request(LISTED[0]), request(LISTED[1])]);
    assert.ok(results.every(result => result.verdict === "ALLOW"), JSON.stringify(results));
    assert.equal(existsSync(path.join(root, ".bearing-round.lock.lock")), false);
  });
  it("cannot widen the parent's write set or repair allowance", () => {
    denied(verdict(claudeEdit(advance({ write_set: [LISTED[0]] }), LISTED[0])), /outside_repair_write_set/);
    denied(verdict(claudeEdit(advance({ repairs_max: 2 }), LISTED[0])), /not_accepted/);
    denied(verdict(claudeEdit(advance({ accepted_by: "reviewer" }), LISTED[0])), /not_accepted/);
    denied(verdict(claudeEdit(advance(), LISTED[0], { session_id: "other" })), /context_mismatch/);
    denied(verdict(claudeEdit(advance({ repair_round: "closed" }), LISTED[0])), /round_closed/);
  });
});
