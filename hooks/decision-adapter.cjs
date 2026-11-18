"use strict";

// Advisory decision adapter (N07). No HOOK_CLASS: evaluator, not a host hook.
// The record lock is released before the backend call so a rule decision can
// finish while inference is still pending.

const crypto = require("node:crypto");
const fs = require("node:fs");
const { DECISION_RULES } = require("./policy.cjs");

const ELIGIBLE = new Set(["dispatch_classification", "post_run_trace_review", "pre_packet_sharpen"]);
const PROSE = new Set(["dispatch_classification", "pre_packet_sharpen"]);
const REUSE = new Set(["RULE", "ADVISED", "NO_PROPOSAL"]);

function agent(outcome, meaning) {
  return meaning ? { outcome, meaning } : { outcome };
}

function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])]));
  }
  return value;
}

function sameFacts(a, b) {
  return JSON.stringify(canon(a || {})) === JSON.stringify(canon(b || {}));
}

function pinned(id) {
  return typeof id === "string" && id.length > 0 && !/latest/i.test(id) && /\d/.test(id);
}

function remainingMs(budget) {
  if (!budget) return 0;
  const { total_ms, elapsed_ms, reserve_ms } = budget;
  if (typeof total_ms !== "number" || typeof elapsed_ms !== "number" || typeof reserve_ms !== "number") return 0;
  const remaining = total_ms - elapsed_ms - reserve_ms;
  return Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
}

function loadConfig(file) {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!cfg || cfg.protocol !== "systemone") return null;
  if (typeof cfg.base_url !== "string" || !/^https?:\/\//.test(cfg.base_url)) return null;
  if (!pinned(cfg.model_id)) return null;
  if (typeof cfg.key_variable_name !== "string" || cfg.key_variable_name.length === 0) return null;
  return cfg;
}

function digestOf(input, cfg, calibration) {
  const payload = {
    decision_type: input.decision_type,
    facts: input.facts || {},
    options: input.options || {},
    packet: PROSE.has(input.decision_type) ? (input.packet ?? null) : null,
    protocol: cfg.protocol,
    base_url: cfg.base_url,
    model_id: cfg.model_id,
    key_variable_name: cfg.key_variable_name,
    calibration: calibration || null,
    rules: DECISION_RULES,
  };
  return crypto.createHash("sha256").update(JSON.stringify(canon(payload))).digest("hex");
}

function buildState(input) {
  const facts = input.facts && typeof input.facts === "object" ? input.facts : {};
  const trusted = { facts };
  if (Array.isArray(facts.gate_results)) {
    trusted.failed_gate_count = facts.gate_results.filter((gate) => !gate.passed).length;
  }
  if (Array.isArray(facts.budgets)) {
    trusted.budget_total = facts.budgets.reduce((sum, row) => sum + row.spent, 0);
  }
  if (typeof facts.checked_at === "string" && typeof facts.deadline === "string") {
    trusted.deadline_passed = Date.parse(facts.checked_at) > Date.parse(facts.deadline);
  }
  const labels = {};
  const criteria = {};
  let optionIndex = 0;
  for (const [meaning, description] of Object.entries(input.options || {})) {
    const label = "n" + (optionIndex++).toString(36);
    labels[label] = meaning;
    criteria[label] = String(description);
  }
  trusted.labels = labels;
  trusted.criteria = criteria;
  const state = { trusted };
  if (PROSE.has(input.decision_type) && typeof input.packet === "string") {
    state.untrusted = { packet: input.packet };
  }
  const questions = {
    fit: { type: "choice", instructions: "Does any criterion in the shared state fit?", criteria: { yes: "yes", no: "no" } },
    choice: {
      type: "choice",
      instructions: "Select one label using the criteria in the shared state.",
      criteria: Object.fromEntries(Object.keys(criteria).map((label) => [label, label])),
    },
  };
  return { state, questions, labels };
}

