/**
 * #194 Scribe cadence and history coverage. A Lifecycle with untranscribed
 * owner decisions, authority events, or landings cannot hand off or close;
 * an unavailable Scribe is a typed capability gap, never substitution.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const { evaluateScribeCoverage, DEFAULT_SCRIBE_CADENCE } = require("../hooks/scribe-coverage.cjs");
const closeout = require("../hooks/closeout.cjs");

const scribeRoute = (enabled, cadence) => ({
  enabled,
  primary: { harness: "h", model: "m", reasoning: "r" },
  ordered_fallbacks: [],
  ...(cadence ? { cadence } : {}),
});

function journey({ scribe = scribeRoute(true), history, landings } = {}) {
  return {
    schema_version: "1",
    journey: { id: "LC-1", title: "t", status: "implementation", planning_repository: "r" },
    decisions: [
      { id: "DEC-1", status: "confirmed", decided_at: "2026-10-16T10:00:00Z", decision: "accept residual" },
      {
        record_type: "owner_stop", id: "DEC-2", status: "answered",
        answered_at: "2026-10-16T11:00:00Z",
      },
    ],
    open_decisions: [],
    authority_events: [{ id: "AUTH-1", event_type: "authority_activation", recorded_at: "2026-10-16T12:00:00Z" }],
    ...(landings ? { landings } : {}),
    planning_receipts: [],
    profile_selection: { snapshot: { roles: scribe === null ? {} : { scribe } } },
    ...(history ? { history } : {}),
  };
}

const fullHistory = {
  decisions: [{ id: "DEC-1" }, { id: "DEC-2" }],
  authority_events: [{ id: "AUTH-1" }],
};

const completion = (j) => ({
  mode: "protected_completion",
  verdict: "PASS",
  candidate_ref: "c",
  changed_paths: ["a"],
  tests: "green",
  findings: "none",
  blocker: "none",
  candidate_matched: true,
  journey: j,
});

describe("#194 Scribe coverage", () => {
  it("decisions with no Scribe run fail closeout", () => {
    const verdict = closeout.evaluate(completion(journey()));
    assert.equal(verdict.outcome, "BLOCK");
    assert.match(verdict.reason, /scribe:SCRIBE_REQUIRED:untranscribed:DEC-1,DEC-2,AUTH-1/);
  });

  it("a Scribe entry after the last event passes closeout", () => {
    const verdict = closeout.evaluate(completion(journey({ history: fullHistory })));
    assert.equal(verdict.outcome, "ADVISE");
    assert.equal(verdict.reason, "protected_completion_ready");
  });

  it("an unavailable Scribe is a typed gap, not substitution", () => {
    for (const scribe of [scribeRoute(false), null]) {
      const j = journey({ scribe });
      const before = JSON.stringify(j);
      const coverage = evaluateScribeCoverage({ journey: j });
      assert.equal(coverage.outcome, "CAPABILITY_GAP");
      assert.match(coverage.recovery, /never transcribes/);
      assert.equal(JSON.stringify(j), before, "the check never writes history");
      const verdict = closeout.evaluate(completion(j));
      assert.equal(verdict.outcome, "BLOCK");
      assert.match(verdict.reason, /scribe:CAPABILITY_GAP:scribe_unavailable:/);
    }
  });

  it("explicit scribe_available overrides the snapshot", () => {
    const coverage = evaluateScribeCoverage({ journey: journey(), scribe_available: false });
    assert.equal(coverage.outcome, "CAPABILITY_GAP");
  });

  it("partial history lists only the untranscribed events, with times", () => {
    const coverage = evaluateScribeCoverage({
      journey: journey({ history: { decisions: [{ id: "DEC-1" }] } }),
    });
    assert.equal(coverage.outcome, "SCRIBE_REQUIRED");
    assert.deepEqual(coverage.untranscribed, [
      { kind: "decision", id: "DEC-2", at: "2026-10-16T11:00:00Z" },
      { kind: "authority_event", id: "AUTH-1", at: "2026-10-16T12:00:00Z" },
    ]);
  });

  it("history entries may cite the source record by source_id", () => {
    const coverage = evaluateScribeCoverage({
      journey: journey({
        history: {
          decisions: [{ id: "H-1", source_id: "DEC-1" }, { id: "H-2", source_id: "DEC-2" }],
          authority_events: [{ id: "H-3", source_id: "AUTH-1" }],
        },
      }),
    });
    assert.equal(coverage.outcome, "PASS");
  });

  it("open owner stops are not yet decisions", () => {
    const j = journey({ history: fullHistory });
    j.decisions.push({ record_type: "owner_stop", id: "DEC-Q", status: "queued" });
    j.decisions.push({ record_type: "owner_stop", id: "DEC-A", status: "asked" });
    assert.equal(evaluateScribeCoverage({ journey: j }).outcome, "PASS");
    j.decisions.push({ record_type: "owner_stop", id: "DEC-C", status: "cancelled", cancelled_at: "2026-10-16T13:00:00Z" });
    const coverage = evaluateScribeCoverage({ journey: j });
    assert.equal(coverage.outcome, "SCRIBE_REQUIRED");
    assert.deepEqual(coverage.untranscribed.map((e) => e.id), ["DEC-C"]);
  });

  it("landings (merges, issue closes) need transcription", () => {
    const landings = [{ id: "LAND-1", kind: "merge", ref: "#12", observed_at: "2026-10-16T14:00:00Z" }];
    const pending = evaluateScribeCoverage({ journey: journey({ history: fullHistory, landings }) });
    assert.equal(pending.outcome, "SCRIBE_REQUIRED");
    assert.deepEqual(pending.untranscribed, [{ kind: "landing", id: "LAND-1", at: "2026-10-16T14:00:00Z" }]);
    const done = evaluateScribeCoverage({
      journey: journey({ history: { ...fullHistory, landings: [{ id: "LAND-1" }] }, landings }),
    });
    assert.equal(done.outcome, "PASS");
  });

  it("records without an id are reported by position, never silently covered", () => {
    const j = journey({ history: fullHistory });
    j.authority_events.push({ event_type: "merge" });
    const coverage = evaluateScribeCoverage({ journey: j });
    assert.deepEqual(coverage.untranscribed.map((e) => e.id), ["authority_events[1]"]);
  });

  it("malformed journeys are UNAVAILABLE, never PASS, and block completion", () => {
    assert.equal(evaluateScribeCoverage({}).outcome, "UNAVAILABLE");
    const bad = journey();
    bad.decisions = "DEC-1";
    assert.equal(evaluateScribeCoverage({ journey: bad }).outcome, "UNAVAILABLE");
    const verdict = closeout.evaluate(completion(bad));
    assert.equal(verdict.outcome, "BLOCK");
    assert.match(verdict.reason, /scribe:UNAVAILABLE/);
  });

  it("advisory closeout reroutes on missing transcription and never blocks", () => {
    const verdict = closeout.evaluate({ ...completion(journey()), mode: undefined });
    assert.equal(verdict.outcome, "REROUTE");
    assert.match(verdict.reason, /^scribe_coverage:SCRIBE_REQUIRED/);
  });

  it("closeout without a journey keeps its existing behavior", () => {
    const { journey: _omit, ...rest } = completion(journey());
    assert.equal(closeout.evaluate(rest).reason, "protected_completion_ready");
  });

  it("handoff refuses until history is current; resume lists events", () => {
    const refused = closeout.evaluate({ action_kind: "scribe_coverage", mode: "handoff", journey: journey() });
    assert.equal(refused.outcome, "REROUTE");
    assert.match(refused.reason, /^handoff_refused:scribe_SCRIBE_REQUIRED/);
    assert.equal(refused.scribe_coverage.untranscribed.length, 3);

    const allowed = closeout.evaluate({
      action_kind: "scribe_coverage", mode: "handoff", journey: journey({ history: fullHistory }),
    });
    assert.equal(allowed.outcome, "ADVISE");
    assert.match(allowed.reason, /^scribe_coverage:PASS/);

    const resume = closeout.evaluate({ action_kind: "scribe_coverage", mode: "resume", journey: journey() });
    assert.equal(resume.outcome, "ADVISE");
    assert.deepEqual(resume.scribe_coverage.untranscribed.map((e) => e.id), ["DEC-1", "DEC-2", "AUTH-1"]);
  });

  it("cadence comes from the frozen snapshot and defaults to event", () => {
    assert.equal(DEFAULT_SCRIBE_CADENCE, "event");
    assert.equal(evaluateScribeCoverage({ journey: journey() }).cadence, "event");
    const phase = journey({ scribe: scribeRoute(true, "phase"), history: fullHistory });
    assert.equal(evaluateScribeCoverage({ journey: phase }).cadence, "phase");
  });

  it("a split snapshot uses the Scribe route for the current phase", () => {
    const j = journey();
    j.profile_selection = {
      snapshot: {
        planning: { roles: { scribe: scribeRoute(true, "lifecycle") } },
        implementation: { roles: { scribe: scribeRoute(false) } },
      },
    };
    assert.equal(evaluateScribeCoverage({ journey: j }).outcome, "CAPABILITY_GAP");
    j.journey.status = "planning";
    const planning = evaluateScribeCoverage({ journey: j });
    assert.equal(planning.outcome, "SCRIBE_REQUIRED");
    assert.equal(planning.cadence, "lifecycle");
  });

  it("CLI exits 0 only on PASS", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scribe-coverage-"));
    try {
      const run = (j) => {
        const file = path.join(dir, "journey.json");
        writeFileSync(file, JSON.stringify(j));
        return spawnSync(process.execPath, [path.join(ROOT, "hooks/scribe-coverage.cjs"), file], { encoding: "utf8" });
      };
      const pending = run(journey());
      assert.equal(pending.status, 1);
      assert.equal(JSON.parse(pending.stdout).outcome, "SCRIBE_REQUIRED");
      const current = run(journey({ history: fullHistory }));
      assert.equal(current.status, 0);
      assert.equal(JSON.parse(current.stdout).outcome, "PASS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("profile schema gives the Scribe a cadence", () => {
    const schema = JSON.parse(read("schemas/profiles.schema.json"));
    assert.equal(schema.$defs.profile.properties.roles.properties.scribe.$ref, "#/$defs/scribeRoute");
    assert.deepEqual(schema.$defs.scribeCadence.enum, ["event", "phase", "lifecycle"]);
  });

  it("skills dispatch the Scribe by cadence and gate handoff and closeout", () => {
    const scribe = read("skills/scribe/SKILL.md");
    const router = read("skills/bearing-lite/SKILL.md");
    const resume = read("skills/bearing-lite/references/resume.md");
    assert.match(scribe, /roles\.scribe\.cadence/);
    assert.match(scribe, /hooks\/scribe-coverage\.cjs/);
    assert.match(router, /frozen cadence \(`event` default\)/);
    assert.match(router, /never relaunch it per event or transcribe history yourself/);
    assert.match(router, /`references\/resume\.md` for resume and Scribe coverage/);
    assert.match(resume, /Resume runs `node <plugin root>\/hooks\/scribe-coverage\.cjs <journey\.json>`/);
    assert.match(resume, /roles\.scribe\.cadence/);
    assert.match(router, /pass `journey` to `hooks\/closeout\.cjs`/);
    assert.match(router, /refuse them until the enabled Scribe transcribes them/);
    assert.match(resume, /never\s+transcribes the events itself/);
    const assembly = read("skills/bearing-lite/references/planning-assembly.md");
    assert.match(assembly, /`hooks\/closeout\.cjs` with `journey` \(`mode: "handoff"`\)/);
    // Configured cadence only: no per-event relaunch and no invented Scribe when disabled.
    assert.match(resume, /Never relaunch it per event, poll it, or\s+invent a Scribe when the role is disabled/);
  });
});
