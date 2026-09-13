#!/usr/bin/env node
/**
 * Deterministic Definition of Done Manifest renderer (DES-BDL-009, DEC-BDL-045).
 * Consumes implementation.json.dod_manifest. Never authors model semantics
 * or fills absent evidence. Node.js standard library only.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPLATE_VERSION = "1.0.1";
export const TEMPLATE_RELATIVE = "templates/dod-manifest-v1.html";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SVG_BYTES = 512 * 1024;
const MAX_PNG_BYTES = 2 * 1024 * 1024;

const SECTIONS = Object.freeze([
  { id: "s1", title: "BLUF and Lifecycle state" },
  { id: "s2", title: "Source, baseline, candidate, and template identity" },
  { id: "s3", title: "Outcome, scope, exclusions, and Definition of Done" },
  {
    id: "s4",
    title:
      "Requirements, architecture, design, interfaces, model inventory, and embedded model views",
  },
  {
    id: "s5",
    title: "Development strategy, task graph, roles, dependencies, and write sets",
  },
  { id: "s6", title: "V&V cases, assurance cadence, evidence, and pass/fail status" },
  { id: "s7", title: "Documentation impact and completion" },
  {
    id: "s8",
    title: "Risks, gaps, exceptions, anomaly handling, rollback, and recovery",
  },
  { id: "s9", title: "Authority, owner decisions, approvals, and closeout status" },
]);

const SVG_ALLOWED_TAGS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "marker",
  "title",
  "desc",
  "use",
  "symbol",
  "clippath",
  "lineargradient",
  "radialgradient",
  "stop",
  "image",
  "style",
  "mask",
  "pattern",
]);

const SVG_ALLOWED_ATTRS = new Set([
  "id",
  "class",
  "viewbox",
  "width",
  "height",
  "x",
  "y",
  "dx",
  "dy",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linejoin",
  "stroke-linecap",
  "stroke-dasharray",
  "fill-opacity",
  "stroke-opacity",
  "opacity",
  "transform",
  "text-anchor",
  "font-family",
  "font-size",
  "font-weight",
  "xml:space",
  "xmlns",
  "role",
  "aria-labelledby",
  "aria-label",
  "aria-hidden",
  "preserveaspectratio",
  "markerwidth",
  "markerheight",
  "markerunits",
  "orient",
  "refx",
  "refy",
  "gradientunits",
  "offset",
  "stop-color",
  "stop-opacity",
  "clip-path",
  "mask",
  "display",
  "overflow",
  "vector-effect",
  "fill-rule",
  "clip-rule",
  "marker-end",
  "marker-start",
  "marker-mid",
  "dominant-baseline",
]);

export class RenderError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ html?: string, failures?: object[] }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "RenderError";
    this.code = code;
    this.html = extra.html;
    this.failures = extra.failures || [];
  }
}

const SUPPLEMENT_KEYS = new Set(["model_id", "digest", "view"]);
const VIEW_KEYS = new Set(["format", "path", "inline", "alt"]);

export function bindingRequirement(modelId = "<model.id>") {
  return [
    `BINDING_REQUIRED ${modelId}: activated model (selected OR required, including render_status READY/MISSING/STALE) must bind a digest-checked view.`,
    "Minimal planning binding:",
    `  "digest": "sha256:<hex of view bytes>",`,
    `  "view": { "format": "svg"|"png", "path": "<path relative to implementation.json>" }`,
    "or SVG only: \"view\": { \"format\": \"svg\", \"inline\": \"<svg ...></svg>\" } with the same digest over UTF-8 inline bytes.",
    "Append-only alternative: dod_manifest.closeout.model_views[] { model_id, digest, view } keyed to a planning model id. Supplemental entries may not rewrite planning rows or override mode, source, viewpoint, trace, limitations, activation, or an already-planned binding.",
    "Inactive (selected=false AND required=false) or not_applicable+reason needs no view.",
    "Do not invent SVG/PNG semantics. Renderer will not scrape design.md or architecture HTML.",
  ].join("\n");
}

export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function normalizeDigest(value) {
  if (value == null || value === "") return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, "");
}

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isNaStatus(value) {
  const s = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  return s === "n/a" || s === "na" || s === "not applicable" || s === "notapplicable";
}

export function statusKind(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (!s) return "plan";
  if (isNaStatus(s) || s === "not started") return "na";
  if (
    /^(pass|passed|confirmed|authorized|ready|embedded|complete|done|accepted|not authorized)$/.test(s)
  ) {
    return "pass";
  }
  if (/(gap|missing|blocked|fail|failed|stale|error|rejected|refuted)/.test(s)) return "gap";
  if (/(hold|pending|waiting|open)/.test(s)) return "hold";
  if (/(plan|planned|proposed|unused|observed)/.test(s)) return "plan";
  return "plan";
}

function statusChip(raw, reason) {
  const kind = statusKind(raw);
  const label = raw == null || String(raw).trim() === "" ? "unspecified" : String(raw);
  let html = `<span class="status status-${kind}"><span class="mark" aria-hidden="true"></span>${esc(label)}</span>`;
  if (reason != null && String(reason).trim() !== "") {
    html += `<span class="reason">${esc(reason)}</span>`;
  }
  return html;
}

function sectionNA(value) {
  if (value == null) return { na: true, reason: "No source projection was provided.", value: null };
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { na: true, reason: "None recorded.", value };
    }
    return { na: false, value };
  }
  if (typeof value === "object") {
    if (value.not_applicable === true || value.na === true || isNaStatus(value.status)) {
      return {
        na: true,
        reason: value.reason || value.evidence || "Not applicable.",
        value,
      };
    }
  }
  return { na: false, value };
}

function field(row, ...keys) {
  for (const key of keys) {
    if (row && row[key] != null && row[key] !== "") return row[key];
  }
  return "";
}

function asRows(value) {
  const parsed = sectionNA(value);
  if (parsed.na) return parsed;
  if (Array.isArray(parsed.value)) return { na: false, value: parsed.value };
  return { na: false, value: [parsed.value] };
}

export function resolveUnder(rootDir, relativePath) {
  const rel = String(relativePath ?? "");
  if (!rel || rel.includes("\0")) {
    throw new RenderError("PATH_TRAVERSAL", "Asset path is empty or contains NUL.");
  }
  if (path.isAbsolute(rel) || /^[A-Za-z]:[\\/]/.test(rel)) {
    throw new RenderError("PATH_TRAVERSAL", `Absolute asset path rejected: ${rel}`);
  }
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, rel);
  const relToRoot = path.relative(root, resolved);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot) || relToRoot.includes("\0")) {
    throw new RenderError("PATH_TRAVERSAL", `Asset path escapes root: ${rel}`);
  }
  return resolved;
}

function isCssWhitespace(ch) {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

/** CSS Syntax 3 §4.3.7 consume an escaped code point, applied across the input. */
function decodeCssEscapes(input) {
  const s = String(input);
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== "\\") {
      out += s[i];
      continue;
    }
    const next = s[i + 1];
    if (next === undefined) {
      out += "\uFFFD";
      break;
    }
    if (next === "\n" || next === "\f") {
      i += 1;
      continue;
    }
    if (next === "\r") {
      i += 1;
      if (s[i + 1] === "\n") i += 1;
      continue;
    }
    if (/[0-9A-Fa-f]/.test(next)) {
      let hex = next;
      let j = i + 2;
      while (j < s.length && hex.length < 6 && /[0-9A-Fa-f]/.test(s[j])) {
        hex += s[j];
        j += 1;
      }
      if (s[j] === "\r" && s[j + 1] === "\n") j += 2;
      else if (isCssWhitespace(s[j])) j += 1;
      const code = parseInt(hex, 16);
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        out += "\uFFFD";
      } else {
        out += String.fromCodePoint(code);
      }
      i = j - 1;
      continue;
    }
    out += next;
    i += 1;
  }
  return out;
}

