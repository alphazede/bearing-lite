/**
 * #221 author-known deltas, #222 boundary review dispatch, #223 landing.
 * Instruction proof only; no new hook evaluator.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const ROUTER = read("skills/bearing-lite/SKILL.md");
const COORDINATOR = read("skills/coordinator/SKILL.md");
const INTEGRATION = read("skills/integration-engineer/SKILL.md");
const TEST_ENGINEER = read("skills/test-engineer/SKILL.md");
const ASSURANCE = read("skills/bearing-lite/references/assurance-policy.md");
const ASSEMBLY = read("skills/bearing-lite/references/planning-assembly.md");
const TASK_STATE = read("skills/bearing-lite/references/task-state.md");
const OWNER_STOPS = read("skills/bearing-lite/references/owner-stops.md");
const CORRECTION = read("skills/planning-and-design/references/correction-loop.md");
const TASK_TEMPLATE = read("skills/bearing-lite/templates/task.md");

describe("#222 owner-requested review runs at its declared boundary", () => {
  it("no executing skill asks for a second per-boundary request", () => {
    for (const [name, text] of [["router", ROUTER], ["coordinator", COORDINATOR], ["integration", INTEGRATION], ["assembly", ASSEMBLY]]) {
      assert.doesNotMatch(text, /explicitly requested at (this|the declared|the chosen) boundary/, name);
      assert.doesNotMatch(text, /dispatch only when explicitly requested/, name);
    }
  });

  it("the parent controller dispatches as soon as deterministic checks pass, without deferral", () => {
    assert.match(ASSURANCE, /## Dispatch timing \(#222\)/);
    assert.match(ASSURANCE, /frozen\s+request is the dispatch authority for every declared boundary/);
    assert.match(ASSURANCE, /never waits for a later wave, batches several units into one\s+review, or defers the review to lifecycle end/);
    assert.match(ASSURANCE, /A session the owner did not request stays inactive/);
    assert.match(COORDINATOR, /immediately dispatch the profile-enabled review or assurance/);
    assert.match(ASSEMBLY, /dispatch the independent review\/assurance the owner requested for it in the frozen\s+plan at once/);
  });

  it("phase cadence resolves to each declared wave, so no default change is needed", () => {
    assert.match(ASSURANCE, /`phase` cadence resolves to each wave/);
    assert.match(TASK_TEMPLATE, /`phase` cadence resolves to each wave/);
  });
});

describe("#223 closed units are landed", () => {
  it("task-state defines the landing rule", () => {
    assert.match(TASK_STATE, /## Landing a closed unit/);
    assert.match(TASK_STATE, /Never commit on the default\s+branch/);
    assert.match(TASK_STATE, /Run the unit's exit commands after that last commit/);
    assert.match(TASK_STATE, /open or update one\s+pull request to the default branch/);
    assert.match(TASK_STATE, /merge only when `allowed\.actions` includes `merge` for that unit/);
    assert.match(TASK_STATE, /A\s+passing check, a review verdict, or a profile setting never grants merge/);
    assert.match(TASK_STATE, /A unit is not landed while its requested\s+review is pending/);
  });

  it("controllers and authority point at the landing rule", () => {
    for (const [name, text] of [["router", ROUTER], ["coordinator", COORDINATOR], ["assembly", ASSEMBLY], ["owner-stops", OWNER_STOPS]]) {
      assert.match(text, /task-state\.md#landing-a-closed-unit/, name);
    }
    assert.match(COORDINATOR, /merge only under express authority/);
    assert.match(OWNER_STOPS, /includes `merge` only when the\s+owner chooses to delegate merge/);
  });
});

describe("#221 author-known deltas return to their owner at reconciliation", () => {
  it("planning assembly routes them before consumers, freeze, or review", () => {
    assert.match(ASSEMBLY, /### Author-known deltas \(#221\)/);
    assert.match(ASSEMBLY, /It never waits for\s+the end-of-wave review/);
    assert.match(ASSEMBLY, /before dispatching any session\s+that consumes the affected artifact/);
    assert.match(ASSEMBLY, /refresh cross-artifact sha256 bindings once/);
    assert.match(ASSEMBLY, /spend no `max_assurance_rounds`, no planning-review\s+round, and no repair/);
  });

  it("the exception cannot renew a spent allowance or absorb review findings", () => {
    assert.match(ASSEMBLY, /raised after the unit's review round opens joins that round's one aggregate\s+repair/);
    assert.match(ASSEMBLY, /Neither the delta label nor the reconciliation label can renew a\s+spent allowance/);
    assert.match(OWNER_STOPS, /reconciliation,\s*delta,\s*or refresh cannot renew a spent allowance/i);
  });

  it("the correction loop and Test Engineer point at the rule", () => {
    assert.match(CORRECTION, /planning-assembly\.md#author-known-deltas-221/);
    assert.match(TEST_ENGINEER, /planning-assembly\.md#author-known-deltas-221/);
  });
});
