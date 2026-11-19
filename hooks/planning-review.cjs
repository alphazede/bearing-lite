"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { PLANNING_REVIEW_POLICY: POLICY } = require("./policy.cjs");

const sameCandidate = (a, b) =>
  POLICY.candidate_fields.every(
    (key) => typeof a?.[key] === "string" && a[key] && a[key] === b?.[key]
  );

// Mirrors dodManifest.output_name in schemas/implementation.schema.json.
const MANIFEST_NAME = /^(?:[A-Za-z0-9._-]+-dod-manifest|review)\.html$/;

function manifestGenerated(input) {
  const name = input?.dod_manifest?.output_name;
  const dir = input?.plan_dir;
  if (typeof name !== "string" || !name || typeof dir !== "string" || !dir) return false;
  // The manifest is the rendered HTML directly inside plan_dir, under a name
  // the implementation schema allows (#189): reject escapes, nested paths, and
  // sibling files that are not the rendered manifest.
  if (!MANIFEST_NAME.test(name)) return false;
  const base = path.resolve(dir);
  const file = path.resolve(base, name);
  if (path.dirname(file) !== base) return false;
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

const nonempty = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * #593/#595: Validate at most one closing return per declared specialist session
 * (recorded as session.closing_return or wave.closing_returns[]) and project the
 * resulting READY/CANDIDATE_READY view for session completeness checks.
 */
function resolveWaveWithClosingReturns(wave) {
  if (wave?.closing_returns !== undefined && !Array.isArray(wave.closing_returns)) {
    return { ok: false, wave };
  }
  const sessions = Array.isArray(wave?.sessions) ? wave.sessions : [];
  const hasWaveClosing = Array.isArray(wave?.closing_returns) && wave.closing_returns.length > 0;
  const hasSessionClosing = sessions.some((session) => session && session.closing_return !== undefined);
  if (!hasWaveClosing && !hasSessionClosing) {
    return { ok: true, wave };
  }
  const declared = new Set(Array.isArray(wave?.required_sessions) ? wave.required_sessions : []);
  const byAuthor = new Map();
  for (const cr of wave.closing_returns || []) {
    if (!cr || typeof cr !== "object" || Array.isArray(cr)) return { ok: false, wave };
    if (!nonempty(cr.author) || !declared.has(cr.author)) return { ok: false, wave };
    if (byAuthor.has(cr.author)) return { ok: false, wave };
    byAuthor.set(cr.author, cr);
  }
  for (const session of sessions) {
    if (!session || session.closing_return === undefined) continue;
    const cr = session.closing_return;
    if (!cr || typeof cr !== "object" || Array.isArray(cr)) return { ok: false, wave };
    if (!nonempty(cr.author) || cr.author !== session.session || !declared.has(cr.author)) {
      return { ok: false, wave };
    }
    if (byAuthor.has(cr.author)) return { ok: false, wave };
    byAuthor.set(cr.author, cr);
  }
  for (const [author, cr] of byAuthor.entries()) {
    const session = sessions.find((item) => item?.session === author);
    if (!session || !sameCandidate(session, session)) return { ok: false, wave };
    const priorAllowed = session.verdict === "GAPS" ||
      POLICY.planning_session_ready_verdicts.includes(session.verdict);
    if (!priorAllowed) return { ok: false, wave };
    if (!nonempty(cr.reason)) return { ok: false, wave };
    if (!Array.isArray(cr.items) || cr.items.length === 0 || !cr.items.every(nonempty)) {
      return { ok: false, wave };
    }
    if (!sameCandidate(cr.candidate, cr.candidate)) return { ok: false, wave };
    const effectiveVerdict = cr.verdict !== undefined
      ? cr.verdict
      : (session.verdict === "GAPS" ? null : session.verdict);
    if (!nonempty(effectiveVerdict) || !POLICY.planning_session_ready_verdicts.includes(effectiveVerdict)) {
      return { ok: false, wave };
    }
  }
  const normalizedSessions = sessions.map((session) => {
    if (!session || !byAuthor.has(session.session)) return session;
    const cr = byAuthor.get(session.session);
    const effectiveVerdict = cr.verdict !== undefined ? cr.verdict : session.verdict;
    return {
      ...session,
      ...cr.candidate,
      verdict: effectiveVerdict,
      ...(cr.inputs !== undefined ? { inputs: cr.inputs } : {}),
      ...(cr.adopted_to !== undefined ? { adopted_to: cr.adopted_to } : {}),
    };
  });
  return { ok: true, wave: { ...wave, sessions: normalizedSessions } };
}

/**
 * #205: the declared planning sessions of the one planning wave. The wave
 * declares exactly the profile-enabled specialist sessions the task needs
 * (possibly none); no session is unconditionally required and final Planning
 * and Design is the Planning Orchestrator's own procedure, not a session.
 * Every declared session must have returned a ready verdict for the candidate
 * identity before review opens or the final freeze passes; a pending or
 * incomplete return stays a gap. Returns null when complete, else a typed
 * { outcome, reason }. Shared with plan-package.cjs.
 */
function planningSessionsVerdict(wave, candidate, inputDigests, { requireSnapshot = true } = {}) {
  if (!wave || typeof wave !== "object") {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "planning_sessions_incomplete" };
  }
  const declared = wave?.required_sessions;
  const known = [...POLICY.planning_sessions_required, ...POLICY.planning_sessions_optional];
  if (
    !Array.isArray(declared) ||
    new Set(declared).size !== declared.length ||
    declared.some((name) => !known.includes(name)) ||
    POLICY.planning_sessions_required.some((name) => !declared.includes(name))
  ) {
    return { outcome: "OWNER_AMENDMENT_REQUIRED", reason: "planning_sessions_invalid" };
  }
  const resolved = resolveWaveWithClosingReturns(wave);
  if (!resolved.ok) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "planning_sessions_incomplete" };
  }
  const sessions = Array.isArray(resolved.wave.sessions) ? resolved.wave.sessions : [];
  const names = sessions.map((session) => session?.session);
  if (new Set(names).size !== names.length || names.some((name) => !declared.includes(name))) {
    return { outcome: "OWNER_AMENDMENT_REQUIRED", reason: "planning_sessions_invalid" };
  }
  // An adoption preserves the source return; its consumed inputs must resolve
  // unchanged in the snapshot bound to the target candidate's manifest digest.
  const validInputRow = (row) => nonempty(row?.path) && /^[0-9a-f]{64}$/.test(row?.sha256);
  const snapshotBound = Array.isArray(inputDigests) && inputDigests.length > 0 &&
    inputDigests.every(validInputRow) &&
    new Set(inputDigests.map((row) => row.path)).size === inputDigests.length &&
    crypto.createHash("sha256").update(inputDigests.map((row) => row.sha256).join("\n")).digest("hex") === candidate?.candidate_digest;
  const adopted = (session) => sameCandidate(session, session) &&
    sameCandidate(session.adopted_to, candidate) && Array.isArray(session.inputs) &&
    session.inputs.length > 0 && session.inputs.every(validInputRow) &&
    (!requireSnapshot || (snapshotBound && session.inputs.every((input) =>
      inputDigests.some((row) => row.path === input?.path && row.sha256 === input?.sha256))));
  const returned = declared.every((name) => {
    const session = sessions.find((item) => item?.session === name);
    return (
      session &&
      nonempty(session.verdict) &&
      POLICY.planning_session_ready_verdicts.includes(session.verdict) &&
      (sameCandidate(session, candidate) || adopted(session))
    );
  });
  return returned ? null : { outcome: "NEEDS_MORE_EVIDENCE", reason: "planning_sessions_incomplete" };
}

