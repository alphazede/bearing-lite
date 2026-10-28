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
    assert.equal(record.repair_transition.receipt_sha256, undefined, "parent authority is never changed by pinning");
    const pins = require("node:fs").readdirSync(root).filter(name => name.startsWith(".bearing-round.lock.receipt-") && !name.endsWith(".lock"));
    assert.equal(pins.length, 1);
    const pin = JSON.parse(readFileSync(path.join(root, pins[0])));
    assert.equal(pin.receipt_sha256,
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

// F03/F05: retained receipt identity and parent revocation; owned filesystem fixtures only.
const rawFs = require('node:fs');
const advanceCheckout = () => checkout({transition:{authorization:'advance',parent_accepted:'IN_SCOPE_REPAIR',repairs_max:1,write_set:LISTED,receipt_sha256:undefined}});
const pinFiles = root => rawFs.readdirSync(root).filter(n=>n.startsWith('.bearing-round.lock.receipt-')&&!n.endsWith('.lock')).map(n=>path.join(root,n));
const controlOf = root => path.join(root,'.bearing-round.lock');
const changeControl = (root,mutate) => {const file=controlOf(root),v=JSON.parse(readFileSync(file,'utf8'));mutate(v);writeFileSync(file,JSON.stringify(v));};
for(const mutation of ['close','generation','context','write-set','candidate','delete']) it(`F05 preserves parent ${mutation} during pin publication`,()=>{
 const root=advanceCheckout(),originalRename=rawFs.renameSync;
 let exercised=false,parentBytes;
 rawFs.renameSync=function(from,to){
  if((String(to)===controlOf(root)||String(to).includes('.bearing-round.lock.receipt-'))&&!exercised){
   exercised=true;
   assert.equal(verdict(claudeEdit(root,'.bearing-round.lock'),'orchestrator').verdict,'ALLOW');
   if(mutation==='delete')rawFs.unlinkSync(controlOf(root));
   else changeControl(root,r=>{
    if(mutation==='close')r.repair_transition.repair_round='closed';
    if(mutation==='generation')r.generation++;
    if(mutation==='context')r.repair_transition.reviewer_context='new-context';
    if(mutation==='write-set')r.repair_transition.write_set=[];
    if(mutation==='candidate')r.candidate='different';
   });
   parentBytes=existsSync(controlOf(root))?readFileSync(controlOf(root),'utf8'):null;
  }
  return originalRename.call(this,from,to);
 };
 let out;try{out=verdict(claudeEdit(root,LISTED[0]));}finally{rawFs.renameSync=originalRename;}
 assert.equal(exercised,true);denied(out,/repair_authority_changed/);
 assert.equal(existsSync(controlOf(root))?readFileSync(controlOf(root),'utf8'):null,parentBytes);
 denied(verdict(claudeEdit(root,LISTED[0])));
});
it('F05 does not write the parent record and preserves legacy parent pin',()=>{
 for(const root of [advanceCheckout(),checkout()]){
  const bytes=readFileSync(controlOf(root),'utf8');
  assert.equal(verdict(claudeEdit(root,LISTED[0])).verdict,'ALLOW');
  assert.equal(readFileSync(controlOf(root),'utf8'),bytes);
 }
});
it('F05 metadata extends existing parent-control namespace on native envelopes',()=>{
 const root=advanceCheckout();assert.equal(verdict(claudeEdit(root,LISTED[0])).verdict,'ALLOW');
 const pin=pinFiles(root)[0];
 for(const role of ['reviewer','repair_implementer','implementer','test_engineer']){
  denied(verdict(claudeEdit(root,pin),role),/only the parent controller/);
  denied(verdict(codexPatch(root,pin),role,'codex'),/only the parent controller/);
 }
 denied(verdict({...claudeEdit(root,pin),agent_id:'child'},null));
 for(const command of [`printf changed > ${pin}`,`rm ${pin}`,`mv ${pin} ${pin}.gone`]){
  denied(cliVerdict(root,claudeEdit(root,pin,{tool_name:'Bash',tool_input:{command}})),/only the parent controller/);
 }
 assert.equal(verdict(claudeEdit(root,pin),'orchestrator').verdict,'ALLOW');
});
it('F05 pins once per identity and cannot repin edited proof after scope changes',()=>{
 const root=advanceCheckout();assert.equal(verdict(claudeEdit(root,LISTED[0])).verdict,'ALLOW');
 const pin=pinFiles(root)[0],pinBytes=readFileSync(pin,'utf8');
 const receipt=path.join(root,'.bearing/review/receipt.json');writeFileSync(receipt,readFileSync(receipt,'utf8')+' ');
 changeControl(root,r=>r.repair_transition.write_set=[...r.repair_transition.write_set,UNLISTED]);
 denied(verdict(claudeEdit(root,LISTED[0])),/digest_mismatch/);
 assert.equal(readFileSync(pin,'utf8'),pinBytes);
});
it('F05 retains pin across close/reopen and changes namespace only for new lineage',()=>{
 const root=advanceCheckout();assert.equal(verdict(claudeEdit(root,LISTED[0])).verdict,'ALLOW');
 const first=pinFiles(root)[0];changeControl(root,r=>r.repair_transition.repair_round='closed');
 denied(verdict(claudeEdit(root,LISTED[0])),/round_closed/);
 changeControl(root,r=>r.repair_transition.repair_round='open');assert.equal(verdict(claudeEdit(root,LISTED[0])).verdict,'ALLOW');
 changeControl(root,r=>{r.generation++;r.repair_transition.generation++;});
 const file=path.join(root,'.bearing/review/receipt.json'),receipt=JSON.parse(readFileSync(file));receipt.lineage.generation++;
 writeFileSync(file,JSON.stringify(receipt));assert.equal(verdict(claudeEdit(root,LISTED[0])).verdict,'ALLOW');
 assert.equal(pinFiles(root).length,2);assert.equal(existsSync(first),true);
});
it('F05 fails closed on pin cleanup exceptions',()=>{
 const root=advanceCheckout(),old=rawFs.rmdirSync;
 rawFs.rmdirSync=function(file,...args){if(String(file).includes('.bearing-round.lock.receipt-'))throw Object.assign(Error('owned cleanup failure'),{code:'ENOTEMPTY'});return old.call(this,file,...args);};
 let out;try{out=verdict(claudeEdit(root,LISTED[0]));}finally{rawFs.rmdirSync=old;}
 denied(out,/repair_pin_unavailable/);
 assert.equal(JSON.parse(readFileSync(controlOf(root))).repair_transition.receipt_sha256,undefined);
});
it('F05 fails closed on malformed or symlinked stored pin',()=>{
 for(const scenario of ['malformed','symlink']){
  const root=advanceCheckout();assert.equal(verdict(claudeEdit(root,LISTED[0])).verdict,'ALLOW');
  const pin=pinFiles(root)[0];
  if(scenario==='malformed')writeFileSync(pin,'{');
  else {rawFs.unlinkSync(pin);symlinkSync(path.join(root,'.bearing/review/receipt.json'),pin);}
  denied(verdict(claudeEdit(root,LISTED[0])),/pin_unavailable|record_unavailable/);
 }
});
it('F05 changed proof during pin publication is refused',()=>{
 const root=advanceCheckout(),old=rawFs.renameSync;let exercised=false;
 rawFs.renameSync=function(from,to){if((String(to)===controlOf(root)||String(to).includes('.bearing-round.lock.receipt-'))&&!exercised){exercised=true;const p=path.join(root,'.bearing/review/receipt.json');writeFileSync(p,readFileSync(p,'utf8')+' ');}return old.call(this,from,to);};
 let out;try{out=verdict(claudeEdit(root,LISTED[0]));}finally{rawFs.renameSync=old;}
 assert.equal(exercised,true);denied(out,/digest_mismatch/);
});
it('F05 initializer does not reset existing or malformed records',()=>{
 const store=require('../hooks/assurance-budget-store.cjs'),root=advanceCheckout(),file=path.join(root,'seed.json');
 const init=()=>store.update({task_record_path:file,create_if_missing:true},record=>{record.count=(record.count||0)+1;return store.result('PASS','checked');});
 assert.equal(init().outcome,'PASS');assert.equal(init().outcome,'PASS');assert.equal(JSON.parse(readFileSync(file)).count,2);
 writeFileSync(file,'{');assert.equal(init().outcome,'NEEDS_MORE_EVIDENCE');assert.equal(readFileSync(file,'utf8'),'{');
 rawFs.unlinkSync(file);assert.equal(store.update({task_record_path:file},()=>store.result('PASS','unexpected')).outcome,'NEEDS_MORE_EVIDENCE');
 assert.equal(existsSync(file),false);
});

it('F05 root pin survives ordinary .bearing cleanup and refuses edited receipt',()=>{
 const root=advanceCheckout();assert.equal(verdict(claudeEdit(root,LISTED[0])).verdict,'ALLOW');
 const pin=pinFiles(root)[0],pinBytes=readFileSync(pin,'utf8');
 const command='rm -rf .bearing';
 assert.equal(cliVerdict(root,claudeEdit(root,'.bearing',{tool_name:'Bash',tool_input:{command}})).verdict,'ALLOW');
 assert.equal(spawnSync('rm',['-rf','.bearing'],{cwd:root}).status,0);
 mkdirSync(path.join(root,'.bearing/review'),{recursive:true});
 const original=JSON.parse(readFileSync(pin,'utf8'));assert.equal(original.receipt_sha256.length,64);
 // Recreate the valid receipt with changed bytes using the unchanged parent candidate/lineage.
 const c=JSON.parse(readFileSync(controlOf(root),'utf8')).repair_transition;
 writeFileSync(path.join(root,'.bearing/review/receipt.json'),JSON.stringify({candidate_ref:c.candidate_ref,candidate_revision:c.candidate_revision,candidate_digest:c.candidate_digest,verdict:'REPAIR_REQUIRED',finding_ids:['F1'],write_set:LISTED,lineage:{worktree:'.',branch:c.branch,generation:c.generation}}));
 denied(verdict(claudeEdit(root,LISTED[0])),/digest_mismatch/);assert.equal(readFileSync(pin,'utf8'),pinBytes);
});
it('F05 root pin explicit deletion and control-prefix shell glob are protected',()=>{
 const root=advanceCheckout();assert.equal(verdict(claudeEdit(root,LISTED[0])).verdict,'ALLOW');
 const pin=pinFiles(root)[0],bytes=readFileSync(pin,'utf8');
 for(const command of [`rm ${pin}`,`mv ${pin} ${pin}.gone`,'rm .bearing-round.lock.receipt-*']){
  const out=cliVerdict(root,claudeEdit(root,pin,{tool_name:'Bash',tool_input:{command}}));denied(out,/only the parent controller/);
 }
 assert.equal(readFileSync(pin,'utf8'),bytes);
});
it('F05 root pin concurrent edited-receipt writes cannot replace first digest',async()=>{
 const root=advanceCheckout(),initial=readFileSync(path.join(root,'.bearing/review/receipt.json'),'utf8');
 assert.equal(verdict(claudeEdit(root,LISTED[0])).verdict,'ALLOW');
 const pin=pinFiles(root)[0],bytes=readFileSync(pin,'utf8');
 writeFileSync(path.join(root,'.bearing/review/receipt.json'),initial+' ');
 const request=file=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[HOOK,'--host=claude-code'],{cwd:root,env:{...process.env,BEARING_ROLE:'reviewer'},stdio:['pipe','pipe','pipe']});let stderr='';child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(stderr).hookSpecificOutput):reject(Error(stderr)));child.stdin.end(JSON.stringify(claudeEdit(root,file)));});
 const out=await Promise.all([request(LISTED[0]),request(LISTED[1])]);out.forEach(x=>denied(x,/digest_mismatch/));assert.equal(readFileSync(pin,'utf8'),bytes);
});

