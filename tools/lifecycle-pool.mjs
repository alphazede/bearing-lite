#!/usr/bin/env node
/**
 * Storage-aware worktree pooling and test artifact cleanup (issue #233).
 *
 *   node <plugin root>/tools/lifecycle-pool.mjs <command> [options]
 *
 * Commands:
 *   lease  --pool P --repo R --owner O --branch B --worktree W [--max N] [--pid N]
 *          [--branch-only]
 *   release --pool P --owner O [--no-reclaim]
 *   reclaim --pool P [--dry-run] [--max-total-mb N] [--priority largest|oldest|newest]
 *   clean-artifacts --pool P --root R --owner O [--status success|failed] [--ttl-hours N]
 *                    [--extra a,b,c] [--registry file.json] [--evict-caches] [--dry-run]
 *   register --pool P --owner O --root R --path rel[,rel2]
 *   scan --pool P --repo R [--adopt] [--dry-run]
 *   recover --pool P [--repo R] [--dry-run]
 *   status --pool P
 *
 * Leases are files P/leases/<owner>.json:
 * {owner, pid, ts, repo, worktree, branch, released, branchOnly}.
 * A lease is stale only when its recorded pid is demonstrably dead; elapsed
 * age alone never makes a live lease reclaimable. A stale record whose
 * worktree still exists is retained until its safe reclamation succeeds.
 * Artifact cleanup requires a lease covering the root and deletes only
 * discovered or registered disposable outputs; unmanaged files and
 * reusable caches (incremental/deps fingerprints, shared CARGO_TARGET_DIR,
 * node_modules, venvs) are preserved unless --evict-caches is given.
 * Audit lines append to P/audit.jsonl. No daemons, no dependencies.
 *
 * Safety: never `worktree remove --force`; refuse dirty/unmerged/locked/
 * in-use/drifted; validate every path component with lstat before any
 * deletion and re-verify the chain immediately before each unlink/rmdir,
 * never following symlinks. The pool lock records its holder pid and is
 * recovered when that pid is dead.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_MAX = 4;
const DEFAULT_TTL_HOURS = 24;
const LOCK_STALE_MS = 10000;
const DISPOSABLE = ["target", "__pycache__", ".pytest_cache", ".coverage", "htmlcov", ".ruff_cache", ".mypy_cache", ".hypothesis"];
const PRESERVE_DIRS = ["node_modules", ".venv", "venv", ".git"];
const CACHE_SUBDIRS = ["incremental", "deps", ".fingerprint"];
const MAX_WALK_DEPTH = 8;

/** Error up to the top handler so locks are always released. */
class ExitErr extends Error { constructor(msg, code = 1) { super(msg); this.code = code; } }
function fail(msg, code = 1) { throw new ExitErr(msg, code); }
function json(o) { console.log(JSON.stringify(o)); }

const args = process.argv.slice(2);
const cmd = args[0];
const opts = {};
for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const val = args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[++i] : true;
    if (key in opts) opts[key] = [...[].concat(opts[key]), val];
    else opts[key] = val;
  }
}
let pool = null;