function stripCssComments(css) {
  let out = "";
  let i = 0;
  const s = String(css);
  while (i < s.length) {
    if (s.startsWith("/*", i)) {
      const end = s.indexOf("*/", i + 2);
      if (end < 0) return "@import /*unterminated";
      i = end + 2;
      continue;
    }
    out += s[i];
    i += 1;
  }
  return out;
}

function normalizedCss(value) {
  return stripCssComments(decodeCssEscapes(String(value)));
}

function unsafeCssValue(value) {
  const v = normalizedCss(value);
  if (
    /@import\b/i.test(v) ||
    /expression\s*\(/i.test(v) ||
    /javascript:/i.test(v) ||
    /-moz-binding/i.test(v)
  ) {
    return true;
  }
  const urls = [...v.matchAll(/url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)];
  for (const match of urls) {
    const target = match[2].trim();
    if (target.startsWith("#")) continue;
    return true;
  }
  return false;
}

function prefixCssSelectors(css, prefix) {
  const s = normalizedCss(css).trim();
  if (!s) return s;
  if (/@/.test(s) || /</.test(s)) {
    throw new RenderError("UNSAFE_ASSET", "Unsafe SVG stylesheet.");
  }
  let out = "";
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i += 1;
    if (i >= s.length) break;
    const brace = s.indexOf("{", i);
    if (brace < 0) {
      if (s.slice(i).trim()) throw new RenderError("UNSAFE_ASSET", "Unsafe SVG stylesheet.");
      break;
    }
    const prelude = s.slice(i, brace).trim();
    if (!prelude) throw new RenderError("UNSAFE_ASSET", "Unsafe SVG stylesheet.");
    let depth = 1;
    let j = brace + 1;
    let quote = null;
    while (j < s.length && depth > 0) {
      const ch = s[j];
      if (quote) {
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "{") {
        throw new RenderError("UNSAFE_ASSET", "Unsafe SVG stylesheet.");
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
      j += 1;
    }
    if (depth !== 0) throw new RenderError("UNSAFE_ASSET", "Unsafe SVG stylesheet.");
    const body = s.slice(brace, j + 1);
    const prefixed = prelude
      .split(",")
      .map((sel) => {
        const t = sel.trim();
        if (!t) throw new RenderError("UNSAFE_ASSET", "Unsafe SVG stylesheet.");
        return t.startsWith(prefix) ? t : `${prefix} ${t}`;
      })
      .join(", ");
    out += `${prefixed} ${body}`;
    i = j + 1;
  }
  return out;
}

function sanitizeStylesheet(css, scopeSelector) {
  if (unsafeCssValue(css) || /</.test(String(css))) {
    throw new RenderError("UNSAFE_ASSET", "Unsafe SVG stylesheet.");
  }
  return prefixCssSelectors(css, scopeSelector);
}

function sanitizeStyleAttr(value) {
  const decoded = decodeCssEscapes(String(value));
  const parts = decoded
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const kept = [];
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx < 1) {
      throw new RenderError("UNSAFE_ASSET", "Malformed SVG style attribute.");
    }
    const name = part.slice(0, idx).trim().toLowerCase();
    const val = part.slice(idx + 1).trim();
    if (!/^[a-z-]+$/.test(name) || unsafeCssValue(val)) {
      throw new RenderError("UNSAFE_ASSET", `Unsafe SVG style: ${name}`);
    }
    kept.push(`${name}: ${val}`);
  }
  return kept.join("; ");
}

function sanitizeHref(name, value, tag) {
  const v = String(value).trim();
  if (tag === "image" && (name === "href" || name === "xlink:href")) {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v.replace(/\s+/g, ""))) {
      throw new RenderError("UNSAFE_ASSET", "SVG image href must be an embedded PNG data URI.");
    }
    const b64 = v.split(",", 2)[1] || "";
    const buf = Buffer.from(b64, "base64");
    if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
      throw new RenderError("UNSAFE_ASSET", "SVG image data URI is not a PNG.");
    }
    return v.replace(/\s+/g, "");
  }
  if (!/^#[A-Za-z][\w:-]*$/.test(v)) {
    throw new RenderError("UNSAFE_ASSET", `SVG ${name} must be a same-document fragment.`);
  }
  return v;
}

const XML_PREDEFINED = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
});

