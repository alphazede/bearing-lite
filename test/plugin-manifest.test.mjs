/**
 * CMD-MANIFEST-01 / SEIT-MANIFEST-01, SEIT-EXTENSION-01
 * Exact Agent Plugins v1.0.0 closed-field manifest + extension containment.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_V1 =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

/**
 * Closed top-level field set from Agent Plugins Specification 1.0.0 §5.2.
 * https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md
 */
const CLOSED_TOP_LEVEL = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);

/**
 * @typedef {{ code: string, message: string, field?: string }} ManifestDiagnostic
 * @typedef {{ ok: true, name: string, schema: string } | { ok: false, diagnostics: ManifestDiagnostic[] }} ManifestVerdict
 */

/**
 * Validate a plugin manifest object (product or fixture). Pure; no disk writes.
 * @param {unknown} manifest
 * @returns {ManifestVerdict}
 */
export function validatePluginManifest(manifest) {
  /** @type {ManifestDiagnostic[]} */
  const diagnostics = [];
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return {
      ok: false,
      diagnostics: [{ code: "manifest_not_object", message: "manifest must be a plain object" }],
    };
  }
  const m = /** @type {Record<string, unknown>} */ (manifest);

  if (m.$schema !== SCHEMA_V1) {
    diagnostics.push({
      code: "schema_not_v1_0_0",
      message: `expected exact $schema ${SCHEMA_V1}, got ${String(m.$schema)}`,
      field: "$schema",
    });
  }

  if (m.name !== "bearing-lite") {
    diagnostics.push({
      code: "name_mismatch",
      message: `expected name "bearing-lite", got ${JSON.stringify(m.name)}`,
      field: "name",
    });
  }

  for (const key of Object.keys(m)) {
    if (!CLOSED_TOP_LEVEL.has(key)) {
      diagnostics.push({
        code: "unknown_top_level_field",
        message: `unknown top-level field "${key}" is outside the v1.0.0 closed set`,
        field: key,
      });
    }
  }

  // Extension / path containment for the Agent Plugins 1.0 `extensions` map.
  const extensions = m.extensions;
  if (extensions !== undefined) {
    if (typeof extensions !== "object" || extensions === null || Array.isArray(extensions)) {
      diagnostics.push({
        code: "section_not_object",
        message: "extensions must be an object map when present",
        field: "extensions",
      });
    } else {
      for (const [entryKey, entryVal] of Object.entries(
        /** @type {Record<string, unknown>} */ (extensions)
      )) {
        const pathLike =
          typeof entryVal === "string"
            ? entryVal
            : entryVal &&
                typeof entryVal === "object" &&
                !Array.isArray(entryVal) &&
                typeof /** @type {Record<string, unknown>} */ (entryVal).path === "string"
              ? String(/** @type {Record<string, unknown>} */ (entryVal).path)
              : null;
        if (pathLike !== null) {
          if (path.isAbsolute(pathLike) || /^[A-Za-z]:[\\/]/.test(pathLike)) {
            diagnostics.push({
              code: "absolute_path_rejected",
              message: `extensions.${entryKey} uses absolute path "${pathLike}"`,
              field: `extensions.${entryKey}`,
            });
          }
          if (pathLike.includes("..") || pathLike.includes("\\..")) {
            diagnostics.push({
              code: "path_traversal_rejected",
              message: `extensions.${entryKey} uses path traversal "${pathLike}"`,
              field: `extensions.${entryKey}`,
            });
          }
        }
        // Extension namespaces must be verified reverse-domain IDs (Agent Plugins §8).
        const verified = /^(com|org|io|net|dev)\.[a-z0-9]+(\.[a-z0-9_-]+)+$/i.test(entryKey);
        if (!verified) {
          diagnostics.push({
            code: "unverified_extension_namespace",
            message: `unverified extension namespace "${entryKey}" in extensions`,
            field: `extensions.${entryKey}`,
          });
        }
      }
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, name: "bearing-lite", schema: SCHEMA_V1 };
}

