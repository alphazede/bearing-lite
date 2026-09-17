/**
 * CMD-SKILLS-01 / SEIT-SKILLS-01, SEIT-ACTIVATION-01
 * Skill catalog, frontmatter, size, activation match/non-match.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = path.join(ROOT, "skills");

const ROUTER = "bearing-lite";
const PLANNING = [
  "requirements-engineer",
  "scope-definition",
  "architectural-alignment",
  "intake",
  "planning-and-design",
];
const ACTIVE_ROLES = [
  "implementer",
  "light-implementer",
  "coordinator",
  "reviewer",
  "test-engineer",
  "scribe",
  "plan-integrator",
  "systems-modeler",
  "integration-engineer",
  "onboard-bearing",
];
const COMPATIBILITY_ROLES = [];
const PACKAGED_UTILITIES = ["prompt"];
const REQUIRED_CATALOG = [ROUTER, ...PLANNING, ...ACTIVE_ROLES];
const RETIRED_SOURCE_SKILLS = [
  "crewmate",
  "explorer",
  "park-ranger",
  "surveyor",
  "navigator",
  "validator",
  "gather-supplies",
  "set-bearings",
  "repository-fit",
  "map-the-route",
];
const HQ_METHOD_SKILLS = [
  "requirements-engineering",
  "sysml-modeling",
  "test-engineering",
  "integration-engineering",
];
const PROHIBITED_LITE_ROLES = ["trail-boss", "sub-explorer"];
/** Core skill body soft limit (bytes). Oversized fixtures must fail. */
const CORE_SKILL_SIZE_LIMIT = 12_000;

/**
 * @typedef {{ code: string, message: string, skill?: string }} SkillDiagnostic
 * @typedef {{ ok: true, name: string, description: string, bodyBytes: number } | { ok: false, diagnostics: SkillDiagnostic[] }} SkillVerdict
 */

/**
 * Parse YAML-like frontmatter from SKILL.md (name/description only).
 * @param {string} text
 */
function parseFrontmatter(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return null;
  }
  const end = text.indexOf("\n---", 4);
  if (end < 0) return null;
  const block = text.slice(4, end);
  /** @type {Record<string, string>} */
  const fields = {};
  let currentKey = null;
  let currentVal = "";
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) {
      if (currentKey) fields[currentKey] = currentVal.trim();
      currentKey = m[1];
      currentVal = m[2] === ">" || m[2] === "|" ? "" : m[2];
      if (m[2] === ">" || m[2] === "|") currentVal = "";
      continue;
    }
    if (currentKey && (/^\s+/.test(line) || line.trim() === "")) {
      currentVal += (currentVal ? " " : "") + line.trim();
    }
  }
  if (currentKey) fields[currentKey] = currentVal.trim();
  return fields;
}

/**
 * @param {string} skillDirName
 * @param {string} skillText
 * @param {{ sizeLimit?: number }} [opts]
 * @returns {SkillVerdict}
 */
export function validateSkillDocument(skillDirName, skillText, opts = {}) {
  /** @type {SkillDiagnostic[]} */
  const diagnostics = [];
  const sizeLimit = opts.sizeLimit ?? CORE_SKILL_SIZE_LIMIT;
  const bodyBytes = Buffer.byteLength(skillText, "utf8");
  if (bodyBytes > sizeLimit) {
    diagnostics.push({
      code: "oversized_core_skill",
      message: `skill ${skillDirName} is ${bodyBytes} bytes; limit ${sizeLimit}`,
      skill: skillDirName,
    });
  }
  const fm = parseFrontmatter(skillText);
  if (!fm) {
    diagnostics.push({
      code: "invalid_frontmatter",
      message: `skill ${skillDirName} missing valid frontmatter`,
      skill: skillDirName,
    });
    return { ok: false, diagnostics };
  }
  if (!fm.name) {
    diagnostics.push({
      code: "invalid_frontmatter",
      message: "frontmatter name is required",
      skill: skillDirName,
    });
  } else if (fm.name !== skillDirName) {
    diagnostics.push({
      code: "name_directory_mismatch",
      message: `frontmatter name "${fm.name}" !== directory "${skillDirName}"`,
      skill: skillDirName,
    });
  }
  if (!fm.description || fm.description.length < 8) {
    diagnostics.push({
      code: "missing_description",
      message: "frontmatter description is required",
      skill: skillDirName,
    });
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  return {
    ok: true,
    name: fm.name,
    description: fm.description,
    bodyBytes,
  };
}

/**
 * Simple activation match: query tokens against skill description + match cues.
 * @param {string} skillName
 * @param {string} description
 * @param {string} query
 */
export function activationMatches(skillName, description, query) {
  const q = query.toLowerCase();
  const hay = `${skillName} ${description}`.toLowerCase();
  // Explicit name / primary phrase hits.
  if (q.includes(skillName.replace(/-/g, " ")) || q.includes(skillName)) return true;
  // Description "Use for X" fragments: require multi-token overlap beyond single stop words.
  const tokens = q
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3 && !["with", "from", "that", "this", "work", "task"].includes(t));
  const hits = tokens.filter((t) => hay.includes(t));
  return hits.length >= 2;
}

/**
 * @param {string[]} catalogNames
 * @returns {{ ok: boolean, diagnostics: SkillDiagnostic[] }}
 */