function isXmlChar(code) {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

function decodeXmlEntities(value, where) {
  const s = String(value);
  if (!s.includes("&")) return s;
  let out = "";
  let i = 0;
  while (i < s.length) {
    const amp = s.indexOf("&", i);
    if (amp < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, amp);
    const semi = s.indexOf(";", amp + 1);
    if (semi < 0 || semi === amp + 1 || s.slice(amp + 1, semi).includes("&")) {
      throw new RenderError("UNSAFE_ASSET", `Malformed XML character reference in SVG ${where}.`);
    }
    const body = s.slice(amp + 1, semi);
    let decoded;
    if (body[0] === "#") {
      let code;
      if (body[1] === "x" || body[1] === "X") {
        const digits = body.slice(2);
        if (!digits || /[^0-9A-Fa-f]/.test(digits)) {
          throw new RenderError("UNSAFE_ASSET", `Malformed XML character reference in SVG ${where}.`);
        }
        code = Number.parseInt(digits, 16);
      } else {
        const digits = body.slice(1);
        if (!digits || /[^0-9]/.test(digits)) {
          throw new RenderError("UNSAFE_ASSET", `Malformed XML character reference in SVG ${where}.`);
        }
        code = Number.parseInt(digits, 10);
      }
      if (!Number.isInteger(code) || !isXmlChar(code)) {
        throw new RenderError("UNSAFE_ASSET", `Malformed XML character reference in SVG ${where}.`);
      }
      decoded = String.fromCodePoint(code);
    } else if (Object.prototype.hasOwnProperty.call(XML_PREDEFINED, body)) {
      decoded = XML_PREDEFINED[body];
    } else {
      throw new RenderError("UNSAFE_ASSET", `Unsupported XML entity in SVG ${where}: &${body};`);
    }
    out += decoded;
    i = semi + 1;
  }
  return out;
}

function decodeSvgXmlValue(value, where) {
  const decoded = decodeXmlEntities(value, where);
  if (decoded.includes("\0")) {
    throw new RenderError("UNSAFE_ASSET", "SVG contains NUL.");
  }
  if (/javascript:/i.test(decoded)) {
    throw new RenderError("UNSAFE_ASSET", "SVG contains script, foreignObject, or javascript: URL.");
  }
  return decoded;
}

function parseAttrs(raw, tag) {
  const attrs = [];
  let i = 0;
  const s = raw;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i += 1;
    if (i >= s.length) break;
    const rest = s.slice(i);
    const m = /^([A-Za-z_:][\w:.-]*)/.exec(rest);
    if (!m) {
      throw new RenderError("UNSAFE_ASSET", `Malformed SVG attribute in <${tag}>`);
    }
    const name = m[1];
    i += name.length;
    while (i < s.length && /\s/.test(s[i])) i += 1;
    let value = "";
    if (s[i] === "=") {
      i += 1;
      while (i < s.length && /\s/.test(s[i])) i += 1;
      const quote = s[i];
      if (quote === '"' || quote === "'") {
        i += 1;
        const end = s.indexOf(quote, i);
        if (end < 0) throw new RenderError("UNSAFE_ASSET", "Unterminated SVG attribute.");
        value = s.slice(i, end);
        i = end + 1;
      } else {
        throw new RenderError("UNSAFE_ASSET", "Unquoted SVG attributes are rejected.");
      }
    }
    value = decodeSvgXmlValue(value, `attribute ${name}`);
    const lower = name.toLowerCase();
    if (lower.startsWith("on") || lower === "srcdoc" || lower.startsWith("xmlns:xsl")) {
      throw new RenderError("UNSAFE_ASSET", `Unsafe SVG attribute: ${name}`);
    }
    if (lower === "href" || lower === "xlink:href") {
      attrs.push([lower === "xlink:href" ? "href" : name, sanitizeHref(lower, value, tag)]);
      continue;
    }
    if (lower === "style") {
      attrs.push(["style", sanitizeStyleAttr(value)]);
      continue;
    }
    if (!SVG_ALLOWED_ATTRS.has(lower) && lower !== "xmlns:xlink") {
      throw new RenderError("UNSAFE_ASSET", `SVG attribute not allowed: ${name}`);
    }
    const cssVal = normalizedCss(value);
    if (unsafeCssValue(value) && /url\s*\(/i.test(cssVal) && !cssVal.trim().startsWith("url(#")) {
      throw new RenderError("UNSAFE_ASSET", `Unsafe SVG attribute value: ${name}`);
    }
    attrs.push([name, value]);
  }
  return attrs;
}

export function sanitizeSvg(raw) {
  if (typeof raw !== "string") {
    throw new RenderError("UNSAFE_ASSET", "SVG view must be a string.");
  }
  const input = raw.replace(/^\uFEFF/, "");
  const needsScope = /<style[\s>/]/i.test(input);
  const scopeClass = `dod-svg-${createHash("sha256").update(input, "utf8").digest("hex").slice(0, 16)}`;
  if (Buffer.byteLength(input, "utf8") > MAX_SVG_BYTES) {
    throw new RenderError("UNSAFE_ASSET", "SVG exceeds size limit.");
  }
  if (input.includes("\0")) {
    throw new RenderError("UNSAFE_ASSET", "SVG contains NUL.");
  }
  if (/<!DOCTYPE/i.test(input) || /<!ENTITY/i.test(input) || /<\?/.test(input) || /<!\[CDATA\[/i.test(input)) {
    throw new RenderError("UNSAFE_ASSET", "SVG declares doctype, entity, CDATA, or processing instruction.");
  }
  if (/<script/i.test(input) || /<foreignobject/i.test(input) || /javascript:/i.test(input)) {
    throw new RenderError("UNSAFE_ASSET", "SVG contains script, foreignObject, or javascript: URL.");
  }
  const out = [];
  let i = 0;
  let depth = 0;
  let sawSvg = false;
  const open = [];
  while (i < input.length) {
    if (input.startsWith("<!--", i)) {
      const end = input.indexOf("-->", i + 4);
      if (end < 0) throw new RenderError("UNSAFE_ASSET", "Unterminated SVG comment.");
      i = end + 3;
      continue;
    }
    const lt = input.indexOf("<", i);
    if (lt < 0) {
      if (input.slice(i).trim()) out.push(esc(decodeSvgXmlValue(input.slice(i), "text")));
      break;
    }
    if (lt > i) out.push(esc(decodeSvgXmlValue(input.slice(i, lt), "text")));
    if (input.startsWith("</", lt)) {
      const m = /^<\/([A-Za-z][\w:-]*)\s*>/.exec(input.slice(lt));
      if (!m) throw new RenderError("UNSAFE_ASSET", "Malformed SVG end tag.");
      const name = m[1].toLowerCase();
      if (!SVG_ALLOWED_TAGS.has(name)) {
        throw new RenderError("UNSAFE_ASSET", `SVG tag not allowed: ${name}`);
      }
      if (open.pop() !== name) throw new RenderError("UNSAFE_ASSET", "SVG tag mismatch.");
      out.push(`</${name}>`);
      depth -= 1;
      i = lt + m[0].length;
      continue;
    }
    const tagM = /^<([A-Za-z][\w:-]*)/.exec(input.slice(lt));
    if (!tagM) throw new RenderError("UNSAFE_ASSET", "Malformed SVG start tag.");
    const rawName = tagM[1];
    const name = rawName.toLowerCase();
    if (!SVG_ALLOWED_TAGS.has(name)) {
      throw new RenderError("UNSAFE_ASSET", `SVG tag not allowed: ${name}`);
    }
    let p = lt + tagM[0].length;
    while (p < input.length && /\s/.test(input[p])) p += 1;
    let q = p;
    let quote = null;
    while (q < input.length) {
      const ch = input[q];
      if (quote) {
        if (ch === quote) quote = null;
        q += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        q += 1;
        continue;
      }
      if (ch === ">") break;
      q += 1;
    }
    if (q >= input.length) throw new RenderError("UNSAFE_ASSET", "Unterminated SVG tag.");
    const attrRaw = input.slice(p, q).trim().replace(/\/\s*$/, "");
    const selfClosing = /\/\s*$/.test(input.slice(p, q)) || input[q - 1] === "/";
    const attrs = parseAttrs(attrRaw, name);
    if (name === "svg") {
      sawSvg = true;
      if (needsScope) {
        let hasClass = false;
        for (const pair of attrs) {
          if (pair[0] === "class") {
            const parts = String(pair[1]).split(/\s+/).filter(Boolean);
            if (!parts.includes(scopeClass)) parts.push(scopeClass);
            pair[1] = parts.join(" ");
            hasClass = true;
          }
        }
        if (!hasClass) attrs.push(["class", scopeClass]);
      }
    }
    let attrHtml = "";
    for (const [k, v] of attrs) {
      attrHtml += ` ${k}="${esc(v)}"`;
    }
    i = q + 1;
    if (name === "style") {
      const close = input.toLowerCase().indexOf("</style>", i);
      if (close < 0) throw new RenderError("UNSAFE_ASSET", "Unterminated SVG style.");
      const css = decodeSvgXmlValue(input.slice(i, close), "style");
      const scoped = sanitizeStylesheet(css, `.${scopeClass}`);
      if (/</.test(scoped)) {
        throw new RenderError("UNSAFE_ASSET", "Unsafe SVG stylesheet.");
      }
      out.push(`<style${attrHtml}>${scoped}</style>`);
      i = close + "</style>".length;
      continue;
    }
    if (selfClosing) {
      out.push(`<${name}${attrHtml} />`);
    } else {
      out.push(`<${name}${attrHtml}>`);
      open.push(name);
      depth += 1;
    }
  }
  if (open.length !== 0 || depth !== 0) {
    throw new RenderError("UNSAFE_ASSET", "SVG tags were not closed.");
  }
  if (!sawSvg) throw new RenderError("UNSAFE_ASSET", "View is not an SVG document.");
  return out.join("");
}

export function embedPng(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8 || buf.length > MAX_PNG_BYTES || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new RenderError("UNSAFE_ASSET", "View is not a PNG or exceeds size limit.");
  }
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function modelActivated(model) {
  if (!model || typeof model !== "object") return false;
  if (model.not_applicable === true || isNaStatus(model.mode) || isNaStatus(model.render_status)) {
    return false;
  }
  if (model.selected === false && model.required === false) return false;
  return true;
}

function viewSpec(model) {
  if (!model) return null;
  if (model.view && typeof model.view === "object") return model.view;
  if (Array.isArray(model.views) && model.views[0] && typeof model.views[0] === "object") {
    return model.views[0];
  }
  return null;
}

function hasPlannedBinding(model) {
  return Boolean(viewSpec(model) || (model && model.digest));
}

function indexSupplementalModelViews(closeout, planningModels) {
  const indexed = new Map();
  const raw = closeout && closeout.model_views;
  if (raw == null) return indexed;
  if (!Array.isArray(raw)) {
    throw new RenderError("SCHEMA", "closeout.model_views must be an array.");
  }
  const byId = new Map();
  for (const model of planningModels) {
    if (model && model.id) byId.set(String(model.id), model);
  }
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new RenderError("SCHEMA", "closeout.model_views entries must be objects.");
    }
    const modelId = entry.model_id;
    if (!modelId || typeof modelId !== "string") {
      throw new RenderError("SCHEMA", "closeout.model_views[].model_id is required.");
    }
    for (const key of Object.keys(entry)) {
      if (!SUPPLEMENT_KEYS.has(key)) {
        throw new RenderError(
          "SEMANTIC_OVERRIDE",
          `closeout.model_views for ${modelId} may not set planning field ${key}.`
        );
      }
    }
    if (entry.view != null) {
      if (typeof entry.view !== "object" || Array.isArray(entry.view)) {
        throw new RenderError("SCHEMA", `${modelId} closeout.model_views.view must be an object.`);
      }
      for (const key of Object.keys(entry.view)) {
        if (!VIEW_KEYS.has(key)) {
          throw new RenderError(
            "SEMANTIC_OVERRIDE",
            `closeout.model_views for ${modelId} view may not set ${key}.`
          );
        }
      }
    }
    if (indexed.has(modelId)) {
      throw new RenderError("DUPLICATE_VIEW_BINDING", `Duplicate closeout.model_views for ${modelId}.`);
    }
    const planned = byId.get(modelId);
    if (!planned) {
      throw new RenderError(
        "UNKNOWN_VIEW_BINDING",
        `closeout.model_views model_id ${modelId} is not a planning model.`
      );
    }
    if (!modelActivated(planned)) {
      throw new RenderError(
        "CONFLICTING_VIEW_BINDING",
        `closeout.model_views may not bind an inactive or N/A planning model ${modelId}.`
      );
    }
    if (hasPlannedBinding(planned)) {
      throw new RenderError(
        "CONFLICTING_VIEW_BINDING",
        `closeout.model_views may not override an already-planned binding for ${modelId}.`
      );
    }
    if (!entry.digest || !entry.view) {
      throw new RenderError(
        "MISSING_VIEW",
        `${modelId} closeout.model_views requires digest and view.\n${bindingRequirement(modelId)}`
      );
    }
    indexed.set(modelId, entry);
  }
  return indexed;
}

function loadView(model, assetRoot) {
  const spec = viewSpec(model);
  if (!spec) return null;
  const format = String(spec.format || "").toLowerCase();
  if (format !== "svg" && format !== "png") {
    throw new RenderError(
      "MISSING_VIEW",
      `${model.id || "model"} view.format must be "svg" or "png".\n${bindingRequirement(model.id)}`
    );
  }
  if (format === "svg" && spec.inline != null) {
    const bytes = Buffer.from(String(spec.inline), "utf8");
    return { format, bytes, svg: sanitizeSvg(String(spec.inline)), pngUri: null };
  }
  if (!spec.path) {
    throw new RenderError(
      "MISSING_VIEW",
      `${model.id || "model"} view.path or svg view.inline is required.\n${bindingRequirement(model.id)}`
    );
  }
  const resolved = resolveUnder(assetRoot, spec.path);
  if (!existsSync(resolved)) {
    throw new RenderError("MISSING_VIEW", `${model.id || "model"} view path not found: ${spec.path}`);
  }
  const bytes = readFileSync(resolved);
  if (format === "svg") {
    return { format, bytes, svg: sanitizeSvg(bytes.toString("utf8")), pngUri: null };
  }
  return { format, bytes, svg: null, pngUri: embedPng(bytes) };
}

function verifyDigest(model, bytes) {
  const expected = normalizeDigest(model.digest);
  if (!expected) {
    throw new RenderError(
      "MISSING_VIEW",
      `${model.id || "model"} is missing digest.\n${bindingRequirement(model.id)}`
    );
  }
  const actual = sha256Hex(bytes);
  if (actual !== expected) {
    throw new RenderError(
      "STALE_VIEW",
      `${model.id || "model"} view digest is stale: expected sha256:${expected}, actual sha256:${actual}`
    );
  }
  return actual;
}

function tableHint() {
  return `          <p class="table-hint">Tables scroll horizontally on a narrow screen.</p>`;
}

function renderTable(captionId, caption, headers, rows) {
  const head = headers
    .map((h) => `                  <th scope="col">${esc(h)}</th>`)
    .join("\n");
  const body = rows
    .map((row) => {
      const kind = row.kind || statusKind(row.status);
      const cells = row.cells
        .map((cell, idx) => {
          if (idx === 0) {
            return `                  <th scope="row" class="id">${cell}</th>`;
          }
          const digestClass = headers[idx] && /digest/i.test(headers[idx]) ? ' class="cell-digest"' : "";
          return `                  <td${digestClass}>${cell}</td>`;
        })
        .join("\n");
      return `                <tr class="row-${kind}">\n${cells}\n                </tr>`;
    })
    .join("\n");
  return [
    tableHint(),
    `          <div class="table-scroll" role="region" tabindex="0" aria-labelledby="${esc(captionId)}">`,
    "            <table>",
    `              <caption id="${esc(captionId)}">${esc(caption)}</caption>`,
    "              <thead>",
    "                <tr>",
    head,
    "                </tr>",
    "              </thead>",
    "              <tbody>",
    body,
    "              </tbody>",
    "            </table>",
    "          </div>",
  ].join("\n");
}

function naBlock(title, reason) {
  return [
    `          <p class="banner"><strong>${esc(title)} not applicable.</strong> ${esc(reason)}</p>`,
  ].join("\n");
}

function listBlock(items, emptyReason) {
  if (!Array.isArray(items) || items.length === 0) {
    return `          <p>${esc(emptyReason)}</p>`;
  }
  const lis = items.map((item) => `            <li>${esc(item)}</li>`).join("\n");
  return `          <ul class="plain">\n${lis}\n          </ul>`;
}

function metaBlock(entries) {
  if (!entries.length) return "";
  const rows = entries
    .map(([dt, dd]) => `            <dt>${esc(dt)}</dt>\n            <dd>${dd}</dd>`)
    .join("\n");
  return `          <dl class="meta">\n${rows}\n          </dl>`;
}

function cellText(value) {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return esc(value.join(", "));
  if (typeof value === "object") return esc(JSON.stringify(value));
  return esc(value);
}

function cellStatus(row) {
  return statusChip(field(row, "status", "render_status", "state"), field(row, "reason", "limitations_reason"));
}

function heading(index, section) {
  const title =
    section.id === "s6"
      ? "V&amp;V cases, assurance cadence, evidence, and pass/fail status"
      : esc(section.title);
  return `          <h2 id="h-${section.id}"><span class="secno">${index}</span>${title}</h2>`;
}

function wrapSection(section, inner) {
  return [
    `        <section class="block" id="${section.id}" aria-labelledby="h-${section.id}">`,
    inner,
    "        </section>",
  ].join("\n");
}

function identityEntries(man, doc) {
  const entries = [];
  if (Array.isArray(man.identity)) {
    for (const item of man.identity) {
      entries.push([item.label || item.id || "Field", `<code>${esc(item.value ?? "")}</code>`]);
    }
  }
  entries.push(["Manifest file", `<code>${esc(man.output_name || "")}</code>`]);
  entries.push(["Template", `<code>dod-manifest-v1 ${esc(man.template_version || TEMPLATE_VERSION)}</code>`]);
  entries.push(["Source artifact", "<code>implementation.json.dod_manifest</code>"]);
  if (doc?.source_baseline?.revision) {
    const hasBaseline = entries.some(([label]) => String(label).toLowerCase() === "baseline");
    if (!hasBaseline) {
      entries.push(["Baseline", `<code>${esc(doc.source_baseline.revision)}</code>`]);
    }
  }
  return entries;
}

function strategyEntries(doc, man) {
  const entries = [];
  const raw = man.development_strategy ?? doc?.journey_settings?.development_strategy;
  if (typeof raw === "string") entries.push(["Development strategy", `<code>${esc(raw)}</code>`]);
  else if (raw && typeof raw === "object" && raw.mode) {
    entries.push(["Development strategy", `<code>${esc(raw.mode)}</code>`]);
  }
  const conc = man.concurrency ?? doc?.journey_settings?.concurrency;
  if (typeof conc === "string") entries.push(["Concurrency", esc(conc)]);
  else if (conc && typeof conc === "object") {
    if (conc.dispatch_ready_independent_work === true) {
      entries.push([
        "Concurrency",
        "Dispatch every dependency-ready, proven-independent task within host and resource limits.",
      ]);
    } else if (conc.summary) {
      entries.push(["Concurrency", esc(conc.summary)]);
    }
  }
  return entries;
}

function cadenceEntries(doc, man) {
  const c = man.assurance_cadence ?? man.cadence ?? doc?.journey_settings?.assurance_cadence;
  if (!c || typeof c !== "object") return [];
  const entries = [];
  if (c.test_engineer?.assurance) {
    entries.push(["Test Engineer assurance", `<code>${esc(c.test_engineer.assurance)}</code>`]);
  }
  if (c.reviewer) entries.push(["Reviewer", `<code>${esc(c.reviewer)}</code>`]);
  if (c.integration_engineer?.execution) {
    entries.push([
      "Integration Engineer execution",
      `<code>${esc(c.integration_engineer.execution)}</code>`,
    ]);
  }
  return entries;
}

function renderModelFigure(model, loaded, boundDigest) {
  const captionId = `view-${esc(String(model.id || "model").toLowerCase())}`;
  const title = field(model, "title", "viewpoint", "id");
  let graphic;
  if (loaded.format === "svg") {
    graphic = loaded.svg;
  } else {
    graphic = `<img src="${loaded.pngUri}" alt="${esc(title)}" />`;
  }
  const digest = normalizeDigest(boundDigest || model.digest);
  return [
    `          <figure class="model" id="${captionId}">`,
    `            <div class="model-scroll" role="region" tabindex="0" aria-label="${esc(title)}">`,
    `            ${graphic}`,
    "            </div>",
    "            <figcaption>",
    `              <strong>${esc(model.id)}.</strong> ${esc(field(model, "limitations") || "Digest-bound human projection. Source artifacts remain authoritative.")}`,
    "              <dl>",
    "                <dt>Mode</dt>",
    `                <dd>${esc(field(model, "mode"))}</dd>`,
    "                <dt>Source</dt>",
    `                <dd>${esc(field(model, "source"))}</dd>`,
    "                <dt>Digest</dt>",
    `                <dd class="cell-digest">sha256:${esc(digest)}</dd>`,
    "                <dt>Viewpoint</dt>",
    `                <dd>${esc(field(model, "viewpoint"))}</dd>`,
    "                <dt>Trace links</dt>",
    `                <dd>${esc(field(model, "trace"))}</dd>`,
    "                <dt>Limitation</dt>",
    `                <dd>${esc(field(model, "limitations"))}</dd>`,
    "              </dl>",
    "            </figcaption>",
    "          </figure>",
  ].join("\n");
}

function closeoutEntries(closeout) {
  if (!closeout || typeof closeout !== "object") {
    return {
      candidate: "pending",
      changed: [],
      evidence: [],
      gaps: [],
      acceptance: "pending",
      receipts: [],
      amendments: [],
      extras: [],
    };
  }
  const known = new Set([
    "candidate",
    "changed_paths",
    "evidence",
    "open_gaps",
    "owner_acceptance",
    "slice_receipts",
    "amendments",
    "owner_amendments",
    "documentation_completion",
    "anomalies",
    "repairs",
    "recovery_used",
    "residual_gaps",
    "completion_status",
    "model_views",
  ]);
  const extras = Object.keys(closeout)
    .filter((k) => !known.has(k))
    .sort()
    .map((k) => [k, closeout[k]]);
  return {
    candidate: closeout.candidate ?? "pending",
    changed: Array.isArray(closeout.changed_paths) ? closeout.changed_paths : [],
    evidence: Array.isArray(closeout.evidence) ? closeout.evidence : [],
    gaps: Array.isArray(closeout.open_gaps)
      ? closeout.open_gaps
      : Array.isArray(closeout.residual_gaps)
        ? closeout.residual_gaps
        : [],
    acceptance: closeout.owner_acceptance ?? "pending",
    receipts: Array.isArray(closeout.slice_receipts) ? closeout.slice_receipts : [],
    amendments: Array.isArray(closeout.amendments)
      ? closeout.amendments
      : Array.isArray(closeout.owner_amendments)
        ? closeout.owner_amendments
        : [],
    documentation: closeout.documentation_completion,
    anomalies: closeout.anomalies,
    repairs: closeout.repairs,
    recovery: closeout.recovery_used,
    completion: closeout.completion_status,
    extras,
  };
}

function listOrPending(arr, pendingLabel = "pending") {
  if (!Array.isArray(arr) || arr.length === 0) return pendingLabel;
  return arr.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(", ");
}

function currentSliceStatus(closeout, taskId) {
  const slices = closeout && closeout.current_execution_state && closeout.current_execution_state.slice_state;
  if (!slices || typeof slices !== "object" || Array.isArray(slices) || taskId == null) return "";
  const value = slices[taskId];
  return value == null || String(value).trim() === "" ? "" : value;
}

function currentRiskDisposition(closeout, riskId) {
  const rows = closeout && closeout.risk_disposition;
  if (!Array.isArray(rows) || riskId == null) return null;
  return rows.find((row) => row && (row.id === riskId || row.risk_id === riskId)) || null;
}

/**
 * @param {object} doc
 * @param {{ assetRoot?: string, templateHtml?: string, templatePath?: string }} [opts]
 */
export function renderDodManifest(doc, opts = {}) {
  if (!doc || typeof doc !== "object" || !doc.dod_manifest || typeof doc.dod_manifest !== "object") {
    throw new RenderError("SCHEMA", "implementation.json.dod_manifest is required.");
  }
  const man = doc.dod_manifest;
  if (!man.title || !man.output_name || !man.template_version) {
    throw new RenderError("SCHEMA", "dod_manifest requires title, output_name, and template_version.");
  }
  if (String(man.template_version) !== TEMPLATE_VERSION) {
    throw new RenderError(
      "SCHEMA",
      `dod_manifest.template_version ${man.template_version} does not match renderer ${TEMPLATE_VERSION}.`
    );
  }
  const assetRoot = opts.assetRoot || process.cwd();
  const failures = [];
  const modelFigures = [];
  const modelsParsed = asRows(man.models);
  const planningModels = modelsParsed.na ? [] : modelsParsed.value;
  const supplementalViews = indexSupplementalModelViews(man.closeout, planningModels);

  const modelRows = [];
  if (!modelsParsed.na) {
    for (const model of planningModels) {
      const activated = modelActivated(model);
      const plannedSpec = viewSpec(model);
      const supplemental = supplementalViews.get(model.id);
      const spec = plannedSpec || (supplemental && supplemental.view) || null;
      const boundDigest = model.digest || (supplemental && supplemental.digest) || "";
      let kind = statusKind(model.render_status);
      let statusLabel = model.render_status || "";
      let reason = field(model, "reason");
      if (!activated) {
        if (isNaStatus(model.render_status) || isNaStatus(model.mode) || model.not_applicable) {
          kind = "na";
          statusLabel = model.render_status || "Not applicable";
          reason = reason || field(model, "limitations") || "Not applicable.";
        }
        modelRows.push({
          kind,
          status: statusLabel,
          cells: [
            esc(model.id),
            cellText(model.mode),
            cellText(model.source),
            cellText(model.digest || "None"),
            cellText(model.viewpoint),
            cellText(model.trace),
            cellText(model.limitations),
            statusChip(statusLabel, reason),
          ],
        });
        continue;
      }
      try {
        if (String(model.render_status || "").toLowerCase() === "missing") {
          throw new RenderError(
            "MISSING_VIEW",
            `${model.id} selected/required view is missing.\n${bindingRequirement(model.id)}`
          );
        }
        if (String(model.render_status || "").toLowerCase() === "stale") {
          throw new RenderError("STALE_VIEW", `${model.id} selected/required view is marked stale.`);
        }
        if (!spec) {
          throw new RenderError(
            "MISSING_VIEW",
            `${model.id} has no view binding.\n${bindingRequirement(model.id)}`
          );
        }
        const loaded = loadView({ id: model.id, view: spec }, assetRoot);
        verifyDigest({ id: model.id, digest: boundDigest }, loaded.bytes);
        statusLabel = model.render_status || "Embedded";
        kind = statusKind(statusLabel) === "plan" ? "pass" : statusKind(statusLabel);
        modelRows.push({
          kind,
          status: statusLabel,
          cells: [
            esc(model.id),
            cellText(model.mode),
            cellText(model.source),
            model.digest ? `sha256:${esc(normalizeDigest(model.digest))}` : cellText("None"),
            cellText(model.viewpoint),
            cellText(model.trace),
            cellText(model.limitations),
            statusChip(statusLabel),
          ],
        });
        modelFigures.push(renderModelFigure(model, loaded, boundDigest));
      } catch (err) {
        const code = err instanceof RenderError ? err.code : "UNSAFE_ASSET";
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ code, message, modelId: model.id });
        const gapLabel =
          code === "STALE_VIEW" ? model.render_status || "Stale" : model.render_status || "Missing";
        modelRows.push({
          kind: "gap",
          status: gapLabel,
          cells: [
            esc(model.id),
            cellText(model.mode),
            cellText(model.source),
            cellText(model.digest || "None"),
            cellText(model.viewpoint),
            cellText(model.trace),
            cellText(model.limitations),
            statusChip(gapLabel, message.split("\n")[0]),
          ],
        });
      }
    }
  }

  const stateLabel = man.state || "planning";
  const lede =
    man.lede ||
    "Human-readable projection of the source artifacts. The source artifacts remain authoritative.";

  const s1 = [
    heading(1, SECTIONS[0]),
    `          <div class="bluf">`,
    `            <p><strong>${esc(man.bluf || "")}</strong></p>`,
    `            <p><strong>Lifecycle state.</strong> ${statusChip(stateLabel)}</p>`,
    `            <p>This manifest compares authorized intent with planned work, evidence, and gaps. It does not grant execution, acceptance, release, or deployment.</p>`,
    `          <ul class="legend status-key" aria-label="Status key">`,
    `            <li><span class="status status-plan"><span class="mark" aria-hidden="true"></span>Planned</span> not yet evidenced</li>`,
    `            <li><span class="status status-pass"><span class="mark" aria-hidden="true"></span>Confirmed</span> or embedded</li>`,
    `            <li><span class="status status-hold"><span class="mark" aria-hidden="true"></span>Hold</span> waiting on owner or candidate</li>`,
    `            <li><span class="status status-gap"><span class="mark" aria-hidden="true"></span>Gap</span> selected content missing</li>`,
    `            <li><span class="status status-na"><span class="mark" aria-hidden="true"></span>Not applicable</span> with a visible reason</li>`,
    "          </ul>",
    "          </div>",
  ].join("\n");

  const s2 = [heading(2, SECTIONS[1]), metaBlock(identityEntries(man, doc))].join("\n");

  const dodParsed = asRows(man.definition_of_done);
  const dodTable = dodParsed.na
    ? naBlock("Definition of Done", dodParsed.reason)
    : renderTable(
        "cap-dod",
        "Definition of Done criteria",
        ["ID", "Criterion", "Evidence", "Status"],
        dodParsed.value.map((row) => ({
          kind: statusKind(row.status),
          status: row.status,
          cells: [
            esc(row.id),
            cellText(row.criterion || row.statement),
            cellText(row.evidence),
            cellStatus(row),
          ],
        }))
      );
  const s3 = [
    heading(3, SECTIONS[2]),
    "          <h3>Planned outcome</h3>",
    `          <p>${esc(man.outcome || "")}</p>`,
    "          <h3>Scope</h3>",
    listBlock(man.scope, "None recorded."),
    "          <h3>Exclusions</h3>",
    listBlock(man.exclusions, "None recorded."),
    dodTable,
  ].join("\n");

  const reqParsed = asRows(man.requirements);
  const reqTable = reqParsed.na
    ? naBlock("Requirements", reqParsed.reason)
    : renderTable(
        "cap-req",
        "Requirements and acceptance",
        ["ID", "Statement", "Source", "Status"],
        reqParsed.value.map((row) => ({
          kind: statusKind(row.status),
          status: row.status,
          cells: [
            esc(row.id),
            cellText(row.statement),
            cellText(row.source),
            cellStatus(row),
          ],
        }))
      );
  const archParsed = asRows(man.architecture);
  const archTable = archParsed.na
    ? naBlock("Architecture, design, and interfaces", archParsed.reason)
    : renderTable(
        "cap-des",
        "Architecture, design, and interfaces",
        ["ID", "Decision", "Interfaces", "Status"],
        archParsed.value.map((row) => ({
          kind: statusKind(row.status),
          status: row.status,
          cells: [
            esc(row.id),
            cellText(row.decision || row.summary),
            cellText(row.interfaces || row.contract),
            cellStatus(row),
          ],
        }))
      );
  const modelTable = modelsParsed.na
    ? naBlock("Model inventory", modelsParsed.reason)
    : renderTable(
        "cap-model",
        "System-model inventory. Systems Modeler owns semantics; this page only projects prepared views.",
        ["ID", "Mode", "Source", "Digest", "Viewpoint", "Trace", "Limitation", "Render"],
        modelRows
      );
  const figures = modelFigures.length
    ? ["          <h3>Embedded model views</h3>", ...modelFigures].join("\n")
    : "";
  const s4 = [
    heading(4, SECTIONS[3]),
    "          <h3>Requirements and acceptance</h3>",
    reqTable,
    "          <h3>Architecture, design, and interfaces</h3>",
    archTable,
    "          <h3>Model inventory</h3>",
    modelTable,
    figures,
  ].join("\n");

  const taskParsed = asRows(man.tasks);
  const taskTable = taskParsed.na
    ? naBlock("Task graph", taskParsed.reason)
    : renderTable(
        "cap-task",
        "Implementation tasks, roles, dependencies, and exact write sets",
        ["ID", "Role", "Depends on", "Write set", "Status"],
        taskParsed.value.map((row) => {
          const planned = field(row, "status");
          const current = currentSliceStatus(man.closeout, row.id);
          return {
            kind: statusKind(current || planned),
            status: current || planned,
            cells: [
              esc(row.id),
              cellText(row.role),
              cellText(row.depends_on),
              cellText(row.write_set),
              statusChip(current || planned),
            ],
          };
        })
      );
  const lineupParsed = asRows(man.lineup);
  const lineupTable = lineupParsed.na
    ? ""
    : [
        "          <h3>Roles and routes</h3>",
        renderTable(
          "cap-lineup",
          "Role and session routing",
          ["Role", "Session", "Configured primary", "Effective route", "Status"],
          lineupParsed.value.map((row) => ({
            kind: statusKind(row.status),
            status: row.status,
            cells: [
              esc(row.role),
              cellText(row.session),
              cellText(row.configured_primary),
              cellText(row.effective_route),
              cellStatus(row),
            ],
          }))
        ),
      ].join("\n");
  const s5 = [
    heading(5, SECTIONS[4]),
    metaBlock(strategyEntries(doc, man)),
    "          <h3>Task graph</h3>",
    taskTable,
    lineupTable,
  ].join("\n");

  const vvParsed = asRows(man.vv);
  const vvTable = vvParsed.na
    ? naBlock("V&V", vvParsed.reason)
    : renderTable(
        "cap-seit",
        "SEIT cases and projected evidence",
        ["ID", "Method", "Cadence", "Evidence", "Status"],
        vvParsed.value.map((row) => ({
          kind: statusKind(row.status),
          status: row.status,
          cells: [
            esc(row.id),
            cellText(row.method),
            cellText(row.cadence),
            cellText(row.evidence),
            cellStatus(row),
          ],
        }))
      );
  const s6 = [heading(6, SECTIONS[5]), metaBlock(cadenceEntries(doc, man)), vvTable].join("\n");

  const docParsed = asRows(man.documentation);
  const docTable = docParsed.na
    ? naBlock("Documentation impact", docParsed.reason)
    : renderTable(
        "cap-doc",
        "Documentation impact, timing, and verification",
        ["Surface", "Impact", "Owner", "Timing", "Verification", "Status"],
        docParsed.value.map((row) => ({
          kind: statusKind(row.status),
          status: row.status,
          cells: [
            esc(row.surface || row.path || row.id),
            cellText(row.impact),
            cellText(row.owner || row.task),
            cellText(row.timing),
            cellText(row.verification),
            cellStatus(row),
          ],
        }))
      );
  const s7 = [heading(7, SECTIONS[6]), docTable].join("\n");

  const riskParsed = asRows(man.risks);
  const riskTable = riskParsed.na
    ? naBlock("Risks and recovery", riskParsed.reason)
    : renderTable(
        "cap-risk",
        "Risks, gaps, exceptions, anomaly handling, rollback, and recovery",
        [
          "ID",
          "Risk",
          "Control",
          "Recovery",
          "Status",
          "Current mitigation",
          "Current evidence",
        ],
        riskParsed.value.map((row) => {
          const planned = field(row, "status");
          const disp = currentRiskDisposition(man.closeout, row.id);
          const current = disp ? field(disp, "status") : "";
          return {
            kind: statusKind(current || planned),
            status: current || planned,
            cells: [
              esc(row.id),
              cellText(row.risk || row.item),
              cellText(row.control || row.handling),
              cellText(row.recovery),
              statusChip(current || planned),
              cellText(disp ? field(disp, "mitigation") : ""),
              cellText(disp ? field(disp, "evidence") : ""),
            ],
          };
        })
      );
  const s8 = [heading(8, SECTIONS[7]), riskTable].join("\n");

  const authParsed = asRows(man.authority);
  const authTable = authParsed.na
    ? naBlock("Authority", authParsed.reason)
    : renderTable(
        "cap-auth",
        "Authority, decisions, and approvals",
        ["Event", "Owner", "Evidence", "Status"],
        authParsed.value.map((row) => ({
          kind: statusKind(row.status),
          status: row.status,
          cells: [
            esc(row.event || row.id),
            cellText(row.owner),
            cellText(row.evidence),
            cellStatus(row),
          ],
        }))
      );
  const close = closeoutEntries(man.closeout);
  const closeTable = renderTable(
    "cap-close",
    "Append-only closeout",
    ["Candidate", "Changed paths", "Evidence", "Open gaps", "Owner acceptance"],
    [
      {
        kind: statusKind(close.acceptance),
        status: close.acceptance,
        cells: [
          statusChip(close.candidate),
          cellText(listOrPending(close.changed, "pending")),
          cellText(listOrPending(close.evidence, "pending")),
          cellText(listOrPending(close.gaps, "none recorded")),
          statusChip(close.acceptance),
        ],
      },
    ]
  );
  const receiptTable = close.receipts.length
    ? [
        "          <h3>Slice receipts</h3>",
        renderTable(
          "cap-receipts",
          "Append-only slice receipts",
          ["Slice", "Status", "Route", "Residual / blocker"],
          close.receipts.map((row) => ({
            kind: statusKind(row.status),
            status: row.status,
            cells: [
              esc(row.slice || row.id),
              statusChip(row.status),
              cellText(row.route),
              cellText(row.residual || row.blocker || "none recorded"),
            ],
          }))
        ),
      ].join("\n")
    : "";
  const amendTable = close.amendments.length
    ? [
        "          <h3>Owner-approved amendments</h3>",
        renderTable(
          "cap-amend",
          "Append-only owner amendments",
          ["ID", "Decision", "Evidence"],
          close.amendments.map((row) => ({
            kind: "pass",
            status: row.status || "CONFIRMED",
            cells: [
              esc(row.id || row.event),
              cellText(row.decision || row.statement),
              cellText(row.evidence || row.source),
            ],
          }))
        ),
      ].join("\n")
    : "";
  const extraClose = [];
  if (close.documentation != null) {
    extraClose.push(["Documentation completion", cellText(close.documentation)]);
  }
  if (close.anomalies != null) extraClose.push(["Anomalies", cellText(close.anomalies)]);
  if (close.repairs != null) extraClose.push(["Repairs", cellText(close.repairs)]);
  if (close.recovery != null) extraClose.push(["Recovery used", cellText(close.recovery)]);
  if (close.completion != null) extraClose.push(["Completion status", cellText(close.completion)]);
  for (const [k, v] of close.extras) extraClose.push([k, cellText(v)]);
  const s9 = [
    heading(9, SECTIONS[8]),
    "          <p>Closeout is append-only over the owner-approved planning projection. Changing planning content requires an explicit owner-approved plan amendment. This page does not grant execution, acceptance, release, or deployment.</p>",
    authTable,
    "          <h3>Closeout actuals</h3>",
    closeTable,
    extraClose.length ? metaBlock(extraClose) : "",
    receiptTable,
    amendTable,
    `          <p class="banner"><strong>Non-authoritative projection.</strong> Source artifacts remain the authority. State: ${esc(stateLabel)}.</p>`,
  ].join("\n");

  const inner = [
    wrapSection(SECTIONS[0], s1),
    wrapSection(SECTIONS[1], s2),
    wrapSection(SECTIONS[2], s3),
    wrapSection(SECTIONS[3], s4),
    wrapSection(SECTIONS[4], s5),
    wrapSection(SECTIONS[5], s6),
    wrapSection(SECTIONS[6], s7),
    wrapSection(SECTIONS[7], s8),
    wrapSection(SECTIONS[8], s9),
  ].join("\n\n");

  const toc = SECTIONS.map((section, idx) => {
    const label = idx === 5 ? "V&amp;V cases, assurance cadence, evidence, and status" : esc(section.title);
    return `          <li><a href="#${section.id}">${label}</a></li>`;
  }).join("\n");

  const body = [
    `  <a class="skip" href="#main">Skip to content</a>`,
    `  <div class="page">`,
    `    <header class="mast">`,
    `      <div class="kicker">`,
    `        <span class="stamp stamp-state">State: ${esc(stateLabel)}</span>`,
    `        <span class="stamp">Template ${esc(TEMPLATE_VERSION)}</span>`,
    `        <span class="stamp stamp-warn">Not authority</span>`,
    `      </div>`,
    `      <h1>${esc(man.title)}</h1>`,
    `      <p class="lede">${esc(lede)}</p>`,
    `    </header>`,
    `    <div class="layout">`,
    `      <nav class="toc" aria-label="Manifest sections">`,
    `        <p class="toc-title" id="toc-title">On this page</p>`,
    `        <ol>`,
    toc,
    `        </ol>`,
    `      </nav>`,
    `      <main id="main">`,
    inner,
    `      </main>`,
    `    </div>`,
    `    <footer class="colophon">`,
    `      <p>${esc(man.title)}. State: ${esc(stateLabel)}. Template ${esc(TEMPLATE_VERSION)}. Self-contained HTML and CSS with no script, no external font, no CDN, and no network image.</p>`,
    `    </footer>`,
    `  </div>`,
  ].join("\n");

  const templateHtml =
    opts.templateHtml ||
    readFileSync(opts.templatePath || defaultTemplatePath(), "utf8").replace(/\r\n/g, "\n");
  if (!templateHtml.includes("<!--DOD_TITLE-->") || !templateHtml.includes("<!--DOD_BODY-->")) {
    throw new RenderError("SCHEMA", "dod-manifest-v1.html is missing required placeholders.");
  }
  const html = templateHtml
    .replace("<!--DOD_TITLE-->", esc(man.title))
    .replace("<!--DOD_BODY-->", body)
    .replace(/\r\n/g, "\n");
  const normalized = html.endsWith("\n") ? html : `${html}\n`;

  if (failures.length) {
    throw new RenderError(
      failures[0].code,
      failures.map((item) => item.message).join("\n"),
      { html: normalized, failures }
    );
  }
  return { html: normalized, outputName: man.output_name, digest: sha256Hex(Buffer.from(normalized, "utf8")) };
}

