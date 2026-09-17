/**
 * #113 Orchestrator / Scribe / non-resettable allowance wording.
 * Instruction proof only; no new hook evaluator.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const ALIGNMENT = read("skills/architectural-alignment/SKILL.md");
const ROUTER = read("skills/bearing-lite/SKILL.md");
const OWNER_STOPS = read("skills/bearing-lite/references/owner-stops.md");
const ASSURANCE = read("skills/bearing-lite/references/assurance-policy.md");
const MAPPING = read("hooks/com.anthropic.claude-code/mapping.md");

describe("#113 Orchestrator, Scribe, and non-resettable budgets", () => {
  it("unchanged maps: completed Alignment is not repeated unless the source map is invalid", () => {
    assert.match(ALIGNMENT, /not repeated unless relevant source changes invalidate/i);
    assert.match(ALIGNMENT, /WORKSPACE_RESUMED/);
    assert.doesNotMatch(ALIGNMENT, /always re-run Alignment|repeat Alignment by default/i);
  });

  it("missing architecture: Alignment maps and hands off; it does not design", () => {
    assert.match(ALIGNMENT, /hand off/i);
    assert.match(ALIGNMENT, /does not design missing architecture|do not design missing architecture/i);
    assert.match(ALIGNMENT, /activate Systems\s+Modeler/);
    assert.match(ALIGNMENT, /Never ask planning questions, write risk choices, design/);
  });

  it("renamed repairs after exhaustion: labels cannot renew a spent allowance", () => {
    assert.match(
      OWNER_STOPS,
      /reconciliation,\s*delta,\s*or refresh cannot renew a spent allowance/i
    );
    assert.match(OWNER_STOPS, /Never reset a spent bound/);
    assert.match(ASSURANCE, /budget_reset_on_alias_or_rename": false/);
    assert.match(ASSURANCE, /budget_reset_on_role_change": false/);
    assert.match(ASSURANCE, /budget_reset_on_session_change": false/);
    assert.match(ROUTER, /Plan-artifact findings dispatch a delta/);
  });

  it("Scribe owns transcription; unavailable Scribe is a gap, not Orchestrator substitution", () => {
    assert.match(ROUTER, /Scribe transcribes|does not transcribe/i);
    assert.match(OWNER_STOPS, /Scribe transcribes/);
    assert.match(OWNER_STOPS, /Orchestrator does not transcribe/i);
    assert.match(
      ROUTER,
      /author specialist artifacts|never specialist artifacts/i
    );
    assert.match(
      `${ROUTER}\n${OWNER_STOPS}`,
      /unavailable Scribe is a (typed )?capability gap/i
    );
    assert.match(
      `${ROUTER}\n${OWNER_STOPS}`,
      /not substitution/
    );
  });

  it("ordinary non-Lifecycle work stays outside these Lifecycle continuation rules", () => {
    assert.match(ROUTER, /Not for ordinary work/);
    assert.match(
      OWNER_STOPS,
      /Routine specialist handoffs continue to the agreed owner-review checkpoint/i
    );
    assert.match(
      OWNER_STOPS,
      /only a genuine blocker or owner intervention pauses work/i
    );
  });

  it("findings aggregate before the single authorized repair; cadence-unit budgets stay distinct", () => {
    assert.match(ASSURANCE, /Aggregate findings\s+before/i);
    assert.match(ASSURANCE, /role packets share/i);
    assert.match(ASSURANCE, /"review_rounds": 1/);
    assert.match(ASSURANCE, /"aggregated_repairs_max": 1/);
    assert.match(ASSURANCE, /"post_repair_rereview": "prohibited"/);
    assert.match(ASSURANCE, /next_distinct_declared_phase_or_wave/);
  });

  it("skill-copy distributions do not claim already-running sessions auto-reload", () => {
    assert.match(MAPPING, /do(?:es)? not reload already-running\s+sessions/i);
    assert.doesNotMatch(MAPPING, /already-running sessions reload automatically/i);
  });
});
