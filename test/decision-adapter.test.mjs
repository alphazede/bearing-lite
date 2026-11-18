// S10T (Bearing 3.0, W3): advisory decision adapter (N07, DES-F06).
// Oracle: boundary contract SM02 / TB04 / TB05 / F06 (sha256 568a2121...), SEIT-B30-202,
// -208, -210, -212, -213, -214, -220, -221, -222, -223, -225, -226, -227, -229, -232,
// -240, -241 (adapter side), SEIT-F06, SEIT-SM02-T, SEIT-SM02-X, SEIT-TB04-N, SEIT-TB05-N;
// DEC-13, DEC-17, DEC-18, DEC-22, DEC-23.
//
// Public entry points this file binds:
//   hooks/decision-adapter.cjs
//     decide(input, ctx) -> Promise<result>   (never throws, never writes stdout/stderr)
//       input: { decision_type, decision_point, evidence_revision, facts, packet?, options }
//         decision_type: dispatch_classification | post_run_trace_review | pre_packet_sharpen
//                        (eligible); anything else (assurance, write_set, route...) is ineligible
//         facts: tool-established facts (trusted); packet: agent-written prose (untrusted)
//         options: { <meaning id>: <description> }
//       ctx: { config_file, record_file, budget: { total_ms, elapsed_ms, reserve_ms },
//              calibration: { <decision_type>: { qualified, threshold, revision } }, enabled? }
//         config_file JSON: { protocol: "systemone", base_url, model_id, key_variable_name };
//         the key value is read from process.env[key_variable_name]. enabled:false is the
//         adapter-disabled baseline.
//       result (agent-facing): { outcome, meaning, status?, evidence_ids?, decision_point?,
//         evidence_revision? }; outcome: RULE | REUSED | ADVISED | NO_PROPOSAL | SILENT_FALLBACK
//     read(record_file) -> [{ decision_point, evidence_revision, outcome, ... }] private record;
//       only RULE/ADVISED/NO_PROPOSAL entries are reuse hits; SILENT_FALLBACK never is.
//       stored in the record file under the `<record_file>.lock` cross-process lock.
//   hooks/policy.cjs DECISION_RULES: [{ decision_type, facts, meaning }] (published rule table)
//   schemas/decision.schema.json $defs.agent_result and $defs.consultation_return (closed)
//   hooks/decision-backend.json shipped backend configuration (DEC-22)
// Wire shape the in-test driver enforces: test/fixtures/decision-adapter/cases.json `systemone`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { boundHook } from "./task-opt-in-fixture.mjs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(ROOT, "test/fixtures/decision-adapter");
const require = createRequire(import.meta.url);
// Loaded per test so a missing module fails each case by name (expected-red baseline).
const adapter = () => require(path.join(ROOT, "hooks/decision-adapter.cjs"));
const transition = require(path.join(ROOT, "hooks/transition-order.cjs"));
const writeLock = boundHook(require(path.join(ROOT, "hooks/orchestrator-write-lock.cjs")));
const CASES = JSON.parse(readFileSync(path.join(FIX, "cases.json"), "utf8"));
const KEY_VAR = "TEST_DECISION_KEY";
const KEY = "TESTKEY-CANARY-9931";
const PACKET_CANARY = "PACKET-CANARY-5521";
const AGENT_KEYS = new Set(["outcome", "meaning", "status", "evidence_ids", "decision_point", "evidence_revision"]);
const CAL = { qualified: true, threshold: 0.8, revision: "cal-1" };
const CALIBRATION = { dispatch_classification: CAL, post_run_trace_review: CAL, pre_packet_sharpen: CAL };

// ---------- local systemone driver (port 0, logs every request) ----------
const isFit = (q) => Array.isArray(q.options) && q.options.length === 2 && q.options.includes("yes") && q.options.includes("no");
const questionsOf = (body) => {
  const questions = Object.entries(body.questions).map(([id, q]) => ({ id, options: Object.keys(q.criteria) }));
  return { fit: questions.find(isFit), choice: questions.find((q) => !isFit(q)) };
};
function hasArrayCriteria(node) {
  if (!node || typeof node !== "object") return false;
  if (!Array.isArray(node) && Array.isArray(node.criteria)) return true;
  return Object.values(node).some(hasArrayCriteria);
}
// Label whose trusted-state entry carries the meaning (mapping lives only in trusted state).
function labelFor(trusted, meaning, labels) {
  const walk = (node) => {
    if (!node || typeof node !== "object") return null;
    for (const [k, v] of Object.entries(node)) {
      if (labels.includes(k) && JSON.stringify(v).includes(meaning)) return k;
    }
    const strings = Object.values(node).filter((v) => typeof v === "string");
    const label = labels.find((l) => strings.includes(l));
    if (label && strings.some((s) => s.includes(meaning))) return label;
    for (const v of Object.values(node)) {
      const hit = walk(v);
      if (hit) return hit;
    }
    return null;
  };
  return walk(trusted);
}
// Recorded-shape answer: fit probability, then `p` on the acted label, rest split evenly.
function answer(body, { fit = 0.95, meaning = "repair_lifecycle", p = 0.9, label } = {}) {
  const { fit: f, choice } = questionsOf(body);
  const labels = choice.options;
  const acted = label ?? labelFor(body.state.trusted, meaning, labels) ?? labels[0];
  const rest = (1 - p) / (labels.length - 1);
  return {
    answers: {
      [f.id]: { yes: fit, no: Number((1 - fit).toFixed(4)) },
      [choice.id]: Object.fromEntries(labels.map((l) => [l, l === acted ? p : Number(rest.toFixed(4))])),
    },
  };
}