function parseAnswers(text, questions) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || !body.answers || typeof body.answers !== "object") return null;
  const out = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = body.answers[id];
    const row = answer?.type === "choice" ? answer.probabilities : answer;
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const options = Object.keys(question.criteria);
    if (Object.keys(row).length !== options.length || options.some((option) => !Object.hasOwn(row, option))) {
      return null;
    }
    const probs = {};
    for (const option of options) {
      const probability = row[option];
      if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) return null;
      probs[option] = probability;
    }
    out[id] = probs;
  }
  return out;
}

function withLock(recordFile, deadline, fn) {
  const lock = recordFile + ".lock";
  let held = false;
  let tmp;
  try {
    while (!held) {
      try {
        fs.mkdirSync(lock);
        held = true;
      } catch (error) {
        if (error.code !== "EEXIST" || Date.now() >= deadline) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(5, Math.max(0, deadline - Date.now())));
      }
    }
    const doc = readRecord(recordFile);
    const result = fn(doc);
    tmp = `${recordFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, recordFile);
    tmp = null;
    return result;
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
    if (held) fs.rmdirSync(lock);
  }
}

function readRecord(recordFile) {
  let doc = {};
  try {
    doc = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("decision record");
  return doc;
}

function rows(doc) {
  if (!Array.isArray(doc.advisory_decisions)) doc.advisory_decisions = [];
  return doc.advisory_decisions;
}

function reuseKey(id) {
  const parts = [id.decision_point, id.evidence_revision, id.state_digest];
  return parts.slice(0, 2).some((part) => part.includes("\n")) ? JSON.stringify(parts) : parts.join("\n");
}

function noteReuse(doc, entry) {
  if (!entry.state_digest || !REUSE.has(entry.outcome)) return;
  if (!doc.advisory_index || typeof doc.advisory_index !== "object" || Array.isArray(doc.advisory_index)) doc.advisory_index = {};
  doc.advisory_index[reuseKey(entry)] = { outcome: entry.outcome, meaning: entry.meaning };
}

function pushEntry(doc, entry) {
  rows(doc).push(entry);
  noteReuse(doc, entry);
}

function reusable(doc, id) {
  const hit = doc.advisory_index && doc.advisory_index[reuseKey(id)];
  return hit && REUSE.has(hit.outcome) ? hit : null;
}

function append(recordFile, deadline, entry, claimId) {
  if (!recordFile) return;
  withLock(recordFile, deadline, (doc) => {
    if (claimId) {
      const list = rows(doc);
      const pending = list.findIndex((row) => row.claim_id === claimId && row.outcome === "PENDING");
      if (pending === -1) return;
      list.splice(pending, 1);
    }
    pushEntry(doc, entry);
  });
}

function claim(recordFile, id, deadline) {
  return withLock(recordFile, deadline, (doc) => {
    const hit = reusable(doc, id);
    if (hit) {
      pushEntry(doc, { ...id, outcome: "REUSED", meaning: hit.meaning });
      return { kind: "return", result: agent("REUSED", hit.meaning) };
    }
    const list = rows(doc);
    const pending = list.findIndex((row) => row.outcome === "PENDING" && reuseKey(row) === reuseKey(id));
    if (pending !== -1) {
      if (list[pending].expires_at > Date.now()) return { kind: "wait" };
      list.splice(pending, 1);
    }
    const claimId = crypto.randomUUID();
    pushEntry(doc, { ...id, outcome: "PENDING", claim_id: claimId, expires_at: deadline });
    return { kind: "own", claimId };
  });
}

async function post(url, key, body, ms) {
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  const text = await response.text();
  return response.ok ? text : null;
}

async function waitFor(recordFile, id, deadline) {
  while (Date.now() < deadline) {
    const doc = readRecord(recordFile);
    const hit = reusable(doc, id);
    if (hit) {
      append(recordFile, deadline, { ...id, outcome: "REUSED", meaning: hit.meaning });
      return agent("REUSED", hit.meaning);
    }
    if (!rows(doc).some((row) => row.outcome === "PENDING" &&
        row.expires_at > Date.now() && reuseKey(row) === reuseKey(id))) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(20, Math.max(0, deadline - Date.now()))));
  }
  append(recordFile, deadline, { ...id, outcome: "SILENT_FALLBACK" });
  return agent("SILENT_FALLBACK");
}

function interpret(answers, labels, calibration) {
  if (!(answers.fit.yes > answers.fit.no)) return { outcome: "NO_PROPOSAL" };
  let bestLabel = null;
  let best = -1;
  let unique = false;
  for (const [label, probability] of Object.entries(answers.choice)) {
    if (probability > best) {
      best = probability;
      bestLabel = label;
      unique = true;
    } else if (probability === best) unique = false;
  }
  const meaning = labels[bestLabel];
  const qualified = calibration && calibration.qualified === true && typeof calibration.threshold === "number";
  if (!unique || !meaning || !qualified || !(best >= calibration.threshold)) return { outcome: "NO_PROPOSAL" };
  return { outcome: "ADVISED", meaning };
}

async function decideInner(input, ctx) {
  const budgetMs = remainingMs(ctx.budget);
  const deadline = Date.now() + budgetMs;
  const decision_point = typeof input.decision_point === "string" ? input.decision_point : "";
  const evidence_revision = typeof input.evidence_revision === "string" ? input.evidence_revision : "";
  const rule = DECISION_RULES.find((row) => row.decision_type === input.decision_type && sameFacts(row.facts, input.facts));
  if (rule) {
    append(ctx.record_file, deadline, { decision_point, evidence_revision, outcome: "RULE", meaning: rule.meaning });
    return agent("RULE", rule.meaning);
  }
  const silent = () => {
    append(ctx.record_file, deadline, { decision_point, evidence_revision, outcome: "SILENT_FALLBACK" });
    return agent("SILENT_FALLBACK");
  };
  if (ctx.enabled === false || !ELIGIBLE.has(input.decision_type)) return silent();
  const cfg = loadConfig(ctx.config_file);
  const key = cfg ? process.env[cfg.key_variable_name] : "";
  if (!cfg || typeof key !== "string" || key.length === 0 || budgetMs <= 0) return silent();

  const built = buildState(input);
  const id = {
    decision_point,
    evidence_revision,
    state_digest: digestOf(input, cfg, ctx.calibration && ctx.calibration[input.decision_type]),
  };
  const claimed = claim(ctx.record_file, id, deadline);
  if (claimed.kind === "return") return claimed.result;
  if (claimed.kind === "wait") return waitFor(ctx.record_file, id, deadline);

  let text = null;
  try {
    const remaining = Math.floor(deadline - Date.now());
    if (remaining > 0) {
      text = await post(cfg.base_url, key, { model: cfg.model_id, state: built.state, questions: built.questions }, remaining);
    }
  } catch {
    text = null;
  }
  const answers = text ? parseAnswers(text, built.questions) : null;
  if (!answers) {
    append(ctx.record_file, deadline, { ...id, outcome: "SILENT_FALLBACK" }, claimed.claimId);
    return agent("SILENT_FALLBACK");
  }
  const judged = interpret(answers, built.labels, ctx.calibration && ctx.calibration[input.decision_type]);
  const entry = { ...id, outcome: judged.outcome, probabilities: answers };
  if (judged.meaning) entry.meaning = judged.meaning;
  append(ctx.record_file, deadline, entry, claimed.claimId);
  return agent(judged.outcome, judged.meaning);
}

async function decide(input, ctx) {
  try {
    return await decideInner(input || {}, ctx || {});
  } catch {
    return { outcome: "SILENT_FALLBACK" };
  }
}

function read(recordFile) {
  try {
    const doc = JSON.parse(fs.readFileSync(recordFile, "utf8"));
    return Array.isArray(doc.advisory_decisions) ? doc.advisory_decisions : [];
  } catch {
    return [];
  }
}

module.exports = { decide, read };