function evaluatePlanningReview(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "planning_review_missing" };
  }
  // DES-136.01: the owner-review gate is unreachable until the DoD Manifest
  // projection and its rendered HTML both exist.
  if (!manifestGenerated(input)) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "manifest_not_generated" };
  }
  if (input.correction_id !== undefined && !nonempty(input.correction_id)) {
    return { outcome: "OWNER_AMENDMENT_REQUIRED", reason: "correction_id_invalid" };
  }
  // #69: a specification Journey gates its requirement register at planning;
  // existence on disk is checked by hooks/plan-package.cjs at the freeze.
  if (
    input.journey_type === "specification" &&
    !(typeof input.requirement_register === "string" && input.requirement_register.endsWith(".sdoc"))
  ) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "missing_requirement_register" };
  }
  // #205: the review never opens while a declared planning session is out.
  const sessions = planningSessionsVerdict(input.planning_wave, input.candidate, input.input_digests);
  if (sessions) return sessions;
  const slots = Array.isArray(input.reviewer_slots) ? input.reviewer_slots : [];
  const ids = slots.map((slot) => slot?.slot_id);
  const primaryRoutes = slots.map((slot) => slot?.primary_route_ref);
  if (
    slots.length < POLICY.reviewer_slots_min ||
    slots.length > POLICY.reviewer_slots_max ||
    ids.some((id) => typeof id !== "string" || !id) ||
    new Set(ids).size !== ids.length ||
    new Set(primaryRoutes).size !== primaryRoutes.length ||
    slots.some(
      (slot) =>
        typeof slot.primary_route_ref !== "string" ||
        !slot.primary_route_ref ||
        !Array.isArray(slot.fallback_route_refs)
    )
  ) {
    return { outcome: "OWNER_AMENDMENT_REQUIRED", reason: "slot_binding_invalid" };
  }
  if (slots.some((slot) => slot.exhausted === true)) {
    return { outcome: POLICY.slot_exhaustion_outcome, reason: "reviewer_slot_exhausted" };
  }
  if (input.round_number !== 1 || input.completed_rounds > POLICY.review_rounds) {
    return { outcome: "HALT", reason: "review_round_limit" };
  }
  if (input.completed_rounds === 0) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "review_round_pending" };
  }
  if (input.completed_rounds !== POLICY.review_rounds) {
    return { outcome: "OWNER_AMENDMENT_REQUIRED", reason: "review_round_invalid" };
  }
  if (
    POLICY.automatic_rereview === "prohibited" &&
    (input.automatic_rereview_requested === true || input.review_after_repair === true)
  ) {
    return { outcome: "OWNER_AMENDMENT_REQUIRED", reason: "automatic_rereview_prohibited" };
  }
  const receipts = Array.isArray(input.receipts) ? input.receipts : [];
  const receiptIds = receipts.map((receipt) => receipt?.slot_id);
  const selectedRoutes = receipts.map((receipt) => receipt?.selected_route_ref);
  if (
    receipts.length !== slots.length ||
    new Set(receiptIds).size !== receiptIds.length ||
    new Set(selectedRoutes).size !== selectedRoutes.length ||
    !input.candidate ||
    receipts.some(
      (receipt) => {
        const slot = slots.find((item) => item.slot_id === receipt?.slot_id);
        return (
          !slot ||
          ![slot.primary_route_ref, ...slot.fallback_route_refs].includes(receipt.selected_route_ref) ||
          receipt.independent !== POLICY.independence_required ||
          receipt.findings_isolated !== POLICY.isolated_findings_until_aggregation ||
          !sameCandidate(receipt, input.candidate)
        );
      }
    )
  ) {
    return { outcome: "HALT", reason: "candidate_or_independence_mismatch" };
  }
  if (input.aggregation_complete !== true) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "aggregation_pending" };
  }
  const repairs = Number(input.aggregated_repairs || 0);
  if (!Number.isInteger(repairs) || repairs < 0 || repairs > POLICY.aggregated_repairs_max) {
    return { outcome: "HALT", reason: "aggregated_repair_limit" };
  }
  if (repairs === 1 && input.deterministic_gate !== POLICY.post_repair_gate.split("_")[1]) {
    return { outcome: "HALT", reason: "deterministic_post_repair_gate_required" };
  }
  return { outcome: "PASS", reason: repairs ? "repair_gate_passed" : "review_aggregated" };
}

module.exports = { POLICY, evaluatePlanningReview, planningSessionsVerdict, sameCandidate };
