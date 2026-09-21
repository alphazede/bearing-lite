#!/usr/bin/env node
"use strict";

/**
 * Write-set hygiene (#118). `git diff --check` ignores untracked files, so a
 * slice that only adds paths can record a vacuous pass. This check examines
 * each named path: tracked diffs (worktree and index) plus newly added files.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function git(cwd, args, opts = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

function tryGit(cwd, args) {
  try {
    return { ok: true, stdout: git(cwd, args).trim(), stderr: "" };
  } catch (err) {
    return {
      ok: false,
      stdout: String((err && err.stdout) || ""),
      stderr: String((err && err.stderr) || ""),
      status: err && err.status,
    };
  }
}

function porcelain(cwd, rel) {
  const out = tryGit(cwd, ["status", "--porcelain", "--untracked-files=all", "--", rel]);
  return out.ok ? out.stdout : "";
}

function collectCheck(stdout) {
  return String(stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /trailing whitespace|space before tab|conflict/i.test(line));
}

function checkPath(cwd, rel) {
  const findings = [];
  const abs = path.resolve(cwd, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return [{ path: rel, code: "missing_path" }];
  }
  const status = porcelain(cwd, rel);
  const untracked = /^\?\?/.test(status);
  if (untracked) {
    const intent = tryGit(cwd, ["add", "-N", "--", rel]);
    try {
      const checked = tryGit(cwd, ["diff", "--check", "--", rel]);
      for (const line of collectCheck(checked.stdout + checked.stderr)) {
        findings.push({ path: rel, code: "whitespace", detail: line });
      }
    } finally {
      if (intent.ok) tryGit(cwd, ["reset", "-q", "--", rel]);
    }
    return findings;
  }
  for (const args of [
    ["diff", "--check", "--", rel],
    ["diff", "--check", "--cached", "--", rel],
  ]) {
    const checked = tryGit(cwd, args);
    for (const line of collectCheck(checked.stdout + checked.stderr)) {
      findings.push({ path: rel, code: "whitespace", detail: line });
    }
  }
  return findings;
}

function check(cwd, paths) {
  const findings = [];
  if (!Array.isArray(paths) || !paths.length) {
    return { outcome: "FAIL", findings: [{ code: "empty_write_set" }] };
  }
  for (const rel of paths) {
    findings.push(...checkPath(cwd, String(rel)));
  }
  return { outcome: findings.length ? "FAIL" : "PASS", findings };
}

function main() {
  const paths = process.argv.slice(2).filter((arg) => arg !== "--");
  const result = check(process.cwd(), paths);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.outcome === "PASS" ? 0 : 1);
}

module.exports = { check };

if (require.main === module) main();
