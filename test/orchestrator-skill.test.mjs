/**
 * #214 Orchestrator skill: discoverability alias with one canonical owner.
 * Matching: coordinate an approved multi-packet wave through its end
 * boundary; the Implementation Orchestrator owns the migrated wave duties
 * (D1-D9, D11; S09T, B30-218) and a Coordinator runs only for a justified
 * profile-enabled one-wave need while it still ships. Non-matching: one
 * assigned packet stays direct with the Implementer and no forced Coordinator.
 *
 * Forward evidence is derived from the shipped SKILL text itself: match /
 * non-match clauses, dispatch and stop wording are read from
 * `skills/orchestrator/SKILL.md` (which forwards to
 * `skills/bearing-lite/SKILL.md`) at test time. Deleting any of those
 * clauses fails the clause assertions below, and the match classifier
 * reads the shipped "Do not use" clause instead of a test-only keyword list.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertLinksTo, assertLocalLinksResolve, readShipped } from "./skill-contract-fixture.mjs";
import { validateCatalog, validateSkillDocument } from "./skills-conformance.test.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORCH = "skills/orchestrator/SKILL.md";
const CANON = "skills/bearing-lite/SKILL.md";

function orchText() {
  return readShipped(ORCH);
}

function canonText() {
  return readShipped(CANON);
}

// Generic English stopwords only; no domain routing keywords live here.
// All routing terms come from the shipped skill text at test time.
const STOP = new Set(["with", "from", "that", "this", "only", "when", "also", "than", "over", "keep"]);

function terms(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3 && !STOP.has(t))
  );
}

function bodyBullet(text, label) {
  const re = new RegExp(`^-\\s+${label}:[\\s\\S]*?(?=\\n- |\\n## |$)`, "m");
  const m = text.match(re);
  return m ? m[0] : "";
}

/**
 * Classify a request from the shipped skill text alone. The description
 * "Use for ... Do not use for ..." split plus the body Match / Non-match
 * bullets supply the positive and negative term sets; the query's terms are
 * fixed first. A shipped non-match clause covering the query wins, so the
 * negation in "Do not use for implementing one assigned packet" classifies
 * "implementing one assigned bounded packet" as non-matching even though
 * "packet" also appears in the match clause.
 */
function classifyOrchestrator(skillText, query) {
  const verdict = validateSkillDocument("orchestrator", skillText);
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
  const desc = verdict.ok ? verdict.description : "";
  const parts = desc.split(/do not use for/i);
  assert.equal(parts.length, 2, "orchestrator description must carry a 'Do not use for' non-match clause");
  const positive = terms(`${parts[0]} ${bodyBullet(skillText, "Match")}`);
  const negative = terms(`${parts[1]} ${bodyBullet(skillText, "Non-match")}`);
  const q = [...terms(query)];
  const negHits = q.filter((t) => negative.has(t)).length;
  const posHits = q.filter((t) => positive.has(t)).length;
  if (negHits >= 1 && negHits >= posHits) return false;
  return posHits >= 2;
}