function git(cwd, ...a) { return spawnSync("git", a, { cwd, encoding: "utf8" }); }
function gitOk(cwd, ...a) {
  const r = git(cwd, ...a);
  if (r.status !== 0) fail(`git ${a.join(" ")} failed: ${(r.stderr || "").trim()}`);
  return (r.stdout || "").trim();
}
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; }
}
function leases() {
  const dir = path.join(pool, "leases");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
}
function leasePath(owner) { return path.join(pool, "leases", `${String(owner).replace(/[^\w.-]+/g, "_")}.json`); }
function isStale(l) { return !l.released && !pidAlive(l.pid); }
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
function realpathOrSelf(p) { try { return realpathSync(p); } catch { return path.resolve(p); } }
function isLocked(worktree) {
  if (!worktree) return false;
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
  const holderFile = path.join(lockDir, "holder.json");
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      mkdirSync(lockDir);
      try { writeFileSync(holderFile, JSON.stringify({ pid: process.pid, ts: Date.now() })); } catch { /* lock still held */ }
      try { return fn(); } finally { rmSync(lockDir, { recursive: true, force: true }); }
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    let holder = null;
    try { if (lstatSync(lockDir).isSymbolicLink()) rmSync(lockDir, { force: true }); } catch { continue; }
    try { holder = JSON.parse(readFileSync(holderFile, "utf8")); } catch { holder = null; }
    if (holder && !pidAlive(holder.pid)) { rmSync(lockDir, { recursive: true, force: true }); continue; }
    if (!holder) {
      try {
        if (Date.now() - lstatSync(lockDir).mtimeMs > LOCK_STALE_MS) { rmSync(lockDir, { recursive: true, force: true }); continue; }
      } catch { continue; }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  fail("pool lock timeout", 2);
}

/** Verify `abs` stays inside `rootReal` component by component (lstat, never realpath). */
function verifyChain(abs, rootReal, rootStat) {
  const rootNow = lstatSync(rootReal);
  if (rootNow.isSymbolicLink() || rootNow.dev !== rootStat.dev || rootNow.ino !== rootStat.ino)
    fail(`containment refusal: root changed during operation: ${rootReal}`);
  const rel = path.relative(rootReal, abs);
  if (rel === "") return;
  let cur = rootReal;
  for (const part of rel.split(path.sep)) {
    cur = path.join(cur, part);
    let st;
    try { st = lstatSync(cur); } catch { return; } // already gone
    if (st.isSymbolicLink()) fail(`containment refusal: symlinked path component: ${cur}`);
  }
}

/**
 * Recursively remove `abs` without following symlinks; returns freed bytes.
 * The chain is re-verified immediately before each unlink/rmdir. When
 * `selective` is set (build dirs), CACHE_SUBDIRS subtrees are preserved.
 */
function safeRemove(abs, rootReal, rootStat, selective, depth = 0) {
  verifyChain(abs, rootReal, rootStat);
  let st;
  try { st = lstatSync(abs); } catch { return 0; }
  if (st.isSymbolicLink()) { unlinkSync(abs); return st.size; }
  if (!st.isDirectory()) { unlinkSync(abs); return st.size; }
  let entries;
  try { entries = readdirSync(abs); } catch { return 0; }
  let freed = 0, kept = false;
  for (const name of entries) {
    const child = path.join(abs, name);
    let cst;
    try { cst = lstatSync(child); } catch { continue; }
    if (cst.isSymbolicLink()) {
      verifyChain(abs, rootReal, rootStat);
      unlinkSync(child);
      freed += cst.size;
      continue;
    }
    const preserve = cst.isDirectory() && (PRESERVE_DIRS.includes(name) || (selective && CACHE_SUBDIRS.includes(name)));
    if (preserve) { kept = true; continue; }
    freed += safeRemove(child, rootReal, rootStat, selective, depth + 1);
    try { if (!existsSync(child)) { /* removed */ } else kept = true; } catch { kept = true; }
  }
  if (kept) return freed; // preserved subtrees remain; keep the directory
  verifyChain(abs, rootReal, rootStat);
  rmdirSync(abs);
  return freed;
}

/** Discover disposable names at any depth inside the owned root. */
function discover(rootReal, names) {
  const found = [];
  (function walk(dir, depth) {
    if (depth > MAX_WALK_DEPTH) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) { if (names.includes(e.name)) found.push(p); continue; }
      if (e.isDirectory()) {
        if (names.includes(e.name)) { found.push(p); continue; }
        if (PRESERVE_DIRS.includes(e.name)) continue;
        walk(p, depth + 1);
      } else if (names.includes(e.name)) found.push(p);
    }
  })(rootReal, 0);
  return [...new Set(found)];
}

