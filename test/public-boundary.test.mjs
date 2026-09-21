/**
 * CMD-PUBLIC-01 / SEIT-PUBLIC-01, SEIT-MODEL-01, SEIT-INDEPENDENCE-01
 * Scan packaged Lite public surfaces for private spill, model pins, deep coupling.
 * Includes the S9 public documents.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PACKAGE = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

/**
 * Packed Lite public documents that must be scanned.
 */
const PACKED_PUBLIC_DOCS = [
  "README.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
];
const SCAN_ROOTS = [
  "plugin.json",
  "package.json",
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".grok-plugin/marketplace.json",
  ".grok-plugin/plugin.json",
  ".cursor-plugin/marketplace.json",
  ".cursor-plugin/plugin.json",
  ".kimi-plugin/plugin.json",
  ".agy/plugin.json",
  ".agy/README.md",
  "hooks",
  "skills",
  "profiles.json",
  "schemas",
  "docs/architecture",
  "docs/guides",
  "docs/releases",
  ...PACKED_PUBLIC_DOCS,
];

const ALPHAZDE_METHOD_SKILLS = [
  "requirements-engineering",
  "sysml-modeling",
  "test-engineering",
  "integration-engineering",
];

const OLD_PACKAGE_NAME_COUPLING = {
  code: "deep_product_coupling",
  re: /@alphazede\/bearing(?!-lite)/,
};

