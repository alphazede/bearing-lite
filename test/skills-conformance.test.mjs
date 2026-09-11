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
  "repository-fit",
  "set-bearings",
  "gather-supplies",
  "map-the-route",
];
const ACTIVE_ROLES = [
  "crewmate",
  "explorer",
  "park-ranger",
  "surveyor",
  "test-engineer",
  "scribe",
  "plan-integrator",
  "systems-modeler",
  "integration-engineer",
];
const COMPATIBILITY_ROLES = ["navigator", "validator"];
const REQUIRED_CATALOG = [ROUTER, ...PLANNING, "navigator", ...ACTIVE_ROLES];
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
  const allowed = new Set([...REQUIRED_CATALOG, ...COMPATIBILITY_ROLES]);
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

  it("Explorer owns proven-independent lanes; Router owns cross-wave conflicts", () => {
    const explorer = readFileSync(path.join(SKILLS_DIR, "explorer", "SKILL.md"), "utf8");
    const navigator = readFileSync(path.join(SKILLS_DIR, "navigator", "SKILL.md"), "utf8");
    const router = readFileSync(path.join(SKILLS_DIR, "bearing-lite", "SKILL.md"), "utf8");
    assert.match(explorer, /proven-independent/);
    assert.match(explorer, /never add a nested coordinator/);
    assert.doesNotMatch(explorer, /Trail Boss|Sub-Explorer|trail-boss|sub-explorer/);
    assert.match(router, /owns\s+Expedition\s+sequencing/);
    assert.match(navigator, /cross-wave/);
    assert.match(navigator, /conflict/);
    assert.match(navigator, /Compatibility only/);
    assert.doesNotMatch(navigator, /Trail Boss|Sub-Explorer|trail-boss|sub-explorer/);
    assert.doesNotMatch(router, /Trail Boss|Sub-Explorer|trail-boss|sub-explorer/);
  });

  it("each skill frontmatter name equals directory and description is present", () => {
    for (const name of skillDirs) {
      const text = readFileSync(path.join(SKILLS_DIR, name, "SKILL.md"), "utf8");
      const verdict = validateSkillDocument(name, text);
      assert.equal(verdict.ok, true, `${name}: ${JSON.stringify(verdict)}`);
      const lines = text.trimEnd().split(/\r?\n/).length;
      const words = text.trim().split(/\s+/).length;
      assert.ok(lines <= 60, `${name}: ${lines} lines must be at most 60`);
      const maxWords = ["bearing-lite", "map-the-route"].includes(name) ? 400 : 600;
      assert.ok(words <= maxWords, `${name}: ${words} words must be at most ${maxWords}`);
    }
  });

  it("matching activation cases succeed for representative roles", () => {
    const cases = [
      ["crewmate", "implement packet with write-set change as crewmate"],
      ["explorer", "orchestrate wave of crewmate packets as explorer"],
      ["navigator", "sequence expedition waves as navigator"],
      ["repository-fit", "repository fit choose repo workspace"],
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
    // Name-similarity: "validate the plan structure" should not activate park-ranger.
    // Broad: "do some repository work" should not force navigator.
    const park = readFileSync(path.join(SKILLS_DIR, "park-ranger", "SKILL.md"), "utf8");
    const parkV = validateSkillDocument("park-ranger", park);
    assert.equal(parkV.ok, true);
    if (parkV.ok) {
      assert.equal(
        activationMatches("park-ranger", parkV.description, "validate the plan structure quickly"),
        false,
        "park-ranger must stay dormant for name-similar non-match"
      );
    }
    const nav = readFileSync(path.join(SKILLS_DIR, "navigator", "SKILL.md"), "utf8");
    const navV = validateSkillDocument("navigator", nav);
    assert.equal(navV.ok, true);
    if (navV.ok) {
      assert.equal(
        activationMatches("navigator", navV.description, "do some repository work"),
        false,
        "navigator must stay dormant for broad wording"
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
          "Use Bearing Lite to start this repository journey"
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
    assert.match(router, /Preparing this Journey\./);
    assert.match(router, /review_cadence: at-end/);
    assert.doesNotMatch(router, /after a\s+slice, after an integrated round, or at the end\?/);
    assert.match(router, /Router alone writes Journey\s+planning state/);
    assert.match(router, /plugin\s+hosts are partial/i);
    assert.match(router, /skill-copy is skills-only/);
    assert.match(router, /may continue in-wave/);
    assert.match(router, /Lineup comes only from `~\/\.agents\/bearing-lite\/lineups\.json`/);
    assert.doesNotMatch(router, /default-role-lineup\.md/);
    assert.match(router, /never infer identity values/i);
    assert.match(router, /planning\s+nodes return owner questions/);
    const planning = router.indexOf("Repository Fit");
    const map = router.indexOf("Invoke Map the Route");
    assert.ok(map >= 0 && map > planning, "Map the Route must follow planning stages");
    assert.match(router, /Do not ask for lineup or route\s+before it/);
    assert.match(router, /one integrated\s+approval-or-change gate/);
    assert.match(router, /Never add a staged lineup or route-review gate/);
  });

  it("execution roles revalidate the visible checkout lease at wave-scoped boundaries", () => {
    const explorer = readFileSync(path.join(SKILLS_DIR, "explorer", "SKILL.md"), "utf8");
    const crewmate = readFileSync(path.join(SKILLS_DIR, "crewmate", "SKILL.md"), "utf8");
    const identity =
      /Revalidate the visible checkout\s+lease against the approved Journey,\s+repository, checkout\/worktree, branch,\s+candidate revision, generation,\s+and active state/;
    const failClosed =
      /Released, stale-generation,\s+forged, or\s+branch\/HEAD-drifted leases fail closed/;
    const waveScoped = /at wave start, after\s+detected drift, and before commit/;
    for (const [name, text] of [
      ["explorer", explorer],
      ["crewmate", crewmate],
    ]) {
      assert.match(text, identity, `${name} must revalidate the full lease identity`);
      assert.match(text, waveScoped, `${name} must revalidate at wave-scoped boundaries`);
      assert.match(text, failClosed, `${name} must fail closed on drifted or forged leases`);
    }
    assert.match(explorer, /same valid lease continues\s+without duplicate dispatch/);
    assert.match(crewmate, /return WAITING_ON without writing/);
    assert.doesNotMatch(crewmate, /every mutation/);
  });

  it("recorded Journey lineup snapshot outranks later global-default edits", () => {
    const router = readFileSync(path.join(SKILLS_DIR, "bearing-lite", "SKILL.md"), "utf8");
    const explorer = readFileSync(path.join(SKILLS_DIR, "explorer", "SKILL.md"), "utf8");
    const crewmate = readFileSync(path.join(SKILLS_DIR, "crewmate", "SKILL.md"), "utf8");
    assert.match(router, /recorded\s+snapshot is authoritative for this Journey/);
    assert.match(
      router,
      /Later edits to\s+`~\/\.agents\/bearing-lite\/lineups\.json` have no effect on it/
    );
    assert.match(router, /explicit owner-confirmed\s+dated visible amendment/);
    assert.match(router, /lineup identity from the recorded snapshot/);
    for (const [name, text] of [
      ["explorer", explorer],
      ["crewmate", crewmate],
    ]) {
      assert.match(
        text,
        /recorded Journey snapshot/,
        `${name} must read identities from the Journey snapshot`
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
    const explorer = readFileSync(path.join(SKILLS_DIR, "explorer", "SKILL.md"), "utf8");
    assert.match(router, /`max_assurance_rounds` is\s+1/);
    assert.match(router, /not per Journey|per declared phase or wave/);
    assert.match(router, /assurance_rounds/);
    assert.match(router, /Direct route/);
    assert.match(router, /never\s+dispatch Navigator/);
    assert.match(
      router,
      /OWNER_DECISION_REQUIRED` naming the candidate\s+and count/
    );
    for (const [name, text] of [["explorer", explorer]]) {
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

  it("Park Ranger declares terminal versus bounded-correction outcomes", () => {
    const park = readFileSync(path.join(SKILLS_DIR, "park-ranger", "SKILL.md"), "utf8");
    assert.match(park, /`ACCEPT`, `ACCEPT_WITH_FINDINGS`, and `BLOCK` are terminal/);
    assert.match(park, /`REPAIR_REQUIRED`\s+permits bounded correction/);
    assert.match(park, /ACCEPT_WITH_FINDINGS` accepts residual/);
    assert.match(park, /do not follow it with another repair/);
    assert.match(park, /max_assurance_rounds/);
    assert.match(park, /of 1/);
  });

  it("Validator is absent from active roles; remaining validator skill is compatibility-only", () => {
    const lineup = readFileSync(path.join(LITE_REF, "lineups.md"), "utf8");
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

  it("split Crewmate separates test-writing from product and neither self-certifies", () => {
    const crewmate = readFileSync(path.join(SKILLS_DIR, "crewmate", "SKILL.md"), "utf8");
    assert.match(crewmate, /test-writing/);
    assert.match(crewmate, /product Crewmate|product implementation/i);
    assert.match(
      crewmate,
      /excludes tests|must not weaken independently authored tests/i
    );
    assert.match(crewmate, /Neither.*self-certif|must not self-certify/i);
  });

  it("Set Bearings enforces bounded discovery, workspace.md template, and anti-hallucination guard", () => {
    const setBearings = readFileSync(
      path.join(SKILLS_DIR, "set-bearings", "SKILL.md"),
      "utf8"
    );
    const templatePath = path.join(SKILLS_DIR, "set-bearings", "templates", "workspace.md");
    assert.ok(existsSync(templatePath), "templates/workspace.md must exist");
    const templateText = readFileSync(templatePath, "utf8");

    // Positive assertions
    assert.match(setBearings, /depth 2,\s*max 40 paths,\s*max 64 KiB/i);
    assert.match(setBearings, /templates\/workspace\.md/);
    assert.match(setBearings, /NEEDS_EVIDENCE/);
    assert.match(setBearings, /observed, not run/i);
    assert.match(setBearings, /WORKSPACE_RESUMED/);

    // Negative assertions (paired checks)
    assert.doesNotMatch(templateText, /(^|[\s"`'])\/home\/[A-Za-z0-9._-]+\//, "template must not contain absolute /home/ paths");
    assert.doesNotMatch(templateText, /\/Users\/[A-Za-z0-9._-]+\//, "template must not contain /Users/ paths");
    assert.doesNotMatch(setBearings, /<journey-topic>/, "set-bearings must not pre-derive journey topic filename");
    assert.doesNotMatch(setBearings, /-technical-plan\.md/, "set-bearings must not create technical-plan filename");
  });

  it("Gather Supplies converges one recommended question at a time", () => {
    const gather = readFileSync(
      path.join(SKILLS_DIR, "gather-supplies", "SKILL.md"),
      "utf8"
    );
    assert.match(gather, /Ask exactly one question/);
    assert.match(gather, /recommended answer/);
    assert.match(gather, /Never ask the\s+owner for a fact tools can establish/);
    assert.match(gather, /explicit confirmation that shared understanding/);
    assert.match(gather, /Buffer confirmed decisions in the active session/);
    assert.match(gather, /Do not persist, patch, or\s+re-render Journey state after each answer/);
    assert.match(gather, /Return one consolidated decision batch to the Router/);
    assert.match(gather, /handoff\/context\s+loss is imminent/);
    assert.doesNotMatch(gather, /Return each confirmed decision immediately/);
  });

  it("canonical planning artifacts are technical-plan, design.md, seit.json, implementation.json, and review.html", () => {
    const mapRoute = readFileSync(path.join(SKILLS_DIR, "map-the-route", "SKILL.md"), "utf8");
    const grammar = readFileSync(
      path.join(SKILLS_DIR, "map-the-route", "references", "artifact-grammar.md"),
      "utf8"
    );
    const explorer = readFileSync(path.join(SKILLS_DIR, "explorer", "SKILL.md"), "utf8");
    const task = readFileSync(
      path.join(SKILLS_DIR, "bearing-lite", "templates", "task.md"),
      "utf8"
    );
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    assert.match(grammar, /five canonical|canonical Journey planning artifacts are exactly/i);
    assert.match(grammar, /technical-plan/);
    assert.match(grammar, /type:\s*technical-plan|type` as `technical-plan/);
    assert.match(grammar, /design\.md/);
    assert.match(grammar, /seit\.json/);
    assert.match(grammar, /implementation\.json/);
    assert.match(grammar, /review\.html/);
    assert.match(grammar, /xlsx/i);
    assert.match(grammar, /never authority|not authority|is not authority/i);
    assert.doesNotMatch(grammar, /plan-spec/);
    for (const [name, text] of [
      ["artifact-grammar", grammar],
      ["map-the-route", mapRoute],
      ["explorer", explorer],
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
    const mapRoute = readFileSync(
      path.join(SKILLS_DIR, "map-the-route", "SKILL.md"),
      "utf8"
    );
    const grammar = readFileSync(
      path.join(SKILLS_DIR, "map-the-route", "references", "artifact-grammar.md"),
      "utf8"
    );
    const implementation = mapRoute.indexOf("generate `implementation.json`");
    const html = mapRoute.indexOf("`review.html` together");
    const review = mapRoute.indexOf("exactly one integrated owner review");
    assert.ok(implementation >= 0 && html >= implementation && review > html);
    assert.match(mapRoute, /propose the Explorer Journey or Expedition,\s+active\/standby\/unused role states, lineup, reasoning/);
    assert.match(mapRoute, /never insert a lineup or route-review pause/);
    assert.match(grammar, /single owner review gate requires\s+the complete five-artifact package/);
    assert.match(grammar, /Do not insert a lineup, route, or\s+specification-only owner gate/);
  });

  it("non-matching unresolved material intent returns to Gather Supplies without implementation or review", () => {
    const mapRoute = readFileSync(path.join(SKILLS_DIR, "map-the-route", "SKILL.md"), "utf8");
    const router = readFileSync(path.join(SKILLS_DIR, "bearing-lite", "SKILL.md"), "utf8");
    assert.match(mapRoute, /unresolved material scope, behavior, authority, risk, or\s+acceptance intent returns `REROUTE_GATHER_SUPPLIES`/);
    assert.match(mapRoute, /generate no\s+`implementation\.json` or `review\.html`/);
    assert.match(router, /Gather Supplies[\s\S]*unresolved\s+material intent blocks Map the Route/);
  });

  it("integrated-review, requirements-register, and published-standard contracts are stated", () => {
    const router = readFileSync(path.join(SKILLS_DIR, "bearing-lite", "SKILL.md"), "utf8");
    const mapRoute = readFileSync(path.join(SKILLS_DIR, "map-the-route", "SKILL.md"), "utf8");
    const gather = readFileSync(path.join(SKILLS_DIR, "gather-supplies", "SKILL.md"), "utf8");
    const crewmate = readFileSync(path.join(SKILLS_DIR, "crewmate", "SKILL.md"), "utf8");
    const parkRanger = readFileSync(path.join(SKILLS_DIR, "park-ranger", "SKILL.md"), "utf8");
    const grammar = readFileSync(
      path.join(SKILLS_DIR, "map-the-route", "references", "artifact-grammar.md"),
      "utf8"
    );
    assert.match(router, /Record the approved Journey type and snapshot/);
    assert.match(router, /Dispatch only after approval/);
    assert.match(mapRoute, /requirements register/);
    assert.match(mapRoute, /Never\s+infer one/);
    assert.match(mapRoute, /author the needed Journey-level proof or return\s+`NEEDS_OWNER_DECISION`/);
    assert.match(mapRoute, /register references versus Journey-local\s+requirements/);
    assert.match(mapRoute, /Owner-decision pauses do\s+not consume correction rounds/);
    assert.match(gather, /route review after Map the Route/);
    assert.match(grammar, /## Requirements register/);
    assert.match(grammar, /Do not restate registered content/);
    assert.match(grammar, /Where the register provides none for a referenced requirement/);
    assert.match(grammar, /`review\.html` marks every requirement as either a register reference or\s+Journey-local/);
    assert.match(grammar, /## Published standards/);
    assert.match(grammar, /Published standard \(`doc#clause`\) when applicable/);
    assert.match(grammar, /cite the exact document and clause/);
    assert.match(grammar, /passing cross-boundary test does not substitute/);
    assert.match(crewmate, /published standard/);
    assert.match(parkRanger, /published standard/);
  });

  it("same-wave continuation, compact receipts, and at-end-only assurance are stated", () => {
    const router = readFileSync(path.join(SKILLS_DIR, "bearing-lite", "SKILL.md"), "utf8");
    const explorer = readFileSync(path.join(SKILLS_DIR, "explorer", "SKILL.md"), "utf8");
    const crewmate = readFileSync(path.join(SKILLS_DIR, "crewmate", "SKILL.md"), "utf8");
    const navigator = readFileSync(path.join(SKILLS_DIR, "navigator", "SKILL.md"), "utf8");
    const park = readFileSync(path.join(SKILLS_DIR, "park-ranger", "SKILL.md"), "utf8");
    const surveyor = readFileSync(path.join(SKILLS_DIR, "surveyor", "SKILL.md"), "utf8");
    const validatorPath = path.join(SKILLS_DIR, "validator", "SKILL.md");
    const testEngineerPath = path.join(SKILLS_DIR, "test-engineer", "SKILL.md");
    const compact =
      /verdict,\s*candidate_ref,\s*changed_paths,\s*tests,\s*findings,\s*and blocker/;
    assert.match(router, /may continue in-wave/);
    assert.match(router, /visible wave receipt/);
    assert.match(router, /once per wave/);
    assert.match(crewmate, /Continue the current session/);
    assert.match(explorer, /Permit Crewmate continuation/);
    assert.match(explorer, /do not\s+reread every accepted artifact/);
    assert.match(navigator, /Compatibility only/);
    assert.match(navigator, /REROUTED/);
    /** @type {Array<[string, string]>} */
    const compactRoles = [
      ["crewmate", crewmate],
      ["explorer", explorer],
      ["navigator", navigator],
      ["park-ranger", park],
      ["surveyor", surveyor],
    ];
    if (existsSync(validatorPath)) {
      compactRoles.push(["validator", readFileSync(validatorPath, "utf8")]);
    }
    if (existsSync(testEngineerPath)) {
      compactRoles.push(["test-engineer", readFileSync(testEngineerPath, "utf8")]);
    }
    for (const [name, text] of compactRoles) {
      assert.match(text, compact, `${name} must return the six-field receipt`);
    }
    /** @type {Array<[string, string]>} */
    const assuranceRoles = [
      ["park-ranger", park],
      ["surveyor", surveyor],
    ];
    if (existsSync(testEngineerPath)) {
      assuranceRoles.push(["test-engineer", readFileSync(testEngineerPath, "utf8")]);
    }
    for (const [name, text] of assuranceRoles) {
      assert.match(text, /fresh session/, `${name} must start fresh`);
      assert.match(text, /author ancestry/, `${name} must reject author ancestry`);
      assert.match(text, /slice or round/, `${name} must refuse slice/round boundaries`);
    }
  });

  it("Codex metadata keeps the router explicitly invoked", () => {
    const metadataPath = path.join(SKILLS_DIR, "bearing-lite", "agents", "openai.yaml");
    assert.ok(existsSync(metadataPath), "router must publish Codex activation metadata");
    const metadata = readFileSync(metadataPath, "utf8");
    assert.match(metadata, /allow_implicit_invocation:\s*false/);
    assert.match(metadata, /\$bearing-lite/);
  });

  it("negative: missing role fails with typed diagnostic", () => {
    const incomplete = REQUIRED_CATALOG.filter((n) => n !== "crewmate");
    const verdict = validateCatalog(incomplete);
    assert.equal(verdict.ok, false);
    assert.ok(verdict.diagnostics.some((d) => d.code === "missing_role" && d.skill === "crewmate"));
  });

  it("negative: invalid frontmatter fails with typed diagnostic", () => {
    const verdict = validateSkillDocument("crewmate", "# No frontmatter\n\nBody only.\n");
    assert.equal(verdict.ok, false);
    assert.ok(verdict.diagnostics.some((d) => d.code === "invalid_frontmatter"));
  });

  it("negative: oversized core skill fails with typed diagnostic", () => {
    const big =
      "---\nname: crewmate\ndescription: implement packets\n---\n\n" + "x".repeat(20_000);
    const verdict = validateSkillDocument("crewmate", big, { sizeLimit: CORE_SKILL_SIZE_LIMIT });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.diagnostics.some((d) => d.code === "oversized_core_skill"));
  });

  it("negative: duplicate contract fails with typed diagnostic", () => {
    const verdict = validateCatalog([...REQUIRED_CATALOG, "crewmate"]);
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
    "explorer/SKILL.md": path.join(SKILLS_DIR, "explorer", "SKILL.md"),
    "park-ranger/SKILL.md": path.join(SKILLS_DIR, "park-ranger", "SKILL.md"),
    "surveyor/SKILL.md": path.join(SKILLS_DIR, "surveyor", "SKILL.md"),
    "test-engineer/SKILL.md": path.join(SKILLS_DIR, "test-engineer", "SKILL.md"),
    "bearing-lite/templates/task.md": path.join(SKILLS_DIR, "bearing-lite", "templates", "task.md"),
    "bearing-lite/references/role-routing.mmd": path.join(LITE_REF, "role-routing.mmd"),
    "bearing-lite/references/task-state.md": path.join(LITE_REF, "task-state.md"),
  });
  /** PLANNING-cadence text; explicitly exempt from the assurance prohibition. */
  const CADENCE_EXEMPT = Object.freeze([
    path.join(SKILLS_DIR, "map-the-route", "SKILL.md"),
    path.join(LITE_REF, "review-policy.md"),
  ]);

  it("T-LITE-12R: the declared assurance policy states the per-declared-unit budget", () => {
    const policyPath = path.join(LITE_REF, "assurance-policy.md");
    assert.ok(existsSync(policyPath), "skills/bearing-lite/references/assurance-policy.md must ship");
    const document = readFileSync(policyPath, "utf8");
    const block = document.match(/```json\n([\s\S]*?)\n```/);
    assert.ok(block, "the policy must publish one machine-readable JSON block");
    const policy = JSON.parse(block[1]);
    assert.equal(policy.budget_scope, "per_declared_phase_or_wave");
    assert.equal(policy.review_rounds, 1);
    assert.equal(policy.aggregated_repairs_max, 1);
    assert.equal(policy.automatic_per_slice_review, "prohibited");
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
      "explorer/SKILL.md": [
        /Dispatch declared assurance only at-end/,
        /defer assurance to the Router's final\s+Journey boundary/,
      ],
      "park-ranger/SKILL.md": [
        /any boundary other than at-end/,
        /Do not\s+review or repair that Journey again/,
      ],
      "surveyor/SKILL.md": [/at-end boundary/, /comparison at-end/],
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
    assert.ok(existsSync(path.join(SKILLS_DIR, "map-the-route", "SKILL.md")));
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
    for (const role of ["park-ranger", "surveyor", "test-engineer", "explorer"]) {
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
    const explorer = readFileSync(path.join(SKILLS_DIR, "explorer", "SKILL.md"), "utf8");
    for (const [name, text] of [["router", router], ["explorer", explorer]]) {
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
