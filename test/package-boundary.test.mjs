/**
 * CMD-PACKAGE-01 / SEIT-PACKAGE-01
 * Package identity + public files allowlist + npm pack surface.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const APPROVED_FILES_ALLOWLIST = [
  "plugin.json",
  "skills/",
  "hooks/",
  "README.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "LICENSE-APACHE",
  "lineups.json",
  "schemas/",
];

const REQUIRED_SCHEMA_FILES = [
  "schemas/seit.schema.json",
  "schemas/implementation.schema.json",
  "schemas/authority.schema.json",
  "schemas/journey.schema.json",
];

const ALWAYS_ON_SEIT_SECTIONS = [
  "scope/baseline",
  "responsibility/change authority",
  "applicable documents/precedence",
  "requirements flowdown/architecture context",
  "V&V methods",
  "verification and validation matrices",
  "levels/integration sequence",
  "environments/fixtures/data/simulations/support",
  "procedures/commands",
  "evidence/pass-fail",
  "anomaly/corrective/closure",
];

const IMPLEMENTATION_SLICE_FIELDS = [
  "role",
  "goal",
  "type",
  "requirement_ids",
  "design_ids",
  "seit_proof_rows",
  "design_lenses",
  "model_route",
  "write_set",
  "command_ids",
  "stop_condition",
  "human_decision",
  "authority_id",
];

const PROHIBITED_PACK_PATTERNS = [
  /^mcp\.json$/i,
  /(^|\/)bin(\/|$)/i,
  /(^|\/)src(\/|$)/i,
  /(^|\/)dist(\/|$)/i,
  /(^|\/)server(\/|$)/i,
  /(^|\/)\.bearing(\/|$)/i,
  /postinstall/i,
  /(^|\/)cli(\.|\/)/i,
  /\.env(\.|$)/i,
  /(^|\/)credentials/i,
  /(^|\/)secrets(\/|$)/i,
];

/**
 * @typedef {{ code: string, message: string, path?: string }} PackageDiagnostic
 * @typedef {{ ok: true } | { ok: false, diagnostics: PackageDiagnostic[] }} PackageVerdict
 */

/**
 * Validate package.json files allowlist against approved public surfaces.
 * @param {unknown} pkg
 * @returns {PackageVerdict}
 */
export function validatePackageAllowlist(pkg) {
  /** @type {PackageDiagnostic[]} */
  const diagnostics = [];
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    return {
      ok: false,
      diagnostics: [{ code: "package_not_object", message: "package.json must be an object" }],
    };
  }
  const p = /** @type {Record<string, unknown>} */ (pkg);
  if (p.name !== "@alphazede/bearing-lite") {
    diagnostics.push({
      code: "package_name_mismatch",
      message: `expected @alphazede/bearing-lite, got ${JSON.stringify(p.name)}`,
    });
  }
  if (!Array.isArray(p.files)) {
    diagnostics.push({
      code: "files_missing",
      message: "package.json files allowlist is required",
    });
  } else {
    const files = p.files.map(String);
    for (const entry of files) {
      if (!APPROVED_FILES_ALLOWLIST.includes(entry)) {
        diagnostics.push({
          code: "allowlist_entry_not_public",
          message: `files entry "${entry}" is outside the public plugin surface allowlist`,
          path: entry,
        });
      }
    }
    for (const required of APPROVED_FILES_ALLOWLIST) {
      if (!files.includes(required)) {
        diagnostics.push({
          code: "allowlist_missing_required",
          message: `files allowlist missing required public surface "${required}"`,
          path: required,
        });
      }
    }
  }
  if (p.bin !== undefined) {
    diagnostics.push({
      code: "bin_present",
      message: "package must not declare bin (CLI runtime is out of Lite boundary)",
    });
  }
  if (p.main !== undefined || p.exports !== undefined) {
    diagnostics.push({
      code: "runtime_entry_present",
      message: "package must not declare main/exports server or CLI runtime entries",
    });
  }
  const scripts = p.scripts && typeof p.scripts === "object" ? p.scripts : null;
  if (scripts && "postinstall" in /** @type {object} */ (scripts)) {
    diagnostics.push({
      code: "postinstall_present",
      message: "postinstall scripts are prohibited on the Lite package",
    });
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  return { ok: true };
}

/**
 * Validate an npm pack --dry-run file list.
 * @param {string[]} packPaths
 * @returns {PackageVerdict}
 */