const SECRET_PATTERNS = [
  { code: "secret_pattern", re: /AKIA[0-9A-Z]{16}/ },
  { code: "secret_pattern", re: /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/ },
  { code: "secret_pattern", re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { code: "secret_pattern", re: /ghp_[A-Za-z0-9]{20,}/ },
  { code: "secret_pattern", re: /sk-[A-Za-z0-9]{20,}/ },
];

const PRIVATE_PATH_PATTERNS = [
  { code: "private_path", re: /(^|[\s"`'])\/home\/[A-Za-z0-9._-]+\// },
  { code: "private_path", re: /\/Users\/[A-Za-z0-9._-]+\// },
  { code: "private_path", re: /\.bearing\/[A-Za-z0-9._/-]+/ },
  { code: "private_path", re: /\/tmp\/bearing-[A-Za-z0-9._/-]+/ },
];

const MODEL_PIN_PATTERNS = [
  { code: "model_pin", re: /model\s*[:=]\s*["']?(gpt-4|gpt-4o|claude-3|claude-opus|o1-preview|gemini-1\.5)/i },
  { code: "model_pin", re: /"model"\s*:\s*"(gpt-|claude-|o1-|gemini-)/i },
  { code: "provider_route", re: /OPENAI_API_KEY|ANTHROPIC_API_KEY|defaultProvider\s*[:=]/ },
  { code: "credential_lookup", re: /process\.env\.(OPENAI|ANTHROPIC|AZURE_OPENAI)_/ },
];

const INTERNAL_METADATA_COUPLING = {
  code: "deep_product_coupling",
  re: /okf_status|public_boundary\s*:/,
};

/**
 * An adopting organization's internal standard is not this product's rationale.
 * A shipped file must state its reasons in engineering terms and leave the
 * mapping to the adopter. The pattern literals are split so that this guard
 * does not itself match a repository-wide scan for such citations.
 */
const INTERNAL_STANDARD_PATTERNS = [
  { code: "internal_standard_citation", re: /COE-[A-Z]{2,}-[0-9]{3}/ },
  { code: "internal_standard_citation", re: /money[-\s]risk/i },
];

const DEEP_COUPLING_PATTERNS = [
  OLD_PACKAGE_NAME_COUPLING,
  { code: "deep_product_coupling", re: /require\(["']\.\.\/src\// },
  { code: "deep_product_coupling", re: /from ["']\.\.\/src\// },
  { code: "deep_product_coupling", re: /bearing_focus_begin|mcpServers|createServer\(/ },
  INTERNAL_METADATA_COUPLING,
];

/** DEC-BDL-042: unchanged public prompt skill; metadata exemption is digest-bound. */
const TRUSTED_PUBLIC_PROMPT_SKILL = "skills/prompt/SKILL.md";
const TRUSTED_PUBLIC_PROMPT_SKILL_SHA256 =
  "a2381d1aba78327332a3b2bc6823e1503876805b3ae317ae65e407b3297a404e";

/**
 * @param {string} content
 * @returns {string}
 */
function sha256Utf8(content) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * @param {string} relPath
 * @param {string} content
 * @returns {boolean}
 */
function isTrustedUnchangedPromptSkill(relPath, content) {
  return (
    relPath === TRUSTED_PUBLIC_PROMPT_SKILL &&
    sha256Utf8(content) === TRUSTED_PUBLIC_PROMPT_SKILL_SHA256
  );
}

/**
 * @typedef {{ code: string, message: string, path?: string }} PublicDiagnostic
 * @typedef {{ ok: true, scanned: string[] } | { ok: false, diagnostics: PublicDiagnostic[], scanned: string[] }} PublicVerdict
 */

/**
 * @param {string} relPath
 * @param {string} content
 * @returns {PublicDiagnostic[]}
 */
export function scanContent(relPath, content) {
  /** @type {PublicDiagnostic[]} */
  const diagnostics = [];
  const groups = [
    ...SECRET_PATTERNS,
    ...PRIVATE_PATH_PATTERNS,
    ...MODEL_PIN_PATTERNS,
    ...DEEP_COUPLING_PATTERNS,
    ...INTERNAL_STANDARD_PATTERNS,
  ];
  const trustedPrompt = isTrustedUnchangedPromptSkill(relPath, content);
  for (const pattern of groups) {
    if (trustedPrompt && pattern === INTERNAL_METADATA_COUPLING) continue;
    const { code, re } = pattern;
    if (!re.test(content)) continue;
    diagnostics.push({
      code,
      message: `${relPath} matches prohibited pattern ${re}`,
      path: relPath,
    });
  }
  return diagnostics;
}

/**
 * Recursively list files under a relative root (no node_modules).
 * @param {string} rel
 * @returns {string[]}
 */
function listFiles(rel) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return [];
  const st = statSync(abs);
  if (st.isFile()) return [rel];
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(abs)) {
    if (name === "node_modules" || name === ".git") continue;
    const child = path.join(rel, name);
    const childAbs = path.join(ROOT, child);
    const cst = statSync(childAbs);
    if (cst.isDirectory()) out.push(...listFiles(child));
    else if (cst.isFile()) out.push(child);
  }
  return out;
}

/**
 * Scan packed Lite public surfaces (plugin, skills, hooks, S9 public docs).
 * @param {{ extraFiles?: { path: string, content: string }[] }} [opts]
 * @returns {PublicVerdict}
 */
export function scanPublicLiteSurfaces(opts = {}) {
  /** @type {PublicDiagnostic[]} */
  const diagnostics = [];
  /** @type {string[]} */
  const scanned = [];

  // Identity claims.
  if (PACKAGE.name !== "@alphazede/bearing-lite") {
    diagnostics.push({
      code: "stale_non_lite_identity",
      message: `package name ${PACKAGE.name} is not @alphazede/bearing-lite`,
      path: "package.json",
    });
  }

  for (const root of SCAN_ROOTS) {
    for (const rel of listFiles(root)) {
      // Skip empty deep skill dir remnants; only scan files.
      if (rel.startsWith("skills/bearing/") && !rel.includes("bearing-lite")) {
        // Empty legacy dir — no files expected; if files appear they are deep coupling.
      }
      // Skip deep historical skill package if any non-Lite path appears with SKILL that is not catalog.
      scanned.push(rel);
      let content;
      try {
        content = readFileSync(path.join(ROOT, rel), "utf8");
      } catch {
        // binary skip
        continue;
      }
      // Skip binary-ish
      if (content.includes("\u0000")) continue;
      diagnostics.push(...scanContent(rel, content));
    }
  }

  for (const extra of opts.extraFiles || []) {
    scanned.push(extra.path);
    diagnostics.push(...scanContent(extra.path, extra.content));
  }

  if (diagnostics.length) return { ok: false, diagnostics, scanned };
  return { ok: true, scanned };
}

describe("CMD-PUBLIC-01 public-boundary (SEIT-PUBLIC-01, SEIT-MODEL-01, SEIT-INDEPENDENCE-01)", () => {
  it("package identity is @alphazede/bearing-lite with public files allowlist only", () => {
    assert.equal(PACKAGE.name, "@alphazede/bearing-lite");
    assert.ok(Array.isArray(PACKAGE.files));
    assert.ok(PACKAGE.files.includes("plugin.json"));
    assert.ok(PACKAGE.files.includes("skills/"));
    assert.ok(PACKAGE.files.includes("hooks/"));
    assert.ok(!PACKAGE.files.includes("guide/"), "must not pack entire guide/ directory");
    assert.ok(!PACKAGE.files.includes("guide/migration.md"));
    assert.ok(!PACKAGE.files.includes("src/"));
    assert.ok(!PACKAGE.files.includes("dist/"));
    assert.ok(!PACKAGE.files.includes("mcp.json"));
  });

  it("files allowlist includes shipped profiles.json and schemas/ and excludes legacy lineups.json", () => {
    assert.ok(PACKAGE.files.includes("profiles.json"), "PACKAGE.files must include profiles.json");
    assert.ok(PACKAGE.files.includes("schemas/"));
    assert.ok(!PACKAGE.files.includes("lineups.json"), "PACKAGE.files must not include legacy lineups.json");
  });

  it("public core does not ship AlphaZede method skills", () => {
    for (const name of ALPHAZDE_METHOD_SKILLS) {
      assert.equal(
        existsSync(path.join(ROOT, "skills", name, "SKILL.md")),
        false,
        name
      );
    }
  });

  it("scans shipped profiles.json and schema files as public surfaces", () => {
    const verdict = scanPublicLiteSurfaces();
    assert.ok(verdict.scanned.includes("profiles.json"), "profiles.json must be a scanned public surface");
    assert.ok(
      verdict.scanned.includes("schemas/seit.schema.json"),
      "schemas/seit.schema.json must be a scanned public surface"
    );
    assert.ok(verdict.scanned.includes("schemas/implementation.schema.json"));
    assert.ok(verdict.scanned.includes("schemas/authority.schema.json"));
    assert.ok(verdict.scanned.includes("schemas/journey.schema.json"));
  });

  it("packaged public surfaces scan clean of secrets, private paths, model pins, deep coupling", () => {
    const verdict = scanPublicLiteSurfaces();
    assert.equal(
      verdict.ok,
      true,
      verdict.ok === false ? JSON.stringify(verdict.diagnostics.slice(0, 10), null, 2) : ""
    );
    assert.ok(verdict.scanned.includes("plugin.json"));
    assert.ok(verdict.scanned.some((p) => p.startsWith("hooks/")));
    assert.ok(verdict.scanned.some((p) => p.startsWith("skills/bearing-lite/")));
    for (const doc of PACKED_PUBLIC_DOCS) {
      assert.ok(verdict.scanned.includes(doc), `expected scanned path ${doc}`);
    }
  });

  it("plugin.json and hooks do not pin models or credentials", () => {
    const plugin = readFileSync(path.join(ROOT, "plugin.json"), "utf8");
    assert.equal(scanContent("plugin.json", plugin).length, 0);
    for (const f of readdirSync(path.join(ROOT, "hooks"))) {
      if (!f.endsWith(".cjs")) continue;
      const rel = path.join("hooks", f);
      const hits = scanContent(rel, readFileSync(path.join(ROOT, rel), "utf8"));
      assert.equal(hits.length, 0, JSON.stringify(hits));
    }
  });

  it("S9 packed public documents are in scan roots and clean", () => {
    for (const doc of PACKED_PUBLIC_DOCS) {
      assert.ok(SCAN_ROOTS.includes(doc), `SCAN_ROOTS must include ${doc}`);
      assert.ok(existsSync(path.join(ROOT, doc)), doc);
      const hits = scanContent(doc, readFileSync(path.join(ROOT, doc), "utf8"));
      assert.equal(hits.length, 0, JSON.stringify(hits));
    }
  });

  it("old deep package references fail on every packed path", () => {
    const hits = scanContent(
      "README.md",
      "Deprecate `@alphazede/bearing` with a migration message.\n"
    );
    assert.ok(hits.some((d) => d.code === "deep_product_coupling"));
  });

  it("negative: injected private path fails validation", () => {
    const verdict = scanPublicLiteSurfaces({
      extraFiles: [
        {
          path: "skills/crewmate/FIXTURE.md",
          content: "see evidence at /home/example/private/session.json\n",
        },
      ],
    });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.ok(verdict.diagnostics.some((d) => d.code === "private_path"));
    }
  });

  it("negative: injected secret pattern fails validation", () => {
    const verdict = scanPublicLiteSurfaces({
      extraFiles: [
        {
          path: "hooks/fixture.cjs",
          content: 'const k = "AKIAIOSFODNN7EXAMPLE";\n',
        },
      ],
    });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.ok(verdict.diagnostics.some((d) => d.code === "secret_pattern"));
    }
  });

  it("negative: injected model pin fails validation", () => {
    const verdict = scanPublicLiteSurfaces({
      extraFiles: [
        {
          path: "skills/navigator/FIXTURE.md",
          content: 'default model: "gpt-4o-mini" for all routes\n',
        },
      ],
    });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.ok(verdict.diagnostics.some((d) => d.code === "model_pin"));
    }
  });

  it("negative: injected deep harness coupling fails validation", () => {
    const verdict = scanPublicLiteSurfaces({
      extraFiles: [
        {
          path: "skills/bearing-lite/FIXTURE.md",
          content: "import x from '../src/mcp/server.js'; bearing_focus_begin()\n",
        },
      ],
    });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.ok(verdict.diagnostics.some((d) => d.code === "deep_product_coupling"));
    }
  });

  it("negative: injected internal standard citation fails validation", () => {
    // Literals are assembled so this fixture does not itself read as a citation.
    const standardId = ["COE", "ELSD", "006"].join("-");
    const policyPhrase = ["money", "risk"].join("-");
    const verdict = scanPublicLiteSurfaces({
      extraFiles: [
        {
          path: "skills/bearing-lite/references/FIXTURE.md",
          content: `A ${policyPhrase} assurance gate forbids it (${standardId}).\n`,
        },
      ],
    });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      const hits = verdict.diagnostics.filter(
        (d) => d.path === "skills/bearing-lite/references/FIXTURE.md"
      );
      assert.equal(hits.length, 2, JSON.stringify(hits));
      assert.ok(hits.every((d) => d.code === "internal_standard_citation"));
    }
  });

  it("scans the unchanged prompt skill and still rejects hostile prompt-directory content", () => {
    const trusted = readFileSync(path.join(ROOT, TRUSTED_PUBLIC_PROMPT_SKILL), "utf8");
    assert.equal(sha256Utf8(trusted), TRUSTED_PUBLIC_PROMPT_SKILL_SHA256);
    assert.equal(scanContent(TRUSTED_PUBLIC_PROMPT_SKILL, trusted).length, 0);

    const mutatedMetadata = scanContent(
      TRUSTED_PUBLIC_PROMPT_SKILL,
      trusted.replace("name: prompt", "name: prompt\nokf_status: active")
    );
    assert.ok(mutatedMetadata.some((d) => d.code === "deep_product_coupling"));

    const siblingMetadata = scanContent("skills/prompt/NOTES.md", "---\nokf_status: active\n---\n");
    assert.ok(siblingMetadata.some((d) => d.code === "deep_product_coupling"));

    const verdict = scanPublicLiteSurfaces({
      extraFiles: [
        {
          path: "skills/prompt/HOSTILE.md",
          content:
            'see evidence at /home/example/private/session.json\nconst k = "AKIAIOSFODNN7EXAMPLE";\n',
        },
      ],
    });
    assert.ok(
      verdict.scanned.includes(TRUSTED_PUBLIC_PROMPT_SKILL),
      "skills/prompt/SKILL.md must be scanned as a public surface"
    );
    const promptHits = (verdict.ok ? [] : verdict.diagnostics).filter(
      (d) => d.path === TRUSTED_PUBLIC_PROMPT_SKILL
    );
    assert.equal(promptHits.length, 0, JSON.stringify(promptHits));
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.ok(
        verdict.diagnostics.some((d) => d.path === "skills/prompt/HOSTILE.md" && d.code === "private_path")
      );
      assert.ok(
        verdict.diagnostics.some((d) => d.path === "skills/prompt/HOSTILE.md" && d.code === "secret_pattern")
      );
    }
  });

  const DELETED_PROCESS_HTML = [
    "docs/architecture/bearing-process/index.html",
    "docs/architecture/bearing-process/planning.html",
    "docs/architecture/bearing-process/implementation.html",
  ];
  const PUBLIC_LIFECYCLE_DOCS = [
    "README.md",
    "docs/architecture/bearing-delivery-lifecycle.md",
    "docs/architecture/bearing-process/lifecycle-context.svg",
    "docs/architecture/bearing-process/lifecycle-process-views.svg",
    "docs/guides/onboarding.md",
    "docs/guides/lifecycle.md",
    "docs/guides/roles.md",
    "docs/guides/troubleshooting.md",
    "docs/releases/announcement.md",
    "docs/releases/acknowledgements.md",
  ];
  const RETAINED_PROCESS_VIEWS = [
    "docs/architecture/bearing-process/lifecycle-context.svg",
    "docs/architecture/bearing-process/lifecycle-process-views.svg",
  ];

  /**
   * @param {string} rel
   * @param {string} text
   */
  function assertLocalMarkdownLinksResolve(rel, text) {
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1].trim();
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) continue;
      const bare = href.split("#")[0].split("?")[0];
      if (!bare) continue;
      const resolved = path.resolve(path.dirname(path.join(ROOT, rel)), bare);
      assert.ok(existsSync(resolved), `${rel} link must resolve: ${href}`);
    }
  }

  it("README states product identity, lifecycle outcome, role primary work, onboarding, profiles, and the native wait/status advisory", () => {
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    const opening = readme.split(/^## /m)[0];
    assert.doesNotMatch(opening, /\*\*BLUF\.\*\*/);
    assert.match(opening, /@alphazede\/bearing-lite/);
    assert.match(
      opening,
      /package\s+that gives AI-assisted repository work a structured\s+delivery lifecycle from\s+an owner-approved plan to an independently assessed\s+result/
    );
    assert.match(
      opening,
      /Planning artifacts and the Definition of\s+Done Manifest compare what AI was authorized to touch with actual changes/
    );
    assert.match(opening, /An agent cannot certify\s+its own work/);
    assert.match(
      opening,
      /Owner Authority remains human-only\.\s+Bearing Lite was created\s+by William Rumph\./
    );
    assert.match(readme, /^\| Role \| Sessions \| Primary work \|$/m);
    assert.doesNotMatch(readme, /^\| Role \| Sessions \| Executes\b/m);
    assert.doesNotMatch(readme, /Writes product/);
    assert.match(readme, /^## Onboarding/m);
    assert.match(readme, /Some agent harnesses may stall after delegated work completes/);
    assert.match(readme, /wait\/status reliability varies by host and route/i);
    assert.match(readme, /~\/\.agents\/bearing-lite\/profiles\.json/);
    assert.match(readme, /onboard-bearing/);
    assert.match(readme, /one setting at a time/);
    assert.match(readme, /clean-session|planning-to-implementation clean session/i);
    assert.match(readme, /reverify\.enabled:\s*`?false`?|enabled:\s*`?false`?/i);
    assert.doesNotMatch(readme, /default-role-lineup\.md/);
    assert.doesNotMatch(readme, /lineups\.json` is the/);
    assert.match(readme, /checkout-lease[\s-]+conflict/);
    assert.match(readme, /WAITING_ON/);
    assert.match(readme, /task-state\.mmd/);
    assert.doesNotMatch(readme, /task-state\.png/);
    assert.doesNotMatch(readme, /role-routing\.png/);
  });

  it("README install guidance covers every advertised client without invented commands", () => {
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    const install = readme.split(/^## Install\b/m)[1]?.split(/^## /m)[0] ?? "";
    assert.ok(install.length > 0, "README must have an Install section");

    for (const client of [
      "Claude Code",
      "Codex",
      "Grok Build",
      "Cursor",
      "Kimi Code",
      "AGY",
      "Pi",
      "DeepCode",
      "Muse Code",
      "GitHub Copilot in VS Code",
      "GitHub Copilot CLI",
      "Qwen Code",
    ]) {
      assert.match(install, new RegExp(client.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), client);
    }

    assert.match(install, /claude plugin marketplace add \/path\/to\/bearing-lite/);
    assert.match(install, /claude plugin install bearing-lite@bearing-lite/);
    assert.match(install, /codex plugin marketplace add \/path\/to\/bearing-lite/);
    assert.match(install, /codex plugin add bearing-lite@bearing-lite/);
    assert.match(install, /grok plugin marketplace add \/path\/to\/bearing-lite/);
    assert.match(install, /grok plugin install bearing-lite --trust/);
    assert.match(install, /\/plugins install \/path\/to\/bearing-lite/);
    assert.match(install, /agy plugin install \/path\/to\/bearing-lite\/\.agy/);
    assert.match(install, /pi install npm:@alphazede\/bearing-lite/);
    assert.match(install, /~\/\.deepcode\/skills/);
    assert.match(install, /Chat:\s*Install Plugin From Source/);
    assert.match(install, /Git repository URL/i);
    assert.match(install, /copilot plugin marketplace add alphazede\/bearing-lite/);
    assert.match(install, /copilot plugin install bearing-lite@bearing-lite/);
    assert.match(install, /qwen extensions install @alphazede\/bearing-lite/);
    assert.match(install, /muse skills install/);
    assert.match(install, /skills\/\*\/SKILL\.md/);
    assert.match(install, /skills-only/i);
    assert.match(install, /PreToolUse/);
    assert.match(install, /SubagentStop/);
    assert.match(install, /transition-order/i);
    assert.match(install, /protected-action/i);
    assert.match(install, /planning-review|planning review/i);
    assert.match(install, /assurance-budget|assurance budget/i);
    assert.doesNotMatch(install, /code --install-extension/);
    assert.doesNotMatch(install, /kimi plugin install/);
    assert.doesNotMatch(install, /Writes product/);
  });

  it("public lifecycle docs describe Intake then Architectural Alignment then Scope Definition then Planning and Design", () => {
    for (const rel of [
      "README.md",
      "docs/architecture/bearing-delivery-lifecycle.md",
      "docs/guides/lifecycle.md",
    ]) {
      const text = readFileSync(path.join(ROOT, rel), "utf8");
      const intake = text.indexOf("Intake");
      const alignment = text.indexOf("Architectural Alignment");
      const scope = text.indexOf("Scope Definition");
      const planning = text.indexOf("Planning and Design");
      assert.ok(intake >= 0, `${rel} must name Intake`);
      assert.ok(alignment > intake, `${rel} must order Architectural Alignment after Intake`);
      assert.ok(scope > alignment, `${rel} must order Scope Definition after Architectural Alignment`);
      assert.ok(planning > scope, `${rel} must order Planning and Design after Scope Definition`);
    }
  });

  it("public docs keep one Integration Engineer and one Test Engineer with named sessions", () => {
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    const spec = readFileSync(
      path.join(ROOT, "docs/architecture/bearing-delivery-lifecycle.md"),
      "utf8"
    );
    for (const [name, text] of [
      ["README", readme],
      ["specification", spec],
    ]) {
      assert.match(text, /Integration Engineer/, name);
      assert.match(text, /planning and execution sessions|planning session[\s\S]{0,80}execution session/i, name);
      assert.match(text, /Test Engineer/, name);
      assert.match(text, /planning and assurance sessions|Planning Test Engineer[\s\S]{0,80}Assurance Test Engineer/i, name);
      assert.match(text, /`slice`, `phase`, or `lifecycle`|slice, phase, or lifecycle/, name);
      assert.doesNotMatch(text, /\|\s*\*\*Validator\*\*/);
    }
  });

  it("public lifecycle surfaces exist, stay public, and omit active retired terms", () => {
    const retired =
      /Explorer Journey|\bExpedition\b|\bCrewmate\b|\bNavigator\b|\bSurveyor\b|\bPark Ranger\b|Map the Route|Set Bearings|Gather Supplies|Repository Fit|Implementation Integration Engineer/;
    const deletedHtmlRef = /bearing-process\/(?:index|planning|implementation)\.html/;
    for (const rel of PUBLIC_LIFECYCLE_DOCS) {
      const abs = path.join(ROOT, rel);
      assert.ok(existsSync(abs), rel);
      const text = readFileSync(abs, "utf8");
      assert.doesNotMatch(text, /(^|[\s"`'])\/home\/[A-Za-z0-9._-]+\//, rel);
      assert.doesNotMatch(text, /docs\/plans\//, rel);
      assert.doesNotMatch(text, retired, `${rel} must not use retired terms as active public names`);
      assert.doesNotMatch(text, deletedHtmlRef, `${rel} must not link to deleted process HTML`);
    }
    for (const rel of DELETED_PROCESS_HTML) {
      assert.equal(existsSync(path.join(ROOT, rel)), false, `${rel} must remain absent`);
    }
    for (const rel of RETAINED_PROCESS_VIEWS) {
      const svg = readFileSync(path.join(ROOT, rel), "utf8");
      assert.match(svg, /role="img"/, rel);
      assert.match(svg, /aria-labelledby=|aria-label=/, rel);
    }
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    assert.match(readme, /docs\/architecture\/bearing-process\/lifecycle-context\.svg/);
    assert.match(readme, /docs\/architecture\/bearing-process\/lifecycle-process-views\.svg/);
    assertLocalMarkdownLinksResolve("README.md", readme);
    assertLocalMarkdownLinksResolve(
      "docs/guides/lifecycle.md",
      readFileSync(path.join(ROOT, "docs/guides/lifecycle.md"), "utf8")
    );
    assertLocalMarkdownLinksResolve(
      "docs/architecture/bearing-delivery-lifecycle.md",
      readFileSync(path.join(ROOT, "docs/architecture/bearing-delivery-lifecycle.md"), "utf8")
    );
  });
});
