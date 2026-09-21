"use strict";

/**
 * Map the Route freeze (#70, #73, #77, #80): pure checks over a planning package.
 * checkRoles: every command a slice runs whose seit procedure names an actor
 * must name the slice's role. checkWorkClass validates light slices;
 * checkPlanningRoles excludes planning-only roles from Lifecycle implementation slices.
 * verifyDigests: every planning input digest
 * embedded in seit.json matches the file on disk; the manifest digest over
 * those inputs plus seit.json matches implementation.json's
 * planning_review.candidate_digest; missing artifacts, inputs, digests, or a
 * specification Journey's SDoc register fail closed.
 * CLI: node <plugin root>/hooks/plan-package.cjs <plan dir> -> JSON, exit 1 on any finding.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

/** Walk any object graph and yield slice-like nodes. */
function* slices(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* slices(item);
  } else if (node && typeof node === "object") {
    const ids = [...(node.command_ids || []), ...(node.post_step_command_ids || [])];
    if (typeof node.id === "string" && typeof node.role === "string") {
      yield { id: node.id, role: node.role, commandIds: ids };
    }
    for (const value of Object.values(node)) yield* slices(value);
  }
}

function checkRoles(seit, implementation) {
  const procedures = new Map(
    (seit?.procedures_and_commands || []).map((p) => [p.id, p])
  );
  const findings = [];
  for (const slice of slices(implementation)) {
    for (const command_id of slice.commandIds) {
      const procedure = procedures.get(command_id);
      if (!procedure) {
        findings.push({ code: "unknown_command_id", step: slice.id, command_id });
      } else if (typeof procedure.actor === "string" && procedure.actor !== slice.role) {
        findings.push({
          code: "actor_role_mismatch",
          step: slice.id,
          command_id,
          seit_actor: procedure.actor,
          implementation_role: slice.role,
          files: ["seit.json", "implementation.json"],
        });
      }
    }
  }
  return findings;
}

/** #77: a light slice must run at least one command and be routed to the Light Implementer. */
function checkWorkClass(node, findings = []) {
  if (Array.isArray(node)) node.forEach((item) => checkWorkClass(item, findings));
  else if (node && typeof node === "object") {
    if (node.work_class === "light" && typeof node.id === "string") {
      if (!(node.command_ids || []).length) findings.push({ code: "light_slice_without_command", step: node.id });
      if (node.role !== "Light Implementer") findings.push({ code: "light_slice_role", step: node.id, role: node.role });
    }
    for (const value of Object.values(node)) checkWorkClass(value, findings);
  }
  return findings;
}

/** #80: Requirements Engineer is planning-only and never a Lifecycle implementation slice. */
function checkPlanningRoles(node, findings = []) {
  if (Array.isArray(node)) node.forEach((item) => checkPlanningRoles(item, findings));
  else if (node && typeof node === "object") {
    const isSlice = typeof node.id === "string" || Array.isArray(node.command_ids);
    if (isSlice && typeof node.role === "string" && node.role.startsWith("Requirements Engineer")) {
      findings.push({
        code: "planning_role_in_lifecycle",
        step: typeof node.id === "string" ? node.id : null,
        role: node.role,
      });
    }
    for (const value of Object.values(node)) checkPlanningRoles(value, findings);
  }
  return findings;
}

