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
const cursorStop = require("./cursor-stop.cjs");

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
      const unpublished = Number(tryGit(root, ["rev-list", "--count", "origin/main.." + branch]) || 0);
      if (unpublished > 0 && alreadyUpstream(root, "origin/main", branch)) {
        facts.attention.push(
          "branch " + branch + " has no upstream; its commits are already on origin/main after a rewrite: reset it to origin/main or delete it; do not push or open a duplicate PR"
        );
      } else {
        facts.attention.push(
          "branch " + branch + " has no upstream" +
            (unpublished > 0 ? " and " + unpublished + " commit(s) origin does not have" : "") +
            ": push it and open a PR to main"
        );
      }
    } else {
      const behind = Number(tryGit(root, ["rev-list", "--count", branch + ".." + upstream]) || 0);
      const ahead = Number(tryGit(root, ["rev-list", "--count", upstream + ".." + branch]) || 0);
      const dirty = (tryGit(root, ["status", "--porcelain", "--untracked-files=no"]) || "") !== "";
      if (ahead > 0 && alreadyUpstream(root, upstream, branch)) {
        facts.attention.push(
          "branch " + branch + " is stale after an upstream rewrite (SHA ahead " + ahead +
            (behind > 0 ? ", behind " + behind : "") +
            "): reset it to " + upstream + " or delete it; do not push or open a duplicate PR"
        );
      } else if (ahead > 0 && behind > 0) {
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
      } else if (alreadyUpstream(root, "origin/main", "main")) {
        facts.attention.push(
          "local main is stale after an upstream rewrite: reset it to origin/main; never commit on main and do not open a duplicate PR"
        );
      } else {
        facts.attention.push("local main has commits origin/main lacks: open a PR for them; never commit on main");
      }
    }
  }
  return facts;
}

/** True when local commits are already on upstream by tree or patch-id (#133). */
function alreadyUpstream(root, upstream, branch) {
  if (tryGit(root, ["rev-parse", "--verify", upstream]) === null) return false;
  if (tryGit(root, ["diff", "--quiet", branch, upstream]) !== null) return true;
  const cherry = tryGit(root, ["cherry", upstream, branch]);
  if (cherry === null) return false;
  if (!cherry) return true;
  return !cherry.split("\n").some((line) => line.startsWith("+"));
}

function isTruthyFlag(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function isStopReentry(input, eventName) {
  const event = String(eventName || "").replace(/[_\-\s]/g, "").toLowerCase();
  if (event !== "stop" && event !== "subagentstop") return false;
  return isTruthyFlag(input.stop_hook_active) || isTruthyFlag(input.stopHookActive);
}

function formatAdvice(facts) {
  if (facts.outcome === "SKIP") return null;
  const lines = [];
  if (!facts.fetched) lines.push("fetch from origin failed; state below may be stale");
  lines.push(...facts.actions);
  lines.push(...facts.attention);
  // Nothing to report: stay silent. On Stop, any additionalContext starts a new
  // turn, which fires Stop again -- an unconditional message never terminates.
  if (lines.length === 0) return null;
  return "Bearing Lite git-sync: " + lines.join("; ") + ".";
}

function readStdinSync() {
  try {
    return require("node:fs").readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function handle(raw) {
  let input = {};
  try {
    input = typeof raw === "string" ? JSON.parse(raw || "{}") : raw && typeof raw === "object" ? raw : {};
  } catch {
    input = {};
  }
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  const event =
    typeof input.hook_event_name === "string"
      ? input.hook_event_name
      : typeof input.hookEventName === "string"
        ? input.hookEventName
        : "Stop";
  // #134: a Stop re-entry exists only because this hook already spoke. Stay quiet.
  if (isStopReentry(input, event)) return {};
  let text = null;
  try {
    text = formatAdvice(sync(cwd));
  } catch {
    text = "Bearing Lite git-sync UNAVAILABLE: git failed; check origin state manually.";
  }
  if (!text) return {};
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

function main() {
  let response = {};
  try {
    response = handle(readStdinSync() || "{}");
  } catch {
    response = {};
  }
  if (cursorStop.usesCursorStop()) response = cursorStop.project(response);
  if (response && Object.keys(response).length) {
    process.stdout.write(JSON.stringify(response) + "\n");
  }
  process.exit(0);
}

module.exports = { sync, formatAdvice, handle, alreadyUpstream };

if (require.main === module) main();
