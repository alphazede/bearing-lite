"use strict";

/**
 * Deterministic verification adapter (DES-BDL-008 / AC-BDL-009 / SEIT-BDL-004).
 * Pure evaluator: no HOOK_CLASS, no host event, no download, no role dispatch.
 * Reverify is one optional backend; availability never selects it for a task.
 */

const STATUSES = Object.freeze(["VERIFIED", "REFUTED", "INCONCLUSIVE", "ERROR"]);
const AUTHORITIES = Object.freeze(["diagnostic", "assurance"]);
const STAGES = Object.freeze([
  "implementation",
  "integration",
  "assurance",
  "review",
  "post_repair_closure",
]);
const EXPECTED = Object.freeze(["VERIFIED", "REFUTED"]);
const SHA256 = /^[0-9a-f]{64}$/;
const CANDIDATE_FIELDS = Object.freeze([
  "candidate_ref",
  "candidate_revision",
  "candidate_digest",
]);

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const nonempty = (value) => typeof value === "string" && value.length > 0;

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

function result(outcome, reason, extra = {}) {
  const out = {
    outcome,
    reason,
    status: extra.status ?? null,
    authority: extra.authority ?? null,
    gate_eligible: extra.gate_eligible === true,
    closure_eligible: extra.closure_eligible === true,
    rereview: false,
    download_attempted: false,
    backend_is_role: false,
  };
  if (Object.hasOwn(extra, "proceed")) out.proceed = extra.proceed;
  return out;
}

function present(value) {
  return !(value === undefined || value === null || value === "");
}

function sameCandidate(left, right) {
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  for (const field of CANDIDATE_FIELDS) {
    const a = left[field];
    const b = right[field];
    if (field === "candidate_digest" && !present(a) && !present(b)) continue;
    if (!present(a) || !present(b) || a !== b) return false;
  }
  return true;
}

function requestErrors(request) {
  if (!isPlainObject(request)) return "verification_request_missing";
  if (request.schema_version !== "1" || request.kind !== "request") return "verification_request_invalid";
  for (const field of [
    "candidate_ref",
    "candidate_revision",
    "claim_id",
    "claim_type",
    "backend",
    "stage",
    "authority",
    "expected_result",
  ]) {
    if (!nonempty(request[field])) return "verification_request_unbound";
  }
  if (!STAGES.includes(request.stage)) return "verification_request_invalid";
  if (!AUTHORITIES.includes(request.authority)) return "verification_request_invalid";
  if (!EXPECTED.includes(request.expected_result)) return "verification_request_invalid";
  if (!isPlainObject(request.command_configuration) || Object.keys(request.command_configuration).length === 0) {
    return "verification_request_unbound";
  }
  if (typeof request.selected !== "boolean" || typeof request.required !== "boolean") {
    return "verification_request_unbound";
  }
  if (request.candidate_digest !== undefined && !SHA256.test(request.candidate_digest)) {
    return "verification_request_invalid";
  }
  return null;
}

function receiptErrors(receipt) {
  if (!isPlainObject(receipt)) return "verification_receipt_missing";
  if (receipt.schema_version !== "1" || receipt.kind !== "receipt") return "verification_receipt_invalid";
  for (const field of [
    "status",
    "candidate_ref",
    "candidate_revision",
    "claim_id",
    "backend",
    "backend_version",
    "evidence_digest",
    "authority",
  ]) {
    if (!nonempty(receipt[field])) return "verification_receipt_unbound";
  }
  if (!STATUSES.includes(receipt.status)) return "verification_receipt_invalid";
  if (!AUTHORITIES.includes(receipt.authority)) return "verification_receipt_invalid";
  if (!SHA256.test(receipt.evidence_digest)) return "verification_receipt_unbound";
  if (!isPlainObject(receipt.command_configuration) || Object.keys(receipt.command_configuration).length === 0) {
    return "verification_receipt_unbound";
  }
  const who = receipt.produced_by;
  if (!isPlainObject(who) || !nonempty(who.role) || !nonempty(who.identity) || !nonempty(who.session)) {
    return "verification_receipt_unbound";
  }
  if (receipt.candidate_digest !== undefined && !SHA256.test(receipt.candidate_digest)) {
    return "verification_receipt_invalid";
  }
  if (receipt.stage !== undefined && !STAGES.includes(receipt.stage)) return "verification_receipt_invalid";
  return null;
}

