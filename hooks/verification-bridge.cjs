"use strict";

/**
 * Deterministic verification receipt bridge (issue #105).
 *
 * `verification.cjs` judges receipts but produces none, so every claim had to
 * be shaped by hand. This module shapes a matched request/receipt pair that the
 * adapter admits, in two steps: `planVerification` says what to run, the caller
 * runs it, `sealVerification` turns that output into a receipt.
 *
 * Pure evaluator, like the adapter: no HOOK_CLASS, no host event, no download,
 * no process execution. A backend is never a role and availability never
 * selects one for a task.
 *
 * The caller states each backend's invocation shape and operation policy in
 * the spec. The bridge validates and assembles; it knows no tool's flags and
 * no backend's subcommands, so a backend with a different command layout is
 * planned the same way. A caller-supplied command line is never read, so raw
 * text cannot bypass the operation policy. The shape and the values are stored
 * together in `command_configuration`, so a rerun is reproducible from the
 * receipt alone.
 *
 * Three rules carry the weight:
 *   - A generative backend operation is denied. An operation that proposes the
 *     claims it then verifies is circular, so it cannot produce independent
 *     evidence. An adopting project maps this to whatever standard it follows.
 *   - An analysis-derived verdict is sealed as INCONCLUSIVE, so a heuristic
 *     answer cannot close a gate. The raw verdict stays visible in the receipt.
 *   - A malformed claim is a typed rejection, never a quiet unproven receipt.
 */

const crypto = require("node:crypto");

const AUTHORITIES = Object.freeze(["diagnostic", "assurance"]);
const STAGES = Object.freeze([
  "implementation",
  "integration",
  "assurance",
  "review",
  "post_repair_closure",
]);
const EXPECTED = Object.freeze(["VERIFIED", "REFUTED"]);
const STATUSES = Object.freeze(["VERIFIED", "REFUTED", "INCONCLUSIVE", "ERROR"]);
const CANDIDATE_REQUIRED = Object.freeze(["candidate_ref", "candidate_revision"]);
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Slots a caller template may use. Each names a value the bridge substitutes;
 * any other template entry passes through untouched and is never interpreted.
 * A template entry is either exactly one of these slots or a literal: entries
 * mixing literal text with braces are rejected, so a validated value cannot be
 * smuggled in beside the checked one.
 */
const SLOT_OPERATION = "{operation}";
const SLOT_TARGET = "{target}";
const SLOT_CLAIM = "{claim}";
const SLOT_ARGS = "{args}";

/** Marker a backend uses to say a verdict was recovered, not read. */
const DERIVED_MARKER = /^\s*DERIVED\b/i;
/** Marker a backend uses to say the claim itself was not well formed. */
const MALFORMED_MARKER = /\bmalformed claim\b/i;

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const nonempty = (value) => typeof value === "string" && value.length > 0;

function fail(outcome, reason, extra = {}) {
  return { outcome, reason, ...extra };
}

/**
 * Deterministic JSON: UTF-8, sorted keys, no incidental whitespace.
 * The same backend output must always digest to the same value.
 * @param {unknown} value
 * @returns {string}
 */
function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys
      .filter((key) => value[key] !== undefined)
      .map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key]))
      .join(",") +
    "}"
  );
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function candidateFields(candidate) {
  const bound = {
    candidate_ref: candidate.candidate_ref,
    candidate_revision: candidate.candidate_revision,
  };
  if (candidate.candidate_digest !== undefined) {
    bound.candidate_digest = candidate.candidate_digest;
  }
  return bound;
}

/**
 * Validate one verification intent and return what to run plus the request that
 * the resulting receipt must match. Nothing is executed here.
 *
 * @param {{
 *   backend?: string, backend_operation?: string,
 *   backend_operations?: {allowed?: string[], denied?: string[]},
 *   invocation?: {executable?: string, argv_template?: string[]},
 *   claim_id?: string, claim_type?: string, claim?: object, target?: string,
 *   candidate?: object, stage?: string, authority?: string,
 *   expected_result?: string, selected?: boolean, required?: boolean,
 *   args?: string[]
 * }} [spec]
 * A caller-supplied `argv` is never read: the runnable command is always
 * assembled from the validated operation, target, claim, and template.
 * @returns {{outcome: string, reason?: string, request?: object, argv?: string[]}}
 */