export function defaultTemplatePath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", TEMPLATE_RELATIVE);
}

export function outputPathFor(inputPath, outputName, explicitOut) {
  if (explicitOut) return path.resolve(explicitOut);
  return path.join(path.dirname(path.resolve(inputPath)), outputName);
}

export function renderFile(inputPath, options = {}) {
  const resolved = path.resolve(inputPath);
  const raw = readFileSync(resolved, "utf8").replace(/^\uFEFF/, "");
  const doc = JSON.parse(raw);
  return renderDodManifest(doc, { ...options, assetRoot: options.assetRoot || path.dirname(resolved) });
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let input = null;
  let check = false;
  let out = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--check") check = true;
    else if (arg === "--out") {
      out = args[i + 1];
      i += 1;
      if (!out) throw new RenderError("USAGE", "Missing value for --out.");
    } else if (arg.startsWith("-")) {
      throw new RenderError("USAGE", `Unknown flag: ${arg}`);
    } else if (!input) input = arg;
    else throw new RenderError("USAGE", "Multiple input paths are not supported.");
  }
  if (!input) {
    throw new RenderError(
      "USAGE",
      "Usage: node tools/render-dod-manifest.mjs <implementation.json> [--check] [--out path]"
    );
  }
  return { input, check, out };
}

function main(argv = process.argv) {
  try {
    const { input, check, out } = parseArgs(argv);
    const result = renderFile(input, {});
    const target = outputPathFor(input, result.outputName, out);
    if (check) {
      if (!existsSync(target)) {
        throw new RenderError("CHECK_MISMATCH", `Expected output is missing: ${target}`);
      }
      const expected = readFileSync(target, "utf8").replace(/\r\n/g, "\n");
      const expectedNorm = expected.endsWith("\n") ? expected : `${expected}\n`;
      if (expectedNorm !== result.html) {
        throw new RenderError(
          "CHECK_MISMATCH",
          `Byte mismatch for ${target}\nexpected sha256:${sha256Hex(Buffer.from(expectedNorm, "utf8"))}\nactual   sha256:${result.digest}`
        );
      }
      process.stdout.write(`RENDER_CHECK_PASS digest=sha256:${result.digest} output=${target} template=${TEMPLATE_VERSION}\n`);
      return 0;
    }
    writeFileSync(target, result.html, "utf8");
    process.stdout.write(`RENDER_WRITE path=${target} digest=sha256:${result.digest} template=${TEMPLATE_VERSION}\n`);
    return 0;
  } catch (err) {
    const code = err instanceof RenderError ? err.code : "ERROR";
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${code}: ${message}\n`);
    if (code === "USAGE") return 2;
    return 1;
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  process.exitCode = main();
}

export { main, SECTIONS };
