#!/usr/bin/env node
/**
 * Storage-aware worktree pooling and test artifact cleanup (issue #233).
 *
 *   node tools/lifecycle-pool.mjs <command> [options]
 *
 * Commands:
 *   lease  --pool P --repo R --owner O --branch B --worktree W [--max N] [--pid N]
 *   release --pool P --owner O
 *   reclaim --pool P [--dry-run]
 *   clean-artifacts --pool P --root R --owner O [--status success|failed] [--ttl-hours N]
 *                    [--extra a,b,c] [--registry file.json] [--dry-run]
 *   status --pool P
 *
 * Leases are files P/leases/<owner>.json:
 * {owner, pid, ts, repo, worktree, branch, released}.
 * `released` marks owner handoff; released leases stay on disk until reclaimed.
 * A lease whose pid is dead (ESRCH) or older than 7 days is stale. Only
 * released or stale leases can be reclaimed; an active lease is in-use.
 * Audit lines append to P/audit.jsonl. No daemons, no dependencies.
 *
 * Safety: never `worktree remove --force`; refuse dirty/unmerged/locked/in-use;
 * refuse symlink candidates; canonical containment of every path before deletion;
 * only exact disposable names are removed (caches like node_modules, venvs, and
 * user files with similar names are never touched).
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_MAX = 4;
const DEFAULT_TTL_HOURS = 24;
const STALE_MS = 7 * 24 * 3600 * 1000;
const DISPOSABLE = ["target", "__pycache__", ".pytest_cache", ".coverage", "htmlcov", ".ruff_cache", ".mypy_cache", ".hypothesis"];

/** Error up to the top handler so locks are always released. */
class ExitErr extends Error { constructor(msg, code = 1) { super(msg); this.code = code; } }
function fail(msg, code = 1) { throw new ExitErr(msg, code); }
function json(o) { console.log(JSON.stringify(o)); }

const args = process.argv.slice(2);
const cmd = args[0];
const opts = {};
for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith("--")) opts[a.slice(2)] = args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[++i] : true;
}
let pool = null;

