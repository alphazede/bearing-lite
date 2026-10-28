/**
 * Shared readers for tests whose product is shipped agent-instruction text.
 * Skills and references are the public text interface; tests read the shipped
 * files, follow their links, and parse their tables and blocks.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Read a shipped file, failing with the contract name when it is absent.
 * @param {string} rel
 * @returns {string}
 */
export function readShipped(rel) {
  const abs = path.join(ROOT, rel);
  assert.ok(existsSync(abs), `${rel} must ship`);
  return readFileSync(abs, "utf8");
}

/**
 * Read a shipped file when present; absent files read as empty text.
 * @param {string} rel
 * @returns {string}
 */
export function readIfShipped(rel) {
  const abs = path.join(ROOT, rel);
  return existsSync(abs) ? readFileSync(abs, "utf8") : "";
}

/**
 * Markdown files directly inside a shipped directory, repository-relative.
 * @param {string} relDir
 * @returns {string[]}
 */
export function markdownIn(relDir) {
  const abs = path.join(ROOT, relDir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map((n) => path.join(relDir, n));
}

/**
 * Prose form for meaning checks: links reduced to their text (link targets
 * are checked separately), emphasis and code ticks removed, whitespace
 * collapsed, lower case. Identifiers keep their underscores.
 * @param {string} text
 * @returns {string}
 */
export function flat(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Assert every pattern matches; the failure names every missing contract.
 * @param {string} text already flattened
 * @param {Record<string, RegExp>} contracts
 * @param {string} where
 */
export function assertContracts(text, contracts, where) {
  const missing = Object.entries(contracts)
    .filter(([, re]) => !re.test(text))
    .map(([name]) => name);
  assert.deepEqual(missing, [], `${where} is missing: ${missing.join("; ")}`);
}

/**
 * Local markdown link targets of a file, resolved to repository-relative paths.
 * @param {string} rel
 * @param {string} text
 * @returns {{ href: string, target: string }[]}
 */
export function localLinks(rel, text) {
  /** @type {{ href: string, target: string }[]} */
  const out = [];
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = m[1].trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) continue;
    const bare = href.split("#")[0].split("?")[0];
    if (!bare) continue;
    const target = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, rel)), bare));
    out.push({ href, target });
  }
  return out;
}

/**
 * Code-span path citations (`references/x.md`, `../role/SKILL.md`) of a file,
 * resolved relative to the citing file; the house form beside markdown links.
 * @param {string} rel
 * @param {string} text
 * @returns {{ href: string, target: string }[]}
 */
export function citedPaths(rel, text) {
  /** @type {{ href: string, target: string }[]} */
  const out = [];
  for (const m of text.matchAll(/`([A-Za-z0-9_./-]+\.(?:md|mmd|json|cjs|mjs))(?:#[^`]*)?`/g)) {
    const target = path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, rel)), m[1]));
    out.push({ href: m[1], target });
  }
  return out;
}

/**
 * Assert `rel` points to `targetRel` by a markdown link or a code-span path
 * citation that resolves to it, and that the target ships.
 * @param {string} rel
 * @param {string} targetRel
 */
export function assertLinksTo(rel, targetRel) {
  const text = readShipped(rel);
  const refs = [...localLinks(rel, text), ...citedPaths(rel, text)];
  assert.ok(
    refs.some((l) => l.target === targetRel),
    `${rel} must reference ${targetRel}; resolved references: ${JSON.stringify(refs.map((l) => l.href))}`
  );
  assert.ok(existsSync(path.join(ROOT, targetRel)), `${targetRel} must ship`);
}

/**
 * Assert every local link of a shipped file resolves inside the package.
 * @param {string} rel
 */
export function assertLocalLinksResolve(rel) {
  const text = readShipped(rel);
  for (const { href, target } of localLinks(rel, text)) {
    assert.ok(!target.startsWith(".."), `${rel} link leaves the package: ${href}`);
    assert.ok(existsSync(path.join(ROOT, target)), `${rel} link must resolve: ${href}`);
  }
}

/**
 * Body of the markdown section whose heading matches, up to the next heading
 * of the same or higher level. Empty when absent.
 * @param {string} text
 * @param {RegExp} heading matched against the heading text
 * @returns {string}
 */
export function section(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && heading.test(l.replace(/^#+\s*/, "")));
  if (start < 0) return "";
  const level = lines[start].match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const h = lines[i].match(/^(#+)\s/);
    if (h && h[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

/**
 * Parse the first markdown table whose header row matches `header`.
 * @param {string} text
 * @param {RegExp} header
 * @returns {{ headers: string[], rows: string[][] }}
 */
export function markdownTable(text, header) {
  const lines = text.split(/\r?\n/);
  const cells = (l) =>
    l
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim().replace(/[`*]/g, ""));
  const start = lines.findIndex((l) => /^\s*\|/.test(l) && header.test(l));
  if (start < 0) return { headers: [], rows: [] };
  const headers = cells(lines[start]).map((h) => h.toLowerCase());
  /** @type {string[][]} */
  const rows = [];
  for (let i = start + 1; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
    if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) continue;
    rows.push(cells(lines[i]));
  }
  return { headers, rows };
}

/**
 * Private identifiers that must not reach new public references: internal
 * glossary IDs and private standards-receipt rows.
 */
export const PRIVATE_IDENTIFIER = /GLOSS-[A-Z]{2,}-[0-9]{3}|SRC-EMV-[A-Z0-9-]+|S8 receipts?/;
