/**
 * #209/#210 pre-dispatch assurance budget barrier.
 *
 * Component replay of the SHIPPED registrations: each case reads the host
 * hook files this package registers (Claude Code / Codex `hooks/hooks.json`,
 * Cursor `hooks/com.cursor/hooks.json`, GitHub Copilot
 * `com.github.copilot/hooks/hooks.json`), runs every registered pre-launch
 * command as the host would (stdin envelope from the committed native fixture
 * shapes, stdout wire), and only when no hook denies runs the launch itself.
 * The launch is a harmless local sentinel that appends to a marker file; no
 * provider or model is contacted. This is hook-chain replay, not a native
 * host end-to-end run; native host invocation stays a typed gap reported by
 * the release notes, and Codex registration is proven separately by
 * test/native/codex-hook-discovery.test.mjs.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
/** Loaded per case so an absent barrier reds each behavior, not the whole file. */
const dispatch = () => require(path.join(ROOT, "hooks/assurance-dispatch.cjs"));
const transition = require(path.join(ROOT, "hooks/transition-order.cjs"));
const writeLock = require(path.join(ROOT, "hooks/orchestrator-write-lock.cjs"));
const HOOK = path.join(ROOT, "hooks/assurance-dispatch.cjs");
const fixture = (name) => JSON.parse(readFileSync(path.join(ROOT, "test/fixtures/te-hook", name), "utf8"));

const temps = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Child env without an inherited session role: the parent launches. */
const parentEnv = () => {
  const env = { ...process.env };
  delete env.BEARING_ROLE;
  delete env.BEARING_HOST;
  return env;
};

/**
 * A fresh checkout with the frozen declaration, the parent round record, and
 * the parent's assurance ledger. Each case owns its own directory.
 */
function checkout({ ledger, round, declaration, omit = [] } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "assurance-dispatch-"));
  temps.push(root);
  mkdirSync(path.join(root, "docs/plans/x"), { recursive: true });
  writeFileSync(path.join(root, "docs/plans/x/implementation.json"),
    JSON.stringify(declaration ?? { waves: [{ id: "W1" }, { id: "W2" }] }));
  const roundRecord = {
    candidate: "cand-1", plan_dir: "docs/plans/x", generation: 1, assurance_unit: "W1",
    assurance_slots: ["test_engineer.assurance", "integration_engineer.execution", "reviewer"], ...round,
  };
  if (!omit.includes("round")) writeFileSync(path.join(root, ".bearing-round.lock"), JSON.stringify(roundRecord));
  const book = { journey: "J", declaration_path: "docs/plans/x/implementation.json", units: [], events: [], ...ledger };
  if (!omit.includes("ledger")) writeFileSync(path.join(root, ".bearing-assurance.json"), JSON.stringify(book));
  const sentinel = path.join(root, "sentinel.cjs");
  writeFileSync(sentinel,
    "require('node:fs').appendFileSync(process.argv[2], (process.env.BEARING_ROLE || 'none') + ' ' + (process.env.BEARING_REVIEW_SLOT || '') + '\\n');\n");
  return root;
}
const setRound = (root, patch) => {
  const file = path.join(root, ".bearing-round.lock");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...patch }));
};
const ledgerOf = (root) => JSON.parse(readFileSync(path.join(root, ".bearing-assurance.json"), "utf8"));
const setLedger = (root, mutate) => {
  const book = ledgerOf(root);
  mutate(book);
  writeFileSync(path.join(root, ".bearing-assurance.json"), JSON.stringify(book));
};

/** A bound launch: leading env carrier, then the sentinel standing in for the provider. */
const launchCommand = (root, role, extra = "") =>
  `BEARING_ROLE=${role} ${extra} node ${JSON.stringify(path.join(root, "sentinel.cjs"))} ${JSON.stringify(path.join(root, "launched.log"))}`.replace(/\s+/g, " ");
const launched = (root) => (existsSync(path.join(root, "launched.log"))
  ? readFileSync(path.join(root, "launched.log"), "utf8").trim().split("\n") : []);

