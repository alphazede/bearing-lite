#!/usr/bin/env node
/**
 * Deterministic handoff compiler. Reads frozen plan, authority, and binding
 * files and writes one JSON packet to stdout. Starts no process and writes
 * no file. Prompt skill default is unchanged (promotion is a separate record).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!key.startsWith("--")) continue;
  const next = args[i + 1];
  if (next === undefined || next.startsWith("--")) opt[key] = "";
  else {
    opt[key] = next;
    i++;
  }
}

const gaps = [];
const gap = (field, code) => gaps.push({ field, code });
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const textList = (value) => Array.isArray(value) && value.length > 0 && value.every(text);
const closed = (value, keys) => record(value) && Object.keys(value).every((key) => keys.includes(key));

function readPinned(file, expected, field) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    gap(field, "missing");
    return null;
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (!expected || digest !== String(expected).toLowerCase()) {
    gap(field, "mismatch");
    return null;
  }
  try {
    const json = JSON.parse(bytes.toString("utf8"));
    if (record(json)) return { digest, json };
  } catch {
    // A pinned hash identifies bytes, regardless of whether they parse.
  }
  gap(field, "invalid");
  return null;
}

function blank(value) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function roleKey(role) {
  return String(role ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Lexical only. shortcut: does not follow symlinks; the write lock does. */
function normalizeRel(input) {
  const parts = [];
  let escaped = false;
  for (const seg of String(input).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) escaped = true;
      else parts.pop();
    } else parts.push(seg);
  }
  return { escaped, dir: String(input).endsWith("/"), parts };
}

function splitRepo(entry) {
  const text = String(entry);
  const at = text.indexOf(": ");
  if (at < 0) return null;
  const rel = text.slice(at + 2);
  if (!rel || path.isAbsolute(rel) || rel.includes("\\")) return null;
  return { repo: text.slice(0, at), rel };
}

function insideWriteSet(entry, writeSet) {
  const file = splitRepo(entry);
  if (!file) return false;
  const norm = normalizeRel(file.rel);
  if (norm.escaped) return false;
  for (const raw of writeSet) {
    const limit = splitRepo(raw);
    if (!limit || limit.repo !== file.repo) continue;
    const bound = normalizeRel(limit.rel);
    if (bound.escaped) continue;
    if (!bound.dir) {
      if (!norm.dir && norm.parts.join("/") === bound.parts.join("/")) return true;
      continue;
    }
    if (norm.parts.length < bound.parts.length) continue;
    if (bound.parts.every((seg, i) => norm.parts[i] === seg)) return true;
  }
  return false;
}

function routeLines(route) {
  const lines = [];
  const hop = (label, value) => {
    if (!value) return;
    const condition = value.condition ? ` (only when: ${value.condition})` : "";
    lines.push(`${label}: ${value.harness} / ${value.model} / ${value.reasoning}${condition}`);
  };
  hop("primary", route.primary);
  for (let i = 0; i < (route.ordered_fallbacks ?? []).length; i++) hop(`fallback ${i + 1}`, route.ordered_fallbacks[i]);
  return lines.join("\n");
}

function validHop(hop, fallback = false) {
  const identity = ["harness", "model", "reasoning"];
  return closed(hop, fallback ? [...identity, "condition"] : identity) &&
    identity.every((key) => text(hop[key])) && (!fallback || text(hop.condition));
}

function validRoute(route) {
  return closed(route, ["enabled", "primary", "ordered_fallbacks", "cadence"]) &&
    route.enabled === true && validHop(route.primary) &&
    (route.cadence === undefined || text(route.cadence)) &&
    Array.isArray(route.ordered_fallbacks) &&
    route.ordered_fallbacks.every((hop) => validHop(hop, true));
}

function validCapabilities(snap) {
  const review = snap?.review;
  const coverage = review?.coverage_assist;
  const verification = snap?.deterministic_verification;
  return closed(review, ["coverage_assist", "ocr_execution_mode"]) && closed(coverage, ["enabled", "required"]) &&
    typeof coverage.enabled === "boolean" && typeof coverage.required === "boolean" && text(review.ocr_execution_mode) &&
    closed(verification, ["reverify"]) && closed(verification.reverify, ["enabled"]) &&
    typeof verification.reverify.enabled === "boolean";
}