async function driver(t) {
  const requests = [];
  let handler = (body) => ({ body: answer(body) });
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, raw };
      requests.push(entry);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (hasArrayCriteria(body)) {
        res.writeHead(422, { "content-type": "application/json" }).end('{"error":"criteria must be a record"}');
        return;
      }
      const out = handler(body, entry) || {};
      if (out.destroy) {
        req.socket.destroy();
        return;
      }
      const send = () => {
        if (res.destroyed) return;
        const text = out.text ?? JSON.stringify(out.body ?? {});
        res.writeHead(out.status ?? 200, { "content-type": "application/json", ...out.headers }).end(text);
      };
      if (out.delayMs) setTimeout(send, out.delayMs).unref();
      else send();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    set: (fn) => (handler = fn),
    body: (i = requests.length - 1) => JSON.parse(requests[i].raw),
  };
}

async function closedPort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return `http://127.0.0.1:${port}`;
}

// ---------- fixtures ----------
function root(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "decision-adapter-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function setup(t, drv, over = {}) {
  const dir = root(t);
  const config_file = path.join(dir, "decision-backend.json");
  const config = { protocol: "systemone", base_url: drv?.url ?? "http://127.0.0.1:9", model_id: "test-model-1.0", key_variable_name: KEY_VAR, ...over.config };
  writeFileSync(config_file, JSON.stringify(config));
  const record_file = path.join(dir, "journey.json");
  writeFileSync(record_file, JSON.stringify({ schema_version: 1, unrelated: { keep: "me" } }, null, 2) + "\n");
  const ctx = { config_file, record_file, budget: { total_ms: 5000, elapsed_ms: 0, reserve_ms: 200 }, calibration: CALIBRATION, ...over.ctx };
  return { dir, ctx, config_file, record_file };
}
let seq = 0;
const dispatchInput = (over = {}) => ({
  decision_type: "dispatch_classification",
  decision_point: `dispatch:S1:implementer:${++seq}`,
  evidence_revision: "ev-1",
  facts: { role: "implementer", gate_exit_code: 1 },
  packet: CASES.packet,
  options: { ...CASES.options },
  ...over,
});
const traceInput = (over = {}) => ({
  decision_type: "post_run_trace_review",
  decision_point: `trace:S1:${++seq}`,
  evidence_revision: "ev-1",
  facts: structuredClone(CASES.trace_facts),
  packet: CASES.packet,
  options: { ...CASES.options },
  ...over,
});
const decide = (input, ctx) => adapter().decide(input, ctx);
const disabled = (input, ctx) => decide(input, { ...ctx, enabled: false });

function assertAgentSafe(result) {
  assert.ok(result && typeof result === "object", "decide returns a result object");
  for (const k of Object.keys(result)) assert.ok(AGENT_KEYS.has(k), `agent-facing key ${k} not permitted`);
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /probab|score|threshold|answers/i, "no probability, score, threshold or raw body reaches the agent");
  assert.ok(!text.includes(KEY) && !text.includes(PACKET_CANARY), "no key or packet echo in the result");
}
function strip(body) {
  const copy = structuredClone(body);
  delete copy.state.trusted;
  delete copy.state.untrusted;
  return JSON.stringify(copy);
}