/** Shipped registrations, per host, as (event, matcher, command, cwd) rows. */
const HOSTS = {
  "claude-code": () => registered("hooks/hooks.json", "PreToolUse", "CLAUDE_PLUGIN_ROOT"),
  codex: () => registered("hooks/hooks.json", "PreToolUse", "CLAUDE_PLUGIN_ROOT"),
  cursor: () => registered("hooks/com.cursor/hooks.json", "beforeShellExecution"),
  copilot: () => registered("com.github.copilot/hooks/hooks.json", "PreToolUse", "PLUGIN_ROOT"),
};
function registered(file, event, rootVar) {
  const doc = JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
  return (doc.hooks[event] || []).flatMap((group) => {
    const entries = Array.isArray(group.hooks) ? group.hooks : [group];
    return entries.map((entry) => ({
      matcher: group.matcher ? new RegExp(`^(?:${group.matcher})$`) : null,
      command: rootVar ? entry.command.replaceAll(`\${${rootVar}}`, ROOT) : entry.command,
    }));
  });
}
function envelope(host, root, command) {
  if (host === "cursor") return { ...fixture("cursor-beforeshellexecution.json"), cwd: root, workspaceRoot: root, command };
  const base = fixture("claude-pretooluse-product-write.json");
  return { ...base, cwd: root, tool_name: "Bash", tool_input: { command } };
}

/** Run the host's registered pre-launch chain; launch only if nothing denies. */
function hostLaunch(host, root, command) {
  const input = envelope(host, root, command);
  let deniedBy = null;
  for (const hook of HOSTS[host]()) {
    if (hook.matcher && !hook.matcher.test(input.tool_name)) continue;
    const run = spawnSync("sh", ["-c", hook.command], {
      cwd: ROOT, input: JSON.stringify(input), encoding: "utf8", env: parentEnv(), timeout: 15_000,
    });
    assert.equal(run.status, 0, `${hook.command}: ${run.stderr}`);
    const wire = JSON.parse(run.stdout.trim() || "{}");
    if (wire.hookSpecificOutput?.permissionDecision === "deny" || wire.permission === "deny") {
      deniedBy = { hook: hook.command, reason: wire.hookSpecificOutput?.permissionDecisionReason || wire.agentMessage };
      break;
    }
  }
  if (!deniedBy) {
    const run = spawnSync("sh", ["-c", command], { cwd: root, encoding: "utf8", env: parentEnv(), timeout: 15_000 });
    assert.equal(run.status, 0, run.stderr);
  }
  return deniedBy;
}

describe("#209 registered pre-launch chains enforce the budget before the provider starts", () => {
  for (const host of Object.keys(HOSTS)) {
    it(`${host}: one round with its approved slots, one repair, deterministic close, excess never starts`, () => {
      const root = checkout();
      assert.ok(HOSTS[host]().some((hook) => /assurance-dispatch\.cjs/.test(hook.command)), "barrier registered");
      assert.equal(hostLaunch(host, root, launchCommand(root, "test_engineer.assurance")), null);
      assert.equal(hostLaunch(host, root, launchCommand(root, "integration_engineer.execution")), null);
      assert.equal(hostLaunch(host, root, launchCommand(root, "reviewer")), null);
      assert.equal(launched(root).length, 3);

      const excess = hostLaunch(host, root, launchCommand(root, "reviewer"));
      assert.match(excess.hook, /assurance-dispatch/);
      assert.match(excess.reason, /assurance_slot_already_launched/);
      assert.equal(launched(root).length, 3, "excess review never started");

      assert.equal(hostLaunch(host, root, launchCommand(root, "repair_implementer")), null);
      // Deterministic post-repair closure is ordinary work, not a new review.
      assert.equal(hostLaunch(host, root, `node -e "process.exit(0)"`), null);
      setLedger(root, (book) => { book.units[0].deterministic_gate = "PASS"; });
      setRound(root, { candidate: "cand-1-repaired" });
      assert.match(hostLaunch(host, root, launchCommand(root, "reviewer")).reason, /HALT — assurance_round_limit/);
      assert.match(hostLaunch(host, root, launchCommand(root, "repair_implementer")).reason, /assurance_repair_limit/);
      assert.equal(launched(root).length, 4, "only the first round and its one repair started");
      const book = ledgerOf(root);
      assert.deepEqual(book.units.map((u) => [u.unit_id, u.assurance_rounds, u.assurance_repairs]), [["W1", 1, 1]]);
    });
  }

  it("the Cursor preToolUse registration carries the same barrier", () => {
    const rows = registered("hooks/com.cursor/hooks.json", "preToolUse");
    assert.ok(rows.some((row) => /assurance-dispatch\.cjs --host=cursor/.test(row.command)));
  });

  it("Codex/Claude matcher also gates subagent tools by their structural subagent_type", () => {
    const root = checkout({ round: { assurance_slots: ["reviewer"] } });
    const input = { ...fixture("claude-pretooluse-product-write.json"), cwd: root, tool_name: "Task",
      tool_input: { subagent_type: "reviewer", prompt: "review" } };
    assert.ok(HOSTS["claude-code"]().some((hook) => hook.matcher?.test("Task") && /assurance-dispatch/.test(hook.command)));
    assert.equal(dispatch().handle(input).verdict, "ALLOW");
    assert.match(dispatch().handle(input).reason, /assurance_slot_already_launched/);
  });
});