export function validatePackFileList(packPaths) {
  /** @type {PackageDiagnostic[]} */
  const diagnostics = [];
  for (const p of packPaths) {
    for (const re of PROHIBITED_PACK_PATTERNS) {
      if (re.test(p)) {
        diagnostics.push({
          code: "prohibited_pack_entry",
          message: `packed path "${p}" matches prohibited pattern ${re}`,
          path: p,
        });
      }
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  return { ok: true };
}

/**
 * Validate pnpm-lock.yaml consistency against zero-dependency Lite package contract.
 * @param {string} lockfileContent
 * @returns {PackageVerdict}
 */
export function validateLockfileConsistency(lockfileContent) {
  /** @type {PackageDiagnostic[]} */
  const diagnostics = [];
  if (typeof lockfileContent !== "string" || !lockfileContent.trim()) {
    return {
      ok: false,
      diagnostics: [{ code: "lockfile_empty", message: "pnpm-lock.yaml content is missing or empty" }],
    };
  }
  if (/^overrides:/m.test(lockfileContent)) {
    diagnostics.push({
      code: "stale_overrides_present",
      message: "pnpm-lock.yaml must not contain overrides configuration for zero-dependency Lite package",
    });
  }
  if (
    /^\s*(devDependencies|dependencies|optionalDependencies|peerDependencies):/m.test(
      lockfileContent
    )
  ) {
    diagnostics.push({
      code: "stale_importers_present",
      message: "pnpm-lock.yaml must not contain dependency importer entries for zero-dependency Lite package",
    });
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  return { ok: true };
}

/**
 * Collect JSON Schema property nodes, including nested properties.
 * @param {unknown} schema
 * @returns {Map<string, Record<string, unknown>>}
 */
export function collectSchemaProperties(schema) {
  /** @type {Map<string, Record<string, unknown>>} */
  const found = new Map();
  /**
   * @param {unknown} node
   */
  function walk(node) {
    if (!node || typeof node !== "object") return;
    const rec = /** @type {Record<string, unknown>} */ (node);
    if (rec.properties && typeof rec.properties === "object" && !Array.isArray(rec.properties)) {
      for (const [key, value] of Object.entries(
        /** @type {Record<string, unknown>} */ (rec.properties)
      )) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          found.set(key, /** @type {Record<string, unknown>} */ (value));
        } else {
          found.set(key, {});
        }
      }
    }
    for (const value of Object.values(rec)) {
      if (value && typeof value === "object") walk(value);
    }
  }
  walk(schema);
  return found;
}

describe("CMD-PACKAGE-01 package-boundary (SEIT-PACKAGE-01)", () => {
  it("package.json name is @alphazede/bearing-lite with public-only files allowlist", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.equal(pkg.name, "@alphazede/bearing-lite");
    const verdict = validatePackageAllowlist(pkg);
    assert.equal(verdict.ok, true, JSON.stringify(verdict));
    assert.deepEqual(pkg.files, APPROVED_FILES_ALLOWLIST);
  });

  it("npm pack --dry-run --json excludes prohibited surfaces", () => {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(out);
    assert.ok(Array.isArray(parsed) && parsed[0], "npm pack json array expected");
    assert.equal(parsed[0].name, "@alphazede/bearing-lite");
    const paths = parsed[0].files.map(/** @param {{path:string}} f */ (f) => f.path);
    assert.ok(paths.includes("plugin.json"));
    assert.ok(paths.some((p) => p.startsWith("hooks/")));
    assert.ok(paths.includes("hooks/hooks.json"));
    assert.ok(paths.includes("hooks/com.anthropic.claude-code/host.cjs"));
    assert.ok(paths.some((p) => p.startsWith("skills/")));
    assert.ok(!paths.some((p) => p.startsWith("guide/")));
    assert.ok(!paths.some((p) => p === "mcp.json" || p.startsWith("mcp.")));
    assert.ok(!paths.some((p) => /(^|\/)bin(\/|$)/.test(p)));
    assert.ok(!paths.some((p) => p.includes(".bearing")));
    assert.ok(!paths.some((p) => p.startsWith("src/") || p.startsWith("dist/")));
    assert.ok(!paths.some((p) => p.startsWith("server/") || /(^|\/)cli(\.|\/)/.test(p)));
    const packVerdict = validatePackFileList(paths);
    assert.equal(packVerdict.ok, true, JSON.stringify(packVerdict));
  });

  it("npm pack includes lineups.json and schema files and no private paths", () => {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(out);
    const paths = parsed[0].files.map(/** @param {{path:string}} f */ (f) => f.path);
    assert.ok(paths.includes("lineups.json"));
    for (const rel of REQUIRED_SCHEMA_FILES) {
      assert.ok(paths.includes(rel), `npm pack must include ${rel}`);
    }
    const packVerdict = validatePackFileList(paths);
    assert.equal(packVerdict.ok, true, JSON.stringify(packVerdict));
  });

  it("negative: fixture allowlist containing prohibited path fails with typed diagnostic", () => {
    const fixture = {
      name: "@alphazede/bearing-lite",
      files: [...APPROVED_FILES_ALLOWLIST, "mcp.json", "bin/", ".bearing/"],
      bin: { bearing: "dist/cli.js" },
      scripts: { postinstall: "node evil.js" },
    };
    const verdict = validatePackageAllowlist(fixture);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      const codes = new Set(verdict.diagnostics.map((d) => d.code));
      assert.ok(codes.has("allowlist_entry_not_public"), "allowlist_entry_not_public");
      assert.ok(codes.has("bin_present"), "bin_present");
      assert.ok(codes.has("postinstall_present"), "postinstall_present");
    }
  });

  it("negative: simulated pack entry with prohibited path fails validation", () => {
    const simulated = [
      "plugin.json",
      "skills/crewmate/SKILL.md",
      "mcp.json",
      "bin/cli.js",
      ".bearing/state.json",
      "src/server.ts",
    ];
    const verdict = validatePackFileList(simulated);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.ok(
        verdict.diagnostics.some((d) => d.code === "prohibited_pack_entry"),
        "expected prohibited_pack_entry"
      );
      assert.ok(verdict.diagnostics.some((d) => d.path === "mcp.json"));
      assert.ok(verdict.diagnostics.some((d) => d.path === "bin/cli.js"));
      assert.ok(verdict.diagnostics.some((d) => d.path === ".bearing/state.json"));
    }
  });

  it("JSON Schema files declare always-on SEIT sections, slice fields, and N/K/C names without integer defaults", () => {
    for (const rel of REQUIRED_SCHEMA_FILES) {
      assert.equal(existsSync(path.join(ROOT, rel)), true, `${rel} must exist`);
    }
    const seit = JSON.parse(readFileSync(path.join(ROOT, "schemas/seit.schema.json"), "utf8"));
    const implementation = JSON.parse(
      readFileSync(path.join(ROOT, "schemas/implementation.schema.json"), "utf8")
    );
    const authority = JSON.parse(
      readFileSync(path.join(ROOT, "schemas/authority.schema.json"), "utf8")
    );
    const journey = JSON.parse(readFileSync(path.join(ROOT, "schemas/journey.schema.json"), "utf8"));
    assert.equal(seit && typeof seit, "object");
    assert.equal(implementation && typeof implementation, "object");
    assert.equal(authority && typeof authority, "object");
    assert.equal(journey && typeof journey, "object");

    const seitText = JSON.stringify(seit);
    for (const section of ALWAYS_ON_SEIT_SECTIONS) {
      assert.ok(
        seitText.toLowerCase().includes(section.toLowerCase()),
        `seit schema must declare ${section}`
      );
    }

    const implText = JSON.stringify(implementation);
    for (const field of IMPLEMENTATION_SLICE_FIELDS) {
      assert.ok(implText.includes(`"${field}"`), `implementation schema must declare ${field}`);
    }

    const props = collectSchemaProperties(implementation);
    for (const name of ["n", "k", "c"]) {
      const node = props.get(name) || props.get(name.toUpperCase());
      assert.ok(node, `implementation schema must declare ${name} without inventing a value`);
      assert.equal(
        typeof node.default === "number",
        false,
        `${name} must not have a default integer value`
      );
    }
  });

  it("pnpm-lock.yaml is consistent with zero-dependency Lite package contract", () => {
    const lockfile = readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8");
    const verdict = validateLockfileConsistency(lockfile);
    assert.equal(verdict.ok, true, JSON.stringify(verdict));
  });

  it("negative: stale lockfile with overrides or deep dependency importers fails validation", () => {
    const staleLockfile = [
      "lockfileVersion: '9.0'",
      "settings:",
      "  autoInstallPeers: true",
      "overrides:",
      "  postcss: '>=8.5.23'",
      "importers:",
      "  .:",
      "    devDependencies:",
      "      typescript: 5.9.3",
    ].join("\n");
    const verdict = validateLockfileConsistency(staleLockfile);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      const codes = new Set(verdict.diagnostics.map((d) => d.code));
      assert.ok(codes.has("stale_overrides_present"), "stale_overrides_present");
      assert.ok(codes.has("stale_importers_present"), "stale_importers_present");
    }
  });
});