function runChild(t, dir, input, ctx, env = {}) {
  const job = path.join(dir, `job-${++seq}.json`);
  const out = path.join(dir, `out-${seq}.json`);
  writeFileSync(job, JSON.stringify({ input, ctx }));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(FIX, "run-decide.cjs"), job, out], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (c) => stdout.push(c));
    child.stderr.on("data", (c) => stderr.push(c));
    child.on("close", (code) => {
      const result = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
      rmSync(job, { force: true });
      resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), out: result });
    });
  });
}
function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}
// Minimal JSON Schema subset: $ref (local), type, enum, const, required, properties,
// additionalProperties:false, items, minimum, maximum, maxLength, maxItems.
function validate(schema, value, rootSchema = schema, at = "$") {
  if (schema.$ref) return validate(schema.$ref.split("/").slice(1).reduce((n, k) => n[k], rootSchema), value, rootSchema, at);
  const errs = [];
  const types = [].concat(schema.type ?? []);
  const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  if (types.length && !types.some((ty) => ty === typeOf(value) || (ty === "number" && typeof value === "number"))) errs.push(`${at}: type`);
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${at}: enum`);
  if ("const" in schema && schema.const !== value) errs.push(`${at}: const`);
  if (typeof value === "string" && schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${at}: maxLength`);
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${at}: maxItems`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, rootSchema, `${at}[${i}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${at}.${k}: required`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) errs.push(...validate(schema.properties[k], v, rootSchema, `${at}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${at}.${k}: additional`);
    }
  }
  return errs;
}
const schema = () => JSON.parse(readFileSync(path.join(ROOT, "schemas/decision.schema.json"), "utf8"));
const closedProps = (def) => {
  assert.equal(def.additionalProperties, false, "definition is closed");
  return Object.keys(def.properties ?? {});
};

process.env[KEY_VAR] = KEY;

// ---------- rules first (B30-202, B30-208, B30-232, SM02 RULES rows) ----------
describe("rules first, no model call for a deterministic decision", () => {
  it("SEIT-B30-202 / SEIT-SM02-T RULES->RECORDED: every rule-decidable fixture yields the rule result with zero backend requests", async (t) => {
    const drv = await driver(t);
    const { ctx } = setup(t, drv);
    for (const row of CASES.rule_rows) {
      const result = await decide(dispatchInput({ facts: { role: "implementer", ...row.facts } }), ctx);
      assert.equal(result.outcome, "RULE", JSON.stringify(row.facts));
      assert.equal(result.meaning, row.meaning);
    }
    assert.equal(drv.requests.length, 0, "rule-decidable fixtures never reach the backend");
  });

  it("SEIT-B30-202: each row of the published DECISION_RULES table decides its own fixture without a request", async (t) => {
    const { DECISION_RULES } = require(path.join(ROOT, "hooks/policy.cjs"));
    assert.ok(Array.isArray(DECISION_RULES) && DECISION_RULES.length >= CASES.rule_rows.length, "rule table published beside the single policy source");
    const drv = await driver(t);
    const { ctx } = setup(t, drv);
    for (const row of DECISION_RULES) {
      const result = await decide({ ...dispatchInput(), decision_type: row.decision_type, facts: structuredClone(row.facts) }, ctx);
      assert.equal(result.outcome, "RULE", JSON.stringify(row));
      assert.equal(result.meaning, row.meaning);
    }
    assert.equal(drv.requests.length, 0);
  });

  it("SEIT-B30-208: only the unresolved eligible fixture makes exactly one request, and its result validates against the closed schema", async (t) => {
    const drv = await driver(t);
    const { ctx } = setup(t, drv);
    await decide(dispatchInput({ facts: { role: "implementer", ...CASES.rule_rows[0].facts } }), ctx);
    assert.equal(drv.requests.length, 0, "rule-decided");
    const ineligible = await decide(dispatchInput({ decision_type: "assurance" }), ctx);
    assert.equal(ineligible.outcome, "SILENT_FALLBACK");
    assert.equal(drv.requests.length, 0, "ineligible");
    const eligible = await decide(dispatchInput(), ctx);
    assert.equal(drv.requests.length, 1, "unresolved eligible makes one request");
    assert.equal(eligible.outcome, "ADVISED");
    const s = schema();
    assert.deepEqual(validate(s.$defs.agent_result, eligible, s), []);
    assertAgentSafe(eligible);
  });

  it("SEIT-SM02-T RULES->SILENT_FALLBACK / B30-502: ineligible decision types (assurance, write set, route, owner authority) never call the backend", async (t) => {
    const drv = await driver(t);
    const { ctx } = setup(t, drv);
    for (const type of ["assurance", "write_set", "route_selection", "owner_authority", "budget"]) {
      const result = await decide(dispatchInput({ decision_type: type }), ctx);
      assert.equal(result.outcome, "SILENT_FALLBACK", type);
      assert.equal(result.meaning ?? null, null, type);
    }
    assert.equal(drv.requests.length, 0);
  });

  it("SEIT-B30-232 / SEIT-SM02-X (RULES backend call for counting/date): code computes counts, sums and date comparisons before the call", async (t) => {
    const drv = await driver(t);
    const { ctx } = setup(t, drv);
    const input = traceInput();
    await decide(input, ctx);
    assert.equal(drv.requests.length, 1);
    const body = drv.body();
    const f = input.facts;
    const expected = {
      failed_gate_count: f.gate_results.filter((g) => !g.passed).length,
      budget_total: f.budgets.reduce((n, b) => n + b.spent, 0),
      deadline_passed: Date.parse(f.checked_at) > Date.parse(f.deadline),
    };
    const found = {};
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        if (k in expected) found[k] = v;
        walk(v);
      }
    };
    walk(body.state.trusted);
    assert.deepEqual(found, expected, "trusted state carries the code-computed values");
    for (const q of Object.values(body.questions)) {
      assert.doesNotMatch(JSON.stringify(q), /\b(count|how many|sum|add|total|compare|earlier|later|before|after)\b/i, "no question delegates arithmetic or dates");
    }
  });
});

// ---------- systemone shape, fit question, labels, state (TB04) ----------
describe("one systemone request: fit first, neutral labels, separated state", () => {
  it("SEIT-B30-221: the hosted record wire contract yields calibrated advice", async (t) => {
    const drv = await driver(t);
    const { ctx } = setup(t, drv);
    drv.set((body) => {
      const questions = body.questions;
      if (!questions || Array.isArray(questions) || Object.keys(questions).length !== 2) return { status: 422 };
      for (const q of Object.values(questions)) {
        if (q.type !== "choice" || !q.instructions || !q.criteria || Array.isArray(q.criteria)) return { status: 422 };
      }
      const response = answer(body);
      return { body: { answers: Object.fromEntries(Object.entries(response.answers)
        .map(([id, probabilities]) => [id, { type: "choice", probabilities }])) } };
    });
    const advice = await decide(dispatchInput(), ctx);
    assert.equal(advice.outcome, "ADVISED");
    assert.equal(advice.meaning, "repair_lifecycle");
  });

  it("SEIT-B30-221: one shared state, typed questions, criteria as a record; exactly one probability per option is read", async (t) => {
    const drv = await driver(t);
    const { ctx } = setup(t, drv);
    const ok = await decide(dispatchInput(), ctx);
    assert.equal(ok.outcome, "ADVISED", "a well-formed response is accepted");
    const body = drv.body();
    assert.equal(typeof body.state, "object");
    assert.ok(!Array.isArray(body.state) && !("states" in body), "one shared state");
    assert.ok(!Array.isArray(body.questions) && Object.keys(body.questions).length === 2, "keyed questions");
    for (const q of Object.values(body.questions)) assert.equal(q.type, "choice", "typed choice question");
    assert.equal(hasArrayCriteria(body), false);
    const crit = [];
    const walk = (n) => n && typeof n === "object" && Object.entries(n).forEach(([k, v]) => (k === "criteria" ? crit.push(v) : walk(v)));
    walk(body);
    assert.ok(crit.length >= 1 && crit.every((c) => c && typeof c === "object" && !Array.isArray(c)), "criteria is a label-to-description record");
    const { choice } = questionsOf(body);
    assert.deepEqual(Object.keys(crit[0]).sort(), [...choice.options].sort());

    const bad = [
      (b) => { const a = answer(b); delete a.answers[questionsOf(b).choice.id][questionsOf(b).choice.options[0]]; return a; },
      (b) => { const a = answer(b); a.answers[questionsOf(b).choice.id].EXTRA = 0.1; return a; },
      (b) => { const a = answer(b); a.answers[questionsOf(b).choice.id][questionsOf(b).choice.options[1]] = 1.5; return a; },
      (b) => { const a = answer(b); delete a.answers[questionsOf(b).fit.id]; return a; },
    ];
    for (const make of bad) {
      drv.set((b) => ({ body: make(b) }));
      const result = await decide(dispatchInput(), ctx);
      assert.equal(result.outcome, "SILENT_FALLBACK", "missing, extra or out-of-range probabilities are rejected");
    }
  });

  it("SEIT-B30-225 / SEIT-SM02-T FIT rows / SEIT-SM02-X (choose before fit-no): fit and choice share one call; fit-no gives no proposal", async (t) => {
    const drv = await driver(t);
    const { ctx } = setup(t, drv);
    const input = dispatchInput();
    drv.set((b) => ({ body: answer(b, { fit: 0.05, p: 0.97 }) }));
    const no = await decide(input, ctx);
    assert.equal(drv.requests.length, 1, "one request carries both questions");
    assert.equal(no.outcome, "NO_PROPOSAL", "fit-no with a high choice probability yields no proposal");
    assert.equal(no.meaning ?? null, null);
    const { fit, choice } = questionsOf(drv.body());
    assert.ok(fit && choice, "companion fit question and choice in the same call");
    assert.equal(choice.options.length, Object.keys(input.options).length, "choice has no abstain option");
    drv.set((b) => ({ body: answer(b, { fit: 0.95, p: 0.9 }) }));
    const yes = await decide(dispatchInput(), ctx);
    assert.equal(drv.requests.length, 2);
    assert.equal(yes.outcome, "ADVISED", "fit-yes proceeds to calibration and a qualified choice");
    assert.equal(yes.meaning, "repair_lifecycle");
  });

  it("SEIT-SM02-T CALIBRATION rows / SEIT-SM02-X (other option or uncalibrated threshold): threshold applies to the acted option and only when qualified", async (t) => {
    const drv = await driver(t);
    const { ctx } = setup(t, drv);
    drv.set((b) => ({ body: answer(b, { fit: 0.99, p: 0.6 }) }));
    assert.equal((await decide(dispatchInput(), ctx)).outcome, "NO_PROPOSAL", "high fit confidence does not lift a 0.6 acted option over 0.8");
    drv.set((b) => ({ body: answer(b, { fit: 0.95, p: 0.99 }) }));
    const unqualified = { ...ctx, calibration: { dispatch_classification: { ...CAL, qualified: false } } };
    assert.equal((await decide(dispatchInput(), unqualified)).outcome, "NO_PROPOSAL", "unqualified calibration");
    assert.equal((await decide(dispatchInput(), { ...ctx, calibration: {} })).outcome, "NO_PROPOSAL", "missing calibration");
    assert.equal((await decide(dispatchInput(), ctx)).outcome, "ADVISED", "qualified threshold met by the acted option");
  });

  it("SEIT-B30-227: labels are neutral, meaning maps only in trusted state, and interpretation follows the mapping when shuffled", async (t) => {
    const drv = await driver(t);
    const { ctx } = setup(t, drv);
    const shuffled = Object.fromEntries(Object.entries(CASES.options).reverse());
    for (const options of [CASES.options, shuffled]) {
      drv.set((b) => ({ body: answer(b, { label: questionsOf(b).choice.options[0] }) }));
      const result = await decide(dispatchInput({ options }), ctx);
      const body = drv.body();
      const labels = questionsOf(body).choice.options;
      for (const label of labels) {
        assert.ok(label.length <= 8, `label ${label} is a short token`);
        for (const w of CASES.meaning_words) assert.ok(!label.toLowerCase().includes(w), `label ${label} reveals ${w}`);
      }
      const outside = strip(body).toLowerCase();
      for (const w of CASES.meaning_words) assert.ok(!outside.includes(w), `meaning word ${w} sent outside trusted state`);
      const expected = Object.keys(CASES.options).find((m) => labelFor(body.state.trusted, m, labels) === labels[0]);
      assert.ok(expected, "trusted state maps the first label to a meaning");
      assert.equal(result.meaning, expected, "interpreted meaning follows the trusted mapping");
    }
  });

  it("SEIT-B30-226 / SEIT-B30-241 (adapter side): dispatch packet as written only in untrusted state; tool facts only in trusted state", async (t) => {
    const drv = await driver(t);
    const { ctx } = setup(t, drv);
    await decide(dispatchInput({ facts: { role: "implementer", gate_exit_code: 7, digest: "sha256-FACT-CANARY-77" } }), ctx);
    const body = drv.body();
    const untrusted = JSON.stringify(body.state.untrusted);
    const trusted = JSON.stringify(body.state.trusted);
    const strings = [];
    const walk = (n) => (typeof n === "string" ? strings.push(n) : n && typeof n === "object" && Object.values(n).forEach(walk));
    walk(body.state.untrusted);
    assert.ok(strings.includes(CASES.packet), "untrusted field is byte-identical to the packet (no redaction)");
    assert.ok(!trusted.includes(PACKET_CANARY), "packet prose never enters trusted state");
    assert.ok(trusted.includes("FACT-CANARY-77"), "tool facts are trusted");
    assert.ok(!untrusted.includes("FACT-CANARY-77"), "tool facts are not mixed into untrusted state");
    assert.ok(!strip(body).includes(PACKET_CANARY), "packet appears nowhere outside untrusted state");
  });

  it("SEIT-B30-226 / SEIT-TB04-N (prose sent for another decision type): a fact-only decision carries no prose even when a packet is available", async (t) => {
    const drv = await driver(t);
    const { ctx } = setup(t, drv);
    await decide(traceInput(), ctx);
    assert.equal(drv.requests.length, 1, "fact-only type is still eligible");
    assert.ok(!drv.requests[0].raw.includes(PACKET_CANARY), "no packet text in a non-dispatch request");
    const u = drv.body().state.untrusted;
    assert.ok(u === undefined || u === null || Object.keys(u).length === 0, "no untrusted prose field for a fact-only type");
  });
});

// ---------- configuration (B30-222, B30-223) ----------
describe("backend configuration", () => {
  it("SEIT-B30-222: URL, model id and key come from configuration and follow a config change", async (t) => {
    const a = await driver(t);
    const b = await driver(t);
    const { ctx, config_file } = setup(t, a);
    await decide(dispatchInput(), ctx);
    assert.equal(a.requests.length, 1);
    assert.equal(a.body().model, "test-model-1.0");
    assert.ok(Object.values(a.requests[0].headers).some((v) => String(v).includes(KEY)), "key value from the named variable is sent in a header");
    writeFileSync(config_file, JSON.stringify({ protocol: "systemone", base_url: b.url, model_id: "test-model-2.0", key_variable_name: "OTHER_DECISION_KEY" }));
    process.env.OTHER_DECISION_KEY = "OTHER-KEY-4410";
    t.after(() => delete process.env.OTHER_DECISION_KEY);
    await decide(dispatchInput(), ctx);
    assert.equal(a.requests.length, 1, "old endpoint not called after the change");
    assert.equal(b.requests.length, 1);
    assert.equal(b.body().model, "test-model-2.0");
    assert.ok(Object.values(b.requests[0].headers).some((v) => String(v).includes("OTHER-KEY-4410")));
  });

  it("SEIT-B30-223: alias model ids are rejected with the silent fallback and no request", async (t) => {
    const drv = await driver(t);
    for (const model_id of ["latest", "liquid", "d1.2-ultra-latest", ""]) {
      const { ctx } = setup(t, drv, { config: { model_id } });
      const result = await decide(dispatchInput(), ctx);
      assert.equal(result.outcome, "SILENT_FALLBACK", `alias ${JSON.stringify(model_id)}`);
    }
    assert.equal(drv.requests.length, 0);
  });

  it("SEIT-B30-223: the shipped configuration pins the DEC-22 model id and names LIQUID_API_KEY", () => {
    const file = path.join(ROOT, "hooks/decision-backend.json");
    assert.ok(existsSync(file), "hooks/decision-backend.json is shipped");
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(cfg.protocol, "systemone");
    assert.equal(cfg.model_id, "d1.2-ultra");
    assert.equal(cfg.key_variable_name, "LIQUID_API_KEY");
    assert.match(cfg.base_url, /^https:\/\//);
    assert.ok(!JSON.stringify(cfg).match(/sk-|key_value|apikey=/i), "no key value in configuration");
  });

  it("SEIT-SM02-T CACHE->SILENT_FALLBACK: no config, no key or no budget skips the backend", async (t) => {
    const drv = await driver(t);
    const { ctx } = setup(t, drv);
    const r1 = await decide(dispatchInput(), { ...ctx, config_file: path.join(path.dirname(ctx.config_file), "absent.json") });
    const r2 = await decide(dispatchInput(), { ...ctx, budget: { total_ms: 5000, elapsed_ms: 4900, reserve_ms: 200 } });
    const saved = process.env[KEY_VAR];
    delete process.env[KEY_VAR];
    let r3;
    try {
      r3 = await decide(dispatchInput(), ctx);
    } finally {
      process.env[KEY_VAR] = saved;
    }
    for (const r of [r1, r2, r3]) assert.equal(r.outcome, "SILENT_FALLBACK");
    assert.equal(drv.requests.length, 0);
  });
});

// ---------- timeout and unavailability (B30-211, B30-212, B30-220) ----------
describe("timeout and unavailable fallback", () => {
  const tight = { total_ms: 5000, elapsed_ms: 4000, reserve_ms: 200 };
  const modes = {
    delay: () => ({ delayMs: 10_000, body: {} }),
    http503: () => ({ status: 503, text: "{}" }),
    invalid: () => ({ text: "not json {" }),
  };

  for (const [name, mode] of [...Object.entries(modes), ["refused", null]]) {
    it(`SEIT-B30-212 / SEIT-SM02-T REQUEST_PENDING->SILENT_FALLBACK (${name}): result equals the adapter-disabled result within the remaining budget, no retry`, async (t) => {
      const drv = await driver(t);
      const url = mode ? drv.url : await closedPort();
      const { ctx } = setup(t, drv, { config: { base_url: url }, ctx: { budget: tight } });
      if (mode) drv.set(mode);
      const input = dispatchInput();
      const baseline = await disabled(input, ctx);
      const started = Date.now();
      const result = await decide(input, ctx);
      const elapsed = Date.now() - started;
      assert.deepEqual(result, baseline);
      assert.equal(result.outcome, "SILENT_FALLBACK");
      // 1000 ms remaining + 200 ms reserve, plus load slack for shared machines (rule 22).
      assert.ok(elapsed < 2000, `finished in ${elapsed} ms`);
      assert.ok(drv.requests.length <= 1, "no retry");
    });
  }

  it("SEIT-B30-212 / B30-211: independent permitted work proceeds while inference is pending", async (t) => {
    const drv = await driver(t);
    drv.set(() => ({ delayMs: 10_000, body: {} }));
    const { ctx } = setup(t, drv, { ctx: { budget: tight } });
    const order = [];
    const pending = decide(dispatchInput(), ctx).then(() => order.push("inference"));
    const rule = decide(dispatchInput({ facts: { role: "implementer", ...CASES.rule_rows[2].facts } }), ctx).then(() => order.push("rule"));
    await Promise.all([pending, rule]);
    assert.deepEqual(order, ["rule", "inference"]);
  });

  it("SEIT-B30-220 / SEIT-TB05-N (timeout adds output): timeout run is byte-identical to the disabled run on stdout, stderr and exit code", async (t) => {
    const drv = await driver(t);
    drv.set(() => ({ delayMs: 10_000, body: {} }));
    const { dir, ctx } = setup(t, drv, { ctx: { budget: tight } });
    const input = dispatchInput();
    const off = await runChild(t, dir, input, { ...ctx, enabled: false });
    const on = await runChild(t, dir, input, ctx);
    assert.ok(on.out && !on.out.thrown, "decide does not throw");
    assert.deepEqual(on.out, off.out);
    assert.equal(on.code, off.code);
    assert.ok(on.stdout.equals(off.stdout), "stdout identical");
    assert.ok(on.stderr.equals(off.stderr), "stderr identical");
    assert.equal(on.stdout.length + on.stderr.length, 0, "zero adapter hook output");
  });
});

// ---------- reuse and record (B30-213, SM02 CACHE/RECORDED) ----------
describe("decision record and reuse", () => {
  it("SEIT-B30-213 / SEIT-SM02-T CACHE->RECORDED: same point, state and evidence revision reuse the record; a new revision calls again", async (t) => {
    const drv = await driver(t);
    const { ctx, record_file, config_file } = setup(t, drv);
    const input = dispatchInput();
    const first = await decide(input, ctx);
    const second = await decide(structuredClone(input), ctx);
    assert.equal(drv.requests.length, 1, "repeat at the same identity does not reach the backend");
    assert.equal(second.outcome, "REUSED");
    assert.equal(second.meaning, first.meaning);
    await decide({ ...input, evidence_revision: "ev-2" }, ctx);
    assert.equal(drv.requests.length, 2, "new evidence revision makes a second request");
    writeFileSync(config_file, JSON.stringify({ ...JSON.parse(readFileSync(config_file, "utf8")), model_id: "test-model-1.1" }));
    await decide({ ...input, evidence_revision: "ev-2" }, ctx);
    assert.equal(drv.requests.length, 3, "a model change is a new state digest");
    assert.deepEqual(JSON.parse(readFileSync(record_file, "utf8")).unrelated, { keep: "me" }, "unrelated record content preserved");
  });

  it("SEIT-B30-213 / SEIT-SM02-X (duplicate cache key): two concurrent identical requests in separate processes make one request", async (t) => {
    const drv = await driver(t);
    drv.set((b) => ({ body: answer(b), delayMs: 400 }));
    const { dir, ctx } = setup(t, drv);
    const input = dispatchInput();
    const [a, b] = await Promise.all([runChild(t, dir, input, ctx), runChild(t, dir, input, ctx)]);
    assert.ok(a.out && !a.out.thrown && b.out && !b.out.thrown, "neither process throws");
    assert.equal(a.code, 0);
    assert.equal(b.code, 0);
    assert.equal(drv.requests.length, 1, "one combined call; pending identity reused");
  });

  it("bounded fallback while the decision record is busy", async (t) => {
    const { ctx, record_file } = setup(t, null);
    mkdirSync(record_file + ".lock");
    const started = performance.now();
    const result = await decide(dispatchInput(), {
      ...ctx, budget: { total_ms: 200, elapsed_ms: 0, reserve_ms: 50 },
    });
    assert.equal(result.outcome, "SILENT_FALLBACK");
    assert.ok(performance.now() - started < 1000, "contention must not outlive the host budget");
  });

  it("exact rule matching includes every JSON fact", async (t) => {
    const { ctx } = setup(t, null);
    const facts = { ...CASES.rule_rows[0].facts, role: "implementer" };
    assert.equal((await disabled(dispatchInput({ facts }), ctx)).outcome, "RULE");
    const extra = JSON.parse('{"__proto__":{"note":"extra fact"}}');
    assert.equal((await disabled(dispatchInput({ facts: { ...facts, ...extra } }), ctx)).outcome, "SILENT_FALLBACK");
  });

  it("a short-budget duplicate leaves the active decision available to a later caller", async (t) => {
    const drv = await driver(t);
    const { ctx } = setup(t, drv);
    const input = dispatchInput();
    let requested;
    const arrived = new Promise((resolve) => { requested = resolve; });
    drv.set((body) => {
      requested();
      return { delayMs: 650, body: answer(body) };
    });
    const first = decide(input, ctx);
    await arrived;
    const short = await decide(input, { ...ctx, budget: { total_ms: 75, elapsed_ms: 0, reserve_ms: 0 } });
    assert.equal(short.outcome, "SILENT_FALLBACK");
    const third = decide(input, ctx);
    assert.equal((await first).outcome, "ADVISED");
    assert.equal((await third).outcome, "REUSED");
    assert.equal(drv.requests.length, 1);
  });

  it("a decision can be retried after its claimant exits", { timeout: 5000 }, async (t) => {
    const drv = await driver(t);
    const { dir, ctx } = setup(t, drv);
    const input = dispatchInput();
    let requested;
    const arrived = new Promise((resolve) => { requested = resolve; });
    drv.set(() => {
      requested();
      return { delayMs: 10_000 };
    });
    const job = path.join(dir, "interrupted.json");
    writeFileSync(job, JSON.stringify({
      input, ctx: { ...ctx, budget: { total_ms: 650, elapsed_ms: 0, reserve_ms: 0 } },
    }));
    const child = spawn(process.execPath, [path.join(FIX, "run-decide.cjs"), job, path.join(dir, "unused.json")],
      { stdio: "ignore" });
    t.after(() => child.kill("SIGKILL"));
    const exited = once(child, "exit");
    await arrived;
    child.kill("SIGKILL");
    await exited;
    await new Promise((resolve) => setTimeout(resolve, 650));
    drv.set((body) => ({ body: answer(body) }));
    assert.equal((await decide(input, ctx)).outcome, "ADVISED");
    assert.equal(drv.requests.length, 2);
  });

  it("fallback on backend redirect keeps the packet within the configured endpoint", async (t) => {
    const drv = await driver(t);
    const other = await driver(t);
    drv.set(() => ({ status: 307, headers: { location: other.url } }));
    const { ctx } = setup(t, drv);
    assert.equal((await decide(dispatchInput(), ctx)).outcome, "SILENT_FALLBACK");
    assert.equal(drv.requests.length, 1);
    assert.equal(other.requests.length, 0);
  });

  it("SEIT-SM02-T ->RECORDED: rule, reuse, advice, no-proposal and fallback outcomes are each recorded privately", async (t) => {
    const drv = await driver(t);
    const { ctx, record_file } = setup(t, drv);
    const rule = dispatchInput({ facts: { role: "implementer", ...CASES.rule_rows[1].facts } });
    const advised = dispatchInput();
    const reused = { ...advised };
    const noProposal = dispatchInput();
    const fallback = dispatchInput();
    await decide(rule, ctx);
    await decide(advised, ctx);
    await decide(reused, ctx);
    drv.set((b) => ({ body: answer(b, { fit: 0.05 }) }));
    await decide(noProposal, ctx);
    drv.set(() => ({ status: 503, text: "{}" }));
    await decide(fallback, ctx);
    const record = adapter().read(record_file);
    const outcomes = (point) => record.filter((r) => r.decision_point === point).map((r) => r.outcome);
    assert.ok(outcomes(rule.decision_point).includes("RULE"));
    assert.ok(outcomes(advised.decision_point).includes("ADVISED"));
    assert.ok(outcomes(advised.decision_point).includes("REUSED"));
    assert.ok(outcomes(noProposal.decision_point).includes("NO_PROPOSAL"));
    assert.ok(outcomes(fallback.decision_point).includes("SILENT_FALLBACK"));
    for (const r of record) assert.equal(typeof r.evidence_revision, "string");
  });
});

// ---------- probabilities and key withheld (B30-229, B30-240, TB04) ----------
describe("probabilities, key and packet never reach agents or logs", () => {
  it("SEIT-B30-229 / SEIT-SM02-X (probabilities reach state writer): canary probabilities stay in the private record only", async (t) => {
    const drv = await driver(t);
    drv.set((b) => {
      const { fit, choice } = questionsOf(b);
      const [x, y, ...rest] = choice.options;
      return { body: { answers: { [fit.id]: { yes: 0.9, no: 0.1 }, [choice.id]: { [x]: 0.7313, [y]: 0.2687, ...Object.fromEntries(rest.map((l) => [l, 0])) } } } };
    });
    const { dir, ctx, record_file } = setup(t, drv, { ctx: { calibration: { dispatch_classification: { qualified: true, threshold: 0.7, revision: "cal-2" } } } });
    const run = await runChild(t, dir, dispatchInput(), ctx);
    const result = run.out?.result;
    assert.equal(result?.outcome, "ADVISED", "0.7313 meets the 0.7 threshold");
    assertAgentSafe(result);
    for (const text of [JSON.stringify(result), run.stdout.toString(), run.stderr.toString()]) {
      assert.ok(!text.includes("0.7313") && !text.includes("0.2687") && !text.includes("0.7"), "no canary probability or threshold");
    }
    const record = readFileSync(record_file, "utf8");
    assert.ok(record.includes("0.7313") && record.includes("0.2687"), "private record keeps the probabilities");
  });

  it("SEIT-B30-240 / SEIT-TB04-N (key logged, packet echoed): the key canary appears only in the outbound header on success, 401, 500, timeout and invalid body", async (t) => {
    const paths = {
      success: (b) => ({ body: answer(b) }),
      http401: () => ({ status: 401, text: '{"error":"unauthorized"}' }),
      http500: () => ({ status: 500, text: '{"error":"boom"}' }),
      timeout: () => ({ delayMs: 10_000, body: {} }),
      invalid: () => ({ text: "<html>" }),
    };
    for (const [name, mode] of Object.entries(paths)) {
      const drv = await driver(t);
      drv.set(mode);
      const { dir, ctx } = setup(t, drv, { ctx: { budget: { total_ms: 5000, elapsed_ms: 4000, reserve_ms: 200 } } });
      const run = await runChild(t, dir, dispatchInput(), ctx);
      assert.ok(run.out && !run.out.thrown, `${name}: decide does not throw`);
      assert.equal(drv.requests.length, 1, `${name}: request sent`);
      assert.ok(Object.values(drv.requests[0].headers).some((v) => String(v).includes(KEY)), `${name}: key in the outbound header`);
      assert.ok(!drv.requests[0].raw.includes(KEY) && !drv.requests[0].url.includes(KEY), `${name}: key not in body or URL`);
      for (const [where, text] of [["stdout", run.stdout.toString()], ["stderr", run.stderr.toString()], ["result", JSON.stringify(run.out)]]) {
        assert.ok(!text.includes(KEY), `${name}: key in ${where}`);
        assert.ok(!text.includes(PACKET_CANARY), `${name}: packet echoed in ${where}`);
      }
      for (const file of filesUnder(dir)) {
        const text = readFileSync(file, "utf8");
        assert.ok(!text.includes(KEY), `${name}: key written to ${path.basename(file)}`);
        if (path.basename(file).startsWith("journey")) assert.ok(!text.includes(PACKET_CANARY), `${name}: packet in the record`);
      }
    }
  });
});

// ---------- deterministic authority (B30-210, TB05) ----------
describe("advisory only: deterministic gates keep final authority", () => {
  const gates = {
    "write-set violation": (advice) => writeLock.evaluate({
      role: "orchestrator", paths: ["docs/plans/example/seit.json"], advice,
    }).verdict,
    "missing receipt": (advice) => transition.evaluate({ from_state: "IN_PROGRESS", to_state: "EVIDENCE_READY", prerequisites_met: false, missing_step: "receipt", advice }).outcome,
    "owner hold": (advice) => transition.evaluate({ action_kind: "owner_stop_check", owner_stop: { class: "C", blocking: true, evidence_ref: "hold-1" }, advice }).outcome,
    "assurance required": (advice) => transition.evaluate({ from_state: "ACCEPTANCE", to_state: "COMPLETE", required_assurance: ["reviewer"], assurance_completed: [], advice }).outcome,
  };
  for (const [name, gate] of Object.entries(gates)) {
    it(`SEIT-B30-210 / SEIT-TB05-N / SEIT-SM02-X (advice changes authority): ${name} outcome is the same with the adapter enabled and disabled`, async (t) => {
      const drv = await driver(t);
      drv.set((b) => ({ body: answer(b, { meaning: "not_repair", p: 0.99 }) }));
      const { ctx } = setup(t, drv);
      const input = dispatchInput({ facts: { role: "implementer", gate: name, gate_blocked: true } });
      const on = await decide(input, ctx);
      const off = await disabled(input, ctx);
      assertAgentSafe(on);
      assert.equal(on.outcome, "ADVISED", "opposite action proposed");
      assert.equal(gate(on), gate(off), "gate outcome unchanged by the proposal");
      assert.ok(["FAIL", "REROUTE", "BLOCK", "DENY_DISPATCH"].includes(gate(on)), `the gate still refuses (${gate(on)})`);
    });
  }
});

// ---------- closed schema and consultation return (B30-214, B30-117) ----------
describe("closed decision schema", () => {
  it("SEIT-B30-208: agent_result is closed and carries no probability, score or threshold field", () => {
    const s = schema();
    const props = closedProps(s.$defs.agent_result);
    for (const p of props) assert.doesNotMatch(p, /prob|score|threshold|raw|body/i, p);
    assert.ok(props.includes("outcome") && props.includes("meaning"));
  });

  it("SEIT-B30-214: consultation return is a closed bounded object addressed to the original agent with no dispatch, route or ownership change", () => {
    const s = schema();
    const def = s.$defs.consultation_return;
    const props = closedProps(def);
    assert.ok(props.length > 0);
    for (const p of props) assert.doesNotMatch(p, /dispatch|route|owner|model|harness|write_set|delegat|budget/i, p);
    for (const [p, sub] of Object.entries(def.properties)) {
      if (sub.type === "string") assert.ok(sub.maxLength > 0, `${p} is bounded`);
      if (sub.type === "array") assert.ok(sub.maxItems > 0, `${p} is bounded`);
    }
    const ref = readFileSync(path.join(ROOT, "skills/bearing-lite/references/consultation.md"), "utf8");
    assert.match(ref, /original agent/i);
    assert.match(ref, /ownership/i);
    assert.match(ref, /Orchestrator/);
  });
});

// ---------- end-to-end flow (F06) ----------
describe("F06 end to end", () => {
  it("SEIT-F06: positive connection retains evidence; each negative crossing ends in its contracted recovery", async (t) => {
    const drv = await driver(t);
    const { ctx, record_file } = setup(t, drv);
    const input = dispatchInput();
    const positive = await decide(input, ctx);
    assert.equal(positive.outcome, "ADVISED");
    assert.equal(positive.meaning, "repair_lifecycle");
    assertAgentSafe(positive);
    const kept = adapter().read(record_file).find((r) => r.decision_point === input.decision_point);
    assert.equal(kept?.evidence_revision, "ev-1", "identity retained in the private record");
    const negatives = [
      ["fit-no", (b) => ({ body: answer(b, { fit: 0.05 }) }), "NO_PROPOSAL"],
      ["low acted-option probability", (b) => ({ body: answer(b, { p: 0.5 }) }), "NO_PROPOSAL"],
      ["array criteria rejected upstream", () => ({ status: 422, text: "{}" }), "SILENT_FALLBACK"],
      ["key echo in body", (b) => ({ text: JSON.stringify({ ...answer(b), echo: KEY }) }), null],
    ];
    for (const [name, mode, expected] of negatives) {
      drv.set(mode);
      const r = await decide(dispatchInput(), ctx);
      assertAgentSafe(r);
      if (expected) assert.equal(r.outcome, expected, name);
    }
    const unq = await decide(dispatchInput(), { ...ctx, calibration: { dispatch_classification: { ...CAL, qualified: false } } });
    assert.equal(unq.outcome, "NO_PROPOSAL", "unqualified calibration");
    assert.ok(!readFileSync(record_file, "utf8").includes(KEY), "no key echo retained");
  });
});
