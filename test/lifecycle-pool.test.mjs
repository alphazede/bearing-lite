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
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const dir = path.join(pool, "wt-clean");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "slice-1", "--max", "2", "--branch", "feat/clean", "--worktree", dir]);
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
    // Failed-run diagnostics retained within TTL (slice-2 has its own lease).
    const dir2 = path.join(pool, "wt-clean2");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "slice-2", "--max", "2", "--branch", "feat/clean2", "--worktree", dir2]);
    mkdirSync(path.join(dir2, ".pytest_cache"), { recursive: true });
    writeFileSync(path.join(dir2, ".pytest_cache", "log.txt"), "failed-log");
    const failedKeep = await cliOk(["clean-artifacts", "--pool", pool, "--root", dir2, "--owner", "slice-2", "--status", "failed", "--ttl-hours", "24"]);
    assert.match(failedKeep.stdout, /retained/);
    assert.equal(existsSync(path.join(dir2, ".pytest_cache")), true);
  });

  it("symlink/containment refusal", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const dir = path.join(pool, "wt-sym");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "slice-1", "--max", "2", "--branch", "feat/sym", "--worktree", dir]);
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
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const dir = path.join(pool, "wt-acct");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "slice-9", "--max", "2", "--branch", "feat/acct", "--worktree", dir]);
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
  it("233-01 ownership: empty pool and unrelated owners cannot clean; caches preserved", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const outside = track(mkdtempSync(path.join(tmpdir(), "outside-")));
    mkdirSync(path.join(outside, "target"), { recursive: true });
    writeFileSync(path.join(outside, "target", "authored.txt"), "user data");
    // Empty pool: reviewer repro — unrelated owner must be refused.
    let e = await cliFail(["clean-artifacts", "--pool", pool, "--root", outside, "--owner", "unrelated-owner"]);
    assert.match(`${e.stdout ?? ""}${e.stderr ?? ""}`, /ownership/i);
    assert.equal(existsSync(path.join(outside, "target", "authored.txt")), true);
    // Owned root: incremental caches survive selective cleanup.
    const wt = path.join(pool, "wt-own");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "owner-A", "--max", "2", "--branch", "feat/own", "--worktree", wt]);
    mkdirSync(path.join(wt, "target", "debug", "incremental"), { recursive: true });
    writeFileSync(path.join(wt, "target", "debug", "incremental", "keep"), "cache");
    writeFileSync(path.join(wt, "target", "debug", "obj"), "blob");
    const out = await cliOk(["clean-artifacts", "--pool", pool, "--root", wt, "--owner", "owner-A"]);
    assert.equal(existsSync(path.join(wt, "target", "debug", "obj")), false);
    assert.equal(existsSync(path.join(wt, "target", "debug", "incremental", "keep")), true);
    // Unrelated owner against the owned root is refused too.
    e = await cliFail(["clean-artifacts", "--pool", pool, "--root", wt, "--owner", "owner-B"]);
    assert.match(`${e.stdout ?? ""}${e.stderr ?? ""}`, /ownership/i);
    // Explicit eviction removes the preserved cache.
    await cliOk(["clean-artifacts", "--pool", pool, "--root", wt, "--owner", "owner-A", "--evict-caches"]);
    assert.equal(existsSync(path.join(wt, "target")), false);
  });

  it("233-02 symlinked parent and nested symlink cannot escape the root", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const outside = track(mkdtempSync(path.join(tmpdir(), "outside-")));
    mkdirSync(path.join(outside, "target"), { recursive: true });
    writeFileSync(path.join(outside, "target", "precious.txt"), "do not delete");
    const wt = path.join(pool, "wt-link");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "s1", "--max", "2", "--branch", "feat/link", "--worktree", wt]);
    symlinkSync(outside, path.join(wt, "linked"), "dir");
    const e = await cliFail(["clean-artifacts", "--pool", pool, "--root", wt, "--owner", "s1", "--extra", "linked/target"]);
    assert.match(`${e.stdout ?? ""}${e.stderr ?? ""}`, /containment|symlink/i);
    assert.equal(existsSync(path.join(outside, "target", "precious.txt")), true);
    // Nested symlink inside a cleaned dir is unlinked as a link, never followed.
    mkdirSync(path.join(wt, "target"), { recursive: true });
    writeFileSync(path.join(wt, "target", "x"), "blob");
    symlinkSync(path.join(outside, "target", "precious.txt"), path.join(wt, "target", "link"));
    await cliOk(["clean-artifacts", "--pool", pool, "--root", wt, "--owner", "s1"]);
    assert.equal(existsSync(path.join(outside, "target", "precious.txt")), true);
    assert.equal(existsSync(path.join(wt, "target")), false);
  });

  it("233-03 live lease with old timestamp is never reclaimed on age alone", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const wt = path.join(pool, "wt-live-old");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "live", "--max", "2", "--branch", "feat/live-old", "--worktree", wt, "--pid", String(process.pid)]);
    writeFileSync(path.join(wt, "b.txt"), "x\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-qm", "work");
    await git(repo, "merge", "-q", "--no-ff", "feat/live-old", "-m", "merge");
    const f = path.join(pool, "leases", "live.json");
    writeFileSync(f, readFileSync(f, "utf8").replace(/"ts":[^,]+/, `"ts":${Date.now() - 8 * 24 * 3600 * 1000}`));
    const e = await cliFail(["reclaim", "--pool", pool]);
    assert.match(`${e.stdout ?? ""}${e.stderr ?? ""}`, /in-use/i);
    assert.equal(existsSync(wt), true);
  });

  it("233-04 stale record with live worktree is retained until reclamation succeeds", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const wt = path.join(pool, "wt-stale");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "old-owner", "--max", "3", "--branch", "feat/stale", "--worktree", wt]);
    writeFileSync(path.join(wt, "a.txt"), "dirty\n");
    const f = path.join(pool, "leases", "old-owner.json");
    writeFileSync(f, readFileSync(f, "utf8").replace(/"pid":\d+/, '"pid":2147483647'));
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "new-owner", "--max", "3", "--branch", "feat/new2", "--worktree", path.join(pool, "wt-new2")]);
    const st = JSON.parse((await cliOk(["status", "--pool", pool])).stdout);
    assert.equal(st.leases.some((l) => l.owner === "old-owner"), true);
    assert.equal(existsSync(wt), true);
    // Once safe, the retained record is reclaimed normally.
    await git(wt, "checkout", "--", ".");
    writeFileSync(path.join(wt, "b.txt"), "x\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-qm", "work");
    await git(repo, "merge", "-q", "--no-ff", "feat/stale", "-m", "merge");
    await cliOk(["release", "--pool", pool, "--owner", "new-owner"]);
    await cliOk(["reclaim", "--pool", pool]);
    assert.equal(existsSync(wt), false);
  });

  it("233-05 reclamation verifies actual HEAD, not the recorded branch", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const wt = path.join(pool, "wt-drift");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "drift", "--max", "2", "--branch", "feat/drift", "--worktree", wt]);
    await git(wt, "checkout", "-qb", "feat/other");
    writeFileSync(path.join(wt, "c.txt"), "unmerged\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-qm", "other-work");
    await cliOk(["release", "--pool", pool, "--owner", "drift"]);
    const e = await cliFail(["reclaim", "--pool", pool]);
    assert.match(`${e.stdout ?? ""}${e.stderr ?? ""}`, /drift|unmerged/i);
    assert.equal(existsSync(wt), true);
  });

  it("233-06 re-lease resolves the existing record without a second worktree", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const wt = path.join(pool, "wt-reacq");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "same", "--max", "1", "--branch", "feat/re", "--worktree", wt]);
    await cliOk(["release", "--pool", pool, "--owner", "same", "--no-reclaim"]);
    const before = (await git(repo, "worktree", "list", "--porcelain")).split("\n").filter((l) => l.startsWith("worktree ")).length;
    const out = await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "same", "--max", "1", "--branch", "feat/re", "--worktree", wt]);
    assert.match(out.stdout, new RegExp(wt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const after = (await git(repo, "worktree", "list", "--porcelain")).split("\n").filter((l) => l.startsWith("worktree ")).length;
    assert.equal(after, before);
    const st = JSON.parse((await cliOk(["status", "--pool", pool])).stdout);
    assert.equal(st.leases.find((l) => l.owner === "same").released, false);
  });

  it("233-07 abandoned lock is recovered; live lock still excludes", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const lockDir = path.join(pool, ".lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(path.join(lockDir, "holder.json"), JSON.stringify({ pid: 2147483647, ts: Date.now() }));
    await cliOk(["reclaim", "--pool", pool, "--dry-run"]);
    // Live holder: reclaim must time out instead of stealing the lock.
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(path.join(lockDir, "holder.json"), JSON.stringify({ pid: process.pid, ts: Date.now() }));
    const e = await cliFail(["reclaim", "--pool", pool, "--dry-run"]);
    assert.match(`${e.stdout ?? ""}${e.stderr ?? ""}`, /lock timeout/i);
    rmSync(lockDir, { recursive: true, force: true });
  });

  it("233-08 plan is validated before mutation; nothing deleted on refusal", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const outside = track(mkdtempSync(path.join(tmpdir(), "outside-")));
    const wt = path.join(pool, "wt-plan");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "s1", "--max", "2", "--branch", "feat/plan", "--worktree", wt]);
    mkdirSync(path.join(wt, "target"), { recursive: true });
    writeFileSync(path.join(wt, "target", "x"), "blob");
    symlinkSync(outside, path.join(wt, "__pycache__"), "dir");
    const auditBefore = existsSync(path.join(pool, "audit.jsonl")) ? readFileSync(path.join(pool, "audit.jsonl"), "utf8") : "";
    const e = await cliFail(["clean-artifacts", "--pool", pool, "--root", wt, "--owner", "s1"]);
    assert.match(`${e.stdout ?? ""}${e.stderr ?? ""}`, /symlink/i);
    assert.equal(existsSync(path.join(wt, "target", "x")), true);
    const auditAfter = existsSync(path.join(pool, "audit.jsonl")) ? readFileSync(path.join(pool, "audit.jsonl"), "utf8") : "";
    assert.equal(auditAfter, auditBefore);
  });

  it("233-09 nested Python outputs are discovered and cleaned", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const wt = path.join(pool, "wt-nest");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "s1", "--max", "2", "--branch", "feat/nest", "--worktree", wt]);
    mkdirSync(path.join(wt, "src", "__pycache__"), { recursive: true });
    writeFileSync(path.join(wt, "src", "__pycache__", "x.pyc"), "pyc");
    const out = await cliOk(["clean-artifacts", "--pool", pool, "--root", wt, "--owner", "s1"]);
    assert.equal(existsSync(path.join(wt, "src", "__pycache__")), false);
    const summary = JSON.parse(out.stdout);
    assert.ok(summary.removed.some((p) => p.endsWith("__pycache__")));
  });

  it("acceptance: repeated lease/release cycles with max 1 leave no worktrees", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    for (let i = 0; i < 3; i++) {
      await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", `cycle-${i}`, "--max", "1", "--branch", `feat/cycle-${i}`, "--worktree", path.join(pool, `wt-cycle-${i}`)]);
      await cliOk(["release", "--pool", pool, "--owner", `cycle-${i}`]);
    }
    const list = (await git(repo, "worktree", "list", "--porcelain")).split("\n").filter((l) => l.startsWith("worktree ")).length;
    assert.equal(list, 1); // main worktree only
  });

  it("acceptance: branch-first allocation without a worktree", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "seq", "--max", "1", "--branch", "feat/seq", "--branch-only"]);
    const branches = await git(repo, "branch", "--format=%(refname:short)");
    assert.match(branches, /feat\/seq/);
    const st = JSON.parse((await cliOk(["status", "--pool", pool])).stdout);
    assert.equal(st.leases[0].worktree, null);
    assert.equal(st.active, 0);
    await cliOk(["release", "--pool", pool, "--owner", "seq"]);
    const st2 = JSON.parse((await cliOk(["status", "--pool", pool])).stdout);
    assert.equal(st2.leases.length, 0);
    assert.match(await git(repo, "branch", "--format=%(refname:short)"), /feat\/seq/);
  });

  it("acceptance: scan inventories orphans and adopt + recover reclaims them", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const orphanWt = path.join(pool, "wt-orphan");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "tmp", "--max", "3", "--branch", "feat/tmp", "--worktree", orphanWt]);
    await cliOk(["release", "--pool", pool, "--owner", "tmp", "--no-reclaim"]);
    // Simulate pre-existing worktree with no lease record.
    rmSync(path.join(pool, "leases", "tmp.json"), { force: true });
    writeFileSync(path.join(orphanWt, "b.txt"), "x\n");
    await git(orphanWt, "add", "-A");
    await git(orphanWt, "commit", "-qm", "work");
    await git(repo, "merge", "-q", "--no-ff", "feat/tmp", "-m", "merge");
    const dry = JSON.parse((await cliOk(["scan", "--pool", pool, "--repo", repo, "--dry-run", "--adopt"])).stdout);
    assert.equal(dry.orphans.length, 1);
    assert.equal(dry.adopted.length, 1);
    const st0 = JSON.parse((await cliOk(["status", "--pool", pool])).stdout);
    assert.equal(st0.leases.length, 0);
    await cliOk(["scan", "--pool", pool, "--repo", repo, "--adopt"]);
    await cliOk(["recover", "--pool", pool, "--repo", repo]);
    assert.equal(existsSync(orphanWt), false);
  });

  it("acceptance: disk threshold and priority pick victims in order", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const sizes = { big: 12000, mid: 6000, small: 2000 };
    for (const [name, size] of Object.entries(sizes)) {
      const wt = path.join(pool, `wt-${name}`);
      await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", name, "--max", "4", "--branch", `feat/${name}`, "--worktree", wt]);
      writeFileSync(path.join(wt, "blob"), Buffer.alloc(size, 65));
      await git(wt, "add", "-A");
      await git(wt, "commit", "-qm", "work");
      await git(repo, "merge", "-q", "--no-ff", `feat/${name}`, "-m", "merge");
    }
    for (const name of Object.keys(sizes)) {
      const f = path.join(pool, "leases", `${name}.json`);
      writeFileSync(f, readFileSync(f, "utf8").replace(/"pid":\d+/, '"pid":2147483647'));
    }
    const st = JSON.parse((await cliOk(["status", "--pool", pool])).stdout);
    const total = st.totalWorktreeBytes;
    const biggest = Math.max(...st.leases.map((l) => l.bytes));
    writeFileSync(path.join(pool, "config.json"), JSON.stringify({ maxTotalBytes: total - biggest, priority: "largest" }));
    const out = JSON.parse((await cliOk(["reclaim", "--pool", pool])).stdout);
    const removed = out.results.filter((r) => r.action === "removed").map((r) => r.owner);
    const skipped = out.results.filter((r) => r.action === "skipped").map((r) => r.owner);
    const biggestOwner = st.leases.find((l) => l.bytes === biggest).owner;
    assert.deepEqual(removed, [biggestOwner]);
    assert.equal(skipped.length, 2);
  });

  it("acceptance: register records project outputs; unregistered files preserved", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const wt = path.join(pool, "wt-reg");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "s1", "--max", "2", "--branch", "feat/reg", "--worktree", wt]);
    mkdirSync(path.join(wt, "build-output"), { recursive: true });
    writeFileSync(path.join(wt, "build-output", "o"), "blob");
    mkdirSync(path.join(wt, "other-output"), { recursive: true });
    writeFileSync(path.join(wt, "other-output", "keep"), "keep");
    await cliOk(["register", "--pool", pool, "--owner", "s1", "--root", wt, "--path", "build-output"]);
    await cliOk(["clean-artifacts", "--pool", pool, "--root", wt, "--owner", "s1"]);
    assert.equal(existsSync(path.join(wt, "build-output")), false);
    assert.equal(existsSync(path.join(wt, "other-output", "keep")), true);
  });

  it("measured: reclaimed bytes equal freed bytes; rebuild is one checkout", async () => {
    const repo = track(await makeRepo());
    const pool = track(mkdtempSync(path.join(tmpdir(), "poolstate-")));
    const wt = path.join(pool, "wt-meas");
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "m", "--max", "2", "--branch", "feat/meas", "--worktree", wt]);
    writeFileSync(path.join(wt, "blob"), Buffer.alloc(8192, 66));
    await git(wt, "add", "-A");
    await git(wt, "commit", "-qm", "work");
    await git(repo, "merge", "-q", "--no-ff", "feat/meas", "-m", "merge");
    const before = JSON.parse((await cliOk(["status", "--pool", pool])).stdout).leases[0].bytes;
    assert.ok(before > 8192);
    await cliOk(["release", "--pool", pool, "--owner", "m", "--no-reclaim"]);
    const rec = JSON.parse((await cliOk(["reclaim", "--pool", pool])).stdout);
    const freed = rec.results[0].reclaimedBytes;
    assert.equal(freed, before);
    const t0 = Date.now();
    await cliOk(["lease", "--pool", pool, "--repo", repo, "--owner", "m2", "--max", "2", "--branch", "feat/meas2", "--worktree", path.join(pool, "wt-meas2")]);
    const rebuildMs = Date.now() - t0;
    console.log(`MEASURED worktreeBytes=${before} reclaimedBytes=${freed} rebuildMs=${rebuildMs}`);
    assert.ok(rebuildMs < 30000);
  });

});