// Real CLI regression: only owned filesystem operations inject the observed cleanup failure.
it('F03 cleanup failure preserves wire denial after parent revocation', () => {
  const root = advanceCheckout();
  const preloader = path.join(root, 'cleanup-preload.cjs');
  writeFileSync(preloader, `const fs=require('node:fs'),path=require('node:path');
const control=path.join(process.env.REPAIR_FIXTURE_ROOT,'.bearing-round.lock');
const read=fs.readFileSync,write=fs.writeFileSync,rename=fs.renameSync;
let exercised=false;
function revoke(lock){exercised=true;const record=JSON.parse(read(control,'utf8'));record.repair_transition.repair_round='closed';write(control,JSON.stringify(record));write(path.join(lock,'owned-child'),'owned failure');}
fs.readFileSync=function(file,...args){if(String(file)===control&&!exercised&&fs.existsSync(control+'.lock'))revoke(control+'.lock');return read.call(this,file,...args);};
fs.renameSync=function(from,to){if(String(to).includes('.bearing-round.lock.receipt-')&&!exercised)revoke(String(to)+'.lock');return rename.call(this,from,to);};
`);
  const run = spawnSync(process.execPath, ['-r', preloader, HOOK, '--host=claude-code'], {
    cwd: root, env: { ...process.env, BEARING_ROLE: 'reviewer', REPAIR_FIXTURE_ROOT: root },
    input: JSON.stringify(withTask(claudeEdit(root, LISTED[0]))), encoding: 'utf8', timeout: 15000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(readFileSync(controlOf(root))).repair_transition.repair_round, 'closed', 'owned revocation must be exercised');
  assert.equal(JSON.parse(run.stdout).hookSpecificOutput?.permissionDecision, 'deny', 'cleanup failure must retain native wire denial');
  assert.equal(JSON.parse(run.stderr).hookSpecificOutput.verdict, 'DENY_DISPATCH');
});