const candidate = opt["--candidate"];
if (blank(candidate)) gap("candidate", "missing");

const sliceId = opt["--slice"];
if (blank(sliceId)) gap("slice", "missing");

const plan = opt["--plan"];
const authority = readPinned(opt["--authority"], opt["--authority-sha256"], "authority");
const binding = readPinned(opt["--binding"], opt["--binding-sha256"], "binding");
const implementation = readPinned(
  plan ? path.join(plan, "implementation.json") : "",
  opt["--implementation-sha256"],
  "implementation",
);

const seitInput = readPinned(plan ? path.join(plan, "seit.json") : "", opt["--seit-sha256"], "seit");
const seit = seitInput?.json;

let slice = null;
if (implementation && !blank(sliceId)) {
  const slices = Array.isArray(implementation.json.slices) ? implementation.json.slices : [];
  slice = slices.find((item) => item?.id === sliceId) ?? null;
  if (!slice) gap("slice", "unknown");
}

if (slice && authority) {
  if (!text(slice.authority_id) || slice.authority_id !== authority.json.id) gap("authority", "conflict");
  if (authority.json.effective !== true) gap("authority", "ineffective");
}

let route = null;
const role = roleKey(slice?.role);
const routeKey = role === "product_implementer" || role === "combined_implementer" ? "implementer" : role;
if (slice && binding) {
  const roles = binding.json.snapshot?.roles ?? {};
  route = Object.hasOwn(roles, routeKey) ? roles[routeKey] : null;
  if (!validRoute(route)) gap("route", route == null ? "missing" : "invalid");
  if (!validCapabilities(binding.json.snapshot)) gap("binding", "incomplete");
}

const commands = [];
const acceptance = [];
if (slice) {
  if (!text(slice.role)) gap("route", "invalid");
  if (blank(slice.goal)) gap("objective", slice.goal == null ? "missing" : "empty");
  else if (!text(slice.goal)) gap("objective", "invalid");
  if (blank(slice.write_set)) gap("write_set", slice.write_set == null ? "missing" : "empty");
  else if (!textList(slice.write_set)) gap("write_set", "invalid");
  if (slice.expected_files != null && (!Array.isArray(slice.expected_files) || !slice.expected_files.every(text))) {
    gap("expected_files", "invalid");
  }
  if (blank(slice.seit_proof_rows)) gap("acceptance", slice.seit_proof_rows == null ? "missing" : "empty");
  else if (!textList(slice.seit_proof_rows)) gap("acceptance", "invalid");
  else if (seit) {
    const cases = Array.isArray(seit.proof_cases) ? seit.proof_cases : [];
    let unresolved = false;
    let evidenceCode = null;
    for (const id of slice.seit_proof_rows) {
      const row = cases.find((item) => item?.id === id);
      if (!row || !text(row.pass_fail_rule)) {
        unresolved = true;
        continue;
      }
      if (!text(row.observable_evidence)) {
        evidenceCode = row.observable_evidence == null ? "missing" : blank(row.observable_evidence) ? "empty" : "invalid";
        continue;
      }
      acceptance.push({
        id: row.id,
        pass_fail_rule: row.pass_fail_rule,
        observable_evidence: row.observable_evidence,
      });
    }
    if (unresolved) gap("acceptance", "unresolved");
    if (evidenceCode) gap("evidence", evidenceCode);
  }
  if (blank(slice.command_ids)) gap("commands", slice.command_ids == null ? "missing" : "empty");
  else if (!textList(slice.command_ids)) gap("commands", "invalid");
  else if (seit) {
    const table = Array.isArray(seit.procedures_and_commands) ? seit.procedures_and_commands : [];
    let unresolved = false;
    for (const id of slice.command_ids) {
      const row = table.find((item) => item?.id === id);
      if (!row || !text(row.command)) unresolved = true;
      else commands.push({ id: row.id, command: row.command });
    }
    if (unresolved) gap("commands", "unresolved");
  }
}

const waves = Array.isArray(implementation?.json.waves) ? implementation.json.waves : [];
const wave = slice ? waves.find((item) => Array.isArray(item?.slice_ids) && item.slice_ids.includes(slice.id)) : null;
if (slice && !text(wave?.id)) gap("slice", "wave");

