import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const core = require(path.join(ROOT, "hooks/planning-review.cjs"));
const transition = require(path.join(ROOT, "hooks/transition-order.cjs"));
const closeout = require(path.join(ROOT, "hooks/closeout.cjs"));
const host = require(path.join(ROOT, "hooks/com.anthropic.claude-code/host.cjs"));

const candidate = { candidate_ref: "plan", candidate_revision: "r1", candidate_digest: "d1" };
const review = (extra = {}) => ({
  candidate,
  reviewer_slots: [
    { slot_id: "slot-a", primary_route_ref: "route-a", fallback_route_refs: ["route-a2"] },
    { slot_id: "slot-b", primary_route_ref: "route-b", fallback_route_refs: ["route-b2"] },
  ],
  round_number: 1,
  completed_rounds: 1,
  receipts: [
    { slot_id: "slot-a", selected_route_ref: "route-a", ...candidate, independent: true, findings_isolated: true },
    { slot_id: "slot-b", selected_route_ref: "route-b", ...candidate, independent: true, findings_isolated: true },
  ],
  aggregation_complete: true,
  aggregated_repairs: 1,
  deterministic_gate: "PASS",
  ...extra,
});

const policyDocument = readFileSync(
  path.join(ROOT, "skills/bearing-lite/references/review-policy.md"),
  "utf8"
);
const documentedPolicy = JSON.parse(policyDocument.match(/```json\n([\s\S]*?)\n```/)[1]);

describe("model-neutral planning review", () => {
  it("accepts exactly two independent slots, one shared candidate, one repair, and deterministic PASS", () => {
    assert.deepEqual(core.POLICY, documentedPolicy);
    assert.deepEqual(core.evaluatePlanningReview(review()), { outcome: "PASS", reason: "repair_gate_passed" });
    assert.match(transition.evaluate({ action_kind: "planning_review_transition", planning_review: review() }).reason, /planning_review:PASS/);
    assert.match(closeout.evaluate({ planning_review: review() }).reason, /planning_review:PASS/);
  });

  it("returns exact reasons for policy violations", () => {
    const mismatch = review();
    mismatch.receipts = mismatch.receipts.map((receipt, index) =>
      index ? { ...receipt, candidate_digest: "other" } : receipt
    );
    const cases = [
      [mismatch, "HALT", "candidate_or_independence_mismatch"],
      [review({ reviewer_slots: [review().reviewer_slots[0], review().reviewer_slots[0]] }), "OWNER_AMENDMENT_REQUIRED", "slot_binding_invalid"],
      [review({ reviewer_slots: [{ ...review().reviewer_slots[0], exhausted: true }, review().reviewer_slots[1]] }), "FAIL_ROUND", "reviewer_slot_exhausted"],
      [review({ round_number: 2, completed_rounds: 2 }), "HALT", "review_round_limit"],
      [review({ aggregated_repairs: 2 }), "HALT", "aggregated_repair_limit"],
      [review({ automatic_rereview_requested: true }), "OWNER_AMENDMENT_REQUIRED", "automatic_rereview_prohibited"],
    ];
    for (const [value, outcome, reason] of cases) {
      assert.deepEqual(core.evaluatePlanningReview(value), { outcome, reason });
    }
  });

  it("distinguishes a pending first round from an exceeded round", () => {
    assert.deepEqual(core.evaluatePlanningReview(review({ completed_rounds: 0 })), {
      outcome: "NEEDS_MORE_EVIDENCE", reason: "review_round_pending",
    });
    assert.deepEqual(core.evaluatePlanningReview(review({ completed_rounds: 2 })), {
      outcome: "HALT", reason: "review_round_limit",
    });
  });

  it("planning review cannot bypass protected completion or close safe channels", () => {
    const protectedResult = closeout.evaluate({
      mode: "protected_completion",
      planning_review: review(),
      verdict: "PASS",
      candidate_ref: "candidate",
      changed_paths: [],
      tests: "pass",
      findings: "none",
      blocker: "none",
      required_assurance: ["Validator"],
      assurance_accepted: [],
      candidate_matched: false,
    });
    assert.equal(protectedResult.outcome, "BLOCK");
    assert.match(protectedResult.reason, /assurance:Validator/);
    assert.match(protectedResult.reason, /candidate_mismatch/);
    for (const channel of ["repair", "status", "owner_communication", "safe_rollback"]) {
      const result = transition.evaluate({
        channel,
        action_kind: "planning_review_transition",
        planning_review: review({ completed_rounds: 2 }),
      });
      assert.deepEqual([result.outcome, result.reason], ["ADVISE", "channel_open"]);
    }
  });

  it("keeps implementation assurance separate and core policy model-neutral", () => {
    const router = readFileSync(path.join(ROOT, "skills/bearing-lite/SKILL.md"), "utf8");
    const policy = policyDocument;
    assert.match(router, /Planning review is a separate pre-dispatch gate/);
    assert.match(router, /`max_assurance_rounds` is 1/);
    assert.doesNotMatch(policy, /Claude|Codex|Grok|Cursor|Kimi|AGY|Pi|DeepCode|OpenAI|Anthropic/i);
    const parkRanger = transition.evaluate({ from_state: "EVIDENCE_READY", to_state: "REVIEWING", required_assurance: ["Park Ranger"] });
    assert.equal(parkRanger.outcome, "REROUTE");
  });

  it("records honest positive and negative coverage for every supported harness", () => {
    const mapping = readFileSync(path.join(ROOT, "hooks/com.anthropic.claude-code/mapping.md"), "utf8");
    const partial = [
      ["Claude Code", "SessionStart", "Stop"],
      ["Codex", "session_start", "session_end"],
      ["Grok Build", "UserPromptSubmit", "SubagentStop"],
      ["Cursor", "sessionStart", "stop"],
      ["Kimi Code", "user_prompt_submit", "sessionEnd"],
    ];
    for (const [name, start, stop] of partial) {
      assert.match(mapping, new RegExp(`\\| ${name.replace(" ", "\\s") } \\|[^\\n]+\\| partial \\|`));
      assert.equal(host.classForEvent(start), "activation", name);
      assert.equal(host.classForEvent(stop), "closeout", name);
      assert.equal(host.classForEvent("planningReview"), null);
    }
    for (const name of ["AGY", "Pi", "DeepCode"]) {
      assert.match(mapping, new RegExp(`\\| ${name} \\|[^\\n]+\\| skills-only \\|`));
    }
    assert.match(mapping, /cannot derive that nested record safely/);
  });
});