function planVerification(spec) {
  if (!isPlainObject(spec)) return fail("NEEDS_MORE_EVIDENCE", "verification_spec_missing");

  if (!nonempty(spec.backend)) return fail("NEEDS_MORE_EVIDENCE", "backend_unspecified");

  // Operation policy travels with the caller: each backend declares which
  // operations read evidence and which would propose it. The bridge enforces
  // the declared policy; it carries no backend's operation list itself. A
  // proposing operation is denied rather than omitted, so the refusal stays
  // explicit instead of looking like an unsupported name.
  const policy = spec.backend_operations;
  if (
    !isPlainObject(policy) ||
    !Array.isArray(policy.allowed) ||
    policy.allowed.length === 0 ||
    !policy.allowed.every(nonempty) ||
    !Array.isArray(policy.denied) ||
    !policy.denied.every(nonempty)
  ) {
    return fail("NEEDS_MORE_EVIDENCE", "backend_operations_unbound");
  }

  const operation = spec.backend_operation;
  if (!nonempty(operation)) return fail("NEEDS_MORE_EVIDENCE", "backend_operation_unspecified");
  if (policy.denied.includes(operation)) {
    return fail("REJECT", "generative_backend_operation_denied");
  }
  if (!policy.allowed.includes(operation)) {
    return fail("REJECT", "backend_operation_unsupported");
  }

  // Authority is never defaulted: one backend serves both authority levels, and
  // silently promoting a diagnostic run would break assurance independence.
  if (!nonempty(spec.authority)) return fail("NEEDS_MORE_EVIDENCE", "authority_unspecified");
  if (!AUTHORITIES.includes(spec.authority)) return fail("REJECT", "authority_invalid");

  if (!nonempty(spec.stage)) return fail("NEEDS_MORE_EVIDENCE", "stage_unspecified");
  if (!STAGES.includes(spec.stage)) return fail("REJECT", "stage_invalid");

  if (!EXPECTED.includes(spec.expected_result)) {
    return fail("NEEDS_MORE_EVIDENCE", "expected_result_unbound");
  }

  if (!nonempty(spec.claim_id)) return fail("NEEDS_MORE_EVIDENCE", "claim_id_unbound");
  if (!nonempty(spec.claim_type)) return fail("NEEDS_MORE_EVIDENCE", "claim_type_unbound");
  if (!isPlainObject(spec.claim) || !nonempty(spec.claim.kind)) {
    return fail("NEEDS_MORE_EVIDENCE", "claim_unbound");
  }
  if (!nonempty(spec.target)) return fail("NEEDS_MORE_EVIDENCE", "target_unbound");

  const candidate = spec.candidate;
  if (!isPlainObject(candidate)) return fail("NEEDS_MORE_EVIDENCE", "candidate_unbound");
  for (const field of CANDIDATE_REQUIRED) {
    if (!nonempty(candidate[field])) return fail("NEEDS_MORE_EVIDENCE", "candidate_unbound");
  }
  if (candidate.candidate_digest !== undefined && !SHA256.test(candidate.candidate_digest)) {
    return fail("REJECT", "candidate_digest_invalid");
  }

  if (typeof spec.selected !== "boolean" || typeof spec.required !== "boolean") {
    return fail("NEEDS_MORE_EVIDENCE", "activation_unbound");
  }

  // The invocation shape is the caller's: an executable plus a template whose
  // slots the bridge fills with the validated values. Literals pass through
  // uninterpreted. Each run-critical value appears exactly once, so the stored
  // shape plus the stored values rebuild the command deterministically.
  const invocation = spec.invocation;
  const template = isPlainObject(invocation) ? invocation.argv_template : undefined;
  if (!isPlainObject(invocation) || !nonempty(invocation.executable)) {
    return fail("NEEDS_MORE_EVIDENCE", "invocation_unbound");
  }
  if (
    invocation.executable.includes("{") ||
    invocation.executable.includes("}") ||
    !Array.isArray(template)
  ) {
    return fail("NEEDS_MORE_EVIDENCE", "invocation_unbound");
  }
  const slots = { operation: 0, target: 0, claim: 0, args: 0 };
  for (const entry of template) {
    if (typeof entry !== "string" || entry.length === 0) {
      return fail("NEEDS_MORE_EVIDENCE", "invocation_unbound");
    }
    if (entry === SLOT_OPERATION) slots.operation += 1;
    else if (entry === SLOT_TARGET) slots.target += 1;
    else if (entry === SLOT_CLAIM) slots.claim += 1;
    else if (entry === SLOT_ARGS) slots.args += 1;
    else if (entry.includes("{") || entry.includes("}")) {
      return fail("NEEDS_MORE_EVIDENCE", "invocation_unbound");
    }
  }
  if (slots.operation !== 1 || slots.target !== 1 || slots.claim !== 1 || slots.args > 1) {
    return fail("NEEDS_MORE_EVIDENCE", "invocation_unbound");
  }

  const extraArgs = Array.isArray(spec.args) ? spec.args.map(String) : [];
  const claimJson = canonicalJson(spec.claim);
  const argv = [invocation.executable];
  let spliced = false;
  for (const entry of template) {
    if (entry === SLOT_OPERATION) argv.push(operation);
    else if (entry === SLOT_TARGET) argv.push(spec.target);
    else if (entry === SLOT_CLAIM) argv.push(claimJson);
    else if (entry === SLOT_ARGS) {
      argv.push(...extraArgs);
      spliced = true;
    } else argv.push(entry);
  }
  if (!spliced) argv.push(...extraArgs);

  // The adapter requires request and receipt command_configuration to be deeply
  // equal, so both are built once, here. The invocation shape is stored with
  // the values, so the command rebuilds from the receipt alone.
  const command_configuration = {
    backend: spec.backend,
    operation,
    target: spec.target,
    claim: claimJson,
    args: extraArgs,
    invocation: {
      executable: invocation.executable,
      argv_template: [...template],
    },
  };

  const request = {
    schema_version: "1",
    kind: "request",
    ...candidateFields(candidate),
    claim_id: spec.claim_id,
    claim_type: spec.claim_type,
    backend: spec.backend,
    stage: spec.stage,
    authority: spec.authority,
    expected_result: spec.expected_result,
    command_configuration,
    selected: spec.selected,
    required: spec.required,
  };

  return { outcome: "READY", request, argv, command_configuration };
}

