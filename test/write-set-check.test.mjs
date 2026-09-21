/**
 * #118: write-set hygiene must examine newly added files, not only tracked diffs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { check } = require(path.join(ROOT, "hooks/write-set-check.cjs"));

const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

function repo() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), "bl-write-set-"));
  git(t, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(t, "kept.txt"), "ok\n");
  git(t, "add", "kept.txt");
  git(t, "commit", "-q", "-m", "base");
  return t;
}

describe("write-set-check (#118)", () => {
  it("fails an untracked file with trailing whitespace and passes a clean one", () => {
    const t = repo();
    try {
      fs.writeFileSync(path.join(t, "new-bad.txt"), "hello \n");
      fs.writeFileSync(path.join(t, "new-good.txt"), "hello\n");
      const vacuous = execFileSync("git", ["diff", "--check"], {
        cwd: t,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.equal(vacuous, "");
      const bad = check(t, ["new-bad.txt"]);
      assert.equal(bad.outcome, "FAIL");
      assert.ok(bad.findings.some((f) => f.code === "whitespace"));
      const good = check(t, ["new-good.txt"]);
      assert.equal(good.outcome, "PASS");
      assert.deepEqual(good.findings, []);
      assert.equal(git(t, "status", "--porcelain", "--", "new-bad.txt"), "?? new-bad.txt");
    } finally {
      fs.rmSync(t, { recursive: true, force: true });
    }
  });

  it("rejects an empty write set so a new-file slice cannot pass unexamined", () => {
    const t = repo();
    try {
      assert.equal(check(t, []).outcome, "FAIL");
    } finally {
      fs.rmSync(t, { recursive: true, force: true });
    }
  });
});
