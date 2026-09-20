#!/usr/bin/env node
"use strict";

/**
 * Bearing Lite closeout git-sync (advisory, fail-open).
 *
 * Runs on the host Stop event for the checkout the session ran in. It keeps
 * local current with origin by fast-forward only, then reports what still
 * needs a human or a PR. It never merges, rebases, pushes, or touches a dirty
 * tree, and it never blocks: exit status is always 0 and output is JSON.
 */

const { execFileSync } = require("node:child_process");

const GIT_TIMEOUT_MS = 10_000;

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

/** Sync one checkout. Pure function of the git state; returns facts, not prose. */
function sync(cwd) {
  const root = tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return { outcome: "SKIP", reason: "not_a_git_checkout" };
  if (tryGit(root, ["remote", "get-url", "origin"]) === null) {
    return { outcome: "SKIP", reason: "no_origin", root };
  }
  const fetched = tryGit(root, ["fetch", "--prune", "--quiet", "origin"]) !== null;
  const facts = { outcome: "OK", root, fetched, actions: [], attention: [] };

  const branch = tryGit(root, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (!branch) {
    facts.attention.push("detached HEAD; nothing fast-forwarded");
  } else {
    const upstream = tryGit(root, ["rev-parse", "--abbrev-ref", "-q", branch + "@{upstream}"]);
    if (!upstream) {
      const unpublished = tryGit(root, ["rev-list", "--count", "origin/main.." + branch]);
      facts.attention.push(
        "branch " + branch + " has no upstream" +
          (unpublished && unpublished !== "0" ? " and " + unpublished + " commit(s) origin does not have" : "") +
          ": push it and open a PR to main"
      );
    } else {
      const behind = Number(tryGit(root, ["rev-list", "--count", branch + ".." + upstream]) || 0);
      const ahead = Number(tryGit(root, ["rev-list", "--count", upstream + ".." + branch]) || 0);
      const dirty = (tryGit(root, ["status", "--porcelain", "--untracked-files=no"]) || "") !== "";
      if (ahead > 0 && behind > 0) {
        facts.attention.push("branch " + branch + " diverged from " + upstream + " (ahead " + ahead + ", behind " + behind + "): merge origin in, then push");
      } else if (ahead > 0) {
        facts.attention.push("branch " + branch + " has " + ahead + " unpushed commit(s): push it" + (branch === "main" ? " via a PR (main is PR-only)" : ""));
      } else if (behind > 0 && dirty) {
        facts.attention.push("branch " + branch + " is behind " + upstream + " by " + behind + " but the tree is dirty; commit or set aside, then fast-forward");
      } else if (behind > 0) {
        if (tryGit(root, ["merge", "--ff-only", "--quiet", upstream]) !== null) {
          facts.actions.push("fast-forwarded " + branch + " +" + behind);
        } else {
          facts.attention.push("branch " + branch + " could not be fast-forwarded to " + upstream);
        }
      }
    }
  }

  // main is PR-only everywhere, so when it is not checked out its local ref
  // is just a mirror and can be moved without a working tree.
  if (
    branch !== "main" &&
    tryGit(root, ["show-ref", "-q", "--verify", "refs/heads/main"]) !== null &&
    tryGit(root, ["show-ref", "-q", "--verify", "refs/remotes/origin/main"]) !== null
  ) {
    const list = tryGit(root, ["worktree", "list", "--porcelain"]) || "";
    const mainCheckedOut = /^branch refs\/heads\/main$/m.test(list);
    if (!mainCheckedOut) {
      if (tryGit(root, ["merge-base", "--is-ancestor", "main", "origin/main"]) !== null) {
        if (tryGit(root, ["rev-parse", "main"]) !== tryGit(root, ["rev-parse", "origin/main"])) {
          if (tryGit(root, ["update-ref", "refs/heads/main", "origin/main"]) !== null) {
            facts.actions.push("moved local main to origin/main");
          }
        }
      } else {
        facts.attention.push("local main has commits origin/main lacks: open a PR for them; never commit on main");
      }
    }
  }
  return facts;
}

function formatAdvice(facts) {
  if (facts.outcome === "SKIP") return null;
  const lines = [];
  if (!facts.fetched) lines.push("fetch from origin failed; state below may be stale");
  lines.push(...facts.actions);
  lines.push(...facts.attention);
  if (lines.length === 0) return "Bearing Lite git-sync: checkout current with origin.";
  return "Bearing Lite git-sync: " + lines.join("; ") + ".";
}

function readStdinSync() {
  try {
    return require("node:fs").readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  let cwd = process.cwd();
  let event = "Stop";
  try {
    const input = JSON.parse(readStdinSync() || "{}");
    if (typeof input.cwd === "string" && input.cwd) cwd = input.cwd;
    if (typeof input.hook_event_name === "string") event = input.hook_event_name;
  } catch {
    // Malformed input is not a policy event; fall back to the process cwd.
  }
  let text = null;
  try {
    text = formatAdvice(sync(cwd));
  } catch {
    text = "Bearing Lite git-sync UNAVAILABLE: git failed; check origin state manually.";
  }
  if (text) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }) + "\n"
    );
  }
  process.exit(0);
}

module.exports = { sync, formatAdvice };

if (require.main === module) main();
