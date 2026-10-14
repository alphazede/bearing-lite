/**
 * D2 regression: SessionStart activation must report the write-set lock as present
 * when the shipped hooks/hooks.json registers orchestrator-write-lock.cjs, and as
 * absent only when that registration is genuinely removed.
 *
 * Runs a disposable copy of the shipped hooks/ tree through the real host adapter
 * (`node host.cjs`, Codex-shaped SessionStart stdin), so detection reads the shipped
 * command-string manifest form rather than a hand-written one.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHIPPED_MANIFEST = path.join(ROOT, "hooks", "hooks.json");
const LOCK_SCRIPT = "orchestrator-write-lock.cjs";
const tmp = mkdtempSync(path.join(os.tmpdir(), `bearing-d2-${process.pid}-${process.hrtime.bigint()}-`));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** Copy shipped hooks/ into a fresh plugin root, optionally rewrite its manifest, run SessionStart. */
function sessionStart(name, editManifest) {
  const root = path.join(tmp, name);
  const repo = path.join(tmp, `${name}-repo`);
  cpSync(path.join(ROOT, "hooks"), path.join(root, "hooks"), { recursive: true });
  mkdirSync(repo);
  if (editManifest) {
    const manifest = JSON.parse(readFileSync(SHIPPED_MANIFEST, "utf8"));
    editManifest(manifest);
    writeFileSync(path.join(root, "hooks", "hooks.json"), JSON.stringify(manifest, null, 2));
  }
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("BEARING_")) delete env[k];
  const r = spawnSync(process.execPath, [path.join(root, "hooks", "com.anthropic.claude-code", "host.cjs")], {
    input: JSON.stringify({ session_id: "d2", transcript_path: null, cwd: repo, hook_event_name: "SessionStart", model: "m", permission_mode: "default", source: "startup" }),
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(r.status, 0, `host.cjs exit=${r.status} signal=${r.signal} error=${r.error?.message}\nstderr: ${r.stderr}`);
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
}

const lockRegistered = (group) => (group.hooks || []).some((h) => String(h.command).includes(LOCK_SCRIPT));

describe("SessionStart write-lock availability reporting (D2)", () => {
  it("reports write_lock: present for the shipped manifest that registers the lock", () => {
    const shipped = JSON.parse(readFileSync(SHIPPED_MANIFEST, "utf8"));
    assert.equal(shipped.hooks.PreToolUse.filter(lockRegistered).length, 1, "shipped manifest should register the write lock once");
    assert.match(sessionStart("shipped"), /^write_lock: present$/m);
  });

  it("reports write_lock: absent when the lock registration is removed", () => {
    const context = sessionStart("no-lock", (m) => {
      const before = m.hooks.PreToolUse.length;
      m.hooks.PreToolUse = m.hooks.PreToolUse.filter((g) => !lockRegistered(g));
      assert.equal(m.hooks.PreToolUse.length, before - 1, "fixture must remove exactly the lock registration");
    });
    assert.match(context, /^write_lock: absent$/m);
  });
});