describe("#209 missing or invalid budget evidence never passes", () => {
  const cases = [
    ["no ledger", { omit: ["ledger"] }, /assurance_ledger_missing/],
    ["an empty ledger object", { ledger: { journey: undefined, declaration_path: undefined, units: undefined, events: undefined } }, /assurance_ledger_invalid/],
    ["no round record", { omit: ["round"] }, /round_record_missing/],
    ["a round record without slots", { round: { assurance_slots: [] } }, /round_record_missing/],
    ["an unreadable declaration", { ledger: { declaration_path: "docs/plans/x/missing.json" } }, /frozen_declaration_unreadable/],
    ["an escaping declaration path", { ledger: { declaration_path: "../outside.json" } }, /frozen_declaration_unreadable/],
    ["an undeclared unit", { round: { assurance_unit: "W9" } }, /undeclared_review_unit/],
    ["the planning unit", { round: { assurance_unit: "planning" } }, /undeclared_review_unit/],
  ];
  for (const [name, setup, reason] of cases) {
    it(`denies ${name}`, () => {
      const root = checkout(setup);
      const denied = hostLaunch("claude-code", root, launchCommand(root, "reviewer"));
      assert.match(denied.reason, reason);
      assert.deepEqual(launched(root), []);
    });
  }

  it("denies a rewritten event chain or a reset counter", () => {
    const root = checkout();
    assert.equal(hostLaunch("codex", root, launchCommand(root, "reviewer")), null);
    setLedger(root, (book) => { book.units[0].assurance_rounds = 0; });
    assert.match(hostLaunch("codex", root, launchCommand(root, "test_engineer.assurance")).reason, /assurance_ledger_tampered/);
    setLedger(root, (book) => { book.units[0].assurance_rounds = 1; book.events[0].candidate = "other"; });
    assert.match(hostLaunch("codex", root, launchCommand(root, "test_engineer.assurance")).reason, /assurance_ledger_tampered/);
    assert.equal(launched(root).length, 1);
  });

  it("the explicit transition path: {} record and unit_kind relabels no longer read as unspent", () => {
    const root = checkout();
    const declaration_path = path.join(root, "docs/plans/x/implementation.json");
    const task_record_path = path.join(root, "record.json");
    const ask = (record, unit_kind) => {
      writeFileSync(task_record_path, JSON.stringify(record));
      return transition.evaluate({ action_kind: "assurance_transition", assurance: {
        journey: "J", unit_kind, assurance_unit: "W1", request_scope: unit_kind, declaration_path, task_record_path } });
    };
    assert.match(ask({}, "wave").reason, /NEEDS_MORE_EVIDENCE:task_record_invalid/);
    const spent = { journey: "J", units: [{ unit_id: "W1", unit_kind: "wave", assurance_rounds: 1 }] };
    assert.match(ask(spent, "wave").reason, /HALT:assurance_round_limit/);
    assert.match(ask(spent, "phase").reason, /HALT:assurance_round_limit/);
    const duplicated = { journey: "J", units: [{ unit_id: "W1", assurance_rounds: 0 }, { unit_id: "W1", assurance_rounds: 1 }] };
    assert.match(ask(duplicated, "wave").reason, /task_record_duplicate_unit/);
    assert.match(ask({ journey: "J", units: [] }, "wave").reason, /assurance_budget:PASS/);
  });
});

