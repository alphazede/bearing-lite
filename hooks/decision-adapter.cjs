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
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canon(value[key]);
    return out;
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
  return total_ms - elapsed_ms - reserve_ms;
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
  const choice = [];
  for (const [meaning, description] of Object.entries(input.options || {})) {
    const label = "n" + choice.length.toString(36);
    labels[label] = meaning;
    criteria[label] = String(description);
    choice.push(label);
  }
  trusted.labels = labels;
  trusted.criteria = criteria;
  const state = { trusted };
  if (PROSE.has(input.decision_type) && typeof input.packet === "string") {
    state.untrusted = { packet: input.packet };
  }
  const questions = [
    { id: "fit", options: ["yes", "no"], text: "Does any option fit?" },
    { id: "choice", options: choice, text: "Select one label." },
  ];
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
  for (const question of questions) {
    const row = body.answers[question.id];
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const keys = Object.keys(row);
    if (keys.length !== question.options.length || question.options.some((option) => !Object.prototype.hasOwnProperty.call(row, option))) {
      return null;
    }
    const probs = {};
    for (const option of question.options) {
      const probability = row[option];
      if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) return null;
      probs[option] = probability;
    }
    out[question.id] = probs;
  }
  return out;
}

function withLock(recordFile, fn) {
  const lock = recordFile + ".lock";
  const deadline = Date.now() + 5000;
  let held = false;
  let tmp;
  try {
    while (!held) {
      try {
        fs.mkdirSync(lock);
        held = true;
      } catch (error) {
        if (error.code !== "EEXIST" || Date.now() >= deadline) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
    let doc = {};
    try {
      doc = JSON.parse(fs.readFileSync(recordFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("decision record");
    const result = fn(doc);
    tmp = `${recordFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n");
    fs.renameSync(tmp, recordFile);
    tmp = null;
    return result;
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
    if (held) fs.rmdirSync(lock);
  }
}

function rows(doc) {
  if (!Array.isArray(doc.advisory_decisions)) doc.advisory_decisions = [];
  return doc.advisory_decisions;
}

function reusable(doc, id) {
  const list = doc.advisory_decisions || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const row = list[i];
    if (row.decision_point === id.decision_point && row.evidence_revision === id.evidence_revision && row.state_digest === id.state_digest && REUSE.has(row.outcome)) {
      return row;
    }
  }
  return null;
}

function append(recordFile, entry, id) {
  if (!recordFile) return;
  withLock(recordFile, (doc) => {
    const list = rows(doc);
    if (id) {
      doc.advisory_decisions = list.filter((row) => !(row.outcome === "PENDING" && row.decision_point === id.decision_point && row.evidence_revision === id.evidence_revision && row.state_digest === id.state_digest));
    }
    doc.advisory_decisions.push(entry);
  });
}

function claim(recordFile, id) {
  return withLock(recordFile, (doc) => {
    const list = rows(doc);
    const hit = reusable(doc, id);
    if (hit) {
      list.push({ ...id, outcome: "REUSED", meaning: hit.meaning });
      return { kind: "return", result: agent("REUSED", hit.meaning) };
    }
    if (list.some((row) => row.outcome === "PENDING" && row.decision_point === id.decision_point && row.evidence_revision === id.evidence_revision && row.state_digest === id.state_digest)) {
      return { kind: "wait" };
    }
    list.push({ ...id, outcome: "PENDING" });
    return { kind: "own" };
  });
}

async function post(url, key, body, ms) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  const text = await response.text();
  return response.ok ? text : null;
}

async function waitFor(recordFile, id, deadline) {
  while (Date.now() < deadline) {
    const found = withLock(recordFile, (doc) => {
      const hit = reusable(doc, id);
      if (!hit) return null;
      rows(doc).push({ ...id, outcome: "REUSED", meaning: hit.meaning });
      return agent("REUSED", hit.meaning);
    });
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  append(recordFile, { ...id, outcome: "SILENT_FALLBACK" }, id);
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
  const decision_point = typeof input.decision_point === "string" ? input.decision_point : "";
  const evidence_revision = typeof input.evidence_revision === "string" ? input.evidence_revision : "";
  const rule = DECISION_RULES.find((row) => row.decision_type === input.decision_type && sameFacts(row.facts, input.facts));
  if (rule) {
    append(ctx.record_file, { decision_point, evidence_revision, outcome: "RULE", meaning: rule.meaning });
    return agent("RULE", rule.meaning);
  }
  const silent = () => {
    append(ctx.record_file, { decision_point, evidence_revision, outcome: "SILENT_FALLBACK" });
    return agent("SILENT_FALLBACK");
  };
  if (ctx.enabled === false || !ELIGIBLE.has(input.decision_type)) return silent();
  const cfg = loadConfig(ctx.config_file);
  const key = cfg ? process.env[cfg.key_variable_name] : "";
  const budgetMs = remainingMs(ctx.budget);
  if (!cfg || typeof key !== "string" || key.length === 0 || budgetMs <= 0) return silent();

  const built = buildState(input);
  const id = {
    decision_point,
    evidence_revision,
    state_digest: digestOf(input, cfg, ctx.calibration && ctx.calibration[input.decision_type]),
  };
  const claimed = claim(ctx.record_file, id);
  if (claimed.kind === "return") return claimed.result;
  if (claimed.kind === "wait") return waitFor(ctx.record_file, id, Date.now() + budgetMs);

  let text = null;
  try {
    text = await post(cfg.base_url, key, { model: cfg.model_id, state: built.state, questions: built.questions }, Math.max(1, Math.floor(budgetMs)));
  } catch {
    text = null;
  }
  const answers = text ? parseAnswers(text, built.questions) : null;
  if (!answers) {
    append(ctx.record_file, { ...id, outcome: "SILENT_FALLBACK" }, id);
    return agent("SILENT_FALLBACK");
  }
  const judged = interpret(answers, built.labels, ctx.calibration && ctx.calibration[input.decision_type]);
  const entry = { ...id, outcome: judged.outcome, probabilities: answers };
  if (judged.meaning) entry.meaning = judged.meaning;
  append(ctx.record_file, entry, id);
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
