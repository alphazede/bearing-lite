/**
 * Codex-only prepared install artifact (D1 repair contract).
 *
 * `node tools/prepare-codex-plugin.mjs --out <new dir>` builds a local Codex marketplace:
 * `.agents/plugins/marketplace.json` (name bearing-lite) plus a `bearing-lite/` payload that is
 * the package runtime closure byte-for-byte, except the root plugin.json omits only `$schema`.
 * The portable source keeps its Agent Plugins `$schema`. Unsafe output paths are refused
 * without writing anything. Native Codex registration is proven separately by the required
 * command `node --test test/native/codex-hook-discovery.test.mjs`.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GENERATOR = path.join("tools", "prepare-codex-plugin.mjs");
const SCHEMA_V1 = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

let tmp;
/** Package runtime closure: the npm pack surface plus Codex host metadata. */
let closure;

const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const hashes = (root, files) => Object.fromEntries(files.map((f) => [f, sha(path.join(root, f))]));
const json = (f) => JSON.parse(readFileSync(f, "utf8"));

function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join("/")];
  });
}

function generate(sourceRoot, out) {
  const gen = path.join(sourceRoot, GENERATOR);
  assert.ok(existsSync(gen), `contract: ${GENERATOR} is missing`);
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("BEARING_")) delete env[k];
  return spawnSync(process.execPath, [gen, "--out", out], { cwd: tmp, env, encoding: "utf8", timeout: 60_000 });
}

/** Disposable copy of the closure plus generator, so refusal cases never risk the real checkout. */
function sandboxSource(name) {
  const src = path.join(tmp, name, "src");
  for (const f of [...closure, GENERATOR]) {
    assert.ok(existsSync(path.join(ROOT, f)), `contract: ${f} is missing from the source`);
    cpSync(path.join(ROOT, f), path.join(src, f));
  }
  return src;
}

function assertRefused(r, out, label) {
  assert.notEqual(r.status, 0, `${label}: generator must refuse ${out}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
}

describe("Codex prepared plugin artifact", () => {
  before(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), `bearing-codex-pkg-${process.pid}-${process.hrtime.bigint()}-`));
    const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
    assert.equal(packed.status, 0, packed.stderr);
    const files = JSON.parse(packed.stdout)[0].files.map((f) => f.path);
    closure = [...new Set([...files, ...listFiles(path.join(ROOT, ".codex-plugin"), ROOT)])].sort();
  });
  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it("prepares a local marketplace whose payload is the closure with only root $schema omitted", () => {
    const before_ = hashes(ROOT, closure);
    const out = path.join(tmp, "artifact");
    const r = generate(ROOT, out);
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.ok(r.stdout.includes(out), `generator must print the output location: ${r.stdout}`);

    const market = json(path.join(out, ".agents", "plugins", "marketplace.json"));
    assert.equal(market.name, "bearing-lite");
    const entry = market.plugins.find((p) => p.name === "bearing-lite");
    assert.ok(entry, JSON.stringify(market));
    assert.equal(entry.source.source, "local");
    assert.equal(path.resolve(out, entry.source.path), path.join(out, "bearing-lite"));

    const payload = path.join(out, "bearing-lite");
    for (const f of closure) {
      assert.ok(existsSync(path.join(payload, f)), `payload missing ${f}`);
      if (f !== "plugin.json") assert.equal(sha(path.join(payload, f)), before_[f], `payload ${f} differs from source`);
    }
    const { $schema, ...portableRest } = json(path.join(ROOT, "plugin.json"));
    assert.equal($schema, SCHEMA_V1);
    assert.deepEqual(json(path.join(payload, "plugin.json")), portableRest);
    assert.ok(!existsSync(path.join(payload, ".git")), "payload must not carry repository metadata");

    assert.deepEqual(hashes(ROOT, closure), before_, "portable source must be unchanged");
  });

  it("refuses an existing output directory without touching its contents", () => {
    const src = sandboxSource("existing");
    const out = path.join(tmp, "existing", "out");
    mkdirSync(out);
    writeFileSync(path.join(out, "keep.txt"), "owner data\n");
    assertRefused(generate(src, out), out, "existing output");
    assert.deepEqual(readdirSync(out), ["keep.txt"]);
    assert.equal(readFileSync(path.join(out, "keep.txt"), "utf8"), "owner data\n");
  });

  it("refuses output inside the source tree", () => {
    const src = sandboxSource("inside");
    const before_ = listFiles(src).sort();
    for (const out of [path.join(src, "codex-out"), path.join(src, "hooks", "codex-out"), `${tmp}/inside/other/../src/codex-out2`]) {
      assertRefused(generate(src, out), out, "inside source");
    }
    assert.deepEqual(listFiles(src).sort(), before_);
  });

  // IR-F2: a child named `..name` is inside the source, unlike the real parent `..`.
  it("accepts a sibling reached through `..` but refuses a `..name` child of the source tree", () => {
    const src = sandboxSource("dotdot");
    const sibling = `${src}/../codex-out`;
    const r = generate(src, sibling);
    assert.equal(r.status, 0, `outside sibling must be accepted\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.ok(existsSync(path.join(tmp, "dotdot", "codex-out", ".agents", "plugins", "marketplace.json")));
    const before_ = listFiles(src).sort();
    for (const out of [`${src}/..codex-out`, `${src}/hooks/..codex-out`, `${src}/..`]) {
      assertRefused(generate(src, out), out, "dot-dot name inside source");
    }
    assert.deepEqual(listFiles(src).sort(), before_);
  });

  it("refuses the source root and its ancestors", () => {
    const src = sandboxSource("ancestor");
    for (const out of [src, path.dirname(src)]) {
      const before_ = listFiles(path.dirname(src)).sort();
      assertRefused(generate(src, out), out, "source or ancestor");
      assert.deepEqual(listFiles(path.dirname(src)).sort(), before_);
    }
  });

  it("refuses symlink aliases that resolve into the source tree", () => {
    const src = sandboxSource("alias");
    const alias = path.join(tmp, "alias", "link");
    symlinkSync(src, alias, "dir");
    const before_ = listFiles(src).sort();
    const out = path.join(alias, "codex-out");
    assertRefused(generate(src, out), out, "symlink alias");
    assert.deepEqual(listFiles(src).sort(), before_);
    assert.ok(lstatSync(alias).isSymbolicLink());
  });
});
