#!/usr/bin/env node
/**
 * Prepare a Codex-only local marketplace from this checkout.
 *
 *   node tools/prepare-codex-plugin.mjs --out <new directory>
 *
 * Writes <out>/.agents/plugins/marketplace.json (marketplace "bearing-lite", local source
 * ./bearing-lite) and <out>/bearing-lite/, a byte copy of the npm package file set plus
 * .codex-plugin/. The only difference from source: root plugin.json omits `$schema`, which
 * Codex 0.162.1 rejects silently (zero hooks registered). The portable source is never changed.
 *
 * Requires a git checkout (npm tarballs omit .codex-plugin/) and `npm` on PATH for the file set.
 * No network, no shell, no dependencies. Refuses an existing output and any output that
 * resolves to the source tree, inside it, or to one of its ancestors.
 */
import { spawnSync } from "node:child_process";
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const NAME = "bearing-lite";

function fail(message) {
  console.error(`prepare-codex-plugin: ${message}`);
  process.exit(1);
}

/** Resolve symlinks through the deepest existing ancestor so aliases cannot slip past checks. */
function realTarget(p) {
  const rest = [];
  let cur = p;
  while (!existsSync(cur)) {
    if (path.dirname(cur) === cur) break;
    rest.unshift(path.basename(cur));
    cur = path.dirname(cur);
  }
  return path.join(realpathSync(cur), ...rest);
}

const within = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

function closure() {
  // npm decides the package file set; reuse it instead of re-implementing `files` rules.
  const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: SOURCE, encoding: "utf8", timeout: 60_000 });
  if (packed.error || packed.status !== 0) fail(`npm pack --dry-run failed: ${packed.error?.message ?? packed.stderr}`);
  const files = JSON.parse(packed.stdout)[0].files.map((f) => f.path);
  const codexMeta = path.join(SOURCE, ".codex-plugin");
  if (!existsSync(path.join(codexMeta, "plugin.json"))) fail("missing .codex-plugin/plugin.json; run from a git checkout, not the npm package");
  const meta = listFiles(codexMeta).map((f) => path.relative(SOURCE, f).split(path.sep).join("/"));
  return [...new Set([...files, ...meta])].sort();
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--out" || !args[1]) fail("usage: node tools/prepare-codex-plugin.mjs --out <new directory>");
const out = path.resolve(args[1]);

let exists = true;
try { lstatSync(out); } catch { exists = false; }
if (exists) fail(`refusing existing output ${out}`);
const outReal = realTarget(out);
for (const candidate of [out, outReal]) {
  if (within(candidate, SOURCE) || within(SOURCE, candidate)) fail(`refusing output ${out}: it overlaps the source tree ${SOURCE}`);
}
if (!existsSync(path.dirname(out))) fail(`output parent ${path.dirname(out)} does not exist`);

const files = closure();
mkdirSync(out); // non-recursive: claims the directory atomically, fails if it appeared meanwhile
try {
  const payload = path.join(out, NAME);
  for (const f of files) {
    const dest = path.join(payload, f);
    mkdirSync(path.dirname(dest), { recursive: true });
    if (f === "plugin.json") {
      const { $schema, ...rest } = JSON.parse(readFileSync(path.join(SOURCE, f), "utf8"));
      writeFileSync(dest, `${JSON.stringify(rest, null, 2)}\n`, { flag: "wx" });
    } else {
      copyFileSync(path.join(SOURCE, f), dest, constants.COPYFILE_EXCL);
    }
  }
  const marketplace = {
    name: NAME,
    interface: { displayName: "Bearing Lite" },
    plugins: [{
      name: NAME,
      source: { source: "local", path: `./${NAME}` },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Developer Tools",
    }],
  };
  mkdirSync(path.join(out, ".agents", "plugins"), { recursive: true });
  writeFileSync(path.join(out, ".agents", "plugins", "marketplace.json"), `${JSON.stringify(marketplace, null, 2)}\n`, { flag: "wx" });
} catch (e) {
  rmSync(out, { recursive: true, force: true });
  fail(`generation failed, removed ${out}: ${e.message}`);
}
console.log(`Prepared Codex marketplace at ${out}`);
console.log(`Install: codex plugin marketplace add ${out} && codex plugin add ${NAME}@${NAME}`);