describe("#209 atomic reservation", () => {
  const race = (root, commands) => Promise.all(commands.map((command) => new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK, "--host=claude-code"], { env: parentEnv() });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("close", () => resolve(JSON.parse(out.trim() || "{}")));
    child.stdin.end(JSON.stringify(envelope("claude-code", root, command)));
  })));
  const allowedCount = (wires) => wires.filter((wire) => !wire.hookSpecificOutput).length;

  it("simultaneous launches on an open 0 record reserve exactly one round", async () => {
    const root = checkout({ round: { assurance_slots: ["reviewer"] } });
    const wires = await race(root, Array.from({ length: 8 }, () => launchCommand(root, "reviewer")));
    assert.equal(allowedCount(wires), 1, JSON.stringify(wires));
    const book = ledgerOf(root);
    assert.equal(book.units[0].assurance_rounds, 1);
    assert.equal(book.events.length, 1);
    assert.ok(!existsSync(path.join(root, ".bearing-assurance.json.lock")), "lock released");
  });

  it("an approved parallel review group is one round; extra sampling and retries never join", async () => {
    const root = checkout({ round: { assurance_slots: ["reviewer:a", "reviewer:b"] } });
    const slot = (name) => launchCommand(root, "reviewer", `BEARING_REVIEW_SLOT=${name}`);
    const wires = await race(root, [slot("reviewer:a"), slot("reviewer:b"), slot("reviewer:a"), slot("reviewer:b")]);
    assert.equal(allowedCount(wires), 2, JSON.stringify(wires));
    assert.match(hostLaunch("claude-code", root, slot("reviewer:c")).reason, /assurance_slot_not_approved/);
    setRound(root, { assurance_slots: ["reviewer:a", "reviewer:b", "reviewer:c"] });
    assert.match(hostLaunch("claude-code", root, slot("reviewer:c")).reason, /assurance_slot_not_approved/, "open round slots are frozen");
    const book = ledgerOf(root);
    assert.equal(book.units[0].assurance_rounds, 1);
    assert.equal(book.events.length, 2);
  });

  it("one tool call carrying two launches is refused rather than half-reserved", () => {
    const root = checkout();
    const two = `${launchCommand(root, "reviewer")}; ${launchCommand(root, "test_engineer.assurance")}`;
    assert.match(hostLaunch("claude-code", root, two).reason, /multiple_launches_in_one_call/);
    assert.deepEqual(ledgerOf(root).events, []);
  });
});

describe("#209 renames, resume, qualification, and amendments", () => {
  it("candidate, model, harness, session, packet, and activity renames keep the spent allowance", () => {
    const root = checkout({ round: { assurance_slots: ["reviewer"] } });
    assert.equal(hostLaunch("claude-code", root, launchCommand(root, "reviewer")), null);
    for (const extra of ["BEARING_MODEL=other-model", "BEARING_HARNESS=other", "BEARING_SESSION=resumed",
      "BEARING_PACKET=renamed-packet", "BEARING_ACTIVITY=qualification-run", "BEARING_ROUND=2"]) {
      assert.match(hostLaunch("copilot", root, launchCommand(root, "reviewer", extra)).reason, /assurance_slot_already_launched/, extra);
    }
    setRound(root, { candidate: "cand-2", generation: 2 });
    assert.match(hostLaunch("cursor", root, launchCommand(root, "Reviewer")).reason, /assurance_round_limit/);
    setLedger(root, (book) => { book.units[0].unit_kind = "phase"; });
    assert.match(hostLaunch("claude-code", root, launchCommand(root, "reviewer")).reason, /assurance_round_limit/, "kind relabel");
    // Resume: a later session reads the same durable ledger.
    assert.match(hostLaunch("codex", root, launchCommand(root, "reviewer.resume")).reason, /assurance_round_limit/);
    assert.equal(launched(root).length, 1);
    // The next distinct declared unit carries its own budget.
    setRound(root, { assurance_unit: "W2" });
    assert.equal(hostLaunch("claude-code", root, launchCommand(root, "reviewer")), null);
  });

  it("qualification needs an owner-recorded bounded grant and never spends or renames a review", () => {
    const root = checkout({ round: { assurance_slots: ["reviewer"] } });
    const qualify = launchCommand(root, "reviewer", "BEARING_QUALIFICATION=Q1");
    assert.match(hostLaunch("claude-code", root, qualify).reason, /qualification_unauthorized/);
    setLedger(root, (book) => { book.qualifications = [{ id: "Q1", unit_id: "W1", slot: "reviewer", authorized_by: "parent", decision_ref: "DEC-1", max_launches: 1 }]; });
    assert.match(hostLaunch("claude-code", root, qualify).reason, /qualification_unauthorized/);
    setLedger(root, (book) => { book.qualifications[0].authorized_by = "owner"; });
    assert.equal(hostLaunch("claude-code", root, qualify), null);
    assert.match(hostLaunch("claude-code", root, qualify).reason, /qualification_exhausted/);
    assert.deepEqual(ledgerOf(root).units.map((u) => u.assurance_rounds), [0]);
    assert.equal(hostLaunch("claude-code", root, launchCommand(root, "reviewer")), null, "the review budget is untouched");
  });

  it("a bounded owner amendment adds exact allowance and keeps original expenditure visible", () => {
    const root = checkout({ round: { assurance_slots: ["reviewer"] } });
    assert.equal(hostLaunch("claude-code", root, launchCommand(root, "reviewer")), null);
    setRound(root, { candidate: "cand-2" });
    // Tool-asserted flags grant nothing.
    const asserted = envelope("claude-code", root, launchCommand(root, "reviewer", "BEARING_OWNER_AMENDMENT=1"));
    asserted.owner_amendment = { additional_rounds: 1 };
    asserted.tool_input.amendment = true;
    assert.equal(dispatch().handle(asserted).verdict, "DENY_DISPATCH");
    setLedger(root, (book) => { book.amendments = [{ unit_id: "W1", additional_rounds: 1, authorized_by: "parent", decision_ref: "DEC-9", scope: "W1 re-review of cand-2" }]; });
    assert.match(hostLaunch("claude-code", root, launchCommand(root, "reviewer")).reason, /amendment_invalid/);
    setLedger(root, (book) => { book.amendments[0].authorized_by = "owner"; });
    assert.equal(hostLaunch("claude-code", root, launchCommand(root, "reviewer")), null);
    setRound(root, { candidate: "cand-3" });
    assert.match(hostLaunch("claude-code", root, launchCommand(root, "reviewer")).reason, /assurance_round_limit/);
    const book = ledgerOf(root);
    assert.equal(book.units[0].assurance_rounds, 2);
    assert.deepEqual(book.events.map((event) => [event.type, event.candidate]), [["round_opened", "cand-1"], ["round_opened", "cand-2"]]);
  });
});