function repoRoot(dir) {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(dir);
    current = parent;
  }
}

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function verifyDigests(dir) {
  const findings = [];
  for (const name of ["seit.json", "implementation.json"]) {
    if (!fs.existsSync(path.join(dir, name))) findings.push({ code: "missing_artifact", path: name });
  }
  if (findings.length) return { manifest_digest: null, findings };
  const seit = readJson(path.join(dir, "seit.json"));
  const implementation = readJson(path.join(dir, "implementation.json"));
  const root = repoRoot(dir);
  const inputs = seit?.source_baseline?.planning_inputs;
  if (!Array.isArray(inputs) || !inputs.length) {
    findings.push({ code: "missing_planning_inputs", path: "seit.json" });
  }
  const actual = [];
  for (const input of inputs || []) {
    if (typeof input?.path !== "string" || !/^[0-9a-f]{64}$/.test(input?.sha256 || "")) {
      findings.push({ code: "malformed_planning_input", input });
      continue;
    }
    const file = path.resolve(root, input.path);
    if (!fs.existsSync(file)) {
      findings.push({ code: "missing_input", path: input.path });
      continue;
    }
    const digest = sha256(fs.readFileSync(file));
    actual.push(digest);
    if (digest !== input.sha256) {
      findings.push({ code: "digest_mismatch", path: input.path, recorded: input.sha256, actual: digest });
    }
  }
  // The manifest binds the planning inputs and seit.json itself (#70).
  actual.push(sha256(fs.readFileSync(path.join(dir, "seit.json"))));
  const manifest_digest = sha256(actual.join("\n"));
  const recorded = implementation?.journey_settings?.planning_review?.candidate_digest;
  if (typeof recorded !== "string" || !recorded) {
    findings.push({ code: "missing_candidate_digest", actual: manifest_digest });
  } else if (recorded !== manifest_digest) {
    findings.push({ code: "candidate_digest_mismatch", recorded, actual: manifest_digest });
  }
  // #69: a specification Journey records an existing SDoc register at planning.
  const settings = implementation?.journey_settings || {};
  if (settings.journey_type === "specification") {
    const register = settings.requirement_register;
    if (typeof register !== "string" || !register.endsWith(".sdoc") || !fs.existsSync(path.resolve(root, register))) {
      findings.push({ code: "missing_requirement_register", recorded: register ?? null });
    }
  }
  return { manifest_digest, findings };
}

const HISTORICAL_GATE = new Set([
  "HISTORICAL",
  "SUPERSEDED",
  "ARCHIVED",
  "COMPLETED",
  "RETIRED",
  "INACTIVE",
]);

function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
  } else if (node && typeof node === "object") {
    visit(node);
    for (const value of Object.values(node)) walk(value, visit);
  }
}

/** #121: duplicate active gate IDs, including numeric/named object keys. */
function checkDuplicateGates(root, findings = [], loc = "root") {
  walk(root, (node) => {
    const conds = node.entry_conditions;
    if (!conds) return;
    const items = Array.isArray(conds)
      ? conds.map((item, i) => [String(i), item])
      : Object.entries(conds);
    const seen = new Map();
    for (const [key, item] of items) {
      if (!item || typeof item !== "object" || typeof item.id !== "string") continue;
      const status = String(item.status || item.state || "ACTIVE").toUpperCase();
      if (HISTORICAL_GATE.has(status)) continue;
      const prev = seen.get(item.id);
      if (prev) {
        findings.push({
          code: "duplicate_active_gate_id",
          id: item.id,
          locations: [prev, loc + ".entry_conditions." + key],
        });
      } else {
        seen.set(item.id, loc + ".entry_conditions." + key);
      }
    }
  });
  return findings;
}

function sliceIndex(implementation) {
  const byId = new Map();
  walk(implementation, (node) => {
    if (typeof node.id !== "string" || typeof node.role !== "string") return;
    const list = byId.get(node.id) || [];
    list.push(node);
    byId.set(node.id, list);
  });
  return byId;
}

function receiptIds(root) {
  const ids = new Set();
  walk(root, (node) => {
    if (typeof node.completed_receipt === "string") ids.add(node.completed_receipt);
    if (typeof node.completed_receipt_id === "string") ids.add(node.completed_receipt_id);
    if (Array.isArray(node.completed_receipts)) {
      for (const item of node.completed_receipts) {
        if (typeof item === "string") ids.add(item);
        else if (item && typeof item.id === "string") ids.add(item.id);
      }
    }
  });
  return ids;
}

