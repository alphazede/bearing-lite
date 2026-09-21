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
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

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
      fs.writeFileSync(path.join(local, "local.txt"), "mine\n");
      git(local, "add", "local.txt");
      git(local, "commit", "-q", "-m", "local-work");
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
      fs.writeFileSync(path.join(local, "draft.txt"), "draft\n");
      git(local, "add", "draft.txt");
      git(local, "commit", "-q", "-m", "draft");
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

  it("treats a rebase-merged local ref as stale, not unpushed (#133)", () => {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), "bl-git-sync-"));
    const origin = path.join(t, "origin");
    const local = path.join(t, "local");
    try {
      git(t, "init", "-q", "-b", "main", origin);
      fs.writeFileSync(path.join(origin, "base.txt"), "base\n");
      git(origin, "add", "base.txt");
      git(origin, "commit", "-q", "-m", "base");
      git(t, "clone", "-q", origin, local);
      fs.writeFileSync(path.join(local, "landed.txt"), "landed\n");
      git(local, "add", "landed.txt");
      git(local, "commit", "-q", "-m", "landed");
      git(local, "push", "-q", "origin", "HEAD:refs/heads/tmp");
      const tree = git(origin, "rev-parse", "tmp^{tree}");
      const parent = git(origin, "rev-parse", "main");
      const replayed = git(origin, "commit-tree", tree, "-p", parent, "-m", "rebase-land");
      git(origin, "update-ref", "refs/heads/main", replayed);
      git(local, "fetch", "-q", "origin");
      const facts = sync(local);
      const advice = (facts.attention || []).join("; ");
      assert.doesNotMatch(advice, /unpushed commit|open a PR|merge origin in, then push/);
      assert.match(advice, /stale|rewrite|reset/);
    } finally {
      fs.rmSync(t, { recursive: true, force: true });
    }
  });

  it("reports a tree-equal rewritten main as stale rather than asking for a PR (#133)", () => {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), "bl-git-sync-"));
    const origin = path.join(t, "origin");
    const local = path.join(t, "local");
    try {
      git(t, "init", "-q", "-b", "main", origin);
      fs.writeFileSync(path.join(origin, "a.txt"), "a\n");
      git(origin, "add", "a.txt");
      git(origin, "commit", "-q", "-m", "one");
      git(t, "clone", "-q", origin, local);
      fs.writeFileSync(path.join(origin, "a.txt"), "a\n");
      git(origin, "commit", "-q", "--allow-empty", "--amend", "-m", "one-rewritten");
      git(local, "fetch", "-q", "origin");
      const facts = sync(local);
      const advice = (facts.attention || []).join("; ");
      assert.match(advice, /stale|rewrite|reset/);
      assert.doesNotMatch(advice, /open a PR for them|unpushed commit/);
    } finally {
      fs.rmSync(t, { recursive: true, force: true });
    }
  });

  it("returns no additionalContext on Stop re-entry (#134)", () => {
    const { handle } = require(path.join(ROOT, "hooks/git-sync.cjs"));
    const { t, local } = fixture();
    try {
      fs.writeFileSync(path.join(local, "local.txt"), "mine\n");
      git(local, "add", "local.txt");
      git(local, "commit", "-q", "-m", "local-work");
      const first = handle({ cwd: local, hook_event_name: "Stop" });
      assert.ok(first.hookSpecificOutput?.additionalContext);
      const again = handle({
        cwd: local,
        hook_event_name: "Stop",
        stop_hook_active: true,
      });
      assert.deepEqual(again, {});
      const camel = handle({
        cwd: local,
        hookEventName: "Stop",
        stopHookActive: "true",
      });
      assert.deepEqual(camel, {});
    } finally {
      fs.rmSync(t, { recursive: true, force: true });
    }
  });
});
