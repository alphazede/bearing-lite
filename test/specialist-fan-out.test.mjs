/**
 * #168 Bounded specialist fan-out with required time budgets.
 * A lead session may split independent questions into child sessions of the
 * same role; each child gets its own packet, write directory, inputs, and
 * time budget, and the lead only merges typed returns into one artifact.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * @typedef {{ code: string, message: string }} FanOutDiagnostic
 */

/**
 * Validate a lead fan-out packet: required TIME BUDGET on the packet and on
 * every child, distinct child write directories, and a packet-declared bound
 * N (maxChildren) covering the child count.
 * @param {{ timeBudget?: { sessionMinutes?: number, perCallMinutes?: number }, maxChildren?: number, children?: { question?: string, writeDir?: string, timeBudget?: { sessionMinutes?: number, perCallMinutes?: number } }[] }} packet
 * @returns {{ ok: boolean, diagnostics: FanOutDiagnostic[] }}
 */
export function validateFanOutPacket(packet) {
  /** @type {FanOutDiagnostic[]} */
  const diagnostics = [];
  const fail = (code, message) => diagnostics.push({ code, message });
  if (!packet || typeof packet !== "object") {
    fail("missing_time_budget", "fan-out packet requires a TIME BUDGET");
    return { ok: false, diagnostics };
  }
  const budget = packet.timeBudget;
  if (!budget || !(budget.sessionMinutes > 0) || !(budget.perCallMinutes > 0)) {
    fail("missing_time_budget", "fan-out packet requires a TIME BUDGET line");
  } else if (!(budget.perCallMinutes < budget.sessionMinutes)) {
    fail(
      "call_bound_exceeds_session",
      "per-external-call bound must be smaller than the session time budget"
    );
  }
  const children = Array.isArray(packet.children) ? packet.children : [];
  if (children.length > 0) {
    if (!(packet.maxChildren >= children.length)) {
      fail(
        "missing_fanout_bound",
        "lead packet must declare maxChildren (N) covering its children"
      );
    }
    const seen = new Set();
    children.forEach((child, index) => {
      if (!child || typeof child !== "object") {
        fail("missing_time_budget", `child ${index} requires its own TIME BUDGET`);
        return;
      }
      if (!child.writeDir) {
        fail("missing_write_directory", `child ${index} requires its own write directory`);
      } else if (seen.has(child.writeDir)) {
        fail("shared_write_directory", `child ${index} shares write directory ${child.writeDir}`);
      } else {
        seen.add(child.writeDir);
      }
      const tb = child.timeBudget;
      if (!tb || !(tb.sessionMinutes > 0) || !(tb.perCallMinutes > 0)) {
        fail("missing_time_budget", `child ${index} requires its own TIME BUDGET`);
      } else {
        if (!(tb.perCallMinutes < tb.sessionMinutes)) {
          fail(
            "call_bound_exceeds_session",
            `child ${index} per-external-call bound must be smaller than its session time budget`
          );
        }
        if (budget && budget.sessionMinutes > 0 && tb.sessionMinutes > budget.sessionMinutes) {
          fail(
            "call_bound_exceeds_session",
            `child ${index} session budget must fit inside the lead session budget`
          );
        }
      }
    });
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

const CONFORMING = {
  timeBudget: { sessionMinutes: 90, perCallMinutes: 20 },
  maxChildren: 4,
  children: [
    {
      question: "grading-miss diagnosis",
      writeDir: "work/fan-out/grading-miss",
      timeBudget: { sessionMinutes: 60, perCallMinutes: 15 },
    },
    {
      question: "live-stream counts",
      writeDir: "work/fan-out/stream-counts",
      timeBudget: { sessionMinutes: 60, perCallMinutes: 15 },
    },
  ],
};

describe("#168 bounded specialist fan-out", () => {
  it("prompt skill documents an optional fan-out section and a required TIME BUDGET line", () => {
    const prompt = read("skills/prompt/SKILL.md");
    assert.match(prompt, /fan-out/i);
    assert.match(prompt, /TIME BUDGET/);
    assert.match(prompt, /write director/i);
    assert.match(prompt, /merge/i);
    assert.match(prompt, /T minus 5/);
    assert.doesNotMatch(prompt, /frozen route/);
    assert.doesNotMatch(prompt, /INSUFFICIENT/);
  });

  it("Test Engineer skill describes lead and child sessions and merge-only lead", () => {
    const te = read("skills/test-engineer/SKILL.md");
    assert.match(te, /lead/i);
    assert.match(te, /child/i);
    assert.match(te, /merge/i);
    assert.match(te, /INSUFFICIENT/);
  });

  it("Orchestrator skill counts fan-out children as one specialist dispatch", () => {
    const router = read("skills/bearing-lite/SKILL.md");
    assert.match(router, /frozen route/);
    assert.match(router, /one specialist dispatch/);
    assert.match(router, /specialist-fan-out\.md/);
  });

  it("fan-out reference lists each child with question, route, runtime, outcome", () => {
    const rel = "skills/bearing-lite/references/specialist-fan-out.md";
    assert.ok(existsSync(path.join(ROOT, rel)), `${rel} must exist`);
    const ref = read(rel);
    assert.match(ref, /question, route, runtime/);
    assert.match(ref, /outcome/);
    assert.match(ref, /frozen route/);
    assert.match(ref, /T minus 5/);
  });

  it("passes a conforming fan-out packet", () => {
    assert.equal(validateFanOutPacket(CONFORMING).ok, true);
  });

  it("fails children sharing a write directory", () => {
    const packet = {
      ...CONFORMING,
      children: CONFORMING.children.map((c) => ({ ...c, writeDir: "work/fan-out/shared" })),
    };
    const verdict = validateFanOutPacket(packet);
    assert.equal(verdict.ok, false);
    assert.ok(verdict.diagnostics.some((d) => d.code === "shared_write_directory"));
  });

  it("fails a child lacking a time budget", () => {
    const packet = {
      ...CONFORMING,
      children: [{ question: "unbounded", writeDir: "work/fan-out/unbounded" }],
    };
    const verdict = validateFanOutPacket(packet);
    assert.equal(verdict.ok, false);
    assert.ok(verdict.diagnostics.some((d) => d.code === "missing_time_budget"));
  });

  it("fails children beyond the packet-declared bound", () => {
    const verdict = validateFanOutPacket({ ...CONFORMING, maxChildren: 1 });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.diagnostics.some((d) => d.code === "missing_fanout_bound"));
  });
});