function git(cwd, ...a) { return spawnSync("git", a, { cwd, encoding: "utf8" }); }
function gitOk(cwd, ...a) {
  const r = git(cwd, ...a);
  if (r.status !== 0) fail(`git ${a.join(" ")} failed: ${(r.stderr || "").trim()}`);
  return (r.stdout || "").trim();
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; }
}
function leases() {
  const dir = path.join(pool, "leases");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
}
function leasePath(owner) { return path.join(pool, "leases", `${String(owner).replace(/[^\w.-]+/g, "_")}.json`); }
function isStale(l) { return l.released ? false : (!pidAlive(l.pid) || Date.now() - l.ts > STALE_MS); }
function isActive(l) { return !l.released && !isStale(l); }
function audit(line) { appendFileSync(path.join(pool, "audit.jsonl"), `${JSON.stringify({ ts: Date.now(), ...line })}\n`); }
function totalReclaimed() {
  const f = path.join(pool, "audit.jsonl");
  if (!existsSync(f)) return 0;
  return readFileSync(f, "utf8").split("\n").filter(Boolean).reduce((s, l) => s + (JSON.parse(l).reclaimedBytes || 0), 0);
}
function dirBytes(root) {
  let total = 0;
  (function walk(d) {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      try {
        if (e.isSymbolicLink()) total += lstatSync(p).size;
        else if (e.isDirectory()) walk(p);
        else total += lstatSync(p).size;
      } catch { /* race: ignore */ }
    }
  })(root);
  return total;
}
function within(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}
function isLocked(worktree) {
  try {
    const gitFile = readFileSync(path.join(worktree, ".git"), "utf8").trim();
    if (gitFile.startsWith("gitdir:")) {
      const gd = gitFile.slice(7).trim();
      const abs = path.isAbsolute(gd) ? gd : path.resolve(worktree, gd);
      if (existsSync(path.join(abs, "locked"))) return true;
    }
  } catch { /* not a linked worktree */ }
  const repo = leases().find((l) => l.worktree === worktree)?.repo;
  if (repo) {
    const r = git(repo, "worktree", "list", "--porcelain");
    if (r.status === 0) {
      for (const section of r.stdout.split("\n\n")) {
        const lines = section.split("\n");
        if (lines.some((l) => l === `worktree ${worktree}`) && lines.some((l) => l.startsWith("locked"))) return true;
      }
    }
  }
  return false;
}
function withLock(fn) {
  const lockDir = path.join(pool, ".lock");
  let got = false;
  for (let i = 0; i < 200 && !got; i++) {
    try { mkdirSync(lockDir); got = true; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (!got) fail("pool lock timeout", 2);
  try { return fn(); } finally { rmdirSync(lockDir); }
}

function reclaimOne(l, dry) {
  const { owner, worktree, repo } = l;
  if (!existsSync(worktree)) {
    if (!dry) rmSync(leasePath(owner), { force: true });
    return { owner, worktree, action: "pruned", reason: "missing", reclaimedBytes: 0 };
  }
  if (isLocked(worktree)) return { owner, worktree, action: "refused", reason: "locked", reclaimedBytes: 0 };
  const st = git(worktree, "status", "--porcelain");
  if (st.status === 0 && st.stdout.trim() !== "") return { owner, worktree, action: "refused", reason: "dirty", reclaimedBytes: 0 };
  const merged = git(repo, "merge-base", "--is-ancestor", l.branch, "HEAD").status === 0;
  if (!merged) return { owner, worktree, action: "refused", reason: "unmerged", reclaimedBytes: 0 };
  if (isActive(l)) return { owner, worktree, action: "refused", reason: "in-use", reclaimedBytes: 0 };
  const bytes = dirBytes(worktree);
  if (!dry) {
    gitOk(repo, "worktree", "remove", worktree); // never --force
    rmSync(leasePath(owner), { force: true });
    git(repo, "worktree", "prune");
  }
  return { owner, worktree, action: "removed", reason: isStale(l) ? "stale" : "integrated", reclaimedBytes: bytes };
}

try {
  if (!cmd || !["lease", "release", "reclaim", "clean-artifacts", "status"].includes(cmd))
    fail("usage: node tools/lifecycle-pool.mjs <lease|release|reclaim|clean-artifacts|status> [options]");
  pool = opts.pool ? path.resolve(opts.pool) : null;
  if (cmd !== "reclaim" && !pool) fail("--pool is required");
  if (pool) mkdirSync(path.join(pool, "leases"), { recursive: true });
  if (cmd === "lease") {
    const { repo, owner, branch, worktree } = opts;
    if (!repo || !owner || !branch || !worktree) fail("lease requires --repo --owner --branch --worktree");
    const max = Number(opts.max || DEFAULT_MAX);
    const pid = opts.pid ? Number(opts.pid) : process.ppid;
    const wt = path.resolve(worktree);
    withLock(() => {
      for (const l of leases()) if (isStale(l)) rmSync(leasePath(l.owner), { force: true });
      const all = leases();
      const existing = all.find((l) => l.owner === owner && !l.released);
      if (existing) { json({ owner, worktree: existing.worktree, active: all.filter((l) => !l.released).length }); return; }
      const active = all.filter((l) => !l.released);
      if (active.length >= max) fail(`pool exhausted: ${active.length}/${max} leases active`, 2);
      const exists = git(repo, "show-ref", "--verify", `refs/heads/${branch}`).status === 0;
      if (exists) gitOk(repo, "worktree", "add", wt, branch);
      else gitOk(repo, "worktree", "add", "-b", branch, wt);
      writeFileSync(leasePath(owner), JSON.stringify({ owner, pid, ts: Date.now(), repo: path.resolve(repo), worktree: wt, branch, released: false }), { flag: "wx" });
      audit({ owner, action: "lease", worktree: wt, reclaimedBytes: 0 });
      json({ owner, worktree: wt, branch, active: active.length + 1 });
    });
  } else if (cmd === "release") {
    const { owner } = opts;
    if (!owner) fail("release requires --owner");
    const f = leasePath(owner);
    if (!existsSync(f)) fail(`no lease for owner ${owner}`);
    const l = JSON.parse(readFileSync(f, "utf8"));
    l.released = true;
    writeFileSync(f, JSON.stringify(l));
    audit({ owner, action: "release", reclaimedBytes: 0 });
    json({ owner, released: true });
  } else if (cmd === "reclaim") {
    const dry = Boolean(opts["dry-run"]);
    const results = [];
    withLock(() => { for (const l of leases()) results.push(reclaimOne(l, dry)); });
    if (dry) { for (const r of results) console.log(`${r.action}: ${r.worktree} (${r.reason}) reclaimedBytes=${r.reclaimedBytes}`); }
    else {
      for (const r of results) audit({ owner: r.owner, action: "reclaim", worktree: r.worktree, reclaimedBytes: r.reclaimedBytes, result: r.action });
      json({ results, totalReclaimedBytes: totalReclaimed() });
      if (results.some((r) => r.action === "refused")) process.exit(1);
    }
  } else if (cmd === "clean-artifacts") {
    const { root, owner } = opts;
    if (!root || !owner) fail("clean-artifacts requires --pool --root --owner");
    const dry = Boolean(opts["dry-run"]);
    const status = opts.status || "success";
    if (status !== "success" && status !== "failed") fail("--status must be success or failed");
    const ttlMs = Number(opts["ttl-hours"] || DEFAULT_TTL_HOURS) * 3600 * 1000;
    if (!existsSync(root)) fail(`root does not exist: ${root}`);
    const rootReal = realpathSync(path.resolve(root));
    if (rootReal === path.parse(rootReal).root) fail("refusing filesystem root");
    let names = [...DISPOSABLE];
    if (process.env.CARGO_TARGET_DIR) {
      const rel = path.relative(rootReal, path.resolve(process.env.CARGO_TARGET_DIR));
      if (rel && !rel.includes(path.sep) && within(path.resolve(process.env.CARGO_TARGET_DIR), rootReal)) names.push(rel);
    }
    if (opts.extra) names.push(...String(opts.extra).split(",").map((s) => s.trim()).filter(Boolean));
    if (opts.registry) {
      const reg = JSON.parse(readFileSync(path.resolve(opts.registry), "utf8"));
      names = Array.isArray(reg) ? reg.map(String) : [...(reg.extra || [])];
    }
    names = [...new Set(names)];
    const removed = [], retained = [];
    let reclaimed = 0;
    let symlinkHit = null;
    for (const name of names) {
      if (name.includes("..") || path.isAbsolute(name)) continue;
      const candidate = path.join(rootReal, name);
      if (!within(candidate, rootReal) || candidate === rootReal) fail(`containment refusal: ${candidate}`);
      if (!existsSync(candidate)) continue;
      let st;
      try { st = lstatSync(candidate); } catch { continue; }
      if (st.isSymbolicLink()) { symlinkHit = candidate; continue; }
      if (status === "failed") {
        let newest = st.mtimeMs;
        (function walkMax(d) {
          let entries;
          try { entries = readdirSync(d); } catch { return; }
          for (const e of entries) {
            const p = path.join(d, e);
            try { const s = lstatSync(p); if (s.isDirectory() && !s.isSymbolicLink()) walkMax(p); newest = Math.max(newest, s.mtimeMs); } catch { }
          }
        })(candidate);
        if (Date.now() - newest < ttlMs) { retained.push(candidate); continue; }
      }
      const bytes = st.isDirectory() ? dirBytes(candidate) : st.size;
      removed.push(candidate);
      if (dry) console.log(`would remove ${candidate}`);
      else { rmSync(candidate, { recursive: true, force: true }); reclaimed += bytes; }
    }
    if (symlinkHit) fail(`refusing symlink candidate: ${symlinkHit}`);
    if (dry) console.log(`dry-run: ${removed.length} paths, retained=${retained.length}`);
    else {
      audit({ owner, action: "clean-artifacts", reclaimedBytes: reclaimed, removed, retained });
      json({ owner, status, removed, retained, reclaimedBytes: reclaimed, totalReclaimedBytes: totalReclaimed() });
    }
  } else if (cmd === "status") {
    const map = leases().map((l) => ({ owner: l.owner, pid: l.pid, ts: l.ts, released: Boolean(l.released), worktree: l.worktree, branch: l.branch, stale: isStale(l), bytes: existsSync(l.worktree) ? dirBytes(l.worktree) : 0 }));
    json({ pool, active: map.filter((l) => !l.released && !l.stale).length, totalReclaimedBytes: totalReclaimed(), leases: map });
  } else fail(`unknown command: ${cmd}`);
} catch (e) {
  if (e instanceof ExitErr) { console.error(`lifecycle-pool: ${e.message}`); process.exit(e.code); }
  throw e;
}
