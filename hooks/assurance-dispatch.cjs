#!/usr/bin/env node
"use strict";

/**
 * Pre-dispatch assurance budget barrier (#209). A PreToolUse / Cursor
 * beforeShellExecution adapter that runs before a bound assurance session can
 * start: a launch whose leading environment carries `BEARING_ROLE=` an
 * assurance role (reviewer, test_engineer.assurance,
 * integration_engineer.execution) or repair_implementer, or a subagent tool
 * whose `subagent_type` names one. Anything else is ordinary work and passes.
 *
 * Authority comes only from parent-owned files at the checkout root, never
 * from tool input: the round record `.bearing-round.lock` (candidate,
 * assurance_unit, assurance_slots) and the assurance ledger
 * `.bearing-assurance.json` (journey, frozen declaration_path, units[],
 * amendments[], qualifications[], hash-chained events[]). The existing
 * evaluator in assurance-budget.cjs decides each new round; this adapter
 * reserves it atomically under an exclusive lock so concurrent launches cannot
 * share one remaining allowance. Missing, corrupt, or rewritten state denies.
 * Always exit 0.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { evaluateAssuranceBudget, POLICY } = require("./assurance-budget.cjs");

const ALLOW = "ALLOW";
const DENY = "DENY_DISPATCH";
const UNAVAILABLE = "UNAVAILABLE";
const LEDGER = ".bearing-assurance.json";
const ROUND_RECORD = ".bearing-round.lock";
const LOCK_SUFFIX = ".lock";
const LOCK_DEADLINE_MS = 2000;
const ASSURANCE_ROLES = new Set(["reviewer", "test_engineer.assurance", "integration_engineer.execution"]);
const REPAIR_ROLE = "repair_implementer";
const WRITE_EVENTS = new Set(["pretooluse", "beforeshellexecution"]);
const SUBAGENT_TOOLS = new Set(["task", "agent"]);

/**
 * Host capability for this barrier. `native`: the host runs a pre-launch hook
 * with a hard deny and this package registers the adapter there. Hosts absent
 * here (AGY, Pi, DeepCode) are skills-only; the budget is procedural there.
 */
const HOST_SUPPORT = Object.freeze({
  "claude-code": "native",
  codex: "native",
  cursor: "native",
  copilot: "native",
});
const DEFAULT_HOST = "claude-code";

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function normalizeRole(value) {
  const role = text(value);
  return role ? role.toLowerCase().replace(/[\s-]+/g, "_") : "";
}

function launchRole(value) {
  const role = normalizeRole(value);
  if (ASSURANCE_ROLES.has(role) || role === REPAIR_ROLE) return role;
  // A reviewer session suffix (reviewer.phase) is still a Reviewer launch.
  if (role.split(".")[0] === "reviewer") return "reviewer";
  return null;
}