function backendState(input, request) {
  const backend = isPlainObject(input.backend) ? input.backend : {};
  const available = backend.available === true;
  const enabled = backend.enabled;
  const name = nonempty(backend.name) ? backend.name : request.backend;
  return {
    name,
    selected: request.selected === true,
    required: request.required === true,
    available,
    enabled: enabled === false ? false : enabled === true ? true : available,
  };
}

/**
 * @param {unknown} input verification evaluation request
 * @returns {{
 *   outcome: string,
 *   reason: string,
 *   status: string|null,
 *   authority: string|null,
 *   gate_eligible: boolean,
 *   closure_eligible: boolean,
 *   rereview: false,
 *   download_attempted: false,
 *   backend_is_role: false
 * }}
 */
function evaluateVerification(input) {
  try {
    if (!isPlainObject(input)) {
      return result("NEEDS_MORE_EVIDENCE", "verification_request_missing");
    }
    // Reverify/download is never performed here. A caller hint is ignored.
    if (input.download === true || input.install === true || typeof input.download_fn === "function") {
      // Fall through without invoking anything.
    }

    const requestErr = requestErrors(input.request);
    if (requestErr) return result("NEEDS_MORE_EVIDENCE", requestErr);

    const request = input.request;
    const current = isPlainObject(input.candidate) ? input.candidate : request;
    if (!sameCandidate(request, current)) {
      return result("REJECT", "candidate_mismatch");
    }

    const backend = backendState(input, request);
    const activated = backend.selected || backend.required;
    if (!activated) {
      if (!isPlainObject(input.receipt)) {
        return result("INACTIVE", "backend_unselected_unrequired");
      }
    } else if (backend.enabled === false || backend.available !== true) {
      return result("ERROR", "backend_unavailable", {
        status: "ERROR",
        proceed: backend.required ? "halt" : "proceed-with-note",
      });
    }

    if (!Object.hasOwn(input, "receipt") || input.receipt === undefined || input.receipt === null) {
      return result(activated ? "NEEDS_MORE_EVIDENCE" : "INACTIVE", activated ? "verification_receipt_missing" : "backend_unselected_unrequired");
    }

    const receiptErr = receiptErrors(input.receipt);
    if (receiptErr) return result("NEEDS_MORE_EVIDENCE", receiptErr);
    const receipt = input.receipt;

    if (
      receipt.claim_id !== request.claim_id ||
      receipt.backend !== request.backend ||
      !deepEqual(receipt.command_configuration, request.command_configuration)
    ) {
      return result("REJECT", "claim_or_backend_mismatch", {
        status: receipt.status,
        authority: receipt.authority,
      });
    }
    if (!sameCandidate(receipt, request) || !sameCandidate(receipt, current)) {
      return result("REJECT", "candidate_mismatch", {
        status: receipt.status,
        authority: receipt.authority,
      });
    }

    const repair = isPlainObject(input.repair) ? input.repair : {};
    if (
      nonempty(repair.prior_evidence_digest) &&
      repair.prior_evidence_digest === receipt.evidence_digest &&
      (repair.post_repair === true || nonempty(repair.prior_candidate_revision))
    ) {
      return result("REJECT", "stale_evidence", {
        status: receipt.status,
        authority: receipt.authority,
      });
    }
    if (
      nonempty(repair.prior_candidate_revision) &&
      receipt.candidate_revision === repair.prior_candidate_revision &&
      current.candidate_revision !== repair.prior_candidate_revision
    ) {
      return result("REJECT", "stale_evidence", {
        status: receipt.status,
        authority: receipt.authority,
      });
    }

    if (receipt.status === "ERROR") {
      return result("ERROR", "backend_error", {
        status: "ERROR",
        authority: receipt.authority,
      });
    }
    if (receipt.status === "INCONCLUSIVE") {
      return result("INCONCLUSIVE", "inconclusive_cannot_satisfy_gate", {
        status: "INCONCLUSIVE",
        authority: receipt.authority,
      });
    }

    const author = isPlainObject(input.author) ? input.author : null;
    const who = receipt.produced_by;
    const sameIdentity = author && nonempty(author.identity) && who.identity === author.identity;
    const sameSession = author && nonempty(author.session) && who.session === author.session;
    const selfCert = sameIdentity || sameSession;
    const gate = input.gate === "post_repair_closure" ? "post_repair_closure" : input.gate === "assurance" ? "assurance" : "none";

    if (gate === "assurance") {
      if (!author || !nonempty(author.identity) || !nonempty(author.session)) {
        return result("NEEDS_MORE_EVIDENCE", "author_identity_missing", {
          status: receipt.status,
          authority: receipt.authority,
        });
      }
      if (receipt.authority === "diagnostic") {
        return result("REJECT", "diagnostic_cannot_satisfy_assurance_gate", {
          status: receipt.status,
          authority: "diagnostic",
        });
      }
      if (selfCert) {
        return result("REJECT", "self_certification", {
          status: receipt.status,
          authority: receipt.authority,
        });
      }
      if (receipt.status !== request.expected_result) {
        return result("REJECT", "expected_result_mismatch", {
          status: receipt.status,
          authority: receipt.authority,
        });
      }
      return result("PASS", "independent_assurance_verified", {
        status: receipt.status,
        authority: "assurance",
        gate_eligible: true,
      });
    }

    if (gate === "post_repair_closure") {
      if (input.review_after_repair === true || input.automatic_rereview_requested === true) {
        return result("REJECT", "automatic_rereview_prohibited", {
          status: receipt.status,
          authority: receipt.authority,
        });
      }
      if (!author || !nonempty(author.identity) || !nonempty(author.session)) {
        return result("NEEDS_MORE_EVIDENCE", "author_identity_missing", {
          status: receipt.status,
          authority: receipt.authority,
        });
      }
      if (selfCert) {
        return result("REJECT", "self_certification", {
          status: receipt.status,
          authority: receipt.authority,
        });
      }
      const closureStage =
        request.stage === "post_repair_closure" || receipt.stage === "post_repair_closure";
      if (receipt.authority === "diagnostic" && !closureStage) {
        return result("REJECT", "diagnostic_cannot_satisfy_closure_gate", {
          status: receipt.status,
          authority: "diagnostic",
        });
      }
      if (!closureStage) {
        return result("REJECT", "closure_stage_required", {
          status: receipt.status,
          authority: receipt.authority,
        });
      }
      if (receipt.status !== request.expected_result) {
        return result("REJECT", "expected_result_mismatch", {
          status: receipt.status,
          authority: receipt.authority,
        });
      }
      return result("PASS", "post_repair_deterministic_closure", {
        status: receipt.status,
        authority: receipt.authority,
        closure_eligible: true,
      });
    }

    if (receipt.authority === "diagnostic") {
      return result("PASS", "diagnostic_receipt_recorded", {
        status: receipt.status,
        authority: "diagnostic",
      });
    }
    return result("PASS", "receipt_recorded", {
      status: receipt.status,
      authority: receipt.authority,
    });
  } catch {
    return result("NEEDS_MORE_EVIDENCE", "verification_adapter_unavailable");
  }
}

module.exports = {
  evaluateVerification,
  STATUSES,
  AUTHORITIES,
  STAGES,
  CANDIDATE_FIELDS,
};
