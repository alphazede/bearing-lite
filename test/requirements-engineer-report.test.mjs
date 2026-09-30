/**
 * Issue #163: the Requirements Engineer gate report is bounded.
 * Failing rows first; PASS rows only as one-line-per-row table lines;
 * the full per-check (CHK) matrix only as an optional JSON sidecar, never prose.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = path.join(ROOT, "skills/requirements-engineer/SKILL.md");
const REPORT_REF = path.join(ROOT, "skills/requirements-engineer/references/gate-report.md");

/**
 * Bounded-report checker: PASS rows must appear only as single markdown
 * table lines (`| UID | PASS | ...`); a heading naming a PASS UID is a
 * per-row prose section and fails. Failing rows come before the PASS table.
 * @param {string} report
 */
export function checkGateReport(report) {
  const errors = [];
  const lines = report.split(/\r?\n/);
  if (!/candidate_ref/.test(report)) errors.push("missing verdict block candidate_ref");
  if (!/lint-sdoc/.test(report)) errors.push("missing lint receipt");
  /** @type {Set<string>} */
  const passUids = new Set();
  for (const line of lines) {
    const m = line.match(/^\|\s*(REQ-[A-Za-z0-9-]+)\s*\|\s*PASS\s*\|/i);
    if (m) passUids.add(m[1]);
  }
  if (passUids.size === 0) errors.push("missing one-line-per-row PASS table");
  for (const line of lines) {
    const h = line.match(/^#{1,6}\s.*?(REQ-[A-Za-z0-9-]+)/);
    if (h && passUids.has(h[1])) errors.push(`per-row prose section for PASS row ${h[1]}`);
  }
  const failIdx = lines.findIndex((l) => /^#{1,6}\s*Failing rows/i.test(l));
  const passIdx = lines.findIndex((l) => /^#{1,6}\s*PASS/i.test(l));
  if (failIdx < 0) errors.push("missing Failing rows section");
  if (failIdx >= 0 && passIdx >= 0 && failIdx > passIdx) {
    errors.push("failing rows must come first");
  }
  return { ok: errors.length === 0, errors };
}

const CONFORMING = `# Gate report
## Verdict
verdict: REPAIRABLE_FAILURE
candidate_ref: plan r2
lint: lint-sdoc.py --profile library clean (0 errors)
## Failing rows
### REQ-001
- checklist item: CHK-RE-07
- evidence: register line 12 uses "fast" with no measure
- corrected text: "The unit responds within 50 ms."
## PASS
| UID | result | note |
| REQ-002 | PASS | measurable |
| REQ-003 | PASS | traceable |
## Owner questions
- None.
## Decision coverage
uncovered: none
`;

const UNBOUNDED = `# Gate report
## Verdict
verdict: REPAIRABLE_FAILURE
candidate_ref: plan r2
lint: lint-sdoc.py --profile library clean (0 errors)
## Failing rows
### REQ-001
- checklist item: CHK-RE-07
- evidence: register line 12 uses "fast" with no measure
- corrected text: "The unit responds within 50 ms."
### REQ-002
The statement is measurable and traceable; checklist CHK-RE-01..CHK-RE-08 all pass with notes on wording.
## PASS
| UID | result | note |
| REQ-002 | PASS | measurable |
| REQ-003 | PASS | traceable |
## Owner questions
- None.
## Decision coverage
uncovered: none
`;

describe("requirements-engineer bounded gate report (#163)", () => {
  it("passes a conforming bounded report", () => {
    assert.equal(checkGateReport(CONFORMING).ok, true, JSON.stringify(checkGateReport(CONFORMING)));
  });

  it("fails a report with per-row prose sections for PASS rows", () => {
    const verdict = checkGateReport(UNBOUNDED);
    assert.equal(verdict.ok, false);
    assert.ok(verdict.errors.some((e) => e.includes("REQ-002")));
  });

  it("fails when failing rows come after the PASS table", () => {
    const swapped = CONFORMING.replace("## Failing rows", "## TMP")
      .replace("## PASS", "## Failing rows")
      .replace("## TMP", "## PASS");
    assert.equal(checkGateReport(swapped).ok, false);
  });

  it("skill links a bounded gate-report reference with the required shape", () => {
    const skill = readFileSync(SKILL, "utf8");
    assert.match(skill, /references\/gate-report\.md/);
    assert.ok(existsSync(REPORT_REF), "references/gate-report.md must exist");
    const ref = readFileSync(REPORT_REF, "utf8");
    assert.match(ref, /Failing rows first/i);
    assert.match(ref, /one-line-per-row PASS table/i);
    assert.match(ref, /checklist item/i);
    assert.match(ref, /corrected text/i);
    assert.match(ref, /JSON sidecar/i);
    assert.match(ref, /never prose/i);
    assert.match(ref, /candidate_ref/);
    assert.match(ref, /lint-sdoc/);
    assert.match(ref, /uncovered/i);
    const lines = skill.trimEnd().split(/\r?\n/).length;
    assert.ok(lines <= 60, `requirements-engineer: ${lines} lines must be at most 60`);
  });
});