function unquote(token) {
  return token.replace(/^(['"])(.*)\1$/, "$2");
}

/**
 * Leading environment assignments of each simple command (`A=b cmd`,
 * `env A=b cmd`, `export A=b`). A later word such as `grep BEARING_ROLE=x`
 * is an argument, not a carrier.
 */
function commandCarriers(command) {
  const found = [];
  if (typeof command !== "string") return found;
  for (const segment of command.split(/[;\n|&()]+/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean).map(unquote);
    const env = {};
    let i = 0;
    if (words[i] === "env" || words[i] === "export") i += 1;
    while (i < words.length && /^-/.test(words[i]) && words[0] === "env") i += 1;
    for (; i < words.length; i += 1) {
      const match = words[i].match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) break;
      env[match[1]] = unquote(match[2]);
    }
    if (env.BEARING_ROLE !== undefined) found.push(env);
  }
  return found;
}

/** The bound launch named by the tool call, or null for ordinary work. */
function launchFrom(input) {
  const toolInput = isPlainObject(input.tool_input)
    ? input.tool_input
    : isPlainObject(input.toolInput) ? input.toolInput : {};
  const tool = normalizeRole(input.tool_name || input.toolName);
  const launches = [];
  if (SUBAGENT_TOOLS.has(tool)) {
    const role = launchRole(toolInput.subagent_type || toolInput.subagentType);
    if (role) launches.push({ role, slot: role });
  }
  for (const env of commandCarriers(text(toolInput.command) || text(input.command))) {
    const role = launchRole(env.BEARING_ROLE);
    if (!role) continue;
    launches.push({
      role,
      slot: text(env.BEARING_REVIEW_SLOT) || role,
      qualification: text(env.BEARING_QUALIFICATION),
    });
  }
  return launches;
}

function readJsonObject(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function inside(root, rel) {
  const name = text(rel);
  if (!name) return null;
  const abs = path.resolve(root, name);
  const back = path.relative(root, abs);
  return back && !back.startsWith("..") && !path.isAbsolute(back) ? abs : null;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Exclusive cross-process lock; contention past the deadline fails closed. */
function withLock(file, fn) {
  const lock = file + LOCK_SUFFIX;
  const deadline = Date.now() + LOCK_DEADLINE_MS;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(lock, "wx");
      break;
    } catch (err) {
      if (!err || err.code !== "EEXIST" || Date.now() > deadline) return null;
      sleepMs(5);
    }
  }
  try {
    fs.writeSync(fd, String(process.pid));
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function eventDigest(prev, event) {
  const { digest, ...core } = event;
  return sha256(prev + "\n" + JSON.stringify(core));
}

/** Verify the append-only chain and derive spent counts per unit from it. */
function replay(ledger) {
  const state = new Map();
  const unit = (id) => {
    if (!state.has(id)) state.set(id, { rounds: [], repairs: 0, qualifications: new Map() });
    return state.get(id);
  };
  let prev = "";
  for (const event of ledger.events) {
    if (!isPlainObject(event) || event.prev !== prev || event.digest !== eventDigest(prev, event)) return null;
    prev = event.digest;
    const entry = unit(event.unit_id);
    if (event.type === "round_opened") {
      entry.rounds.push({ candidate: event.candidate, slots: event.slots, launched: [event.slot], repaired: false });
    } else if (event.type === "slot_launched") {
      const round = entry.rounds[entry.rounds.length - 1];
      if (!round) return null;
      round.launched.push(event.slot);
    } else if (event.type === "repair_launched") {
      const round = entry.rounds[entry.rounds.length - 1];
      if (!round) return null;
      round.repaired = true;
      entry.repairs += 1;
    } else if (event.type === "qualification_launched") {
      entry.qualifications.set(event.qualification, (entry.qualifications.get(event.qualification) || 0) + 1);
    } else {
      return null;
    }
  }
  return { state, head: prev };
}

function validLedger(ledger) {
  return (
    isPlainObject(ledger) &&
    text(ledger.journey) &&
    text(ledger.declaration_path) &&
    Array.isArray(ledger.units) &&
    Array.isArray(ledger.events) &&
    (ledger.amendments === undefined || Array.isArray(ledger.amendments)) &&
    (ledger.qualifications === undefined || Array.isArray(ledger.qualifications))
  );
}

const deny = (outcome, reason) => ({ verdict: DENY, outcome, reason });

/**
 * Evaluate and, when allowed, durably record one launch.
 * @param {{ root: string, launch: { role: string, slot: string, qualification?: string } }} request
 */
function reserve({ root, launch }) {
  const round = readJsonObject(path.join(root, ROUND_RECORD));
  const slots = round && round.assurance_slots;
  if (
    !round || !text(round.candidate) || !text(round.assurance_unit) ||
    !Array.isArray(slots) || !slots.length || !slots.every(text) || new Set(slots).size !== slots.length
  ) {
    return deny("NEEDS_MORE_EVIDENCE", "round_record_missing: the parent has not bound candidate, assurance_unit, and assurance_slots");
  }
  const ledgerPath = path.join(root, LEDGER);
  const result = withLock(ledgerPath, () => {
    const ledger = readJsonObject(ledgerPath);
    if (!ledger) return deny("NEEDS_MORE_EVIDENCE", "assurance_ledger_missing");
    if (!validLedger(ledger)) return deny("NEEDS_MORE_EVIDENCE", "assurance_ledger_invalid");
    const replayed = replay(ledger);
    if (!replayed) return deny("NEEDS_MORE_EVIDENCE", "assurance_ledger_tampered: events[] chain does not verify");
    const declarationPath = inside(root, ledger.declaration_path);
    const declaration = declarationPath && readJsonObject(declarationPath);
    if (!declaration) return deny("NEEDS_MORE_EVIDENCE", "frozen_declaration_unreadable");
    // Canonical unit identity comes from the frozen declaration.
    const unitKind = Array.isArray(declaration.waves) && declaration.waves.length ? "wave" : "phase";
    const unitId = text(round.assurance_unit);
    const spent = replayed.state.get(unitId) || { rounds: [], repairs: 0, qualifications: new Map() };
    // Recorded counters never fall below what the chain proves was spent.
    for (const [id, entry] of replayed.state) {
      const rows = ledger.units.filter((row) => isPlainObject(row) && row.unit_id === id);
      const rounds = rows.length === 1 ? rows[0].assurance_rounds : undefined;
      const repairs = rows.length === 1 ? rows[0].assurance_repairs ?? 0 : undefined;
      if (rows.length !== 1 || rounds !== entry.rounds.length || !(repairs >= entry.repairs)) {
        return deny("NEEDS_MORE_EVIDENCE", `assurance_ledger_tampered: units[] for ${id} differs from events[]`);
      }
    }
    const append = (event) => {
      const full = { ...event, unit_id: unitId, prev: replayed.head };
      full.digest = eventDigest(replayed.head, full);
      ledger.events.push(full);
      let row = ledger.units.find((item) => isPlainObject(item) && item.unit_id === unitId);
      if (!row) {
        row = { unit_id: unitId, unit_kind: unitKind, assurance_rounds: 0, assurance_repairs: 0 };
        ledger.units.push(row);
      }
      if (event.type === "round_opened") row.assurance_rounds += 1;
      if (event.type === "repair_launched") row.assurance_repairs = (row.assurance_repairs || 0) + 1;
      writeAtomic(ledgerPath, ledger);
    };
    const budget = () => evaluateAssuranceBudget({
      journey: ledger.journey,
      unit_kind: unitKind,
      assurance_unit: unitId,
      request_scope: unitKind,
      declaration_path: declarationPath,
      task_record_path: ledgerPath,
    });

    if (launch.qualification) {
      // Qualification is owner-recorded and bounded; a carrier alone is nothing.
      const grant = (ledger.qualifications || []).find((item) => isPlainObject(item) && item.id === launch.qualification);
      if (
        !grant || grant.authorized_by !== "owner" || !text(grant.decision_ref) || grant.unit_id !== unitId ||
        grant.slot !== launch.slot || !Number.isInteger(grant.max_launches) || grant.max_launches < 1
      ) {
        return deny("OWNER_AMENDMENT_REQUIRED", "qualification_unauthorized");
      }
      if ((spent.qualifications.get(grant.id) || 0) >= grant.max_launches) {
        return deny("HALT", "qualification_exhausted");
      }
      append({ type: "qualification_launched", qualification: grant.id, slot: launch.slot, candidate: round.candidate });
      return { verdict: ALLOW, outcome: "PASS", reason: "qualification_launch_recorded" };
    }

    if (launch.role === REPAIR_ROLE) {
      if (!spent.rounds.length) return deny("OWNER_AMENDMENT_REQUIRED", "repair_without_review_round");
      const check = budget();
      // The evaluator HALTs on a spent round; a repair is judged on repairs only.
      if (check.outcome !== "PASS" && check.reason !== "assurance_round_limit") return deny(check.outcome, check.reason);
      const row = ledger.units.find((item) => isPlainObject(item) && item.unit_id === unitId);
      const repairs = row ? row.assurance_repairs || 0 : 0;
      const extra = (ledger.amendments || [])
        .filter((item) => isPlainObject(item) && item.unit_id === unitId)
        .reduce((sum, item) => sum + (Number.isInteger(item.additional_repairs) ? item.additional_repairs : 0), 0);
      if (repairs >= POLICY.aggregated_repairs_max + extra) return deny("HALT", "assurance_repair_limit");
      append({ type: "repair_launched", slot: launch.slot, candidate: round.candidate });
      return { verdict: ALLOW, outcome: "PASS", reason: "repair_launch_recorded" };
    }

    // Join the open round: same candidate, an approved slot, not yet launched,
    // and no repair since it opened. Retries and extra sampling never join.
    const open = spent.rounds[spent.rounds.length - 1];
    if (open && open.candidate === round.candidate && !open.repaired) {
      if (!open.slots.includes(launch.slot)) return deny("OWNER_AMENDMENT_REQUIRED", "assurance_slot_not_approved");
      if (open.launched.includes(launch.slot)) return deny("HALT", "assurance_slot_already_launched");
      append({ type: "slot_launched", slot: launch.slot, candidate: round.candidate });
      return { verdict: ALLOW, outcome: "PASS", reason: "assurance_round_slot_recorded" };
    }
    if (!slots.includes(launch.slot)) return deny("OWNER_AMENDMENT_REQUIRED", "assurance_slot_not_approved");
    const check = budget();
    if (check.outcome !== "PASS") return deny(check.outcome, check.reason);
    append({ type: "round_opened", slot: launch.slot, slots: [...slots], candidate: round.candidate });
    return { verdict: ALLOW, outcome: "PASS", reason: "assurance_round_reserved" };
  });
  return result || deny("NEEDS_MORE_EVIDENCE", "assurance_ledger_busy");
}

function normalizeEvent(name) {
  return typeof name === "string" ? name.trim().replace(/[_\-\s]/g, "").toLowerCase() : "";
}

/**
 * @param {unknown} envelope host PreToolUse / beforeShellExecution payload
 * @param {{ host?: string }} [options]
 */
function handle(envelope, options = {}) {
  let input = envelope;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return { verdict: UNAVAILABLE, reason: "malformed_input" };
    }
  }
  if (!isPlainObject(input)) return { verdict: UNAVAILABLE, reason: "malformed_input" };
  const host = text(options.host) || DEFAULT_HOST;
  const event = input.hook_event_name || input.hookEventName || input.event || "";
  if (event && !WRITE_EVENTS.has(normalizeEvent(event))) {
    return { verdict: UNAVAILABLE, reason: "unmapped_host_event", host };
  }
  const launches = launchFrom(input);
  if (!launches.length) return { verdict: ALLOW, reason: "not_bound_assurance_launch", host };
  if (HOST_SUPPORT[host] !== "native") {
    return { verdict: UNAVAILABLE, reason: `host_enforcement_unavailable: ${host} is procedural`, host };
  }
  const root = path.resolve(text(input.cwd) || text(input.workspaceRoot) || process.cwd());
  // One tool call may carry several launches; all must be reserved or none run.
  if (launches.length > 1) {
    return { ...deny("OWNER_AMENDMENT_REQUIRED", "multiple_launches_in_one_call: dispatch each slot separately"), host };
  }
  return { ...reserve({ root, launch: launches[0] }), host };
}

/** Host wire: the shared PreToolUse deny, plus Cursor's `permission` field. */
function toWire(result) {
  if (result.verdict !== DENY) return {};
  const reason = `Bearing Lite assurance_dispatch: ${result.outcome} — ${result.reason}`;
  const wire = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  if (result.host === "cursor") {
    wire.permission = "deny";
    wire.userMessage = reason;
    wire.agentMessage = reason;
  }
  return wire;
}

function main() {
  let result;
  try {
    const arg = process.argv.slice(2).find((item) => item.startsWith("--host="));
    result = handle(fs.readFileSync(0, "utf8"), { host: arg ? arg.slice(7) : process.env.BEARING_HOST });
  } catch {
    // An adapter fault on a bound launch must not read as an allowed launch.
    result = { verdict: DENY, outcome: "NEEDS_MORE_EVIDENCE", reason: "adapter_failure" };
  }
  process.stderr.write(JSON.stringify(result) + "\n");
  process.stdout.write(JSON.stringify(toWire(result)) + "\n");
  process.exit(0);
}

module.exports = { HOST_SUPPORT, LEDGER, ROUND_RECORD, handle, reserve, launchFrom, toWire, eventDigest };

if (require.main === module) main();
