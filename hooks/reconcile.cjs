"use strict";

/** Deterministically apply evidence events to Journey state (#64). */
const fs = require("node:fs");

const REQUIRED = [
  "schema_version", "event_id", "source", "journey", "repository", "unit",
  "candidate_revision", "generation", "evidence", "transition", "occurred_at",
];
const KINDS = new Set(["implementation", "verification", "assurance", "acceptance", "merge", "issue_close"]);
const FIELDS = {
  implementation: "implementation",
  verification: "verification",
  assurance: "assurance",
  acceptance: "acceptance",
  merge: "observed_merge",
  issue_close: "observed_issue_close",
};
const PREDECESSORS = { verification: "implementation", assurance: "verification", acceptance: "assurance" };
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.length > 0;
const only = (value, names) => Object.keys(value).every((name) => names.includes(name));
const dateTime = (value) => nonempty(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));

function receiptFor(event) {
  return {
    event_id: event?.event_id ?? null,
    applied: false,
    code: "invalid_event",
    transition: event?.transition?.kind ?? null,
    slice: event?.unit?.slice ?? null,
    candidate_revision: event?.candidate_revision ?? null,
    evidence_sha256: event?.evidence?.sha256 ?? null,
  };
}

function structuralError(event) {
  if (!object(event) || !REQUIRED.every((name) => Object.hasOwn(event, name)) || !only(event, REQUIRED)) return true;
  if (event.schema_version !== 1 || !nonempty(event.event_id) || !nonempty(event.source) ||
      !nonempty(event.journey) || !nonempty(event.repository) || !nonempty(event.candidate_revision) ||
      !Number.isInteger(event.generation) || event.generation < 0 || !dateTime(event.occurred_at)) return true;
  if (!object(event.unit) || !only(event.unit, ["wave", "slice"]) || !nonempty(event.unit.slice) ||
      (Object.hasOwn(event.unit, "wave") && !nonempty(event.unit.wave))) return true;
  if (!object(event.evidence) || !only(event.evidence, ["ref", "sha256"])) return true;
  if (!object(event.transition) || !only(event.transition, ["kind", "verdict"]) ||
      !KINDS.has(event.transition.kind) || !nonempty(event.transition.verdict)) return true;
  return false;
}

function reject(state, receipt, code) {
  return { state, receipt: { ...receipt, code, reason: code } };
}

function applyEvent(state, event, options = {}) {
  const receipt = receiptFor(event);
  if (structuralError(event)) return reject(state, receipt, "invalid_event");
  if (options.expected_version !== undefined && options.expected_version !== state.version) {
    return reject(state, receipt, "stale_write");
  }
  if (state.applied_event_ids.includes(event.event_id)) return reject(state, receipt, "duplicate_event");
  if (event.journey !== state.journey || event.repository !== state.repository) {
    return reject(state, receipt, "unrelated_journey");
  }
  if (event.generation < state.generation) return reject(state, receipt, "stale_generation");

  const hasEvidence = nonempty(event.evidence.ref) && nonempty(event.evidence.sha256);
  if (!hasEvidence && event.transition.verdict === "PASS") return reject(state, receipt, "bare_pass");
  if (!hasEvidence) return reject(state, receipt, "missing_evidence");
  if (!/^[0-9a-f]{64}$/.test(event.evidence.sha256)) return reject(state, receipt, "invalid_event");

  const kind = event.transition.kind;
  const slice = state.slices[event.unit.slice] || {};
  const field = FIELDS[kind];
  const prior = slice[field];
  const history = prior ? {
    ...prior.history,
    [prior.candidate_revision]: { verdict: prior.verdict, sha256: prior.evidence.sha256 },
  } : {};
  const h = Object.hasOwn(history, event.candidate_revision) ? history[event.candidate_revision] : undefined;
  if (h && (h.verdict !== event.transition.verdict || h.sha256 !== event.evidence.sha256)) {
    return reject(state, receipt, "conflicting_receipt");
  }
  if (h) {
    return reject(state, receipt, event.candidate_revision === prior.candidate_revision ? "duplicate_event" : "stale_candidate");
  }

  const implementation = slice.implementation;
  if (["verification", "assurance", "acceptance"].includes(kind) &&
      implementation?.candidate_revision !== event.candidate_revision) {
    return reject(state, receipt, implementation ? "stale_candidate" : "predecessor_missing");
  }
  const predecessor = PREDECESSORS[kind];
  if (predecessor && slice[predecessor]?.candidate_revision !== event.candidate_revision) {
    return reject(state, receipt, "predecessor_missing");
  }

  const entry = {
    candidate_revision: event.candidate_revision,
    verdict: event.transition.verdict,
    evidence: { ...event.evidence },
    event_id: event.event_id,
    history: { ...history, [event.candidate_revision]: { verdict: event.transition.verdict, sha256: event.evidence.sha256 } },
  };
  const next = {
    ...state,
    generation: Math.max(state.generation, event.generation),
    version: state.version + 1,
    applied_event_ids: [...state.applied_event_ids, event.event_id],
    slices: { ...state.slices, [event.unit.slice]: { ...slice, [field]: entry } },
  };
  return { state: next, receipt: { ...receipt, applied: true, code: "applied" } };
}

function replay(state, events) {
  const receipts = [];
  let current = state;
  for (const event of events) {
    const result = applyEvent(current, event);
    current = result.state;
    receipts.push(result.receipt);
  }
  return { state: current, receipts };
}

function main(args = process.argv.slice(2)) {
  const [stateFile, eventsFile] = args;
  try {
    if (!stateFile || !eventsFile) throw new Error("usage: node hooks/reconcile.cjs <state.json> <events.ndjson>");
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const events = fs.readFileSync(eventsFile, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const result = replay(state, events);
    const temporary = `${stateFile}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, JSON.stringify(result.state, null, 2) + "\n");
    fs.renameSync(temporary, stateFile);
    for (const receipt of result.receipts) process.stdout.write(JSON.stringify(receipt) + "\n");
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

module.exports = { applyEvent, replay };

if (require.main === module) process.exitCode = main();