describe("#209 ordinary work, guards, and honest host capability", () => {
  it("ordinary commands, argument mentions, and non-assurance roles pass with no Bearing state", () => {
    const root = checkout({ omit: ["ledger", "round"] });
    for (const command of ["node -e 0", "grep BEARING_ROLE=reviewer /dev/null || true", "echo 'BEARING_ROLE=reviewer'",
      "BEARING_ROLE=implementer node -e 0", "BEARING_ROLE=test_engineer.planning node -e 0"]) {
      assert.equal(hostLaunch("claude-code", root, command), null, command);
    }
  });

  it("only the parent may write the ledger; the write lock refuses assurance roles", () => {
    const root = checkout();
    for (const role of ["reviewer", "repair_implementer", "test_engineer", "integration_engineer"]) {
      const out = writeLock.handle({ ...fixture("claude-pretooluse-product-write.json"), cwd: root,
        tool_input: { file_path: path.join(root, ".bearing-assurance.json") } }, { role, host: "claude-code" });
      assert.equal(out.hookSpecificOutput.verdict, "DENY_DISPATCH", role);
      const shell = writeLock.handle({ ...fixture("claude-pretooluse-product-write.json"), cwd: root, tool_name: "Bash",
        tool_input: { command: "echo '{}' > .bearing-assurance.json" } }, { role, host: "claude-code" });
      assert.equal(shell.hookSpecificOutput.verdict, "DENY_DISPATCH", role);
    }
  });

  it("declares native support for exactly the registered hosts and stays procedural elsewhere", () => {
    assert.deepEqual(Object.keys(dispatch().HOST_SUPPORT).sort(), ["claude-code", "codex", "copilot", "cursor"]);
    const root = checkout();
    for (const host of ["agy", "pi", "deepcode", "qwen", "kimi", "grok"]) {
      const out = dispatch().handle(envelope("claude-code", root, launchCommand(root, "reviewer")), { host });
      assert.equal(out.verdict, "UNAVAILABLE", host);
      assert.match(out.reason, /procedural/);
    }
    const mapping = readFileSync(path.join(ROOT, "hooks/com.anthropic.claude-code/mapping.md"), "utf8");
    const section = mapping.slice(mapping.indexOf("## Assurance dispatch barrier"));
    for (const host of ["Claude Code", "Codex", "Cursor", "GitHub Copilot"]) {
      assert.match(section, new RegExp(`\\| ${host} \\| native`), host);
    }
    assert.match(section, /AGY, Pi, DeepCode \| skills-only/);
    assert.match(section, /component replay/);
  });
});