/**
 * Pick the single claim result out of a backend run.
 * @param {object} output
 * @returns {object|null}
 */
function soleResult(output) {
  const results = output.results;
  if (Array.isArray(results)) return results.length === 1 ? results[0] : null;
  return isPlainObject(results) ? results : null;
}

/**
 * Turn one backend run into a receipt the adapter can judge.
 *
 * @param {{plan?: object, output?: object, produced_by?: object}} [input]
 * @returns {{outcome: string, reason?: string, detail?: string, receipt?: object}}
 */
function sealVerification(input) {
  if (!isPlainObject(input)) return fail("NEEDS_MORE_EVIDENCE", "seal_input_missing");

  const plan = input.plan;
  if (!isPlainObject(plan) || !isPlainObject(plan.request)) {
    return fail("NEEDS_MORE_EVIDENCE", "plan_missing");
  }
  const request = plan.request;

  const output = input.output;
  if (!isPlainObject(output)) return fail("NEEDS_MORE_EVIDENCE", "backend_output_missing");

  // The version is read from the run, never assumed, so a stale receipt cannot
  // claim a version the backend did not report.
  if (!nonempty(output.backend_version)) {
    return fail("NEEDS_MORE_EVIDENCE", "backend_version_missing");
  }

  const who = input.produced_by;
  if (
    !isPlainObject(who) ||
    !nonempty(who.role) ||
    !nonempty(who.identity) ||
    !nonempty(who.session)
  ) {
    return fail("NEEDS_MORE_EVIDENCE", "produced_by_unbound");
  }

  const result = soleResult(output);
  if (!isPlainObject(result)) return fail("NEEDS_MORE_EVIDENCE", "backend_result_unreadable");

  const detail = nonempty(result.detail) ? result.detail : "";
  const verdict = nonempty(result.verdict) ? result.verdict.toUpperCase() : "";

  // A claim the backend could not parse is an authoring error. Sealing it as
  // INCONCLUSIVE would read as "not proven" and quietly weaken the gate.
  if (MALFORMED_MARKER.test(detail)) {
    return fail("REJECT", "claim_malformed", { detail });
  }

  if (!STATUSES.includes(verdict)) {
    return fail("NEEDS_MORE_EVIDENCE", "backend_verdict_unreadable");
  }

  const evidence = isPlainObject(result.evidence) ? result.evidence : {};
  const derived = nonempty(evidence.strength) && DERIVED_MARKER.test(evidence.strength);

  // A recovered control-flow answer is heuristic. Keep the raw verdict visible
  // for a reader, but seal it at a status that cannot satisfy a gate.
  const status = derived && (verdict === "VERIFIED" || verdict === "REFUTED")
    ? "INCONCLUSIVE"
    : verdict;

  const receipt = {
    schema_version: "1",
    kind: "receipt",
    status,
    ...candidateFields(request),
    claim_id: request.claim_id,
    backend: request.backend,
    backend_version: output.backend_version,
    command_configuration: request.command_configuration,
    evidence_digest: sha256Hex(canonicalJson(output)),
    authority: request.authority,
    produced_by: { role: who.role, identity: who.identity, session: who.session },
    stage: request.stage,
    evidence_tier: derived ? "derived" : "observed",
    backend_verdict: verdict,
  };
  if (derived && nonempty(evidence.engine)) {
    receipt.evidence_engine = nonempty(evidence.engine_version)
      ? `${evidence.engine} ${evidence.engine_version}`
      : evidence.engine;
  }

  return { outcome: "READY", receipt };
}

module.exports = {
  planVerification,
  sealVerification,
  canonicalJson,
};
