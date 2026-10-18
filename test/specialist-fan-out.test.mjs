/**
 * #168 retired (F12 repair): automatic specialist fan-out and a mandatory
 * TIME BUDGET line were removed from Prompt and the Orchestrator. No shipped
 * reference may still instruct fan-out children, a fan-out bound, or a
 * mandatory time budget, and no surface may link the deleted reference.
 * Supplied time/call limits are carried only when the owner provides them.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

function files(rel) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs).flatMap((name) => files(path.join(rel, name)));
}
const SHIPPED = ["skills", "hooks", "schemas", "docs/guides", "docs/architecture", "README.md", "CONTRIBUTING.md"]
  .flatMap(files)
  .filter((rel) => /\.(md|mmd|cjs|json|yaml|svg)$/.test(rel));

describe("#168 retired specialist fan-out stays retired", () => {
  it("the orphan reference is deleted and nothing links it", () => {
    assert.equal(existsSync(path.join(ROOT, "skills/bearing-lite/references/specialist-fan-out.md")), false);
    for (const rel of SHIPPED) assert.doesNotMatch(read(rel), /specialist-fan-out/, rel);
  });

  it("no shipped surface instructs fan-out children or a mandatory time budget", () => {
    for (const rel of SHIPPED) {
      const text = read(rel);
      assert.doesNotMatch(text, /Every handoff carries one TIME BUDGET line/, rel);
      assert.doesNotMatch(text, /fan-out child|child sessions of the same role|maxChildren/i, rel);
      assert.doesNotMatch(text, /mandatory time budget/i, rel);
    }
  });

  it("Prompt carries limits only when supplied and adds no automatic fan-out or invocations", () => {
    const prompt = read("skills/prompt/SKILL.md");
    assert.doesNotMatch(prompt, /^TIME BUDGET/m);
    assert.match(prompt, /time\/call\s+limits only when supplied/);
    assert.match(prompt, /Never poll or add automatic fan-out, reviews, or agent invocations/);
    const loops = read("skills/prompt/references/role-loops.md");
    assert.match(loops, /No loop authorizes polling,\s+automatic fan-out/);
  });

  it("Orchestrator and Test Engineer launch each selected assignment once without fan-out", () => {
    const router = read("skills/bearing-lite/SKILL.md");
    assert.match(router, /Launch each selected agent assignment once/);
    assert.doesNotMatch(router, /fan-out/i);
    const te = read("skills/test-engineer/SKILL.md");
    assert.match(te, /do not\s+add a review, repair round, fan-out agent, or new invocation automatically/);
    assert.doesNotMatch(te, /lead session|merge-only lead/i);
  });
});