describe("orchestrator-skill #214", () => {
  it("orchestrator ships as a valid, size-bounded skill", () => {
    assert.ok(existsSync(path.join(ROOT, ORCH)), "skills/orchestrator/SKILL.md must ship");
    const text = orchText();
    const verdict = validateSkillDocument("orchestrator", text);
    assert.equal(verdict.ok, true, JSON.stringify(verdict));
    const lines = text.trimEnd().split(/\r?\n/).length;
    const words = text.trim().split(/\s+/).length;
    assert.ok(lines <= 60, `orchestrator: ${lines} lines must be at most 60`);
    assert.ok(words <= 650, `orchestrator: ${words} words must be at most 650`);
  });

  it("forward chain resolves to the single canonical owner", () => {
    assertLinksTo(ORCH, CANON);
    assertLocalLinksResolve(ORCH);
    assertLocalLinksResolve(CANON);
    const canon = canonText();
    assert.match(canon, /# Bearing Orchestrator/);
    // No reverse copy: the canonical owner does not duplicate or point back.
    assert.doesNotMatch(canon, /skil[l]?s\/orchestrator\/SKILL\.md/);
    assert.doesNotMatch(canon, /\.\.\/orchestrator\//);
  });

  it("orchestrator forwards rather than duplicating orchestration policy", () => {
    const text = orchText();
    for (const marker of [
      "Planning Orchestrator:",
      "Implementation Orchestrator:",
      "references/task-state.md#landing-a-closed-unit",
      "references/planning-assembly.md",
    ]) {
      assert.doesNotMatch(text, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(text, /\.\.\/bearing-lite\/SKILL\.md/);
  });

  it("alias Codex metadata carries the canonical explicit-invocation policy", () => {
    const aliasMeta = path.join(ROOT, "skills/orchestrator/agents/openai.yaml");
    const canonMeta = path.join(ROOT, "skills/bearing-lite/agents/openai.yaml");
    assert.ok(existsSync(aliasMeta), "orchestrator must publish agents/openai.yaml (R214-1)");
    assert.ok(existsSync(canonMeta), "canonical owner must publish agents/openai.yaml");
    const alias = readFileSync(aliasMeta, "utf8");
    const canon = readFileSync(canonMeta, "utf8");
    assert.match(alias, /allow_implicit_invocation:\s*false/, "alias must disable implicit invocation like the canonical owner");
    assert.match(canon, /allow_implicit_invocation:\s*false/, "canonical owner must disable implicit invocation");
    assert.match(alias, /\$orchestrator/, "alias default prompt must name the orchestrator entry point");
    assert.match(canon, /\$bearing-lite/, "canonical default prompt must name the bearing-lite entry point");
  });

  it("matching request: wave to end boundary classified from shipped match clause", () => {
    const text = orchText();
    // Dispatch / stop evidence is the shipped wording itself; losing any of
    // these clauses fails here before classification runs.
    assert.match(text, /coordinating an approved multi-packet wave through its end boundary/i);
    assert.match(text, /coordinator\/SKILL\.md.*runs\s+only\s+for\s+a\s+justified\s+profile-enabled\s+one-wave\s+need/s);
    assert.match(text, /Stop here and route onward; do not orchestrate\./);
    assert.match(text, /implementing one assigned bounded packet/i);
    assert.equal(
      classifyOrchestrator(text, "orchestrator coordinate this approved multi-packet wave through its end boundary"),
      true,
      "shipped match clause must classify the wave request as matching"
    );
    assert.equal(
      classifyOrchestrator(text, "explicitly coordinate a Bearing lifecycle"),
      true,
      "amended explicit-activation request must classify as matching"
    );
  });

  it("non-matching request: one assigned packet classified from shipped Do-not-use clause", () => {
    const text = orchText();
    // The canonical non-match wording is the evidence: the classifier reads
    // it, so deleting "Do not use for implementing one assigned packet"
    // fails the clause assertion and changes classification.
    const verdict = validateSkillDocument("orchestrator", text);
    assert.equal(verdict.ok, true);
    assert.match(verdict.ok ? verdict.description : "", /Do not use for implementing one assigned packet/i);
    assert.match(text, /Non-match: implementing one assigned bounded packet/);
    assert.equal(
      classifyOrchestrator(text, "implementing one assigned bounded packet"),
      false,
      "required non-matching request must classify as non-matching from shipped text"
    );
    assert.equal(classifyOrchestrator(text, "fix the typo in the readme"), false);
    assert.equal(classifyOrchestrator(text, "ordinary work"), false);
    assert.equal(classifyOrchestrator(text, "naming models or roles"), false);
    assert.equal(classifyOrchestrator(text, "advisory-hook suggestion"), false);
    // Derivation proof: without the shipped negation clause the same
    // classifier cannot promise the non-match verdict.
    const mutated = text.replace(/Do not use for implementing one\s*\n?\s*assigned packet[^.]*\./i, "");
    assert.notEqual(mutated, text, "mutation fixture must actually remove the shipped clause");
    assert.doesNotMatch(mutated, /Do not use for implementing one assigned packet/);
  });

  it("canonical owner keeps match, non-match, dispatch, review and stop clauses", () => {
    const canon = canonText();
    // Each pattern names one load-bearing clause. Removing any of them is a
    // behavior change to the single policy owner and must fail here.
    assert.match(canon, /only\s+when the owner explicitly requests Bearing/);
    assert.match(canon, /Do not activate for\s+ordinary work/);
    assert.match(canon, /coordinator\/SKILL\.md` only for a justified/);
    assert.match(canon, /unrequested review stays inactive/i);
    assert.match(canon, /Launch each selected agent assignment once/);
    assert.match(canon, /Never replay completed stages/);
    assert.match(canon, /On resume, follow `references\/resume\.md` first/);
    assert.match(canon, /Return `READY`, `WAITING_ON`, `OWNER_DECISION_REQUIRED`, or `COMPLETE`/);
    assert.match(canon, /WAITING_ON.*OWNER_DECISION_REQUIRED/s);
  });

  it("S09T canonical owner and alias cite the Coordinator migration reference (B30-206, B30-218)", () => {
    // One lifecycle owner: the alias forwards to the same reference, no second copy of the duty table.
    const ref = "skills/bearing-lite/references/coordinator-migration.md";
    assertLinksTo(CANON, ref);
    assertLinksTo(ORCH, ref);
    assert.doesNotMatch(orchText(), /^\|\s*D\d+\s*\|/m, "alias must not duplicate the duty table");
  });

  it("catalog allows exactly one orchestrator discovery name", () => {
    const verdict = validateCatalog(["orchestrator", "bearing-lite"]);
    assert.ok(
      !verdict.diagnostics.some((d) => d.skill === "orchestrator" && d.code === "unexpected_skill"),
      JSON.stringify(verdict)
    );
    const canon = canonText();
    assert.match(canon, /only\s+when the owner explicitly requests Bearing/);
  });

  it("review stays opt-in; typed returns and stop conditions are stated", () => {
    const text = orchText();
    assert.match(text, /unrequested review stays inactive/i);
    assert.match(text, /explicitly requested/);
    for (const ret of ["READY", "WAITING_ON", "OWNER_DECISION_REQUIRED", "COMPLETE"]) {
      assert.ok(text.includes(ret), `orchestrator must name typed return ${ret}`);
    }
    assert.match(text, /stop|WAITING_ON|OWNER_DECISION_REQUIRED/i);
  });
});
