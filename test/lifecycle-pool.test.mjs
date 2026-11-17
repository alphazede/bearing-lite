/**
 * Storage-aware worktree pooling and test artifact lifecycle cleanup.
 * Drives tools/lifecycle-pool.mjs against real git repos in unique temp dirs.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, readFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "tools", "lifecycle-pool.mjs");

async function git(cwd, ...args) {
  const { stdout } = await run("git", args, { cwd });
  return stdout.trim();
}
function cli(args, opts = {}) {
  return run("node", [CLI, ...args], { encoding: "utf8", ...opts });
}
async function cliOk(args) {
  const { stdout, stderr } = await cli(args);
  return { stdout, stderr };
}
async function cliFail(args) {
  try {
    await cli(args);
    assert.fail(`expected failure: ${args.join(" ")}`);
  } catch (e) {
    return e;
  }
}
async function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "pool-"));
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@t");
  await git(dir, "config", "user.name", "t");
  writeFileSync(path.join(dir, "a.txt"), "hello\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-qm", "init");
  return dir;
}
const scope = [];
function track(d) { scope.push(d); return d; }
after(() => { for (const d of scope) rmSync(d, { recursive: true, force: true }); });

describe("lifecycle-pool", () => {
  it("pool bound and backpressure: second lease refused at max=1", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "slice-1", "--max", "1", "--branch", "feat/a", "--worktree", path.join(pool, "wt-a")]);
    const e = await cliFail(["lease", "--pool", pool, "--repo", repo, "--owner", "slice-2", "--max", "1", "--branch", "feat/b", "--worktree", path.join(pool, "wt-b")]);
    assert.match(`${e.stdout ?? ""}${e.stderr ?? ""}`, /pool exhausted/i);
    await cliOk(["release", "--pool", pool, "--owner", "slice-1"]);
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "slice-2", "--max", "1", "--branch", "feat/b", "--worktree", path.join(pool, "wt-b")]);
    const st = JSON.parse((await cliOk(["status", "--pool", pool])).stdout);
    assert.equal(st.active, 1);
    assert.equal(st.leases.find((l) => l.owner === "slice-2").stale, false);
  });

  it("crash/stale lease recovery: dead pid lease is reclaimed", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const wtPath = path.join(pool, "wt-dead");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "dead-slice", "--max", "1", "--branch", "feat/dead", "--worktree", wtPath]);
    // Make the branch integrated so only staleness remains as a question.
    writeFileSync(path.join(wtPath, "b.txt"), "x\n");
    await git(wtPath, "add", "-A");
    await git(wtPath, "commit", "-qm", "work");
    await git(repo, "merge", "-q", "--no-ff", "feat/dead", "-m", "merge");
    // Rewrite lease with a pid that cannot exist and an old timestamp.
    const leaseFile = path.join(pool, "leases", "dead-slice.json");
    const txt = readFileSync(leaseFile, "utf8");
    writeFileSync(leaseFile, txt.replace(/"pid":\d+/, '"pid":2147483647').replace(/"ts":[^,]+/, '"ts":1'));
    const out = await cliOk(["reclaim", "--pool", pool, "--dry-run"]);
    assert.match(out.stdout, /stale/);
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "new-slice", "--max", "1", "--branch", "feat/new", "--worktree", path.join(pool, "wt-new")]);
    const st = JSON.parse((await cliOk(["status", "--pool", pool])).stdout);
    assert.equal(st.leases.length, 1);
    assert.equal(st.leases[0].owner, "new-slice");
  });

  it("dirty/unmerged worktree refusal; integrated removal keeps branch", async () => {
    const base = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const wtPath = path.join(pool, "wt-dirty");
    await cliOk(["lease", "--pool", pool, "--repo", base, "--owner", "dirty-slice", "--max", "2", "--branch", "feat/dirty", "--worktree", wtPath]);
    // Dirty it
    writeFileSync(path.join(wtPath, "a.txt"), "changed\n");
    let e = await cliFail(["reclaim", "--pool", pool]);
    assert.match(`${e.stdout ?? ""}${e.stderr ?? ""}`, /dirty/i);
    await git(wtPath, "checkout", "--", ".");
    // Unmerged branch: commit on feat/dirty not in main
    writeFileSync(path.join(wtPath, "b.txt"), "x\n");
    await git(wtPath, "add", "-A");
    await git(wtPath, "commit", "-qm", "work");
    e = await cliFail(["reclaim", "--pool", pool]);
    assert.match(`${e.stdout ?? ""}${e.stderr ?? ""}`, /unmerged/i);
    // Merge into main, release, then reclaim succeeds and branch survives
    await git(base, "merge", "-q", "--no-ff", "feat/dirty", "-m", "merge");
    await cliOk(["release", "--pool", pool, "--owner", "dirty-slice"]);
    await cliOk(["reclaim", "--pool", pool]);
    assert.equal(existsSync(wtPath), false);
    const branches = await git(base, "branch", "--format=%(refname:short)");
    assert.match(branches, /feat\/dirty/);
  });

  it("in-use lease refusal: alive pid, clean and merged, still refused", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const wtPath = path.join(pool, "wt-live");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "live-slice", "--max", "2", "--branch", "feat/live", "--worktree", wtPath, "--pid", String(process.pid)]);
    writeFileSync(path.join(wtPath, "b.txt"), "x\n");
    await git(wtPath, "add", "-A");
    await git(wtPath, "commit", "-qm", "work");
    await git(repo, "merge", "-q", "--no-ff", "feat/live", "-m", "merge");
    const e = await cliFail(["reclaim", "--pool", pool]);
    assert.match(`${e.stdout ?? ""}${e.stderr ?? ""}`, /in-use/i);
    await cliOk(["release", "--pool", pool, "--owner", "live-slice"]);
    await cliOk(["reclaim", "--pool", pool]);
    assert.equal(existsSync(wtPath), false);
  });

  it("locked worktree refusal", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const wtPath = path.join(pool, "wt-locked");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "lock-slice", "--max", "2", "--branch", "feat/locked", "--worktree", wtPath]);
    // merge branch first so only lock blocks
    writeFileSync(path.join(wtPath, "b.txt"), "x\n");
    await git(wtPath, "add", "-A");
    await git(wtPath, "commit", "-qm", "work");
    await git(repo, "merge", "-q", "--no-ff", "feat/locked", "-m", "merge");
    await git(repo, "worktree", "lock", wtPath);
    const e = await cliFail(["reclaim", "--pool", pool]);
    assert.match(`${e.stdout ?? ""}${e.stderr ?? ""}`, /locked/i);
    await git(repo, "worktree", "unlock", wtPath);
    await cliOk(["release", "--pool", pool, "--owner", "lock-slice"]);
    await cliOk(["reclaim", "--pool", pool]);
    assert.equal(existsSync(wtPath), false);
  });

  it("artifact cleanup keeps caches and failed-run logs; dry-run exactness", async () => {
    const dir = track(mkdtempSync(path.join(tmpdir(), "art-")));
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    mkdirSync(path.join(dir, "target", "debug"), { recursive: true });
    writeFileSync(path.join(dir, "target", "debug", "x"), "blob");
    mkdirSync(path.join(dir, "__pycache__"), { recursive: true });
    writeFileSync(path.join(dir, "__pycache__", "m.pyc"), "pyc");
    mkdirSync(path.join(dir, "node_modules"), { recursive: true });
    writeFileSync(path.join(dir, "node_modules", "keep.js"), "keep");
    mkdirSync(path.join(dir, "userTarget"), { recursive: true });
    writeFileSync(path.join(dir, "userTarget", "mine.txt"), "user");
    const dry = await cliOk(["clean-artifacts", "--pool", pool, "--root", dir, "--owner", "slice-1", "--dry-run"]);
    assert.match(dry.stdout, /target/);
    assert.match(dry.stdout, /__pycache__/);
    assert.doesNotMatch(dry.stdout, /node_modules/);
    assert.doesNotMatch(dry.stdout, /userTarget/);
    const real = await cliOk(["clean-artifacts", "--pool", pool, "--root", dir, "--owner", "slice-1"]);
    assert.equal(existsSync(path.join(dir, "target")), false);
    assert.equal(existsSync(path.join(dir, "node_modules", "keep.js")), true);
    assert.equal(existsSync(path.join(dir, "userTarget", "mine.txt")), true);
    // Failed-run diagnostics retained within TTL
    mkdirSync(path.join(dir, ".pytest_cache"), { recursive: true });
    writeFileSync(path.join(dir, ".pytest_cache", "log.txt"), "failed-log");
    const failedKeep = await cliOk(["clean-artifacts", "--pool", pool, "--root", dir, "--owner", "slice-2", "--status", "failed", "--ttl-hours", "24"]);
    assert.match(failedKeep.stdout, /retained/);
    assert.equal(existsSync(path.join(dir, ".pytest_cache")), true);
  });

  it("symlink/containment refusal", async () => {
    const dir = track(mkdtempSync(path.join(tmpdir(), "art-")));
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const outside = track(mkdtempSync(path.join(tmpdir(), "outside-")));
    writeFileSync(path.join(outside, "precious.txt"), "do not delete");
    mkdirSync(path.join(dir, "real"), { recursive: true });
    symlinkSync(outside, path.join(dir, "target"), "dir");
    const e = await cliFail(["clean-artifacts", "--pool", pool, "--root", dir, "--owner", "slice-1"]);
    assert.match(`${e.stdout ?? ""}${e.stderr ?? ""}`, /symlink/i);
    assert.equal(existsSync(path.join(outside, "precious.txt")), true);
    // Explicit root escape refused
    const e2 = await cliFail(["clean-artifacts", "--pool", pool, "--root", path.join(outside, "..", "etc"), "--owner", "slice-1", "--registry", path.join(dir, "reg.json")]);
    assert.ok(e2.status !== 0);
  });

  it("parallel leases: two concurrent processes, exactly one wins", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const p = (owner, wt) => cli(["lease", "--pool", pool, "--repo", repo, "--owner", owner, "--max", "1", "--branch", `feat/${owner}`, "--worktree", path.join(pool, wt)]);
    const results = await Promise.allSettled([p("slice-A", "wt-A"), p("slice-B", "wt-B")]);
    const ok = results.filter((r) => r.status === "fulfilled");
    assert.equal(ok.length, 1, JSON.stringify(results.map((r) => r.status)));
    const st = JSON.parse((await cliOk(["status", "--pool", pool])).stdout);
    assert.equal(st.active, 1);
  });

  it("disk accounting and audit log record bytes reclaimed", async () => {
    const dir = track(mkdtempSync(path.join(tmpdir(), "art-")));
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    mkdirSync(path.join(dir, "target"), { recursive: true });
    writeFileSync(path.join(dir, "target", "big"), Buffer.alloc(1024, 65));
    const out = await cliOk(["clean-artifacts", "--pool", pool, "--root", dir, "--owner", "slice-9"]);
    const summary = JSON.parse(out.stdout);
    assert.equal(summary.owner, "slice-9");
    assert.ok(summary.reclaimedBytes >= 1024, JSON.stringify(summary));
    const status = JSON.parse((await cliOk(["status", "--pool", pool])).stdout);
    assert.ok(status.totalReclaimedBytes >= 1024);
    const audit = readFileSync(path.join(pool, "audit.jsonl"), "utf8");
    assert.match(audit, /slice-9/);
    assert.match(audit, /reclaimedBytes/);
  });
});
