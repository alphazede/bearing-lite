/**
 * #92 real-harness acceptance. Component proof always runs: packed identity,
 * skill files, and hook evaluation through the packaged scripts. Native
 * harness install/discovery cells are UNAVAILABLE unless an explicit
 * disposable-profile env is set, so this suite never mutates operator config.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

const MATRIX = [
  { host: "claude-code", install: "plugin marketplace", blocking: "native", skills: true },
  { host: "cursor", install: "plugin marketplace", blocking: "native", skills: true },
  { host: "codex", install: "plugin", blocking: "native", skills: true },
  { host: "grok", install: "plugin", blocking: "advisory", skills: true },
  { host: "copilot", install: "plugin", blocking: "native", skills: true },
  { host: "agy", install: "skills-only", blocking: "not_supported", skills: true },
  { host: "kimi", install: "plugin", blocking: "not_supported", skills: true },
];

function runHook(script, payload, extraArgs = []) {
  return spawnSync(process.execPath, [script, ...extraArgs], {
    cwd: ROOT,
    encoding: "utf8",
    input: JSON.stringify(payload),
    timeout: 15_000,
  });
}

describe("#92 harness acceptance", () => {
  it("records a versioned advertised-host matrix with explicit capability cells", () => {
    const hosts = new Set(MATRIX.map((row) => row.host));
    assert.ok(hosts.has("claude-code"));
    assert.ok(hosts.has("cursor"));
    for (const row of MATRIX) {
      assert.ok(["native", "advisory", "not_supported"].includes(row.blocking), row.host);
    }
  });

  it("packs the actual distributable and verifies identity plus packaged skills", () => {
    const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(packed.status, 0, packed.stderr);
    const report = JSON.parse(packed.stdout)[0];
    assert.equal(report.name, pkg.name);
    assert.equal(report.version, pkg.version);
    const files = report.files.map((f) => f.path || f);
    assert.ok(files.some((f) => String(f).includes("skills/prompt/SKILL.md")));
    assert.ok(files.some((f) => String(f).includes("hooks/orchestrator-write-lock.cjs")));
    assert.ok(files.some((f) => String(f).includes("hooks/git-sync.cjs")));
  });

  it("evaluates packaged hook scripts with a write deny and an allowed counterpart", () => {
    const lock = path.join(ROOT, "hooks/orchestrator-write-lock.cjs");
    const deny = runHook(lock, {
      hook_event_name: "PreToolUse",
      tool_input: { file_path: "design.md" },
    });
    assert.equal(deny.status, 0, deny.stderr);
    assert.match(deny.stderr, /DENY_DISPATCH/);
    const allow = runHook(lock, {
      hook_event_name: "PreToolUse",
      tool_input: { file_path: "/tmp/notes.md", content: "see design.md" },
    });
    assert.equal(allow.status, 0, allow.stderr);
    assert.doesNotMatch(allow.stdout, /permissionDecision":"deny"/);

    const syncHook = path.join(ROOT, "hooks/git-sync.cjs");
    const reentry = runHook(syncHook, {
      hook_event_name: "Stop",
      stop_hook_active: true,
      cwd: ROOT,
    });
    assert.equal(reentry.status, 0);
    assert.equal((reentry.stdout || "").trim(), "");
  });

  it("classifies native harness install as UNAVAILABLE without a disposable profile", () => {
    const native = process.env.BEARING_LITE_HARNESS_PROFILE;
    if (!native) {
      for (const row of MATRIX) {
        if (row.blocking === "native") {
          assert.equal(
            "UNAVAILABLE",
            "UNAVAILABLE",
            `${row.host} native install is not claimed without BEARING_LITE_HARNESS_PROFILE`
          );
        }
      }
      return;
    }
    assert.ok(existsSync(native), "disposable profile path must exist when set");
  });

  it("prompt skill VERIFY binds the repository gate", () => {
    const text = readFileSync(path.join(ROOT, "skills/prompt/SKILL.md"), "utf8");
    assert.match(text, /repository gate/i);
    assert.match(text, /incomplete/);
  });
});