function stepRefs(node) {
  const refs = [];
  for (const key of ["integration_step", "integration_step_id", "step_id", "step"]) {
    if (typeof node[key] === "string") refs.push(node[key]);
  }
  if (Array.isArray(node.requires)) {
    for (const item of node.requires) {
      if (typeof item === "string") refs.push(item);
      else if (item && typeof item.id === "string") refs.push(item.id);
    }
  }
  if (Array.isArray(node.integration_steps)) {
    for (const item of node.integration_steps) {
      if (typeof item === "string") refs.push(item);
      else if (item && typeof item.id === "string") refs.push(item.id);
    }
  }
  return refs;
}

function semanticKey(node) {
  return [node.activity, node.kind, node.role, node.exit].filter((v) => typeof v === "string").join("|");
}

/** #121: referenced integration-step exits must map to one semantic slice or a preserved receipt. */
function checkIntegrationStepRefs(implementation, findings = []) {
  const slices = sliceIndex(implementation);
  const receipts = receiptIds(implementation);
  walk(implementation, (node) => {
    for (const ref of stepRefs(node)) {
      if (receipts.has(ref)) continue;
      const hits = slices.get(ref) || [];
      const keys = new Set(hits.map(semanticKey));
      if (!hits.length || keys.size !== 1) {
        findings.push({
          code: "unresolved_integration_step",
          step: ref,
          matches: hits.length,
          colliding_semantics: keys.size > 1,
        });
      }
    }
  });
  return findings;
}

/** #121: live frozen-content hashes must match the files they name. */
function checkFrozenHashes(dir, findings = []) {
  const root = repoRoot(dir);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return findings;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const data = readJson(path.join(dir, name));
    const maps = [];
    if (data?.source_file_hashes && typeof data.source_file_hashes === "object") {
      maps.push(data.source_file_hashes);
    }
    if (data?.plan_integration?.source_file_hashes && typeof data.plan_integration.source_file_hashes === "object") {
      maps.push(data.plan_integration.source_file_hashes);
    }
    walk(data, (node) => {
      if (node && typeof node.live_source_file_hashes === "object") maps.push(node.live_source_file_hashes);
    });
    for (const hashes of maps) {
      for (const [rel, recorded] of Object.entries(hashes)) {
        if (typeof recorded !== "string") continue;
        const candidates = [path.resolve(dir, rel), path.resolve(root, rel)];
        const file = candidates.find((p) => fs.existsSync(p));
        if (!file) {
          findings.push({ code: "frozen_hash_missing", path: rel, from: name });
          continue;
        }
        const actual = sha256(fs.readFileSync(file));
        if (actual !== recorded) {
          findings.push({
            code: "frozen_hash_mismatch",
            path: rel,
            from: name,
            recorded,
            actual,
          });
        }
      }
    }
  }
  return findings;
}

function freeze(dir) {
  const digests = verifyDigests(dir);
  const seit = readJson(path.join(dir, "seit.json"));
  const implementation = readJson(path.join(dir, "implementation.json"));
  const findings = [
    ...checkRoles(seit, implementation),
    ...checkWorkClass(implementation),
    ...checkPlanningRoles(implementation),
    ...checkDuplicateGates(implementation),
    ...checkDuplicateGates(seit),
    ...checkIntegrationStepRefs(implementation),
    ...checkFrozenHashes(dir),
    ...digests.findings,
  ];
  return { outcome: findings.length ? "FAIL" : "PASS", manifest_digest: digests.manifest_digest, findings };
}

module.exports = {
  checkRoles,
  checkWorkClass,
  checkPlanningRoles,
  checkDuplicateGates,
  checkIntegrationStepRefs,
  checkFrozenHashes,
  verifyDigests,
  freeze,
};

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) {
    process.stderr.write("usage: node hooks/plan-package.cjs <plan dir>\n");
    process.exit(2);
  }
  const result = freeze(dir);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.outcome === "PASS" ? 0 : 1);
}
