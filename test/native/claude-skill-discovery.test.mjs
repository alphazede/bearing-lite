/**
 * Claude Code native skill discovery for the candidate checkout (#214).
 *
 * Installs the candidate through the real `claude plugin marketplace add` /
 * `claude plugin install` path into a disposable HOME/XDG_CONFIG_HOME, then
 * reads `claude plugin details bearing-lite` (credential-free, no model call)
 * to prove the installed plugin inventories every packaged skill, including
 * the `orchestrator` discovery alias and the canonical `bearing-lite` entry
 * point. The asserted skill set is derived from the shipped `skills/` tree
 * at test time, so a missing alias fails rather than passing on a count.
 *
 * Required native prerequisite: `claude` on PATH (override with
 * BEARING_CLAUDE_BIN). Its absence fails this test; it never skips or passes.
 * Resource group: isolated Claude HOME/config per run; no shared ports,
 * credentials, or user config. The default gate glob `test/*.test.mjs` does
 * not run this file; run it explicitly alongside the Codex native suite.
 *
 * Cursor: the desktop installation path (UI Customize install and the
 * documented local-plugin symlink) is explicitly untested — no Cursor CLI
 * inventories the desktop plugin. `cursor-agent` is a different client and
 * does not validate that path.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLAUDE = process.env.BEARING_CLAUDE_BIN || "claude";
const CALL_TIMEOUT_MS = 60_000;

/** @type {string} */ let tmp;
/** @type {Record<string, string>} */ let env;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: CALL_TIMEOUT_MS });
  const diag = `${cmd} ${args.join(" ")} -> status=${r.status} signal=${r.signal} error=${r.error?.message}\nstdout: ${r.stdout}\nstderr: ${String(r.stderr).slice(-2000)}`;
  assert.equal(r.error, undefined, `ENVIRONMENT_FAILURE: ${diag}`);
  assert.equal(r.status, 0, `ENVIRONMENT_FAILURE: ${diag}`);
  return r.stdout;
}

function shippedSkills() {
  return readdirSync(path.join(ROOT, "skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(ROOT, "skills", d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();
}

describe("Claude Code native skill discovery (#214)", () => {
  before(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), `bearing-claude-discovery-${process.pid}-${process.hrtime.bigint()}-`));
    const home = path.join(tmp, "home");
    const xdg = path.join(tmp, "xdg");
    for (const d of [home, xdg]) mkdirSync(d, { recursive: true });
    env = { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: xdg, LANG: "C.UTF-8", TMPDIR: tmp };

    const version = spawnSync(CLAUDE, ["--version"], { env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: CALL_TIMEOUT_MS });
    assert.ok(
      !version.error && version.status === 0,
      `ENVIRONMENT_FAILURE: required native prerequisite '${CLAUDE}' unavailable (${version.error?.message ?? `status ${version.status}`}); install Claude Code or set BEARING_CLAUDE_BIN`
    );

    run(CLAUDE, ["plugin", "marketplace", "add", ROOT]);
    run(CLAUDE, ["plugin", "install", "bearing-lite@bearing-lite", "--json"]);
  });

  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it("inventories every packaged skill, including orchestrator and bearing-lite", () => {
    const details = run(CLAUDE, ["plugin", "details", "bearing-lite"]);
    const shipped = shippedSkills();
    assert.ok(shipped.includes("orchestrator"), "candidate must ship skills/orchestrator/SKILL.md");
    assert.ok(shipped.includes("bearing-lite"), "candidate must ship skills/bearing-lite/SKILL.md");
    const m = details.match(/Skills\s*\((\d+)\)\s+([^\n]+)/i);
    assert.ok(m, `plugin details must report a Skills inventory: ${details.slice(0, 2000)}`);
    assert.equal(Number(m[1]), shipped.length, `Claude inventoried ${m[1]} skills; candidate ships ${shipped.length}`);
    const listed = m[2].split(",").map((s) => s.trim()).filter(Boolean).sort();
    assert.deepEqual(listed, shipped, `Claude Skills inventory must equal the shipped skills tree.\nlisted: ${listed.join(", ")}\nshipped: ${shipped.join(", ")}`);
    assert.ok(listed.includes("orchestrator"), "Claude must discover the orchestrator alias");
    assert.ok(listed.includes("bearing-lite"), "Claude must discover the canonical bearing-lite entry point");
  });
});
