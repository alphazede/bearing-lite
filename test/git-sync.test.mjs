/**
 * Closeout git-sync: fast-forward only, never mutate a dirty or diverged
 * checkout, always report what still needs a push or a PR.
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
const { sync, formatAdvice } = require(path.join(ROOT, "hooks/git-sync.cjs"));

const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function fixture() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), "bl-git-sync-"));
  const origin = path.join(t, "origin");
  const local = path.join(t, "local");
  git(t, "init", "-q", "-b", "main", origin);
  git(origin, "commit", "-q", "--allow-empty", "-m", "one");
  git(t, "clone", "-q", origin, local);
  git(local, "switch", "-q", "-c", "feature");
  git(local, "push", "-q", "-u", "origin", "feature");
  return { t, origin, local };
}

function advanceOrigin(origin, branch, message) {
  git(origin, "switch", "-q", branch);
  git(origin, "commit", "-q", "--allow-empty", "-m", message);
  git(origin, "switch", "-q", "main");
}

describe("closeout git-sync", () => {
  it("fast-forwards a clean branch and moves the unchecked-out main ref", () => {
    const { t, origin, local } = fixture();
    try {
      advanceOrigin(origin, "main", "two");
      advanceOrigin(origin, "feature", "feature-two");
      const facts = sync(local);
      assert.equal(facts.outcome, "OK");
      assert.deepEqual(facts.actions, ["fast-forwarded feature +1", "moved local main to origin/main"]);
      assert.deepEqual(facts.attention, []);
      assert.equal(git(local, "rev-parse", "main"), git(local, "rev-parse", "origin/main"));
      assert.match(formatAdvice(facts), /fast-forwarded feature \+1/);
    } finally {
      fs.rmSync(t, { recursive: true, force: true });
    }
  });

  it("leaves a dirty tree alone and says so", () => {
    const { t, origin, local } = fixture();
    try {
      advanceOrigin(origin, "feature", "feature-two");
      fs.writeFileSync(path.join(local, "tracked.txt"), "dirty");
      git(local, "add", "tracked.txt");
      const facts = sync(local);
      assert.deepEqual(facts.actions, []);
      assert.match(facts.attention[0], /behind .* dirty/);
      assert.equal(git(local, "rev-list", "--count", "feature..origin/feature"), "1");
    } finally {
      fs.rmSync(t, { recursive: true, force: true });
    }
  });

  it("reports unpushed and diverged branches instead of merging", () => {
    const { t, origin, local } = fixture();
    try {
      git(local, "commit", "-q", "--allow-empty", "-m", "local-work");
      assert.match(sync(local).attention[0], /1 unpushed commit/);
      advanceOrigin(origin, "feature", "feature-two");
      const facts = sync(local);
      assert.deepEqual(facts.actions, []);
      assert.match(facts.attention[0], /diverged/);
    } finally {
      fs.rmSync(t, { recursive: true, force: true });
    }
  });

  it("reports a branch with no upstream and never pushes", () => {
    const { t, local } = fixture();
    try {
      git(local, "switch", "-q", "-c", "unpublished");
      git(local, "commit", "-q", "--allow-empty", "-m", "draft");
      const facts = sync(local);
      assert.match(facts.attention[0], /no upstream and 1 commit/);
      assert.equal(git(local, "ls-remote", "--heads", "origin", "unpublished"), "");
    } finally {
      fs.rmSync(t, { recursive: true, force: true });
    }
  });

  it("stays silent when the checkout is already current", () => {
    const { t, local } = fixture();
    try {
      // Nothing fetched, nothing ahead/behind: on Stop an unconditional message
      // would start a turn that fires Stop again, forever.
      assert.equal(formatAdvice(sync(local)), null);
    } finally {
      fs.rmSync(t, { recursive: true, force: true });
    }
  });

  it("skips outside a git checkout and prints nothing for it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bl-git-sync-none-"));
    try {
      const facts = sync(dir);
      assert.equal(facts.outcome, "SKIP");
      assert.equal(formatAdvice(facts), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
