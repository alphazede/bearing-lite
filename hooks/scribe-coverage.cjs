#!/usr/bin/env node
"use strict";

/**
 * Scribe coverage (#194). Lists Lifecycle events in journey.json that the
 * selected recorder has not transcribed into `history`. Orchestrator records
 * by default; an enabled Scribe owns transcription instead, with unavailable
 * selected Scribe remaining a typed gap. Pure evaluator, never writes history.
 *
 * Events: confirmed owner decisions (answered or cancelled owner stops and
 * non-owner-stop decision records), authority events, and observed landings.
 * An event is transcribed when its id appears in the matching `history` list.
 */

const fs = require("node:fs");

const SCRIBE_CADENCES = Object.freeze(["event", "phase", "lifecycle"]);
const DEFAULT_SCRIBE_CADENCE = "event";
const OUTCOMES = Object.freeze(["PASS", "SCRIBE_REQUIRED", "ORCHESTRATOR_REQUIRED", "CAPABILITY_GAP", "UNAVAILABLE"]);

/** Control-plane list -> history list that transcribes it. */
const SOURCES = Object.freeze([
  { kind: "decision", control: "decisions", history: "decisions" },
  { kind: "authority_event", control: "authority_events", history: "authority_events" },
  { kind: "landing", control: "landings", history: "landings" },
]);

const TIME_FIELDS = Object.freeze([
  "answered_at",
  "cancelled_at",
  "decided_at",
  "observed_at",
  "occurred_at",
  "recorded_at",
  "timestamp",
]);

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.trim() !== "";

/** Owner stops still queued or asked are open questions, not decisions yet. */
function isSettledDecision(record) {
  if (record.record_type !== "owner_stop") return true;
  return record.status === "answered" || record.status === "cancelled";
}

function eventTime(record) {
  for (const field of TIME_FIELDS) {
    if (nonempty(record[field])) return record[field];
  }
  return null;
}

function transcribedIds(history, key) {
  const ids = new Set();
  const list = isPlainObject(history) && Array.isArray(history[key]) ? history[key] : [];
  for (const entry of list) {
    if (!isPlainObject(entry)) continue;
    if (nonempty(entry.id)) ids.add(entry.id);
    if (nonempty(entry.source_id)) ids.add(entry.source_id);
  }
  return ids;
}

/** Every `roles.scribe` route in the snapshot, with the key path that holds it. */
function collectScribeRoutes(value, trail = [], found = [], depth = 0) {
  if (!isPlainObject(value) || depth > 6) return found;
  if (isPlainObject(value.roles) && isPlainObject(value.roles.scribe)) {
    found.push({ trail, route: value.roles.scribe });
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== "roles") collectScribeRoutes(child, [...trail, key], found, depth + 1);
  }
  return found;
}

/**
 * The Scribe route for the Lifecycle's current phase: a snapshot split into
 * planning and implementation profiles uses the one matching journey.status.
 */
function findScribeRoute(journey) {
  const found = collectScribeRoutes(journey.profile_selection);
  if (found.length === 0) return undefined;
  const status = isPlainObject(journey.journey) ? journey.journey.status : undefined;
  const phase = status === "planning" ? "planning" : "implementation";
  const match = found.find((entry) => entry.trail.includes(phase));
  return (match || found[0]).route;
}

/** Explicit flag, else the snapshot. Only an enabled route counts; omitted/disabled uses Orchestrator. */
function scribeAvailable(journey, explicit) {
  if (typeof explicit === "boolean") return explicit;
  const route = findScribeRoute(journey);
  return Boolean(route && route.enabled === true);
}

/** Scribe cadence from the recorded snapshot; omitted means `event`. */
function scribeCadence(journey) {
  const route = findScribeRoute(journey);
  const cadence = route && route.cadence;
  return SCRIBE_CADENCES.includes(cadence) ? cadence : DEFAULT_SCRIBE_CADENCE;
}

function untranscribedEvents(journey) {
  const pending = [];
  for (const source of SOURCES) {
    const list = journey[source.control];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw new TypeError(source.control + "_not_array");
    const done = transcribedIds(journey.history, source.history);
    list.forEach((record, index) => {
      if (!isPlainObject(record)) throw new TypeError(source.control + "_entry_invalid");
      if (source.kind === "decision" && !isSettledDecision(record)) return;
      const id = nonempty(record.id) ? record.id : null;
      if (id && done.has(id)) return;
      pending.push({
        kind: source.kind,
        id: id ?? `${source.control}[${index}]`,
        at: eventTime(record),
      });
    });
  }
  return pending;
}

/**
 * @param {{journey: unknown, scribe_available?: boolean}} input
 * @returns {{outcome: string, reason: string, untranscribed: object[], cadence: string|null, recovery: string}}
 */
function evaluateScribeCoverage(input) {
  const journey = isPlainObject(input) ? input.journey : undefined;
  if (!isPlainObject(journey)) {
    return {
      outcome: "UNAVAILABLE",
      reason: "journey_missing_or_malformed",
      untranscribed: [],
      cadence: null,
      recovery: "Supply the Lifecycle journey.json; coverage is unknown, never PASS",
    };
  }
  let pending;
  try {
    pending = untranscribedEvents(journey);
  } catch (err) {
    return {
      outcome: "UNAVAILABLE",
      reason: "journey_invalid:" + err.message,
      untranscribed: [],
      cadence: null,
      recovery: "Repair journey.json lists; coverage is unknown, never PASS",
    };
  }
  const cadence = scribeCadence(journey);
  if (pending.length === 0) {
    return {
      outcome: "PASS",
      reason: "history_current",
      untranscribed: [],
      cadence,
      recovery: "History is current; continue",
    };
  }
  const ids = pending.map((event) => event.id).join(",");
  const route = findScribeRoute(journey);
  if (route === undefined || route.enabled === false) {
    return {
      outcome: "ORCHESTRATOR_REQUIRED",
      reason: "untranscribed:" + ids,
      untranscribed: pending,
      cadence,
      recovery: "Orchestrator records the listed source-backed events, then re-runs coverage; no separate Scribe is selected",
    };
  }
  if (!scribeAvailable(journey, input.scribe_available)) {
    return {
      outcome: "CAPABILITY_GAP",
      reason: "scribe_unavailable:" + ids,
      untranscribed: pending,
      cadence,
      recovery:
        "Report the typed capability gap to the owner; the Orchestrator never transcribes history in the Scribe's place",
    };
  }
  return {
    outcome: "SCRIBE_REQUIRED",
    reason: "untranscribed:" + ids,
    untranscribed: pending,
    cadence,
    recovery: "Send these events to the existing Scribe session on its frozen route, then re-run this check; never relaunch per event or phase",
  };
}

function main(argv) {
  const file = argv[2];
  let body;
  try {
    body = { journey: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    body = { journey: undefined };
  }
  const verdict = evaluateScribeCoverage(body);
  process.stdout.write(JSON.stringify(verdict) + "\n");
  process.exit(verdict.outcome === "PASS" ? 0 : 1);
}

module.exports = {
  SCRIBE_CADENCES,
  DEFAULT_SCRIBE_CADENCE,
  OUTCOMES,
  evaluateScribeCoverage,
  untranscribedEvents,
};

if (require.main === module) {
  main(process.argv);
}