function regPath(owner) { return path.join(pool, "registry", `${String(owner).replace(/[^\w.-]+/g, "_")}.json`); }
function readRegistry(owner) {
  try {
    const v = JSON.parse(readFileSync(regPath(owner), "utf8"));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function addRegistry(owner, rootReal, rels) {
  mkdirSync(path.join(pool, "registry"), { recursive: true });
  const cur = readRegistry(owner);
  for (const rel of rels) if (!cur.some((e) => e.root === rootReal && e.rel === rel)) cur.push({ root: rootReal, rel });
  writeFileSync(regPath(owner), JSON.stringify(cur));
}
function leaseCovers(owner, rootReal) {
  return leases().some((l) => {
    if (l.owner !== owner || !l.worktree) return false;
    const base = realpathOrSelf(l.worktree);
    return rootReal === base || within(rootReal, base);
  });
}
/** Active worktree leases (branch-only leases hold no disk slot). */
function activeWorktreeCount() { return leases().filter((l) => isActive(l) && l.worktree).length; }

function worktreeBranch(worktree) {
  const r = git(worktree, "symbolic-ref", "--quiet", "--short", "HEAD");
  return r.status === 0 ? (r.stdout || "").trim() || null : null;
}
function headOf(dir) { const r = git(dir, "rev-parse", "HEAD"); return r.status === 0 ? (r.stdout || "").trim() : null; }
function readPoolConfig() {
  try { return JSON.parse(readFileSync(path.join(pool, "config.json"), "utf8")); } catch { return {}; }
}
function gitWorktrees(repo) {
  const r = git(repo, "worktree", "list", "--porcelain");
  if (r.status !== 0) return [];
  return (r.stdout || "").split("\n\n").filter(Boolean).map((sec) => {
    const lines = sec.split("\n");
    const out = { path: "", head: "", branch: "" };
    for (const l of lines) {
      if (l.startsWith("worktree ")) out.path = l.slice(9);
      else if (l.startsWith("HEAD ")) out.head = l.slice(5);
      else if (l.startsWith("branch refs/heads/")) out.branch = l.slice(18);
    }
    return out;
  });
}

function reclaimOne(l, dry) {
  const { owner, worktree, repo } = l;
  if (!worktree) {
    // Branch-only lease: no disk to remove; prune once the branch is integrated.
    if (!repo || !l.branch) return { owner, worktree: null, action: "pruned", reason: "missing", reclaimedBytes: 0 };
    const exists = git(repo, "show-ref", "--verify", `refs/heads/${l.branch}`).status === 0;
    if (!exists) { if (!dry) rmSync(leasePath(owner), { force: true }); return { owner, worktree: null, action: "pruned", reason: "missing", reclaimedBytes: 0 }; }
    if (isActive(l)) return { owner, worktree: null, action: "refused", reason: "in-use", reclaimedBytes: 0 };
    const merged = git(repo, "merge-base", "--is-ancestor", l.branch, "HEAD").status === 0;
    if (!merged) return { owner, worktree: null, action: "refused", reason: "unmerged", reclaimedBytes: 0 };
    if (!dry) rmSync(leasePath(owner), { force: true });
    return { owner, worktree: null, action: "pruned", reason: "integrated", reclaimedBytes: 0 };
  }
  if (!existsSync(worktree)) {
    if (!dry) rmSync(leasePath(owner), { force: true });
    return { owner, worktree, action: "pruned", reason: "missing", reclaimedBytes: 0 };
  }
  if (isLocked(worktree)) return { owner, worktree, action: "refused", reason: "locked", reclaimedBytes: 0 };
  const st = git(worktree, "status", "--porcelain");
  if (st.status === 0 && (st.stdout || "").trim() !== "") return { owner, worktree, action: "refused", reason: "dirty", reclaimedBytes: 0 };
  const actual = worktreeBranch(worktree);
  if (actual !== l.branch) return { owner, worktree, action: "refused", reason: "drift", reclaimedBytes: 0 };
  const head = headOf(worktree);
  const repoHead = repo ? headOf(repo) : null;
  const merged = Boolean(head && repoHead && git(repo, "merge-base", "--is-ancestor", head, repoHead).status === 0);
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

/** Run reclamation over leases; audits each result immediately. */
function runReclaim(dry, maxTotalBytes, priority) {
  const results = [];
  withLock(() => {
    const all = leases();
    const done = new Set();
    const emit = (r) => {
      results.push(r);
      done.add(r.owner);
      if (!dry) audit({ owner: r.owner, action: "reclaim", worktree: r.worktree, reclaimedBytes: r.reclaimedBytes, result: r.action });
    };
    if (maxTotalBytes == null) {
      for (const l of all) emit(reclaimOne(l, dry));
    } else {
      let total = all.reduce((s, l) => s + (l.worktree && existsSync(l.worktree) ? dirBytes(l.worktree) : 0), 0);
      const by = { largest: (a, b) => (b._b || 0) - (a._b || 0), oldest: (a, b) => a.ts - b.ts, newest: (a, b) => b.ts - a.ts }[priority] || ((a, b) => (b._b || 0) - (a._b || 0));
      const ordered = all
        .map((l) => ({ ...l, _b: l.worktree && existsSync(l.worktree) ? dirBytes(l.worktree) : 0 }))
        .sort(by);
      for (const l of ordered) {
        if (total <= maxTotalBytes || !(l.released || isStale(l))) {
          emit({ owner: l.owner, worktree: l.worktree, action: "skipped", reason: total <= maxTotalBytes ? "threshold-met" : "in-use", reclaimedBytes: 0 });
          continue;
        }
        const before = l._b || 0;
        const r = reclaimOne(l, dry);
        if (r.action === "removed") total -= before;
        emit(r);
      }
      for (const l of all) if (!done.has(l.owner)) emit({ owner: l.owner, worktree: l.worktree, action: "skipped", reason: "in-use", reclaimedBytes: 0 });
    }
  });
  return results;
}

try {
  if (!cmd || !["lease", "release", "reclaim", "clean-artifacts", "register", "scan", "recover", "status"].includes(cmd))
    fail("usage: node tools/lifecycle-pool.mjs <lease|release|reclaim|clean-artifacts|register|scan|recover|status> [options]");
  pool = opts.pool ? path.resolve(opts.pool) : null;
  if (cmd !== "reclaim" && !pool) fail("--pool is required");
  if (pool) { mkdirSync(path.join(pool, "leases"), { recursive: true }); mkdirSync(path.join(pool, "registry"), { recursive: true }); }
  if (cmd === "lease") {
    const { repo, owner, branch } = opts;
    if (!repo || !owner || !branch) fail("lease requires --repo --owner --branch");
    const branchOnly = Boolean(opts["branch-only"]);
    if (!branchOnly && !opts.worktree) fail("lease requires --worktree (or --branch-only)");
    const max = Number(opts.max || DEFAULT_MAX);
    const pid = opts.pid ? Number(opts.pid) : process.ppid;
    const wt = branchOnly ? null : path.resolve(opts.worktree);
    let payload;
    withLock(() => {
      const reclaimed = [];
      for (const l of leases()) {
        if (!isStale(l)) continue;
        if (l.worktree && existsSync(l.worktree)) {
          try {
            const r = reclaimOne(l, false);
            if (r.action === "removed" || r.action === "pruned") { audit({ owner: l.owner, action: "reclaim", worktree: r.worktree, reclaimedBytes: r.reclaimedBytes, result: r.action }); reclaimed.push(l.owner); }
          } catch { /* retain the record; safety never depends on cleanup succeeding */ }
        } else if (!l.worktree) {
          try { const r = reclaimOne(l, false); if (r.action === "pruned") reclaimed.push(l.owner); } catch { /* retain */ }
        } else rmSync(leasePath(l.owner), { force: true });
      }
      const existing = leases().find((l) => l.owner === owner);
      if (existing) {
        if (!existing.released && (!existing.worktree || existsSync(existing.worktree))) {
          payload = { owner, worktree: existing.worktree, branch: existing.branch, active: activeWorktreeCount(), reclaimed };
          return;
        }
        if (existing.released && existing.worktree && existsSync(existing.worktree)) {
          if (activeWorktreeCount() >= max) fail(`pool exhausted: ${activeWorktreeCount()}/${max} leases active`, 2);
          existing.released = false; existing.ts = Date.now(); existing.pid = pid;
          writeFileSync(leasePath(owner), JSON.stringify(existing));
          audit({ owner, action: "lease", worktree: existing.worktree, reclaimedBytes: 0 });
          payload = { owner, worktree: existing.worktree, branch: existing.branch, active: activeWorktreeCount(), reclaimed };
          return;
        }
        rmSync(leasePath(owner), { force: true });
      }
      if (!branchOnly && activeWorktreeCount() >= max) fail(`pool exhausted: ${activeWorktreeCount()}/${max} leases active`, 2);
      const exists = git(repo, "show-ref", "--verify", `refs/heads/${branch}`).status === 0;
      if (branchOnly) {
        if (!exists) gitOk(repo, "branch", branch);
        writeFileSync(leasePath(owner), JSON.stringify({ owner, pid, ts: Date.now(), repo: path.resolve(repo), worktree: null, branch, released: false, branchOnly: true }), { flag: "wx" });
        audit({ owner, action: "lease", worktree: null, reclaimedBytes: 0 });
        payload = { owner, worktree: null, branch, branchOnly: true, active: activeWorktreeCount(), reclaimed };
        return;
      }
      let allocated = false;
      try {
        if (exists) gitOk(repo, "worktree", "add", wt, branch);
        else gitOk(repo, "worktree", "add", "-b", branch, wt);
        allocated = true;
        writeFileSync(leasePath(owner), JSON.stringify({ owner, pid, ts: Date.now(), repo: path.resolve(repo), worktree: wt, branch, released: false }), { flag: "wx" });
      } catch (e) {
        if (allocated) git(repo, "worktree", "remove", wt); // roll back allocation if recording fails
        throw e;
      }
      audit({ owner, action: "lease", worktree: wt, reclaimedBytes: 0 });
      payload = { owner, worktree: wt, branch, active: activeWorktreeCount(), reclaimed };
    });
    json(payload);
  } else if (cmd === "release") {
    const { owner } = opts;
    if (!owner) fail("release requires --owner");
    const f = leasePath(owner);
    if (!existsSync(f)) fail(`no lease for owner ${owner}`);
    const l = JSON.parse(readFileSync(f, "utf8"));
    l.released = true;
    writeFileSync(f, JSON.stringify(l));
    audit({ owner, action: "release", reclaimedBytes: 0 });
    let reclaim = null;
    if (!opts["no-reclaim"]) {
      try {
        const r = reclaimOne(l, false);
        reclaim = { action: r.action, reason: r.reason, reclaimedBytes: r.reclaimedBytes };
        audit({ owner, action: "reclaim", worktree: r.worktree, reclaimedBytes: r.reclaimedBytes, result: r.action });
      } catch (e) { reclaim = { action: "error", reason: String((e && e.message) || e) }; }
    }
    json({ owner, released: true, reclaim });
  } else if (cmd === "reclaim") {
    const dry = Boolean(opts["dry-run"]);
    const config = readPoolConfig();
    const pr = opts.priority || config.priority || "largest";
    if (!["largest", "oldest", "newest"].includes(pr)) fail("--priority must be largest, oldest, or newest");
    const mb = opts["max-total-mb"] !== undefined ? Number(opts["max-total-mb"]) : (config.maxTotalBytes ? config.maxTotalBytes / 1024 / 1024 : null);
    const limit = mb == null ? null : Math.max(0, Number(mb) * 1024 * 1024);
    const results = runReclaim(dry, limit, pr);
    if (dry) { for (const r of results) console.log(`${r.action}: ${r.worktree} (${r.reason}) reclaimedBytes=${r.reclaimedBytes}`); }
    else {
      json({ results, totalReclaimedBytes: totalReclaimed() });
      if (results.some((r) => r.action === "refused")) process.exit(1);
    }
  } else if (cmd === "register") {
    const { root, owner } = opts;
    if (!root || !owner || !opts.path) fail("register requires --pool --root --owner --path");
    if (!existsSync(root)) fail(`root does not exist: ${root}`);
    const rootReal = realpathSync(path.resolve(root));
    if (rootReal === path.parse(rootReal).root) fail("refusing filesystem root");
    if (!leaseCovers(owner, rootReal)) fail(`ownership refusal: no lease for owner ${owner} covering ${rootReal}`);
    const rels = [].concat(opts.path).flatMap((s) => String(s).split(",").map((x) => x.trim()).filter(Boolean));
    for (const rel of rels) {
      if (path.isAbsolute(rel) || rel.split(path.sep).includes("..") || rel === "." || rel === "") fail(`containment refusal: ${rel}`);
      const abs = path.join(rootReal, rel);
      if (!within(abs, rootReal) || abs === rootReal) fail(`containment refusal: ${rel}`);
    }
    addRegistry(owner, rootReal, rels);
    audit({ owner, action: "register", reclaimedBytes: 0, paths: rels });
    json({ owner, root: rootReal, registered: rels });
  } else if (cmd === "scan") {
    const { repo } = opts;
    if (!repo) fail("scan requires --repo");
    const dry = Boolean(opts["dry-run"]);
    const adopt = Boolean(opts.adopt);
    let out;
    withLock(() => {
      const mainPath = realpathOrSelf(repo);
      const actual = gitWorktrees(repo).filter((w) => realpathOrSelf(w.path) !== mainPath);
      const all = leases();
      const byPath = new Map(actual.map((w) => [w.path, w]));
      const leaseByPath = new Map(all.filter((l) => l.worktree).map((l) => [l.worktree, l]));
      const repoHead = headOf(repo);
      const worktrees = actual.map((w) => {
        const l = leaseByPath.get(w.path);
        const st = git(w.path, "status", "--porcelain");
        const dirty = st.status === 0 && (st.stdout || "").trim() !== "";
        const merged = Boolean(w.head && repoHead && git(repo, "merge-base", "--is-ancestor", w.head, repoHead).status === 0);
        return { path: w.path, branch: w.branch, head: w.head, owner: l ? l.owner : null, leased: Boolean(l), orphan: !l, bytes: existsSync(w.path) ? dirBytes(w.path) : 0, dirty, merged, released: l ? Boolean(l.released) : null };
      });
      const missing = all.filter((l) => l.worktree && !byPath.has(l.worktree)).map((l) => ({ owner: l.owner, worktree: l.worktree, branch: l.branch }));
      out = { repo, worktrees, missing, orphans: worktrees.filter((w) => w.orphan).map((w) => w.path), adopted: [] };
      if (adopt) {
        for (const w of worktrees.filter((x) => x.orphan)) {
          const owner = `orphan-${String(w.branch || path.basename(w.path)).replace(/[^\w.-]+/g, "_")}`;
          out.adopted.push(owner);
          if (dry || existsSync(leasePath(owner))) continue;
          writeFileSync(leasePath(owner), JSON.stringify({ owner, pid: 0, ts: Date.now(), repo: path.resolve(repo), worktree: w.path, branch: w.branch, released: true, adopted: true }), { flag: "wx" });
          audit({ owner, action: "adopt", worktree: w.path, reclaimedBytes: 0 });
        }
      }
    });
    json(out);
  } else if (cmd === "recover") {
    const dry = Boolean(opts["dry-run"]);
    const results = runReclaim(dry, null, "largest");
    let reconcile = null;
    if (opts.repo) {
      const mainPath = realpathOrSelf(opts.repo);
      const actual = gitWorktrees(opts.repo).filter((w) => realpathOrSelf(w.path) !== mainPath);
      const all = leases();
      const actualPaths = new Set(actual.map((w) => w.path));
      const leasePaths = new Map(all.filter((l) => l.worktree).map((l) => [l.worktree, l.owner]));
      reconcile = {
        orphans: actual.filter((w) => !leasePaths.has(w.path)).map((w) => w.path),
        missing: all.filter((l) => l.worktree && !actualPaths.has(l.worktree)).map((l) => l.worktree),
      };
    }
    if (dry) { for (const r of results) console.log(`${r.action}: ${r.worktree} (${r.reason}) reclaimedBytes=${r.reclaimedBytes}`); }
    json({ results, totalReclaimedBytes: totalReclaimed(), reconcile });
    if (!dry && results.some((r) => r.action === "refused")) process.exit(1);
  } else if (cmd === "clean-artifacts") {
    const { root, owner } = opts;
    if (!root || !owner) fail("clean-artifacts requires --pool --root --owner");
    const dry = Boolean(opts["dry-run"]);
    const status = opts.status || "success";
    if (status !== "success" && status !== "failed") fail("--status must be success or failed");
    const ttlMs = Number(opts["ttl-hours"] || DEFAULT_TTL_HOURS) * 3600 * 1000;
    const evict = Boolean(opts["evict-caches"]);
    if (!existsSync(root)) fail(`root does not exist: ${root}`);
    const rootReal = realpathSync(path.resolve(root));
    if (rootReal === path.parse(rootReal).root) fail("refusing filesystem root");
    if (!leaseCovers(owner, rootReal)) fail(`ownership refusal: no lease for owner ${owner} covering ${rootReal}`);
    const rootStat = lstatSync(rootReal);
    // Collect candidates: discovered disposable names at any depth, registered
    // outputs for this root, explicit extras, and CARGO_TARGET_DIR inside root.
    let registryNames = [];
    if (opts.registry) {
      const reg = JSON.parse(readFileSync(path.resolve(opts.registry), "utf8"));
      registryNames = Array.isArray(reg) ? reg.map(String) : [...(reg.extra || [])];
    }
    let explicit = [...registryNames];
    if (opts.extra) explicit.push(...String(opts.extra).split(",").map((s) => s.trim()).filter(Boolean));
    let cargoRel = "";
    if (process.env.CARGO_TARGET_DIR) {
      const rel = path.relative(rootReal, path.resolve(process.env.CARGO_TARGET_DIR));
      cargoRel = rel && within(path.resolve(process.env.CARGO_TARGET_DIR), rootReal) ? rel : "";
      if (rel && !rel.includes(path.sep) && within(path.resolve(process.env.CARGO_TARGET_DIR), rootReal)) explicit.push(rel);
    }
    const rels = new Set();
    for (const e of readRegistry(owner)) if (realpathOrSelf(e.root) === rootReal) { if (!e.rel || path.isAbsolute(e.rel) || e.rel.split(path.sep).includes("..")) fail(`containment refusal: ${e.rel}`); rels.add(e.rel); }
    for (const e of explicit) { if (path.isAbsolute(e) || e.split(path.sep).includes("..") || e === "") fail(`containment refusal: ${e}`); rels.add(e); }
    const candidates = new Set();
    for (const d of discover(rootReal, DISPOSABLE)) candidates.add(d);
    for (const rel of rels) candidates.add(path.join(rootReal, rel));
    // Register newly discovered outputs for this owner (not during dry-run).
    if (!dry) {
      const newRels = [];
      for (const d of discover(rootReal, DISPOSABLE)) { const r = path.relative(rootReal, d); if (!readRegistry(owner).some((e) => e.root === rootReal && e.rel === r)) newRels.push(r); }
      if (newRels.length) addRegistry(owner, rootReal, newRels);
    }
    // Validate the whole plan before mutating anything.
    const plan = [], retained = [];
    for (const candidate of [...candidates].sort()) {
      if (!within(candidate, rootReal) || candidate === rootReal) fail(`containment refusal: ${candidate}`);
      const rel = path.relative(rootReal, candidate);
      const relParts = rel.split(path.sep);
      if (relParts.some((p) => PRESERVE_DIRS.includes(p))) fail(`refusing preserved cache path: ${candidate}`);
      if (!existsSync(candidate)) continue;
      let st;
      try { st = lstatSync(candidate); } catch { continue; }
      if (st.isSymbolicLink()) fail(`refusing symlink candidate: ${candidate}`);
      verifyChain(candidate, rootReal, rootStat);
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
      plan.push({ path: candidate, bytes: st.isDirectory() ? dirBytes(candidate) : st.size, dir: st.isDirectory(), selective: st.isDirectory() && !evict && (path.basename(candidate) === "target" || (cargoRel && rel === cargoRel)) });
    }
    const removed = [];
    let reclaimed = 0;
    if (dry) {
      for (const p of plan) console.log(`would remove ${p.path}`);
      console.log(`dry-run: ${plan.length} paths, retained=${retained.length}`);
    } else {
      try {
        for (const p of plan) {
          const freed = safeRemove(p.path, rootReal, rootStat, p.selective);
          reclaimed += freed;
          removed.push(p.path);
        }
      } catch (e) {
        audit({ owner, action: "clean-artifacts", reclaimedBytes: reclaimed, removed, retained, partial: true });
        fail(String((e && e.message) || e));
      }
      audit({ owner, action: "clean-artifacts", reclaimedBytes: reclaimed, removed, retained });
      json({ owner, status, removed, retained, reclaimedBytes: reclaimed, totalReclaimedBytes: totalReclaimed() });
    }
  } else if (cmd === "status") {
    const map = leases().map((l) => ({ owner: l.owner, pid: l.pid, ts: l.ts, released: Boolean(l.released), worktree: l.worktree, branch: l.branch, branchOnly: Boolean(l.branchOnly), stale: isStale(l), bytes: l.worktree && existsSync(l.worktree) ? dirBytes(l.worktree) : 0 }));
    json({ pool, active: activeWorktreeCount(), totalWorktreeBytes: map.reduce((s, l) => s + l.bytes, 0), totalReclaimedBytes: totalReclaimed(), leases: map });
  } else fail(`unknown command: ${cmd}`);
} catch (e) {
  if (e instanceof ExitErr) { console.error(`lifecycle-pool: ${e.message}`); process.exit(e.code); }
  throw e;
}


