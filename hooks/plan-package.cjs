"use strict";

/**
 * Map the Route freeze (#70, #73): pure checks over a planning package.
 * checkRoles: every command a slice runs whose seit procedure names an actor
 * must name the slice's role. verifyDigests: every planning input digest
 * embedded in seit.json matches the file on disk; the manifest digest over
 * those inputs matches implementation.json's planning_review.candidate_digest.
 * CLI: node hooks/plan-package.cjs <plan dir>  -> JSON, exit 1 on any finding.
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
    if (typeof node.id === "string" && typeof node.role === "string" && ids.length) {
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
  const seit = readJson(path.join(dir, "seit.json"));
  const implementation = readJson(path.join(dir, "implementation.json"));
  const root = repoRoot(dir);
  const findings = [];
  const actual = [];
  for (const input of seit?.source_baseline?.planning_inputs || []) {
    if (typeof input?.path !== "string" || typeof input?.sha256 !== "string") continue;
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
  const manifest_digest = sha256(actual.join("\n"));
  const recorded = implementation?.journey_settings?.planning_review?.candidate_digest;
  if (typeof recorded === "string" && recorded !== manifest_digest) {
    findings.push({ code: "candidate_digest_mismatch", recorded, actual: manifest_digest });
  }
  return { manifest_digest, findings };
}

function freeze(dir) {
  const digests = verifyDigests(dir);
  const seit = readJson(path.join(dir, "seit.json"));
  const implementation = readJson(path.join(dir, "implementation.json"));
  const findings = [...checkRoles(seit, implementation), ...digests.findings];
  return { outcome: findings.length ? "FAIL" : "PASS", manifest_digest: digests.manifest_digest, findings };
}

module.exports = { checkRoles, verifyDigests, freeze };

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