if (gaps.length) {
  console.log(JSON.stringify({ outcome: "COMPILATION_GAP", gaps }));
  process.exit(1);
}
const writeSet = slice.write_set.slice();
const expected = (Array.isArray(slice.expected_files) ? slice.expected_files : []).map((entry) => ({
  path: String(entry),
  inside_write_set: insideWriteSet(entry, writeSet),
}));
const capabilities = {
  review: binding.json.snapshot.review,
  deterministic_verification: binding.json.snapshot.deterministic_verification,
};
const skillRole = routeKey === "test_implementer" ? "implementer" : routeKey.replaceAll("_", "-");
const skill = `skills/${skillRole}/SKILL.md`;
const actions = Array.isArray(authority.json.prohibited?.actions) ? authority.json.prohibited.actions : [];

const sections = [
  {
    title: "ROLE / SESSION",
    body: [`Role: ${slice.role}`, `Canonical skill: ${skill}`, "Frozen route:", routeLines(route)].join("\n"),
  },
  {
    title: "STATE / INPUTS",
    body: [
      `Candidate revision: ${candidate}`,
      `Wave: ${wave?.id ?? ""}`,
      `Authority id: ${authority.json.id}`,
      `Authority sha256: ${authority.digest}`,
      `Binding sha256: ${binding.digest}`,
      `Implementation sha256: ${implementation.digest}`,
      `SEIT sha256: ${seitInput.digest}`,
      `Owner-only actions: ${actions.join(", ")}`,
      `Capabilities: ${JSON.stringify(capabilities)}`,
    ].join("\n"),
  },
  {
    title: "OBJECTIVE / ACCEPTANCE",
    body: [
      `Slice: ${slice.id}`,
      `Outcome: ${slice.goal}`,
      "Acceptance:",
      ...acceptance.map((row) => `${row.id}: ${row.pass_fail_rule} Evidence: ${row.observable_evidence}`),
    ].join("\n"),
  },
  {
    title: "AUTHORITY",
    body: [
      "Recorded write-set limit:",
      ...writeSet,
      "Expected files are guidance inside that limit, not a second authority source:",
      ...expected.map((row) => `${row.path} (${row.inside_write_set ? "inside the recorded write set" : "outside the recorded write set"})`),
      "An assigned agent that needs a file outside the recorded write set shall stop and return that need to the Orchestrator.",
    ].join("\n"),
  },
  {
    title: "LOOP",
    body: `Follow ${skill}. Select techniques inside the assignment without a repeated controller approval. Do not weaken required evidence. Do not self-certify.`,
  },
  {
    title: "VERIFY",
    body: [
      "Repository-required gates are mandatory. Independent assurance stays mandatory where the frozen binding declares it. Additional focused tests, tools, and fixtures are left to the assigned agent.",
      ...commands.map((row) => `${row.id} (exit 0): ${row.command}`),
      "Acceptance-to-evidence:",
      ...acceptance.map((row) => `${row.id} | ${row.pass_fail_rule} | ${row.observable_evidence}`),
      "Trust-boundary negative check: expected files do not amend authority, and the recorded write set is not widened.",
    ].join("\n"),
  },
  {
    title: "RETURN / STOP",
    body: [
      "Verdict, candidate_ref, changed_paths, tests, findings, blocker.",
      `Stop condition: ${slice.stop_condition ?? ""}`,
      "Stop and return to the Orchestrator when a needed file is outside the recorded write set.",
    ].join("\n"),
  },
];

const packet = {
  outcome: "PACKET_READY",
  identity: {
    slice: slice.id,
    wave: wave?.id ?? "",
    role: slice.role,
    candidate_revision: candidate,
    authority_id: authority.json.id,
    authority_sha256: authority.digest,
    binding_sha256: binding.digest,
    implementation_sha256: implementation.digest,
    seit_sha256: seitInput.digest,
  },
  write_set: writeSet,
  expected_files: expected,
  route,
  capabilities,
  commands,
  acceptance,
  sections,
  text: sections.map((item) => `${item.title}\n${item.body}`).join("\n\n") + "\n",
};

console.log(JSON.stringify(packet));
