// Shared with the synchronous plan-package hook.
"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_TEXT_VIEW_BYTES = 512 * 1024;

class RenderError extends Error {
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

function bindingRequirement(modelId = "<model.id>") {
  return [
    `BINDING_REQUIRED ${modelId}: activated model (selected OR required, including render_status READY/MISSING/STALE) must bind a digest-checked view.`,
    "Minimal planning binding:",
    `  "digest": "sha256:<hex of view bytes>",`,
    `  "view": { "format": "svg"|"png", "path": "<path relative to implementation.json>" }`,
    'For diagram-assisted models, "format": "mermaid" accepts a path and a digest over the source bytes.',
    "or SVG only: \"view\": { \"format\": \"svg\", \"inline\": \"<svg ...></svg>\" } with the same digest over UTF-8 inline bytes.",
    "Append-only alternative: dod_manifest.closeout.model_views[] { model_id, digest, view } keyed to a planning model id. Supplemental entries may not rewrite planning rows or override mode, source, viewpoint, trace, limitations, activation, or an already-planned binding.",
    "Inactive (selected=false AND required=false) or not_applicable+reason needs no view.",
    "Do not invent SVG/PNG semantics. Renderer will not scrape design.md or architecture HTML.",
  ].join("\n");
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function normalizeDigest(value) {
  if (value == null || value === "") return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, "");
}

function resolveUnder(rootDir, relativePath) {
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
}

function loadVerifiedMermaidView(model, assetRoot) {
  if (model.mode !== "diagram-assisted" || !model.view.path) {
    throw new RenderError(
      "MISSING_VIEW",
      `${model.id || "model"} needs diagram-assisted mode and a Mermaid source path.\n${bindingRequirement(model.id)}`
    );
  }
  const resolved = resolveUnder(assetRoot, model.view.path);
  if (!fs.existsSync(resolved)) {
    throw new RenderError("MISSING_VIEW", `${model.id || "model"} view path not found: ${model.view.path}`);
  }
  const root = fs.realpathSync(assetRoot);
  const file = fs.realpathSync(resolved);
  resolveUnder(root, path.relative(root, file));
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_TEXT_VIEW_BYTES) {
    throw new RenderError("UNSAFE_ASSET", "Mermaid source must be a regular file within the text view size limit.");
  }
  const bytes = fs.readFileSync(file);
  verifyDigest(model, bytes);
  return { format: "mermaid", bytes };
}

module.exports = {
  MAX_TEXT_VIEW_BYTES,
  RenderError,
  bindingRequirement,
  loadVerifiedMermaidView,
  normalizeDigest,
  resolveUnder,
  sha256Hex,
  verifyDigest,
};