export function validateCatalog(catalogNames) {
  /** @type {SkillDiagnostic[]} */
  const diagnostics = [];
  const set = new Set(catalogNames);
  if (set.has("grader")) {
    diagnostics.push({
      code: "standalone_grader_present",
      message: "standalone grader skill is prohibited",
      skill: "grader",
    });
  }
  for (const expected of REQUIRED_CATALOG) {
    if (!set.has(expected)) {
      diagnostics.push({
        code: "missing_role",
        message: `catalog missing required skill "${expected}"`,
        skill: expected,
      });
    }
  }
  // Detect duplicate contract names (same basename listed twice).
  const seen = new Map();
  for (const name of catalogNames) {
    seen.set(name, (seen.get(name) || 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) {
      diagnostics.push({
        code: "duplicate_contract",
        message: `skill "${name}" appears ${count} times`,
        skill: name,
      });
    }
  }
  const allowed = new Set([...REQUIRED_CATALOG, ...COMPATIBILITY_ROLES, ...PACKAGED_UTILITIES]);
  for (const name of catalogNames) {
    if (HQ_METHOD_SKILLS.includes(name)) {
      diagnostics.push({
        code: "unexpected_skill",
        message: `AlphaZede method skill "${name}" is not a public Lite catalog entry`,
        skill: name,
      });
      continue;
    }
    if (PROHIBITED_LITE_ROLES.includes(name)) {
      diagnostics.push({
        code: "unexpected_skill",
        message: `unexpected skill "${name}" outside Lite catalog`,
        skill: name,
      });
      continue;
    }
    if (!allowed.has(name) && name !== "grader") {
      diagnostics.push({
        code: "unexpected_skill",
        message: `unexpected skill "${name}" outside Lite catalog`,
        skill: name,
      });
    }
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

function listSkillDirsWithSkillMd() {
  return readdirSync(SKILLS_DIR)
    .filter((name) => {
      const skillPath = path.join(SKILLS_DIR, name, "SKILL.md");
      return existsSync(skillPath) && statSync(path.join(SKILLS_DIR, name)).isDirectory();
    })
    .sort();
}

describe("CMD-SKILLS-01 skills-conformance (SEIT-SKILLS-01, SEIT-ACTIVATION-01)", () => {
  const skillDirs = listSkillDirsWithSkillMd();

  it("catalog requires the Lite engineering roles and does not require HQ method skills", () => {
    for (const name of REQUIRED_CATALOG) {
      assert.ok(skillDirs.includes(name), `catalog missing required skill "${name}"`);
    }
    for (const name of [...PROHIBITED_LITE_ROLES, ...HQ_METHOD_SKILLS]) {
      assert.ok(!skillDirs.includes(name), `catalog must not include "${name}"`);
    }
    const catalogVerdict = validateCatalog(skillDirs);
    assert.equal(catalogVerdict.ok, true, JSON.stringify(catalogVerdict));
    const withoutHq = validateCatalog([...REQUIRED_CATALOG]);
    assert.equal(withoutHq.ok, true, JSON.stringify(withoutHq));
    const withHq = validateCatalog([...REQUIRED_CATALOG, "requirements-engineering"]);
    assert.equal(withHq.ok, false);
    assert.ok(
      withHq.diagnostics.some(
        (d) => d.code === "unexpected_skill" && d.skill === "requirements-engineering"
      )
    );
    assert.ok(
      !withHq.diagnostics.some(
        (d) => d.code === "missing_role" && d.skill === "requirements-engineering"
      )
    );
  });

  it("no standalone grader skill remains", () => {
    assert.ok(!skillDirs.includes("grader"));
    assert.ok(!existsSync(path.join(SKILLS_DIR, "grader", "SKILL.md")));
    const negative = validateCatalog([...skillDirs, "grader"]);
    assert.equal(negative.ok, false);
    assert.ok(negative.diagnostics.some((d) => d.code === "standalone_grader_present"));
  });

  it("no Delegate Authority skill remains", () => {
    assert.ok(!skillDirs.includes("delegate-authority"));
    assert.ok(!existsSync(path.join(SKILLS_DIR, "delegate-authority", "SKILL.md")));
    const negative = validateCatalog([...skillDirs, "delegate-authority"]);
    assert.equal(negative.ok, false);
    assert.ok(
      negative.diagnostics.some(
        (d) => d.code === "unexpected_skill" && d.skill === "delegate-authority"
      )
    );
  });

  it("no Trail Boss or Sub-Explorer skill remains", () => {
    for (const name of PROHIBITED_LITE_ROLES) {
      assert.ok(!skillDirs.includes(name));
      assert.ok(!existsSync(path.join(SKILLS_DIR, name, "SKILL.md")));
      const negative = validateCatalog([...skillDirs, name]);
      assert.equal(negative.ok, false);
      assert.ok(
        negative.diagnostics.some((d) => d.code === "unexpected_skill" && d.skill === name)
      );
    }
  });

  it("retired source skills are absent from the catalog", () => {
    for (const name of RETIRED_SOURCE_SKILLS) {
      assert.ok(!skillDirs.includes(name), `catalog must not include retired skill "${name}"`);
      assert.ok(!existsSync(path.join(SKILLS_DIR, name, "SKILL.md")), name);
    }
  });

  it("Coordinator owns proven-independent lanes; Orchestrator owns sequencing", () => {
    const coordinator = readFileSync(path.join(SKILLS_DIR, "coordinator", "SKILL.md"), "utf8");
    const router = readFileSync(path.join(SKILLS_DIR, "bearing-lite", "SKILL.md"), "utf8");
    assert.match(coordinator, /proven-independent/);
    assert.match(coordinator, /never add a nested coordinator/);
    assert.doesNotMatch(coordinator, /Trail Boss|Sub-Explorer|trail-boss|sub-explorer/);
    assert.match(router, /owns\s+sequencing/);
    assert.doesNotMatch(router, /Trail Boss|Sub-Explorer|trail-boss|sub-explorer/);
    assert.ok(!existsSync(path.join(SKILLS_DIR, "navigator", "SKILL.md")));
  });

  it("Coordinator match/non-match states the one-wave activation predicate", () => {
    const coordinator = readFileSync(path.join(SKILLS_DIR, "coordinator", "SKILL.md"), "utf8");
    const router = readFileSync(path.join(SKILLS_DIR, "bearing-lite", "SKILL.md"), "utf8");
    const onboard = readFileSync(path.join(SKILLS_DIR, "onboard-bearing", "SKILL.md"), "utf8");
    const reviewer = readFileSync(path.join(SKILLS_DIR, "reviewer", "SKILL.md"), "utf8");
    assert.match(coordinator, /\*\*Match:\*\*/);
    assert.match(coordinator, /two or more proven-independent packets/);
    assert.match(coordinator, /shared wave evidence/);
    assert.match(coordinator, /aggregate repair ownership/);
    assert.match(coordinator, /roles\.coordinator\.enabled/);
    assert.match(coordinator, /available, not that every packet dispatches Coordinator/);
    assert.match(coordinator, /\*\*Non-match:\*\*/);
    assert.match(coordinator, /direct packet/);
    assert.match(coordinator, /never force Coordinator/);
    assert.match(coordinator, /Orchestrator is the parent controller/);
    assert.match(coordinator, /not a capability gap/);
    assert.match(coordinator, /typed capability gap/);
    assert.match(coordinator, /not Orchestrator substitution/);
    assert.match(router, /Direct packets never dispatch Coordinator/);
    assert.match(router, /Orchestrator is the parent controller/);
    assert.match(router, /typed capability gap, not substitution/);
    assert.match(onboard, /Enabling Coordinator adds value only for a one-wave need/);
    assert.match(onboard, /explicit disabled choice/);
    assert.match(onboard, /disabled Coordinator\s+on a true direct packet is not a capability gap/);
    assert.match(reviewer, /parent controller/);
    assert.match(reviewer, /Orchestrator on a direct packet, Coordinator on a coordinator wave/);
    assert.doesNotMatch(reviewer, /the coordinator then runs deterministic verification/);
  });

  it("each skill frontmatter name equals directory and description is present", () => {
    for (const name of skillDirs) {
      const text = readFileSync(path.join(SKILLS_DIR, name, "SKILL.md"), "utf8");
      const verdict = validateSkillDocument(name, text);
      assert.equal(verdict.ok, true, `${name}: ${JSON.stringify(verdict)}`);
      if (PACKAGED_UTILITIES.includes(name)) continue;
      const lines = text.trimEnd().split(/\r?\n/).length;
      const words = text.trim().split(/\s+/).length;
      assert.ok(lines <= 60, `${name}: ${lines} lines must be at most 60`);
      const maxWords = name === "bearing-lite" ? 600 : name === "planning-and-design" ? 500 : 600;
      assert.ok(words <= maxWords, `${name}: ${words} words must be at most ${maxWords}`);
    }
  });

  it("matching activation cases succeed for representative roles", () => {
    const cases = [
      ["implementer", "implement packet with write-set change as implementer"],
      ["coordinator", "orchestrate wave of implementer packets as coordinator"],
      ["intake", "intake choose repo workspace"],
      ["onboard-bearing", "configure profiles.json onboard-bearing setup"],
    ];
    for (const [name, query] of cases) {
      const text = readFileSync(path.join(SKILLS_DIR, name, "SKILL.md"), "utf8");
      const verdict = validateSkillDocument(name, text);
      assert.equal(verdict.ok, true);
      if (verdict.ok) {
        assert.equal(
          activationMatches(name, verdict.description, query),
          true,
          `${name} should match: ${query}`
        );
      }
    }
  });

  it("non-matching broad / name-similarity wording keeps unneeded roles dormant", () => {
    const reviewer = readFileSync(path.join(SKILLS_DIR, "reviewer", "SKILL.md"), "utf8");
    const reviewerV = validateSkillDocument("reviewer", reviewer);
    assert.equal(reviewerV.ok, true);
    if (reviewerV.ok) {
      assert.equal(
        activationMatches("reviewer", reviewerV.description, "validate the plan structure quickly"),
        false,
        "reviewer must stay dormant for name-similar non-match"
      );
    }
    const coordinator = readFileSync(path.join(SKILLS_DIR, "coordinator", "SKILL.md"), "utf8");
    const coordinatorV = validateSkillDocument("coordinator", coordinator);
    assert.equal(coordinatorV.ok, true);
    if (coordinatorV.ok) {
      assert.equal(
        activationMatches("coordinator", coordinatorV.description, "do some repository work"),
        false,
        "coordinator must stay dormant for broad wording"
      );
    }
  });

  it("router requires explicit Bearing invocation and owns the Journey conversation", () => {
    const routerPath = path.join(SKILLS_DIR, "bearing-lite", "SKILL.md");
    const router = readFileSync(routerPath, "utf8");
    const verdict = validateSkillDocument("bearing-lite", router);
    assert.equal(verdict.ok, true);
    if (verdict.ok) {
      assert.equal(
        activationMatches(
          "bearing-lite",
          verdict.description,
          "Use Bearing Lite to start this repository lifecycle"
        ),
        true,
        "explicit Bearing Lite request should match"
      );
      assert.equal(
        activationMatches(
          "bearing-lite",
          verdict.description,
          "route the next task for this repository"
        ),
        false,
        "ordinary repository routing must not invoke Bearing Lite"
      );
    }
    assert.match(router, /Preparing this Lifecycle\./);
    assert.doesNotMatch(router, /review_cadence: at-end/);
    assert.doesNotMatch(router, /after a\s+slice, after an integrated round, or at the end\?/);
    assert.match(router, /Orchestrator alone writes Lifecycle\s+control state/);
    assert.match(router, /plugin\s+hosts are partial/i);
    assert.match(router, /skill-copy is skills-only/);
    assert.match(router, /may continue in-wave/);
    assert.match(router, /Profile comes only from `~\/\.agents\/bearing-lite\/profiles\.json`/);
    assert.doesNotMatch(router, /default-role-lineup\.md/);
    assert.match(router, /never infer identity values/i);
    assert.match(router, /planning\s+nodes return owner questions/);
    const planning = router.indexOf("Intake");
    const map = router.indexOf("Invoke Planning and Design");
    assert.ok(map >= 0 && map > planning, "Planning and Design must follow planning stages");
    assert.match(router, /Do not ask for profile or route\s+before it/);
    assert.match(router, /one integrated\s+approval-or-change gate/);
    assert.match(router, /Never add a staged profile or route-review gate/);
  });

  it("execution roles revalidate the visible checkout lease at wave-scoped boundaries", () => {
    const coordinator = readFileSync(path.join(SKILLS_DIR, "coordinator", "SKILL.md"), "utf8");
    const implementer = readFileSync(path.join(SKILLS_DIR, "implementer", "SKILL.md"), "utf8");
    const identity =
      /Revalidate the visible checkout\s+lease against the approved Lifecycle,\s+repository, checkout\/worktree, branch,\s+candidate revision, generation,\s+and active state/;
    const failClosed =
      /Released, stale-generation,\s+forged, or\s+branch\/HEAD-drifted leases fail closed/;
    const waveScoped = /at wave start, after\s+detected drift, and before commit/;
    for (const [name, text] of [
      ["coordinator", coordinator],
      ["implementer", implementer],
    ]) {
      assert.match(text, identity, `${name} must revalidate the full lease identity`);
      assert.match(text, waveScoped, `${name} must revalidate at wave-scoped boundaries`);
      assert.match(text, failClosed, `${name} must fail closed on drifted or forged leases`);
    }
    assert.match(coordinator, /same valid lease continues\s+without duplicate dispatch/);
    assert.match(implementer, /return WAITING_ON without writing/);
    assert.doesNotMatch(implementer, /every mutation/);
  });

  it("recorded Journey lineup snapshot outranks later global-default edits", () => {
    const router = readFileSync(path.join(SKILLS_DIR, "bearing-lite", "SKILL.md"), "utf8");
    const coordinator = readFileSync(path.join(SKILLS_DIR, "coordinator", "SKILL.md"), "utf8");
    const implementer = readFileSync(path.join(SKILLS_DIR, "implementer", "SKILL.md"), "utf8");
    assert.match(router, /recorded\s+snapshot is authoritative for this Lifecycle/);
    assert.match(
      router,
      /Later edits to\s+`~\/\.agents\/bearing-lite\/profiles\.json` have no effect on it/
    );
    assert.match(router, /explicit owner-confirmed\s+dated visible amendment/);
    assert.match(router, /Dispatch uses that snapshot|profile identity from the recorded snapshot/);
    for (const [name, text] of [
      ["coordinator", coordinator],
      ["implementer", implementer],
    ]) {
      assert.match(
        text,
        /recorded Lifecycle snapshot/,
        `${name} must read identities from the Lifecycle snapshot`
      );
      assert.match(
        text,
        /never\s+from\s+the\s+current\s+global\s+defaults\s+file/,
        `${name} must not reread the global defaults file`
      );
    }
  });

  it("Bearing Lite permits one review and one repair without re-review", () => {
    const router = readFileSync(path.join(SKILLS_DIR, "bearing-lite", "SKILL.md"), "utf8");
    const coordinator = readFileSync(path.join(SKILLS_DIR, "coordinator", "SKILL.md"), "utf8");
    assert.match(router, /`max_assurance_rounds` is\s+1/);
    assert.match(router, /not per Journey|per declared phase or wave/);
    assert.match(router, /assurance_rounds/);
    assert.match(router, /Direct route/);
    assert.match(router, /never\s+dispatch Navigator/);
    assert.match(
      router,
      /OWNER_DECISION_REQUIRED` naming the candidate\s+and count/
    );
    for (const [name, text] of [["coordinator", coordinator]]) {
      assert.match(text, /max_assurance_rounds/, `${name} must honor the Lite bound`);
      assert.match(text, /of 1/, `${name} must fix the Lite bound at one review`);
      assert.match(text, /assurance_rounds/, `${name} must read the visible count`);
      assert.match(
        text,
        /OWNER_DECISION_REQUIRED` with\s+candidate and\s+count/,
        `${name} must escalate with candidate and count`
      );
      assert.match(text, /without another review/, `${name} must not re-review the repair`);
      assert.match(text, /one[\s\S]*repair/, `${name} must allow at most one repair`);
    }
    assert.match(router, /`COMPLETE` ends Bearing assurance/);
    assert.match(router, /deployment[\s\S]*without reopening review/i);
  });

  it("Reviewer declares terminal versus bounded-correction outcomes", () => {
    const reviewer = readFileSync(path.join(SKILLS_DIR, "reviewer", "SKILL.md"), "utf8");
    assert.match(reviewer, /`ACCEPT`, `ACCEPT_WITH_FINDINGS`, and `BLOCK` are terminal/);
    assert.match(reviewer, /`REPAIR_REQUIRED`\s+permits bounded correction/);
    assert.match(reviewer, /ACCEPT_WITH_FINDINGS` accepts residual/);
    assert.match(reviewer, /do not follow it with another repair/);
    assert.match(reviewer, /max_assurance_rounds/);
    assert.match(reviewer, /of 1/);
  });

  it("Validator is absent from active roles; remaining validator skill is compatibility-only", () => {
    const lineup = readFileSync(path.join(LITE_REF, "profiles.md"), "utf8");
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    const taskState = readFileSync(
      path.join(SKILLS_DIR, "bearing-lite", "references", "task-state.md"),
      "utf8"
    );
    const routing = readFileSync(
      path.join(SKILLS_DIR, "bearing-lite", "references", "role-routing.mmd"),
      "utf8"
    );
    const peer = readFileSync(
      path.join(SKILLS_DIR, "bearing-lite", "references", "peer-synthesis.md"),
      "utf8"
    );
    assert.doesNotMatch(lineup, /\|\s*Validator\s*\|/);
    assert.doesNotMatch(readme, /\|\s*\*\*Validator\*\*/);
    assert.doesNotMatch(taskState, /\|\s*`VALIDATING`\s*\|\s*Validator\s*\|/);
    assert.doesNotMatch(routing, /Validator declared/);
    assert.doesNotMatch(peer, /\|\s*Validator\s*\|/);
    const validatorPath = path.join(SKILLS_DIR, "validator", "SKILL.md");
    if (existsSync(validatorPath)) {
      const validator = readFileSync(validatorPath, "utf8");
      assert.match(validator, /Compatibility only|compatibility-only|not an active/i);
      assert.doesNotMatch(validator, /Independent assurance responsibility/);
    }
  });

  it("one Test Engineer role names Planning and Assurance sessions", () => {
    const skillPath = path.join(SKILLS_DIR, "test-engineer", "SKILL.md");
    assert.ok(existsSync(skillPath), "test-engineer/SKILL.md must exist");
    const text = readFileSync(skillPath, "utf8");
    assert.match(text, /Planning Test Engineer/);
    assert.match(text, /Assurance Test Engineer/);
    assert.match(text, /retires Validator|replaces Validator|absent from active roles/i);
    assert.match(text, /published standard/);
  });

  it("split Implementer separates Test Implementer from Product Implementer and neither self-certifies", () => {
    const implementer = readFileSync(path.join(SKILLS_DIR, "implementer", "SKILL.md"), "utf8");
    assert.match(implementer, /Test Implementer/);
    assert.match(implementer, /product Implementer|product implementation|Product Implementer/i);
    assert.match(
      implementer,
      /excludes tests|must not weaken independently authored tests/i
    );
    assert.match(implementer, /Neither.*self-certif|must not self-certify/i);
  });

  it("Architectural Alignment enforces bounded discovery, workspace.md template, and anti-hallucination guard", () => {
    const alignment = readFileSync(
      path.join(SKILLS_DIR, "architectural-alignment", "SKILL.md"),
      "utf8"
    );
    const templatePath = path.join(SKILLS_DIR, "architectural-alignment", "templates", "workspace.md");
    assert.ok(existsSync(templatePath), "templates/workspace.md must exist");
    const templateText = readFileSync(templatePath, "utf8");

    // Positive assertions
    assert.match(alignment, /depth 2,\s*max 40 paths,\s*max 64 KiB/i);
    assert.match(alignment, /templates\/workspace\.md/);
    assert.match(alignment, /NEEDS_EVIDENCE/);
    assert.match(alignment, /observed, not run/i);
    assert.match(alignment, /WORKSPACE_RESUMED/);

    // Negative assertions (paired checks)
    assert.doesNotMatch(templateText, /(^|[\s"`'])\/home\/[A-Za-z0-9._-]+\//, "template must not contain absolute /home/ paths");
    assert.doesNotMatch(templateText, /\/Users\/[A-Za-z0-9._-]+\//, "template must not contain /Users/ paths");
    assert.doesNotMatch(alignment, /<journey-topic>/, "architectural-alignment must not pre-derive journey topic filename");
    assert.doesNotMatch(alignment, /-technical-plan\.md/, "architectural-alignment must not create technical-plan filename");
  });

  it("Scope Definition converges one recommended question at a time", () => {
    const scope = readFileSync(
      path.join(SKILLS_DIR, "scope-definition", "SKILL.md"),
      "utf8"
    );
    assert.match(scope, /Ask exactly one question/);
    assert.match(scope, /recommended answer/);
    assert.match(scope, /Never ask the\s+owner for a fact tools can establish/);
    assert.match(scope, /explicit confirmation that shared understanding/);
    assert.match(scope, /Buffer confirmed decisions in the active session/);
    assert.match(scope, /Do not persist, patch, or\s+re-render Lifecycle state after each answer/);
    assert.match(scope, /Return one consolidated decision batch to the Orchestrator/);
    assert.match(scope, /handoff\/context\s+loss is imminent/);
    assert.doesNotMatch(scope, /Return each confirmed decision immediately/);
  });

  it("canonical planning artifacts are technical-plan, design.md, seit.json, implementation.json, and DoD Manifest", () => {
    const planning = readFileSync(path.join(SKILLS_DIR, "planning-and-design", "SKILL.md"), "utf8");
    const grammar = readFileSync(
      path.join(SKILLS_DIR, "planning-and-design", "references", "artifact-grammar.md"),
      "utf8"
    );
    const coordinator = readFileSync(path.join(SKILLS_DIR, "coordinator", "SKILL.md"), "utf8");
    const task = readFileSync(
      path.join(SKILLS_DIR, "bearing-lite", "templates", "task.md"),
      "utf8"
    );
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    assert.match(grammar, /five canonical|canonical Lifecycle planning artifacts are exactly/i);
    assert.match(grammar, /technical-plan/);
    assert.match(grammar, /type:\s*technical-plan|type` as `technical-plan/);
    assert.match(grammar, /design\.md/);
    assert.match(grammar, /seit\.json/);
    assert.match(grammar, /implementation\.json/);
    assert.match(grammar, /dod-manifest|DoD Manifest/);
    assert.match(grammar, /xlsx/i);
    assert.match(grammar, /never authority|not authority|is not authority/i);
    assert.doesNotMatch(grammar, /plan-spec/);
    for (const [name, text] of [
      ["artifact-grammar", grammar],
      ["planning-and-design", planning],
      ["coordinator", coordinator],
      ["task-template", task],
      ["README", readme],
    ]) {
      assert.doesNotMatch(text, /seit\.md/, `${name} must not treat seit.md as canonical`);
      assert.doesNotMatch(
        text,
        /implementation\.md/,
        `${name} must not treat implementation.md as canonical`
      );
    }
  });

  it("matching settled intent produces five artifacts before one integrated owner review", () => {
    const planning = readFileSync(
      path.join(SKILLS_DIR, "planning-and-design", "SKILL.md"),
      "utf8"
    );
    const grammar = readFileSync(
      path.join(SKILLS_DIR, "planning-and-design", "references", "artifact-grammar.md"),
      "utf8"
    );
    const implementation = planning.indexOf("generate `implementation.json`");
    const html = planning.indexOf("DoD Manifest input together");
    const review = planning.indexOf("exactly one integrated owner review");
    assert.ok(implementation >= 0 && html >= implementation && review > html);
    assert.match(planning, /propose development strategy/);
    assert.match(planning, /never insert a profile or route pause/);
    assert.match(grammar, /single owner review gate requires\s+the complete five-artifact package/);
    assert.match(grammar, /Do not insert a lineup, route, or\s+specification-only owner gate/);
  });

  it("non-matching unresolved material intent returns to Scope Definition without implementation or review", () => {
    const planning = readFileSync(path.join(SKILLS_DIR, "planning-and-design", "SKILL.md"), "utf8");
    const router = readFileSync(path.join(SKILLS_DIR, "bearing-lite", "SKILL.md"), "utf8");
    assert.match(planning, /unresolved material scope, behavior, authority, risk, or\s+acceptance intent returns `REROUTE_SCOPE_DEFINITION`/);
    assert.match(planning, /generate no\s+`implementation\.json` or Manifest/);
    assert.match(router, /Intake[\s\S]*unresolved\s+material intent blocks Planning and Design/);
  });

  it("integrated-review, requirements-register, and published-standard contracts are stated", () => {
    const router = readFileSync(path.join(SKILLS_DIR, "bearing-lite", "SKILL.md"), "utf8");
    const planning = readFileSync(path.join(SKILLS_DIR, "planning-and-design", "SKILL.md"), "utf8");
    const scope = readFileSync(path.join(SKILLS_DIR, "scope-definition", "SKILL.md"), "utf8");
    const implementer = readFileSync(path.join(SKILLS_DIR, "implementer", "SKILL.md"), "utf8");
    const reviewer = readFileSync(path.join(SKILLS_DIR, "reviewer", "SKILL.md"), "utf8");
    const grammar = readFileSync(
      path.join(SKILLS_DIR, "planning-and-design", "references", "artifact-grammar.md"),
      "utf8"
    );
    assert.match(router, /Record the approved Lifecycle type and snapshot/);
    assert.match(router, /Dispatch only after approval/);
    assert.match(planning, /requirements register/);
    assert.match(planning, /Never\s+infer one/);
    assert.match(planning, /author the needed Lifecycle-level proof or return\s+`NEEDS_OWNER_DECISION`/);
    assert.match(planning, /register references versus Lifecycle-local\s+requirements/);
    assert.match(planning, /Owner-decision pauses do\s+not consume correction rounds/);
    assert.match(scope, /Planning and Design is next/);
    assert.match(grammar, /## Requirements register/);
    assert.match(grammar, /Do not restate registered content/);
    assert.match(grammar, /Where the register provides none for a referenced requirement/);
    assert.match(grammar, /DoD Manifest|dod-manifest/);
    assert.match(grammar, /register reference or\s+Lifecycle-local/);
    assert.match(grammar, /## Published standards/);
    assert.match(grammar, /Published standard \(`doc#clause`\) when applicable/);
    assert.match(grammar, /cite the exact document and clause/);
    assert.match(grammar, /passing cross-boundary test does not substitute/);
    assert.match(implementer, /published standard/);
    assert.match(reviewer, /published standard/);
  });

  it("same-wave continuation, compact receipts, and at-end-only assurance are stated", () => {
    const router = readFileSync(path.join(SKILLS_DIR, "bearing-lite", "SKILL.md"), "utf8");
    const coordinator = readFileSync(path.join(SKILLS_DIR, "coordinator", "SKILL.md"), "utf8");
    const implementer = readFileSync(path.join(SKILLS_DIR, "implementer", "SKILL.md"), "utf8");
    const reviewer = readFileSync(path.join(SKILLS_DIR, "reviewer", "SKILL.md"), "utf8");
    const integration = readFileSync(path.join(SKILLS_DIR, "integration-engineer", "SKILL.md"), "utf8");
    const testEngineerPath = path.join(SKILLS_DIR, "test-engineer", "SKILL.md");
    const compact =
      /verdict,\s*candidate_ref,\s*changed_paths,\s*tests,\s*findings,\s*and blocker/;
    assert.match(router, /may continue in-wave/);
    assert.match(router, /visible wave receipt/);
    assert.match(router, /once per wave/);
    assert.match(implementer, /Continue the current session/);
    assert.match(coordinator, /Permit Implementer continuation/);
    assert.match(coordinator, /do not\s+reread every accepted artifact/);
    assert.ok(!existsSync(path.join(SKILLS_DIR, "navigator", "SKILL.md")));
    assert.ok(!existsSync(path.join(SKILLS_DIR, "surveyor", "SKILL.md")));
    /** @type {Array<[string, string]>} */
    const compactRoles = [
      ["implementer", implementer],
      ["coordinator", coordinator],
      ["reviewer", reviewer],
      ["integration-engineer", integration],
    ];
    if (existsSync(testEngineerPath)) {
      compactRoles.push(["test-engineer", readFileSync(testEngineerPath, "utf8")]);
    }
    for (const [name, text] of compactRoles) {
      assert.match(text, compact, `${name} must return the six-field receipt`);
    }
    /** @type {Array<[string, string]>} */
    const assuranceRoles = [
      ["reviewer", reviewer],
      ["integration-engineer", integration],
    ];
    if (existsSync(testEngineerPath)) {
      assuranceRoles.push(["test-engineer", readFileSync(testEngineerPath, "utf8")]);
    }
    for (const [name, text] of assuranceRoles) {
      assert.match(text, /fresh session/, `${name} must start fresh`);
      assert.match(text, /author[\s\S]{0,20}ancestry/, `${name} must reject author ancestry`);
    }
    assert.match(reviewer, /slice or round/, "reviewer must refuse unconfigured slice/round boundaries");
    assert.match(
      readFileSync(testEngineerPath, "utf8"),
      /slice or round/,
      "test-engineer must refuse unconfigured slice/round boundaries"
    );
  });

  it("Codex metadata keeps the router explicitly invoked", () => {
    const metadataPath = path.join(SKILLS_DIR, "bearing-lite", "agents", "openai.yaml");
    assert.ok(existsSync(metadataPath), "router must publish Codex activation metadata");
    const metadata = readFileSync(metadataPath, "utf8");
    assert.match(metadata, /allow_implicit_invocation:\s*false/);
    assert.match(metadata, /\$bearing-lite/);
  });

  it("negative: missing role fails with typed diagnostic", () => {
    const incomplete = REQUIRED_CATALOG.filter((n) => n !== "implementer");
    const verdict = validateCatalog(incomplete);
    assert.equal(verdict.ok, false);
    assert.ok(verdict.diagnostics.some((d) => d.code === "missing_role" && d.skill === "implementer"));
  });

  it("negative: invalid frontmatter fails with typed diagnostic", () => {
    const verdict = validateSkillDocument("implementer", "# No frontmatter\n\nBody only.\n");
    assert.equal(verdict.ok, false);
    assert.ok(verdict.diagnostics.some((d) => d.code === "invalid_frontmatter"));
  });

  it("negative: oversized core skill fails with typed diagnostic", () => {
    const big =
      "---\nname: implementer\ndescription: implement packets\n---\n\n" + "x".repeat(20_000);
    const verdict = validateSkillDocument("implementer", big, { sizeLimit: CORE_SKILL_SIZE_LIMIT });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.diagnostics.some((d) => d.code === "oversized_core_skill"));
  });

  it("negative: duplicate contract fails with typed diagnostic", () => {
    const verdict = validateCatalog([...REQUIRED_CATALOG, "implementer"]);
    assert.equal(verdict.ok, false);
    assert.ok(verdict.diagnostics.some((d) => d.code === "duplicate_contract"));
  });

  it("does not package stale role-routing or task-state PNGs", () => {
    const assets = path.join(SKILLS_DIR, "bearing-lite", "assets");
    assert.equal(existsSync(path.join(assets, "role-routing.png")), false);
    assert.equal(existsSync(path.join(assets, "task-state.png")), false);
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    assert.doesNotMatch(readme, /task-state\.png/);
    assert.doesNotMatch(readme, /role-routing\.png/);
    assert.match(readme, /task-state\.mmd/);
    assert.match(readme, /checkout-lease[\s-]+conflict/);
    assert.match(readme, /WAITING_ON/);
    const mermaid = readFileSync(
      path.join(SKILLS_DIR, "bearing-lite", "references", "task-state.mmd"),
      "utf8"
    );
    assert.match(mermaid, /checkout-lease conflict/);
    assert.match(mermaid, /WAITING_ON/);
  });
  /**
   * ROUTER-EMV-CADENCE-IMPLEMENTATION-001 (S70 test-first for S71).
   * The assurance budget is scoped to each DECLARED phase or wave, dispatched
   * automatically at that unit's end. Journey-final and per-slice scopes are
   * both refused. RED until S71 ships the corrected role, template, and routing
   * text plus skills/bearing-lite/references/assurance-policy.md.
   */
  const LITE_REF = path.join(SKILLS_DIR, "bearing-lite", "references");
  const CADENCE_GOVERNED = Object.freeze({
    "bearing-lite/SKILL.md": path.join(SKILLS_DIR, "bearing-lite", "SKILL.md"),
    "coordinator/SKILL.md": path.join(SKILLS_DIR, "coordinator", "SKILL.md"),
    "reviewer/SKILL.md": path.join(SKILLS_DIR, "reviewer", "SKILL.md"),
    "test-engineer/SKILL.md": path.join(SKILLS_DIR, "test-engineer", "SKILL.md"),
    "bearing-lite/templates/task.md": path.join(SKILLS_DIR, "bearing-lite", "templates", "task.md"),
    "bearing-lite/references/role-routing.mmd": path.join(LITE_REF, "role-routing.mmd"),
    "bearing-lite/references/task-state.md": path.join(LITE_REF, "task-state.md"),
  });
  /** PLANNING-cadence text; explicitly exempt from the assurance prohibition. */
  const CADENCE_EXEMPT = Object.freeze([
    path.join(SKILLS_DIR, "planning-and-design", "SKILL.md"),
    path.join(LITE_REF, "review-policy.md"),
  ]);

  it("T-LITE-12R: the declared assurance policy states the per-declared-unit budget", () => {
    const policyPath = path.join(LITE_REF, "assurance-policy.md");
    assert.ok(existsSync(policyPath), "skills/bearing-lite/references/assurance-policy.md must ship");
    const document = readFileSync(policyPath, "utf8");
    const block = document.match(/```json\n([\s\S]*?)\n```/);
    assert.ok(block, "the policy must publish one machine-readable JSON block");
    const policy = JSON.parse(block[1]);
    assert.equal(policy.budget_scope, "per_declared_cadence_unit");
    assert.equal(policy.review_rounds, 1);
    assert.equal(policy.aggregated_repairs_max, 1);
    assert.equal(policy.automatic_per_slice_review, "cadence_gated");
    assert.equal(policy.automatic_phase_or_wave_end_review, "required");
    assert.equal(policy.post_repair_rereview, "prohibited");
    assert.match(document, /records no route, provider, model, harness, account, or agent identity/);
    for (const identity of ["provider:", "model:", "harness:", "account:", "agent:"]) {
      assert.doesNotMatch(document, new RegExp(`"${identity.slice(0, -1)}"\\s*:`), identity);
    }
    // The separate pre-dispatch planning gate is not folded in.
    assert.match(document, /planning review/i);
    assert.match(document, /separate/i);
  });

  it("T-LITE-14 / W12-R5: no residual Journey-final or per-slice assurance text governs the unit", () => {
    /** @type {Record<string, RegExp[]>} */
    const prohibited = {
      "bearing-lite/SKILL.md": [
        /`max_assurance_rounds` is\s+1 per Journey/,
        /materially changed new Journey resets review allowance/,
      ],
      "coordinator/SKILL.md": [
        /Dispatch declared assurance only at-end/,
        /defer assurance to the Router's final\s+Journey boundary/,
      ],
      "reviewer/SKILL.md": [
        /any boundary other than at-end/,
        /Do not\s+review or repair that Journey again/,
      ],
      "test-engineer/SKILL.md": [/at-end V&V/, /candidate at-end only/, /at-end boundary/],
      "bearing-lite/templates/task.md": [
        /`review_cadence` is `at-end` only/,
        /completed assurance rounds for this Journey/,
        /materially changed new Journey starts at 0/,
      ],
      "bearing-lite/references/role-routing.mmd": [/Final integrated candidate at-end\?/],
      "bearing-lite/references/task-state.md": [
        /One Journey receives at most one assurance round/i,
      ],
    };
    for (const [label, file] of Object.entries(CADENCE_GOVERNED)) {
      const text = readFileSync(file, "utf8");
      for (const pattern of [/new Journey resets/i, /Journey-level allowance/i]) {
        assert.doesNotMatch(text, pattern, `${label} keeps Journey-scoped assurance text ${pattern}`);
      }
      for (const pattern of prohibited[label]) {
        assert.doesNotMatch(text, pattern, `${label} keeps superseded assurance text ${pattern}`);
      }
      // A per-slice assurance round is never declared anywhere in scope.
      assert.doesNotMatch(
        text,
        /assurance (round|review)[^.\n]*per[- ]slice|per[- ]slice[^.\n]*assurance (round|review)/i,
        `${label} must not declare a per-slice assurance round`
      );
    }
    // The planning-cadence occurrences stay untouched and out of this scan.
    for (const exempt of CADENCE_EXEMPT) {
      assert.ok(
        !Object.values(CADENCE_GOVERNED).includes(exempt),
        `${exempt} is planning cadence and is exempt`
      );
    }
    assert.ok(existsSync(path.join(SKILLS_DIR, "planning-and-design", "SKILL.md")));
  });

  it("T-LITE-15 / W12-R5: role text agrees with the declared phase or wave unit", () => {
    for (const [label, file] of Object.entries(CADENCE_GOVERNED)) {
      const text = readFileSync(file, "utf8");
      assert.match(
        text,
        /declared (phase or wave|wave or phase)/i,
        `${label} must name the declared phase-or-wave unit`
      );
    }
    for (const role of ["reviewer", "test-engineer", "coordinator"]) {
      const text = readFileSync(path.join(SKILLS_DIR, role, "SKILL.md"), "utf8");
      assert.match(text, /max_assurance_rounds/, `${role} must honor the bound`);
      assert.match(text, /\bof 1\b|\b1 per declared\b/, `${role} must fix the bound at one round`);
      assert.match(text, /one[\s\S]{0,120}repair/i, `${role} must allow at most one aggregate repair`);
      assert.match(text, /deterministic/i, `${role} must close deterministically`);
      assert.match(
        text,
        /without another review|no rereview|not.{0,40}review.{0,40}again/i,
        `${role} must not rereview the repaired unit`
      );
      assert.match(text, /distinct declared/i, `${role} must state the next distinct unit rule`);
      assert.match(text, /own budget|its own (1\/1 )?(round|budget|allowance)/i, `${role} must give it its own budget`);
    }
    // Wave-end dispatch is the required trigger, and the router owns it.
    const router = readFileSync(path.join(SKILLS_DIR, "bearing-lite", "SKILL.md"), "utf8");
    const coordinator = readFileSync(path.join(SKILLS_DIR, "coordinator", "SKILL.md"), "utf8");
    for (const [name, text] of [["router", router], ["coordinator", coordinator]]) {
      assert.match(
        text,
        /(wave|phase)[- ]end|end of (each|the) declared (phase or wave|wave|phase)/i,
        `${name} must dispatch assurance at the declared unit end`
      );
    }
    // The separate pre-dispatch planning gate is still not folded in.
    assert.match(
      router,
      /Planning review is a separate pre-dispatch gate/,
      "the planning-review 1/1 gate stays separate"
    );
  });
});
