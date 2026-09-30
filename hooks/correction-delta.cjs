"use strict";

// Pure correction-loop evaluator. CLI: node <file> <input.json> -> JSON receipt.
const { isDeepStrictEqual } = require("node:util");
const fs = require("node:fs");
const nonempty = value => typeof value === "string" && value.trim().length > 0;
const strings = value => Array.isArray(value) && value.every(nonempty);

function evaluateCorrectionDelta(input) {
  const result = {
    verdict: "VALIDATION_FAILED", changed_uids: [], extra_uids: [], missing_uids: [],
    closed_uids: [], regate_uids: [], correction_rounds: 0,
    owner_gate_residuals: [], findings: [], receipt: null,
  };
  const fail = (code, details = {}) => result.findings.push({ code, ...details });
  if (!input || typeof input !== "object") {
    fail("invalid_input");
    return result;
  }
  const { before, after, findings, candidate_ref, lint } = input;
  // Default only omitted fields; explicit null or wrong types fail as invalid_context.
  const given = (key, fallback) => input[key] === undefined ? fallback : input[key];
  const rounds = given("correction_rounds", 0);
  const known = given("known_uids", []);
  const residuals = given("residuals", []);
  if (!nonempty(candidate_ref) || !Number.isInteger(rounds) || rounds < 0 || rounds > 2 ||
      !strings(known) || !strings(residuals)) fail("invalid_context");
  else {
    result.correction_rounds = rounds;
    result.owner_gate_residuals = [...residuals];
  }
  function index(rows, name, isFinding = false) {
    const map = new Map();
    if (!Array.isArray(rows)) {
      fail("invalid_collection", { collection: name });
      return map;
    }
    for (const row of rows) {
      if (!row || !nonempty(row.uid) || (isFinding
        ? !["exact_text", "requires_regate"].includes(row.finding_type) ||
          (row.finding_type === "exact_text" && !nonempty(row.corrected_text))
        : typeof row.text !== "string" || !strings(row.references))) {
        fail("invalid_row", { collection: name });
        continue;
      }
      if (map.has(row.uid)) fail("duplicate_uid", { collection: name, uid: row.uid });
      map.set(row.uid, row);
    }
    return map;
  }
  const oldRows = index(before, "before");
  const newRows = index(after, "after");
  const named = index(findings, "findings", true);
  if (result.findings.length) return result;

  result.changed_uids = [...new Set([...oldRows.keys(), ...newRows.keys()])]
    .filter(uid => !isDeepStrictEqual(oldRows.get(uid), newRows.get(uid))).sort();
  const changed = new Set(result.changed_uids);
  result.extra_uids = result.changed_uids.filter(uid => !named.has(uid));
  result.missing_uids = [...named.keys()].filter(uid => !changed.has(uid)).sort();
  if (result.extra_uids.length || result.missing_uids.length) {
    fail("changed_uid_set_mismatch", { extra_uids: result.extra_uids, missing_uids: result.missing_uids });
  }
  const exact = [...named.values()].filter(row => row.finding_type === "exact_text");
  for (const finding of exact) {
    const oldRow = oldRows.get(finding.uid);
    const newRow = newRows.get(finding.uid);
    if (!oldRow || !newRow || newRow.text !== finding.corrected_text ||
        !isDeepStrictEqual({ ...oldRow, text: newRow.text }, newRow)) {
      fail("exact_text_mismatch", { uid: finding.uid });
    }
  }
  const targets = new Set([...newRows.keys(), ...known]);
  for (const row of newRows.values()) {
    for (const target of row.references) {
      if (!targets.has(target)) fail("unresolved_reference", { uid: row.uid, target });
    }
  }
  if (result.findings.length) return result;
  if (exact.length && (!lint || lint.candidate_ref !== candidate_ref || !["PASS", "FAIL"].includes(lint.verdict))) {
    result.verdict = "NEEDS_MORE_EVIDENCE";
    fail("missing_candidate_lint");
    return result;
  }
  if (exact.length && lint.verdict === "FAIL") {
    fail("lint_failed");
    return result;
  }
  result.closed_uids = exact.map(row => row.uid).sort();
  result.regate_uids = [...named.values()].filter(row => row.finding_type === "requires_regate")
    .map(row => row.uid).sort();
  result.receipt = {
    candidate_ref, changed_uids: result.changed_uids, named_uids: [...named.keys()].sort(),
    delta: "PASS", cross_references: "PASS", lint: exact.length ? { ...lint } : null,
  };
  result.verdict = "DELTA_APPLIED";
  if (result.regate_uids.length) {
    result.verdict = rounds === 2 ? "NEEDS_OWNER_DECISION" : "REQUIRES_REGATE";
    if (rounds < 2) result.correction_rounds++;
  }
  return result;
}

module.exports = { evaluateCorrectionDelta };
if (require.main === module) {
  let result;
  try {
    if (process.argv.length !== 3) throw new Error("expected one input JSON file");
    result = evaluateCorrectionDelta(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
  } catch {
    result = { verdict: "VALIDATION_FAILED", findings: [{ code: "invalid_input_file" }] };
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exitCode = ["DELTA_APPLIED", "REQUIRES_REGATE"].includes(result.verdict) ? 0 : 1;
}
