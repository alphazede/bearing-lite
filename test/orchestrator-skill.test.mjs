/**
 * #214 Orchestrator skill: discoverability alias with one canonical owner.
 * Matching: coordinate an approved multi-packet wave through its end
 * boundary dispatches Coordinator + Implementer (+ requested assurance only),
 * parented to the Orchestrator. Non-matching: one assigned packet stays
 * direct with the Implementer and no forced Coordinator.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertLinksTo, assertLocalLinksResolve } from "./skill-contract-fixture.mjs";
import {
  activationMatches,
  validateCatalog,
  validateSkillDocument,
} from "./skills-conformance.test.mjs";
import { selectRoute } from "./role-routing.test.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORCH = "skills/orchestrator/SKILL.md";
const CANON = "skills/bearing-lite/SKILL.md";

function orchText() {
  return readFileSync(path.join(ROOT, ORCH), "utf8");
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
    const canon = readFileSync(path.join(ROOT, CANON), "utf8");
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

  it("matching request: wave to end boundary dispatches Coordinator + workers", () => {
    const text = orchText();
    const verdict = validateSkillDocument("orchestrator", text);
    assert.equal(verdict.ok, true);
    if (verdict.ok) {
      assert.equal(
        activationMatches(
          "orchestrator",
          verdict.description,
          "orchestrator coordinate this approved multi-packet wave through its end boundary"
        ),
        true,
        "orchestrator should match a wave-coordination request"
      );
    }
    // End-of-lifecycle review runs only because the owner requested it.
    const route = selectRoute({
      kind: "coordinator_wave",
      packetCount: 3,
      requiredAssurance: ["reviewer", "integration-engineer"],
    });
    assert.equal(route.ok, true);
    if (route.ok) {
      assert.ok(route.active.includes("coordinator"));
      assert.ok(route.active.includes("implementer"));
      assert.ok(route.active.includes("reviewer"));
      assert.equal(route.parentController, "coordinator");
    }
    const unrequested = selectRoute({
      kind: "coordinator_wave",
      packetCount: 3,
      requiredAssurance: [],
    });
    assert.equal(unrequested.ok, true);
    if (unrequested.ok) {
      assert.ok(!unrequested.active.includes("reviewer"));
    }
  });

  it("non-matching request: one assigned packet stays direct, no Coordinator", () => {
    const text = orchText();
    const verdict = validateSkillDocument("orchestrator", text);
    assert.equal(verdict.ok, true);
    if (verdict.ok) {
      assert.equal(
        activationMatches("orchestrator", verdict.description, "fix the typo in the readme"),
        false,
        "orchestrator must stay dormant for ordinary single-packet work"
      );
      // The keyword heuristic cannot negate the "Do not use for implementing"
      // clause; the stop/dispatch behavior itself is the text route plus the
      // direct route verdict below.
      assert.match(text, /\.\.\/implementer\/SKILL\.md/);
      assert.match(text, /Stop here and route onward/);
    }
    const route = selectRoute({ kind: "direct", packetCount: 1, requiredAssurance: [] });
    assert.equal(route.ok, true);
    if (route.ok) {
      assert.deepEqual(route.active, ["implementer"]);
      assert.deepEqual(route.coordinators, []);
      assert.ok(route.dormant.includes("coordinator"));
      assert.equal(route.parentController, "orchestrator");
    }
  });

  it("catalog allows exactly one orchestrator discovery name", () => {
    const verdict = validateCatalog(["orchestrator", "bearing-lite"]);
    assert.ok(
      !verdict.diagnostics.some((d) => d.skill === "orchestrator" && d.code === "unexpected_skill"),
      JSON.stringify(verdict)
    );
    const canon = readFileSync(path.join(ROOT, CANON), "utf8");
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