describe("CMD-MANIFEST-01 plugin-manifest (SEIT-MANIFEST-01, SEIT-EXTENSION-01)", () => {
  it("loads product plugin.json with exact v1.0.0 schema and bearing-lite name", () => {
    const raw = readFileSync(path.join(ROOT, "plugin.json"), "utf8");
    const manifest = JSON.parse(raw);
    assert.equal(manifest.$schema, SCHEMA_V1);
    assert.equal(manifest.name, "bearing-lite");
    const verdict = validatePluginManifest(manifest);
    assert.equal(verdict.ok, true, JSON.stringify(verdict));
    if (verdict.ok) {
      assert.equal(verdict.schema, SCHEMA_V1);
      assert.equal(verdict.name, "bearing-lite");
    }
    assert.equal(manifest.hooks, undefined);
    assert.equal(manifest.skills, undefined);
    assert.equal(manifest.mcpServers, undefined);
    assert.equal(manifest.commands, undefined);
    assert.equal(manifest.agents, undefined);
  });

  it("accepts only closed top-level fields present on the product manifest", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "plugin.json"), "utf8"));
    for (const key of Object.keys(manifest)) {
      assert.ok(
        CLOSED_TOP_LEVEL.has(key),
        `product field "${key}" is outside the documented closed set`
      );
    }
  });

  it("keeps host install metadata aligned with Bearing Lite", () => {
    const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));
    const claude = readJson(".claude-plugin/plugin.json");
    const codex = readJson(".codex-plugin/plugin.json");
    const grok = readJson(".grok-plugin/plugin.json");
    const cursor = readJson(".cursor-plugin/plugin.json");
    const kimi = readJson(".kimi-plugin/plugin.json");
    const agy = readJson(".agy/plugin.json");
    const pkg = readJson("package.json");

    for (const manifest of [claude, codex, grok, cursor, kimi]) {
      assert.equal(manifest.name, "bearing-lite");
      assert.equal(manifest.skills, "./skills/");
      assert.equal(manifest.mcpServers, undefined);
    }
    for (const manifest of [claude, codex, grok]) {
      // These hosts auto-load hooks/hooks.json. Declaring both duplicates.
      assert.equal(manifest.hooks, undefined);
    }
    assert.equal(cursor.hooks, "./hooks/com.cursor/hooks.json");
    assert.ok(Array.isArray(kimi.hooks));
    assert.equal(kimi.hooks.length, 2);
    assert.deepEqual(Object.keys(agy).sort(), ["description", "name"]);
    assert.equal(agy.name, "bearing-lite");
    assert.deepEqual(pkg.pi, { skills: ["./skills"] });
    assert.ok(pkg.keywords.includes("pi-package"));

    const portable = readJson("plugin.json");
    assert.equal(portable.hooks, undefined);
    assert.equal(portable.skills, undefined);
    assert.equal(portable.mcpServers, undefined);
    const copilotHooks = readJson("com.github.copilot/hooks/hooks.json");
    for (const event of ["SessionStart", "PreToolUse", "Stop", "SubagentStop"]) {
      assert.ok(
        Array.isArray(copilotHooks.hooks[event]),
        `Copilot ${event} must be registered`
      );
    }
    assert.match(JSON.stringify(copilotHooks), /\$\{PLUGIN_ROOT\}/);
    const teCommands = ["PreToolUse", "Stop", "SubagentStop"].flatMap((event) =>
      copilotHooks.hooks[event]
        .map((entry) => entry.command)
        .filter(
          (command) => typeof command === "string" && /te-host\.cjs/.test(command)
        )
    );
    assert.equal(teCommands.length, 3);
    for (const command of teCommands) {
      assert.match(command, /\$\{PLUGIN_ROOT\}/);
      assert.match(command, /te-host\.cjs/);
      assert.match(command, /--host=copilot/);
    }

    assert.equal(readJson(".agents/plugins/marketplace.json").plugins[0].name, "bearing-lite");
    assert.equal(readJson(".claude-plugin/marketplace.json").plugins[0].name, "bearing-lite");
    assert.equal(readJson(".grok-plugin/marketplace.json").plugins[0].name, "bearing-lite");
    assert.equal(readJson(".cursor-plugin/marketplace.json").plugins[0].name, "bearing-lite");
  });

  it("keeps release-bearing manifest versions aligned", () => {
    const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));
    const claude = readJson(".claude-plugin/plugin.json");
    const portable = readJson("plugin.json");
    const pkg = readJson("package.json");
    assert.equal(claude.version, portable.version);
    assert.equal(portable.version, pkg.version);
  });

  it("negative: floating / non-1.0.0 schema is rejected with typed diagnostic", () => {
    const fixture = {
      $schema: "https://agent-plugins.org/schemas/2.0.0/plugin.schema.json",
      name: "bearing-lite",
      version: "0.1.0",
    };
    const verdict = validatePluginManifest(fixture);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.ok(
        verdict.diagnostics.some((d) => d.code === "schema_not_v1_0_0"),
        "expected schema_not_v1_0_0"
      );
    }
  });

  it("negative: unknown top-level field is rejected with typed diagnostic", () => {
    const fixture = {
      $schema: SCHEMA_V1,
      name: "bearing-lite",
      version: "0.1.0",
      secretRuntimeBridge: true,
    };
    const verdict = validatePluginManifest(fixture);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      const hit = verdict.diagnostics.find((d) => d.code === "unknown_top_level_field");
      assert.ok(hit, "expected unknown_top_level_field");
      assert.equal(hit.field, "secretRuntimeBridge");
    }
  });

  it("negative: top-level hooks is rejected as a nonstandard Agent Plugins 1.0 field", () => {
    const fixture = {
      $schema: SCHEMA_V1,
      name: "bearing-lite",
      version: "0.1.0",
      hooks: {
        "com.anthropic.claude-code.activation": {
          path: "./hooks/com.anthropic.claude-code/host.cjs",
        },
      },
    };
    const verdict = validatePluginManifest(fixture);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      const hit = verdict.diagnostics.find((d) => d.code === "unknown_top_level_field");
      assert.ok(hit, "expected unknown_top_level_field for top-level hooks");
      assert.equal(hit.field, "hooks");
    }
  });

  it("negative: absolute path in extension map is rejected", () => {
    const fixture = {
      $schema: SCHEMA_V1,
      name: "bearing-lite",
      version: "0.1.0",
      extensions: {
        "com.example.vendor": { path: "/etc/passwd" },
      },
    };
    const verdict = validatePluginManifest(fixture);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.ok(
        verdict.diagnostics.some((d) => d.code === "absolute_path_rejected"),
        "expected absolute_path_rejected"
      );
    }
  });

  it("negative: path traversal is rejected", () => {
    const fixture = {
      $schema: SCHEMA_V1,
      name: "bearing-lite",
      version: "0.1.0",
      extensions: {
        "com.example.vendor": { path: "../../secrets/token" },
      },
    };
    const verdict = validatePluginManifest(fixture);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.ok(
        verdict.diagnostics.some((d) => d.code === "path_traversal_rejected"),
        "expected path_traversal_rejected"
      );
    }
  });

  it("negative: unverified extension namespace is rejected", () => {
    const fixture = {
      $schema: SCHEMA_V1,
      name: "bearing-lite",
      version: "0.1.0",
      extensions: {
        "not-a-reverse-domain": { path: "./hooks/x.cjs" },
      },
    };
    const verdict = validatePluginManifest(fixture);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.ok(
        verdict.diagnostics.some((d) => d.code === "unverified_extension_namespace"),
        "expected unverified_extension_namespace"
      );
    }
  });
});
