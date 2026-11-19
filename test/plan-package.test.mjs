/** #70 / #73: Map the Route freeze checks. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planningContract } from "./planning-contract-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { checkRoles, verifyDigests, freeze } = require(path.join(ROOT, "hooks/plan-package.cjs"));
const sha = (s) => createHash("sha256").update(s).digest("hex");

function draftFindings(t, implementation, match) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "plan-package-draft-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, "implementation.json"), JSON.stringify(implementation));
  writeFileSync(path.join(dir, "seit.json"), "{}");
  return freeze(dir, { stage: "draft" }).findings.filter((finding) => match.test(finding.code));
}

const seit = (actor) => ({
  procedures_and_commands: [{ id: "PROC-RERUN", ...(actor ? { actor } : {}) }],
});
const impl = (role) => ({
  waves: [{ slices: [{ id: "S1.10", role, command_ids: ["PROC-RERUN"] }] }],
});

describe("plan-package (#73 actor/role consistency)", () => {
  it("reports a mismatch naming both files, the step, and both values", () => {
    const [finding, ...rest] = checkRoles(seit("Explorer"), impl("Router"));
    assert.equal(rest.length, 0);
    assert.deepEqual(finding, {
      code: "actor_role_mismatch",
      step: "S1.10",
      command_id: "PROC-RERUN",
      seit_actor: "Explorer",
      implementation_role: "Router",
      files: ["seit.json", "implementation.json"],
    });
  });
  it("matching actor and role, or no actor, produce nothing", () => {
    assert.deepEqual(checkRoles(seit("Explorer"), impl("Explorer")), []);
    assert.deepEqual(checkRoles(seit(null), impl("Router")), []);
  });
  it("an unknown command id is a finding", () => {
    assert.deepEqual(checkRoles({ procedures_and_commands: [] }, impl("Router")), [
      { code: "unknown_command_id", step: "S1.10", command_id: "PROC-RERUN" },
    ]);
  });
});

describe("plan-package (#77 light slices)", () => {
  it("a light slice without a command or with another role is a finding", (t) => {
    const checkWorkClass = (doc) => draftFindings(t, doc, /^light_slice_/);
    const light = (extra) => ({ waves: [{ slices: [{ id: "S1.1", role: "Light Implementer", work_class: "light", ...extra }] }] });
    assert.deepEqual(checkWorkClass(light({ command_ids: ["CMD-1"] })), []);
    assert.deepEqual(checkWorkClass(light({ command_ids: [] })), [{ code: "light_slice_without_command", step: "S1.1" }]);
    assert.deepEqual(checkWorkClass(light({ command_ids: ["CMD-1"], role: "Crewmate" })), [
      { code: "light_slice_role", step: "S1.1", role: "Crewmate" },
    ]);
    assert.deepEqual(checkWorkClass({ waves: [{ slices: [{ id: "S1.2", role: "Crewmate", command_ids: [] }] }] }), []);
  });
  it("ignores dod_manifest.tasks rows with work_class: light while still flagging light slices (#576)", (t) => {
    const checkWorkClass = (doc) => draftFindings(t, doc, /^light_slice_/);
    const doc = {
      slices: [{ id: "S1.1", role: "Light Implementer", work_class: "light", command_ids: ["CMD-1"] }],
      dod_manifest: {
        tasks: [
          { id: "S1.1", role: "Light Implementer", work_class: "light" },
          { id: "S1.2", role: "Implementer", work_class: "light" },
        ],
      },
    };
    assert.deepEqual(checkWorkClass(doc), []);
    assert.deepEqual(
      checkWorkClass({
        slices: [{ id: "S1.3", role: "Light Implementer", work_class: "light", command_ids: [] }],
        dod_manifest: doc.dod_manifest,
      }),
      [{ code: "light_slice_without_command", step: "S1.3" }]
    );
  });
});

describe("plan-package (#80/#580 planning-only roles)", () => {
  it("checks real slice slots and ignores planning-shaped notes", (t) => {
    const implementation = {
      waves: [{ notes: { slices: [{ id: "note", role: "Implementer", work_class: "light" }] } }],
      evidence: [{ id: "evidence", role: "MBSE", integration_step: "note-link" }],
      slices: [{ id: "real", role: "mbse.planning" }],
      integration: { entry_conditions: [{ id: "gate", integration_step: "missing" }] },
    };
    assert.deepEqual(draftFindings(t, implementation, /light_slice|planning_role|integration_step/), [
      { code: "planning_role_in_lifecycle", step: "real", role: "mbse.planning" },
      { code: "unresolved_integration_step", step: "missing", matches: 0, colliding_semantics: false },
    ]);
  });
  it("rejects MBSE and Integration and Test slices and permits execution/assurance roles", (t) => {
    const checkPlanningRoles = (doc) => draftFindings(t, doc, /^planning_role_in_lifecycle$/);
    const assigned = (role) => ({ waves: [{ slices: [{ id: "S1.2", role }] }] });
    assert.deepEqual(checkPlanningRoles(assigned("MBSE / planning")), [
      { code: "planning_role_in_lifecycle", step: "S1.2", role: "MBSE / planning" },
    ]);
    assert.deepEqual(checkPlanningRoles(assigned("Integration and Test / planning")), [
      { code: "planning_role_in_lifecycle", step: "S1.2", role: "Integration and Test / planning" },
    ]);
    assert.deepEqual(checkPlanningRoles(assigned("Test Engineer")), []);
    assert.deepEqual(checkPlanningRoles(assigned("Integration Engineer")), []);
  });
  it("flags an MBSE or Integration and Test slice that has no id", (t) => {
    const checkPlanningRoles = (doc) => draftFindings(t, doc, /^planning_role_in_lifecycle$/);
    assert.deepEqual(
      checkPlanningRoles({ slices: [{ role: "MBSE", command_ids: [] }] }),
      [{ code: "planning_role_in_lifecycle", step: null, role: "MBSE" }]
    );
    assert.deepEqual(
      checkPlanningRoles({ slices: [{ role: "Integration and Test", command_ids: [] }] }),
      [{ code: "planning_role_in_lifecycle", step: null, role: "Integration and Test" }]
    );
  });
  it("accepts MBSE and Integration and Test planning-route records and still rejects slices", (t) => {
    const checkPlanningRoles = (doc) => draftFindings(t, doc, /^planning_role_in_lifecycle$/);
    const routes = {
      planning_assignments: [
        {
          role: "MBSE / planning",
          primary: "fixture-harness / fixture-model / fixture-effort",
          fallbacks: ["fixture-fallback / fixture-model / fixture-effort"],
          effective_route: "fixture-harness / fixture-model / fixture-effort",
        },
        {
          role: "Integration and Test / planning",
          primary: "fixture-harness / fixture-model / fixture-effort",
          fallbacks: [],
          effective_route: "fixture-harness / fixture-model / fixture-effort",
        },
      ],
      lineup: [
        {
          role: "MBSE",
          session: "planning",
          configured_primary: "fixture-harness / fixture-model / fixture-effort",
          effective_route: "fixture-harness / fixture-model / fixture-effort",
          status: "READY",
        },
      ],
    };
    assert.deepEqual(checkPlanningRoles(routes), []);
    assert.deepEqual(
      checkPlanningRoles({
        ...routes,
        waves: [{ slices: [{ id: "S1.2", role: "MBSE / planning" }] }],
      }),
      [{ code: "planning_role_in_lifecycle", step: "S1.2", role: "MBSE / planning" }]
    );
  });
});

describe("plan-package (#70 embedded digest freeze)", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "plan-package-"));
  const dir = path.join(repo, "docs/plans/x");
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  mkdirSync(dir, { recursive: true });
  const plan = "# plan\n";
  const design = "# design\n";
  writeFileSync(path.join(dir, "plan.md"), plan);
  writeFileSync(path.join(dir, "design.md"), design);
  writeFileSync(
    path.join(dir, "seit.json"),
    JSON.stringify({
      source_baseline: {
        planning_inputs: [
          { path: "docs/plans/x/plan.md", sha256: sha(plan) },
          { path: "docs/plans/x/design.md", sha256: sha(design) },
        ],
      },
      procedures_and_commands: [],
    })
  );
  const seitBytes = readFileSync(path.join(dir, "seit.json"));
  const expectedManifest = sha([sha(plan), sha(design), sha(seitBytes)].join("\n"));
  const impl = (candidate_digest, extra = {}) => {
    const contract = planningContract(candidate_digest ?? expectedManifest, { dir });
    writeFileSync(
      path.join(dir, "implementation.json"),
      JSON.stringify({
        boundary_contract: contract.boundary_contract,
        journey_settings: { planning_review: { candidate_digest }, ...contract.journey_settings, ...extra },
      })
    );
  };

  it("fails closed on a missing artifact or candidate digest", () => {
    assert.deepEqual(freeze(path.join(repo, "nowhere")).findings.map((f) => f.code), [
      "missing_artifact",
      "missing_artifact",
    ]);
    impl(undefined);
    assert.deepEqual(verifyDigests(dir).findings, [
      { code: "missing_candidate_digest", actual: expectedManifest },
    ]);
  });
  it("passes with a manifest digest that binds plan, design, and seit.json", () => {
    impl(expectedManifest);
    assert.deepEqual(verifyDigests(dir), { manifest_digest: expectedManifest, input_digests: [
      { path: "docs/plans/x/plan.md", sha256: sha(plan) },
      { path: "docs/plans/x/design.md", sha256: sha(design) },
      { path: "docs/plans/x/seit.json", sha256: sha(seitBytes) },
    ], findings: [] });
    assert.equal(freeze(dir).outcome, "PASS");
  });
  it("a specification Journey needs an existing SDoc register", () => {
    impl(expectedManifest, { journey_type: "specification", requirement_register: "docs/plans/x/register.md" });
    assert.deepEqual(verifyDigests(dir).findings.map((f) => f.code), ["missing_requirement_register"]);
    writeFileSync(path.join(dir, "register.sdoc"), "[DOCUMENT]\n");
    impl(expectedManifest, { journey_type: "specification", requirement_register: "docs/plans/x/register.sdoc" });
    assert.deepEqual(verifyDigests(dir).findings, []);
  });
  it("fails on an edited seit.json, then on an edited input", () => {
    impl(expectedManifest);
    writeFileSync(path.join(dir, "seit.json"), seitBytes.toString() + "\n");
    // The completed wave receipt is bound to the frozen candidate too (#205).
    assert.deepEqual(freeze(dir).findings.map((f) => f.code), ["planning_wave_candidate_mismatch", "candidate_digest_mismatch"]);
    writeFileSync(path.join(dir, "seit.json"), seitBytes);
    writeFileSync(path.join(dir, "plan.md"), plan + "edited\n");
    assert.deepEqual(freeze(dir).findings.map((f) => f.code), [
      "planning_wave_candidate_mismatch", "digest_mismatch", "candidate_digest_mismatch",
    ]);
    assert.equal(freeze(dir).outcome, "FAIL");
  });
});

describe("plan-package (#121 freeze guards)", () => {
  it("rejects duplicate active gate IDs and allows unique or historical ones", () => {
    const { checkDuplicateGates } = require(path.join(ROOT, "hooks/plan-package.cjs"));
    const dup = checkDuplicateGates({
      integration: {
        entry_conditions: {
          0: { id: "EC-2", status: "MET" },
          named: { id: "EC-2", status: "NOT_MET" },
        },
      },
    });
    assert.equal(dup[0].code, "duplicate_active_gate_id");
    assert.equal(dup[0].id, "EC-2");
    assert.deepEqual(
      checkDuplicateGates({
        integration: {
          entry_conditions: [
            { id: "EC-2", status: "MET" },
            { id: "EC-2", status: "HISTORICAL" },
          ],
        },
      }),
      []
    );
  });

  it("rejects an integration-step id that collides with a different activity", (t) => {
    const checkIntegrationStepRefs = (doc) => draftFindings(t, doc, /^unresolved_integration_step$/);
    const impl = {
      waves: [
        {
          slices: [
            { id: "INT-3", role: "Integration Engineer", activity: "assemble" },
            { id: "INT-3", role: "Integration Engineer", activity: "other" },
          ],
        },
      ],
      integration: { entry_conditions: [{ id: "EC-1", integration_step: "INT-3" }] },
    };
    const findings = checkIntegrationStepRefs(impl);
    assert.ok(findings.some((f) => f.code === "unresolved_integration_step" && f.colliding_semantics));
    const mapped = {
      waves: [{ slices: [{ id: "INT-3", role: "Integration Engineer", activity: "assemble" }] }],
      integration: { entry_conditions: [{ id: "EC-1", integration_step: "INT-3" }] },
    };
    assert.deepEqual(checkIntegrationStepRefs(mapped), []);
  });

  it("ignores requires, step, and integration_steps outside slices while keeping slice checks (#577)", (t) => {
    const checkIntegrationStepRefs = (doc) => draftFindings(t, doc, /^unresolved_integration_step$/);
    const nonSliceRefs = {
      slices: [
        {
          id: "S1",
          role: "Implementer",
          requires: ["INT-3"],
          integration_steps: ["INT-3"],
          evidence: { step: "verify", requires: ["non-slice-req"], integration_steps: ["non-slice-step"] },
        },
        { id: "INT-3", role: "Integration Engineer", activity: "assemble" },
      ],
      dod_manifest: {
        definition_of_done: [
          { criterion: "Tests pass", requires: ["node >= 20"], step: "gate", integration_steps: ["outside-step"] },
        ],
        tasks: [
          { id: "S1", role: "Implementer", requires: ["AC-1"], step: "implement", integration_steps: ["task-note"] },
        ],
      },
      evidence: [{ note: "field note", step: "check", step_id: "note-1", requires: ["doc"], integration_steps: ["ev-1"] }],
    };
    assert.deepEqual(checkIntegrationStepRefs(nonSliceRefs), []);

    const unresolvedSlice = {
      slices: [
        {
          id: "S1",
          role: "Implementer",
          integration_step: "INT-MISSING",
          step: "STEP-MISSING",
          requires: ["REQ-MISSING"],
          integration_steps: ["LIST-MISSING"],
        },
      ],
    };
    assert.deepEqual(
      checkIntegrationStepRefs(unresolvedSlice).map((f) => [f.code, f.step]),
      [
        ["unresolved_integration_step", "INT-MISSING"],
        ["unresolved_integration_step", "STEP-MISSING"],
        ["unresolved_integration_step", "REQ-MISSING"],
        ["unresolved_integration_step", "LIST-MISSING"],
      ]
    );
  });

  it("fails a one-character live hash corruption and ignores historical maps", () => {
    const { checkFrozenHashes } = require(path.join(ROOT, "hooks/plan-package.cjs"));
    const repo = mkdtempSync(path.join(os.tmpdir(), "plan-hash-"));
    const dir = path.join(repo, "docs/plans/x");
    mkdirSync(path.join(repo, ".git"), { recursive: true });
    mkdirSync(dir, { recursive: true });
    const body = '{"ok":true}\n';
    writeFileSync(path.join(dir, "outcome-view.json"), body);
    const good = sha(body);
    const bad = good.slice(0, -1) + (good.endsWith("a") ? "b" : "a");
    writeFileSync(
      path.join(dir, "plan-integration.json"),
      JSON.stringify({ source_file_hashes: { "outcome-view.json": bad } })
    );
    const mismatch = checkFrozenHashes(dir);
    assert.equal(mismatch[0].code, "frozen_hash_mismatch");
    writeFileSync(
      path.join(dir, "plan-integration.json"),
      JSON.stringify({ source_file_hashes: { "outcome-view.json": good } })
    );
    assert.deepEqual(checkFrozenHashes(dir), []);
  });
});


describe("plan-package (#153 complete manifest projection)", () => {
  const fixture = (name = "complete") => JSON.parse(readFileSync(
    path.join(ROOT, `test/fixtures/manifest-${name}.json`), "utf8"));
  // Real freeze inputs: each mutation keeps the source digest valid.
  const run = (doc) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "manifest-freeze-"));
    writeFileSync(path.join(dir, ".git"), "fixture repository marker");
    writeFileSync(path.join(dir, "plan.md"), "# Stable source\n");
    const seit = JSON.stringify({ source_baseline: { planning_inputs: [
      { path: "plan.md", sha256: sha("# Stable source\n") },
    ] } });
    writeFileSync(path.join(dir, "seit.json"), seit);
    const candidate_digest = sha([sha("# Stable source\n"), sha(seit)].join("\n"));
    const contract = planningContract(candidate_digest, { dir });
    doc.journey_settings = { planning_review: { candidate_digest }, ...contract.journey_settings };
    doc.boundary_contract ??= contract.boundary_contract;
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify(doc));
    return freeze(dir);
  };
  const rejects = (doc, code) => {
    const result = run(doc);
    assert.equal(result.outcome, "FAIL");
    assert.ok(result.findings.some((finding) => finding.code === code), JSON.stringify(result));
  };
  it("rejects the reference-index fixture", () => {
    rejects(fixture("reference-index"), "manifest_requirement_statement_missing");
  });
  it("passes the complete fixture", () => {
    assert.deepEqual(run(fixture()).findings, []);
  });
  it("rejects a requirement without statement text", () => {
    const doc = fixture();
    doc.dod_manifest.requirements[0].statement = "  ";
    rejects(doc, "manifest_requirement_statement_missing");
  });
  it("rejects architecture without a summary or decision", () => {
    const doc = fixture();
    delete doc.dod_manifest.architecture[0].summary;
    rejects(doc, "manifest_architecture_summary_missing");
  });
  it("rejects a slice missing its task row", () => {
    const doc = fixture();
    doc.dod_manifest.tasks = [];
    rejects(doc, "manifest_slice_task_missing");
  });
  for (const field of ["role", "route", "depends_on", "write_set"]) {
    it(`rejects a task missing ${field}`, () => {
      const doc = fixture();
      delete doc.dod_manifest.tasks[0][field];
      rejects(doc, "manifest_task_field_missing");
    });
  }
  for (const section of ["requirements", "architecture", "tasks"]) {
    it(`F2 rejects per-row N/A in ${section}`, () => {
      const doc = fixture();
      doc.dod_manifest[section] = [{ id: section === "tasks" ? "S1" : "R1",
        not_applicable: true, reason: "deferred" }];
      rejects(doc, "manifest_row_not_applicable");
      const codes = { requirements: "manifest_requirement_statement_missing",
        architecture: "manifest_architecture_summary_missing", tasks: "manifest_task_field_missing" };
      rejects(doc, codes[section]);
    });
  }
  for (const [section, value] of [
    ["requirements", 42], ["architecture", "bad"], ["tasks", 42],
    ["documentation", false], ["models", "bad"],
    ["requirements", [null]], ["architecture", [false]], ["tasks", [42]],
  ]) {
    it(`F3 rejects malformed ${section}: ${JSON.stringify(value)}`, () => {
      const doc = fixture();
      doc.dod_manifest[section] = value;
      rejects(doc, "manifest_section_shape_invalid");
    });
  }
  it("F3 rejects a malformed projection object", () => {
    const doc = fixture();
    doc.dod_manifest = 42;
    rejects(doc, "manifest_section_shape_invalid");
  });
  for (const [field, value] of [["depends_on", [null]], ["write_set", [false]]]) {
    it(`F3 rejects malformed task ${field} elements`, () => {
      const doc = fixture();
      doc.dod_manifest.tasks[0][field] = value;
      const result = run(doc);
      assert.equal(result.outcome, "FAIL");
      assert.ok(result.findings.some((finding) => finding.code === "manifest_task_field_invalid" &&
        finding.id === "S1" && finding.field === field), JSON.stringify(result));
    });
  }
  it("permits section N/A with reason and empty lists without slices", () => {
    for (const value of [[], { not_applicable: true, reason: "No applicable content." }]) {
      const doc = fixture();
      doc.slices = [];
      for (const section of ["requirements", "architecture", "tasks"]) doc.dod_manifest[section] = value;
      doc.dod_manifest.models = [];
      assert.deepEqual(run(doc).findings, []);
    }
    const doc = fixture();
    doc.dod_manifest.tasks[0].write_set = [];
    assert.deepEqual(run(doc).findings, []);
  });
  it("rejects unspecified documentation without explicit N/A and reason", () => {
    for (const documentation of [[], [{ surface: "unspecified", impact: "unspecified" }],
      { not_applicable: true }, { not_applicable: true, reason: "  " }]) {
      const doc = fixture();
      doc.dod_manifest.documentation = documentation;
      rejects(doc, "manifest_documentation_unspecified");
    }
  });
  it("permits explicit documentation N/A with a reason", () => {
    const doc = fixture();
    doc.dod_manifest.documentation = { not_applicable: true, reason: "No documentation changes." };
    assert.deepEqual(run(doc).findings, []);
  });
  for (const mode of ["diagram-assisted", "sysml-v2"]) {
    it(`rejects ${mode} without an embedded view`, () => {
      const doc = fixture();
      doc.dod_manifest.models = [{ id: "MODEL-1", mode, not_applicable: true }];
      rejects(doc, "manifest_model_view_missing");
    });
  }
  it("rejects empty view bindings", () => {
    const doc = fixture();
    doc.dod_manifest.models[0].view = {};
    rejects(doc, "manifest_model_view_missing");
  });
});

describe("plan-package (#226 post-approval correction round)", () => {
  const names = ["mbse", "integration_test"];
  const corpus = JSON.parse(readFileSync(new URL("./fixtures/planning-repair-package.json", import.meta.url)));

  function setupCorrectionFixture() {
    const dir = mkdtempSync(path.join(os.tmpdir(), "plan-pkg-226-"));
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    mkdirSync(path.join(dir, "gate-evidence"), { recursive: true });
    const doc = structuredClone(corpus.implementation);
    const seitDoc = structuredClone(corpus.seit);
    let plan = "# Round 1 plan\n";
    let notes = "Round 1 notes\n";

    function writeInputs() {
      writeFileSync(path.join(dir, "plan.md"), plan);
      writeFileSync(path.join(dir, "notes.md"), notes);
      seitDoc.source_baseline.planning_inputs = [
        { path: "plan.md", sha256: sha(plan) },
        { path: "notes.md", sha256: sha(notes) },
      ];
      const seitBytes = JSON.stringify(seitDoc);
      writeFileSync(path.join(dir, "seit.json"), seitBytes);
      return [...seitDoc.source_baseline.planning_inputs, { path: "seit.json", sha256: sha(seitBytes) }];
    }

    // Round 1: approved plan
    const r1Inputs = writeInputs();
    const r1Candidate = {
      candidate_ref: "plan",
      candidate_revision: "r1",
      candidate_digest: sha(r1Inputs.map((x) => x.sha256).join("\n")),
    };
    const r1Sessions = names.map((session) => ({
      session,
      ...r1Candidate,
      verdict: "READY",
      inputs: [structuredClone(r1Inputs[0])],
    }));
    const r1Review = {
      candidate: structuredClone(r1Candidate),
      input_digests: r1Inputs,
      planning_wave: { required_sessions: names, sessions: structuredClone(r1Sessions) },
      dod_manifest: { output_name: "review.html" },
      reviewer_slots: [{ slot_id: "one", primary_route_ref: "independent-route", fallback_route_refs: [] }],
      round_number: 1,
      completed_rounds: 1,
      receipts: [{
        slot_id: "one",
        selected_route_ref: "independent-route",
        ...r1Candidate,
        independent: true,
        findings_isolated: true,
        verdict: "ACCEPT",
      }],
      aggregation_complete: true,
      aggregated_repairs: 0,
    };
    const r1ReviewBytes = Buffer.from(JSON.stringify(r1Review));
    writeFileSync(path.join(dir, "gate-evidence/planning-review.json"), r1ReviewBytes);
    writeFileSync(path.join(dir, "review.html"), "<!doctype html><title>DoD</title>");
    const r1Wave = {
      required_sessions: names,
      sessions: structuredClone(r1Sessions),
      reviews: 1,
      repairs: 0,
      closure: "deterministic_PASS",
      candidate_digest: r1Candidate.candidate_digest,
      closing_candidate: structuredClone(r1Candidate),
      review_receipt: { path: "gate-evidence/planning-review.json", sha256: sha(r1ReviewBytes) },
    };
    doc.journey_settings.planning_wave = structuredClone(r1Wave);
    doc.journey_settings.planning_review = { candidate_digest: r1Candidate.candidate_digest };

    // Correction 1: new requirements, one review (REPAIR_REQUIRED), one repair
    plan += "New requirements added in correction.\n";
    const c1Inputs = writeInputs();
    const c1Reviewed = {
      candidate_ref: "plan",
      candidate_revision: "r2",
      candidate_digest: sha(c1Inputs.map((x) => x.sha256).join("\n")),
    };
    // mbse re-ran on changed plan.md; integration_test also returned for r2
    const c1Sessions = names.map((session) => ({
      session,
      ...c1Reviewed,
      verdict: "READY",
      inputs: [structuredClone(c1Inputs[0])],
    }));
    const c1Review = {
      correction_id: "corr-1",
      candidate: structuredClone(c1Reviewed),
      input_digests: c1Inputs,
      planning_wave: { required_sessions: names, sessions: structuredClone(c1Sessions) },
      dod_manifest: { output_name: "review.html" },
      reviewer_slots: [{ slot_id: "one", primary_route_ref: "independent-route", fallback_route_refs: [] }],
      round_number: 1,
      completed_rounds: 1,
      receipts: [{
        slot_id: "one",
        selected_route_ref: "independent-route",
        ...c1Reviewed,
        independent: true,
        findings_isolated: true,
        verdict: "REPAIR_REQUIRED",
      }],
      aggregation_complete: true,
      aggregated_repairs: 0,
    };
    const c1ReviewBytes = Buffer.from(JSON.stringify(c1Review));
    writeFileSync(path.join(dir, "gate-evidence/planning-review-corr-1.json"), c1ReviewBytes);

    // One repair inside correction 1
    plan += "Repair applied for correction 1.\n";
    const c1ClosingInputs = writeInputs();
    const c1Closing = {
      candidate_ref: "plan",
      candidate_revision: "r3",
      candidate_digest: sha(c1ClosingInputs.map((x) => x.sha256).join("\n")),
    };
    doc.journey_settings.planning_review = { candidate_digest: c1Closing.candidate_digest };
    doc.journey_settings.planning_corrections = [{
      correction_id: "corr-1",
      from_candidate: structuredClone(r1Candidate),
      required_sessions: names,
      sessions: structuredClone(c1Sessions),
      reviews: 1,
      repairs: 1,
      closure: "deterministic_PASS",
      candidate_digest: c1Closing.candidate_digest,
      closing_candidate: structuredClone(c1Closing),
      review_receipt: { path: "gate-evidence/planning-review-corr-1.json", sha256: sha(c1ReviewBytes) },
      repair: {
        from_candidate: structuredClone(c1Reviewed),
        to_candidate: structuredClone(c1Closing),
        deterministic_gate: "PASS",
      },
    }];

    return { dir, doc, r1Wave, r1ReviewBytes };
  }

  it("passes final freeze with approved plan + one correction while keeping round-1 provenance byte-identical", () => {
    const { dir, doc, r1Wave, r1ReviewBytes } = setupCorrectionFixture();
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify(doc));
    const result = freeze(dir, { stage: "final" });
    assert.equal(result.outcome, "PASS", JSON.stringify(result));
    assert.deepEqual(result.findings, []);
    // Round-1 receipts and session input digests stay byte-identical
    assert.deepEqual(readFileSync(path.join(dir, "gate-evidence/planning-review.json")), r1ReviewBytes);
    assert.deepEqual(doc.journey_settings.planning_wave, r1Wave);
  });

  it("fails the freeze when a historical round-1 receipt digest is rewritten", () => {
    const { dir, doc } = setupCorrectionFixture();
    doc.journey_settings.planning_wave.review_receipt.sha256 = "0".repeat(64);
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify(doc));
    const result = freeze(dir, { stage: "final" });
    assert.equal(result.outcome, "FAIL");
    assert.ok(result.findings.some((f) => f.code === "planning_wave_review_invalid" && f.reason === "receipt_digest_mismatch"), JSON.stringify(result));
  });

  it("rejects a second review inside the same correction", () => {
    const { dir, doc } = setupCorrectionFixture();
    doc.journey_settings.planning_corrections[0].reviews = 2;
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify(doc));
    const result = freeze(dir, { stage: "final" });
    assert.equal(result.outcome, "FAIL");
    assert.ok(result.findings.some((f) => f.code === "planning_wave_review_count"), JSON.stringify(result));
  });

  it("passes final freeze when a historical no-review round-1 wave has adopted specialist returns without wave.input_digests (F226-1)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "plan-pkg-226-f226-1-"));
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    mkdirSync(path.join(dir, "gate-evidence"), { recursive: true });
    const doc = structuredClone(corpus.implementation);
    const seitDoc = structuredClone(corpus.seit);
    let plan = "# Round 0 plan\n";
    const notes = "Shared unchanged notes\n";

    function writeInputs() {
      writeFileSync(path.join(dir, "plan.md"), plan);
      writeFileSync(path.join(dir, "notes.md"), notes);
      seitDoc.source_baseline.planning_inputs = [
        { path: "plan.md", sha256: sha(plan) },
        { path: "notes.md", sha256: sha(notes) },
      ];
      const seitBytes = JSON.stringify(seitDoc);
      writeFileSync(path.join(dir, "seit.json"), seitBytes);
      return [...seitDoc.source_baseline.planning_inputs, { path: "seit.json", sha256: sha(seitBytes) }];
    }

    const r0Inputs = writeInputs();
    const r0Candidate = {
      candidate_ref: "plan",
      candidate_revision: "r0",
      candidate_digest: sha(r0Inputs.map((x) => x.sha256).join("\n")),
    };

    plan = "# Round 1 plan\n";
    const r1Inputs = writeInputs();
    const r1Candidate = {
      candidate_ref: "plan",
      candidate_revision: "r1",
      candidate_digest: sha(r1Inputs.map((x) => x.sha256).join("\n")),
    };
    const r1Wave = {
      review_requested: false,
      required_sessions: names,
      sessions: [
        {
          session: names[0],
          ...r0Candidate,
          verdict: "READY",
          inputs: [structuredClone(r0Inputs[1])],
          adopted_to: structuredClone(r1Candidate),
        },
        ...names.slice(1).map((session) => ({
          session,
          ...r1Candidate,
          verdict: "READY",
          inputs: [structuredClone(r1Inputs[0])],
        })),
      ],
      reviews: 0,
      repairs: 0,
      closure: "deterministic_PASS",
      candidate_digest: r1Candidate.candidate_digest,
      closing_candidate: structuredClone(r1Candidate),
    };
    doc.journey_settings.planning_wave = structuredClone(r1Wave);
    doc.journey_settings.planning_review = { candidate_digest: r1Candidate.candidate_digest };
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify(doc));
    const preCorrection = freeze(dir, { stage: "final" });
    assert.equal(preCorrection.outcome, "PASS", JSON.stringify(preCorrection));

    // Append a no-review correction without mutating historical planning_wave
    plan = "# Round 2 correction plan\n";
    const c1Inputs = writeInputs();
    const c1Candidate = {
      candidate_ref: "plan",
      candidate_revision: "r2",
      candidate_digest: sha(c1Inputs.map((x) => x.sha256).join("\n")),
    };
    doc.journey_settings.planning_review = { candidate_digest: c1Candidate.candidate_digest };
    doc.journey_settings.planning_corrections = [{
      correction_id: "corr-1",
      from_candidate: structuredClone(r1Candidate),
      review_requested: false,
      required_sessions: names,
      sessions: names.map((session) => ({
        session,
        ...c1Candidate,
        verdict: "READY",
        inputs: [structuredClone(c1Inputs[0])],
      })),
      reviews: 0,
      repairs: 0,
      closure: "deterministic_PASS",
      candidate_digest: c1Candidate.candidate_digest,
      closing_candidate: structuredClone(c1Candidate),
    }];
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify(doc));
    const postCorrection = freeze(dir, { stage: "final" });
    assert.equal(postCorrection.outcome, "PASS", JSON.stringify(postCorrection));
    assert.deepEqual(postCorrection.findings, []);
    assert.deepEqual(doc.journey_settings.planning_wave, r1Wave);
  });
});

describe("plan-package (Alphazedehq#608 false serial chain flag)", () => {
  function setupPackage(t, mutate, name = "") {
    const parent = mkdtempSync(path.join(os.tmpdir(), "plan-pkg-608-"));
    const dir = path.join(parent, name);
    t.after(() => rmSync(parent, { recursive: true, force: true }));
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    const plan = "# Plan\n";
    writeFileSync(path.join(dir, "plan.md"), plan);
    const seit = JSON.stringify({
      source_baseline: { planning_inputs: [{ path: "plan.md", sha256: sha(plan) }] },
      procedures_and_commands: [],
      proof_cases: [],
    });
    writeFileSync(path.join(dir, "seit.json"), seit);
    const digest = sha([sha(plan), sha(seit)].join("\n"));
    const contract = planningContract(digest, { units: ["W1"], kind: "wave", dir });
    const doc = {
      journey_settings: { planning_review: { candidate_digest: digest }, ...contract.journey_settings },
      boundary_contract: contract.boundary_contract,
      waves: [{ id: "W1", slice_ids: ["S1", "S2"] }],
      dependencies: [],
      slices: [
        { id: "S1", role: "Implementer", write_set: ["a.js"], command_ids: [], inputs: [], resource: "host:i7" },
        { id: "S2", role: "Implementer", write_set: ["b.js"], command_ids: [], depends_on: ["S1"], inputs: [], resource: "host:mac" },
      ],
    };
    if (mutate) mutate(doc);
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify(doc));
    return dir;
  }

  it("flags an ordering edge between slices that share no input or resource without refusing the freeze", (t) => {
    const dir = setupPackage(t);
    const finalRes = freeze(dir, { stage: "final" });
    assert.equal(finalRes.outcome, "PASS", JSON.stringify(finalRes));
    const flag = finalRes.findings.find((f) => f.code === "false_serial_chain");
    assert.ok(flag, JSON.stringify(finalRes.findings));
    assert.equal(flag.from, "S1");
    assert.equal(flag.to, "S2");

    const draftRes = freeze(dir, { stage: "draft" });
    assert.equal(draftRes.outcome, "PASS");
    assert.ok(draftRes.findings.some((f) => f.code === "false_serial_chain" && f.from === "S1" && f.to === "S2"));

    const cli = spawnSync(process.execPath, [path.join(ROOT, "hooks/plan-package.cjs"), dir], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    const parsed = JSON.parse(cli.stdout);
    assert.equal(parsed.outcome, "PASS");
    assert.ok(parsed.findings.some((f) => f.code === "false_serial_chain"));
  });

  it("also flags top-level dependencies edges sharing no input or resource without refusing", (t) => {
    const dir = setupPackage(t, (doc) => {
      delete doc.slices[1].depends_on;
      doc.dependencies = [{ from: "S1", to: "S2" }];
    });
    const res = freeze(dir, { stage: "final" });
    assert.equal(res.outcome, "PASS");
    assert.deepEqual(res.findings.filter((f) => f.code === "false_serial_chain").map((f) => [f.from, f.to]), [["S1", "S2"]]);
  });

  it("still freezes a plan named ready when called with only the plan directory", (t) => {
    const dir = setupPackage(t, undefined, "ready");
    const cli = spawnSync(process.execPath, [path.join(ROOT, "hooks/plan-package.cjs"), "ready"], {
      cwd: path.dirname(dir), input: "", encoding: "utf8",
    });
    assert.equal(cli.status, 0, cli.stderr || cli.stdout);
    assert.equal(JSON.parse(cli.stdout).outcome, "PASS");
  });

  it("does not flag ordering edges that share an input, producer write_set, resource, or omit the new fields", (t) => {
    const sharedInputSliceId = setupPackage(t, (doc) => {
      doc.slices[1].inputs = ["S1"];
    });
    assert.deepEqual(freeze(sharedInputSliceId).findings, []);

    const sharedInputWriteSet = setupPackage(t, (doc) => {
      doc.slices[1].inputs = ["a.js"];
    });
    assert.deepEqual(freeze(sharedInputWriteSet).findings, []);

    const sharedResource = setupPackage(t, (doc) => {
      doc.slices[1].resource = "host:i7";
    });
    assert.deepEqual(freeze(sharedResource).findings, []);

    const legacyWithoutFields = setupPackage(t, (doc) => {
      delete doc.slices[0].inputs;
      delete doc.slices[0].resource;
      delete doc.slices[1].inputs;
      delete doc.slices[1].resource;
    });
    assert.deepEqual(freeze(legacyWithoutFields).findings, []);
  });

  it("leaves overlapping input scopes and partly declared legacy edges unflagged", (t) => {
    const overlapping = setupPackage(t, (doc) => {
      doc.slices[0].inputs = ["config/"];
      doc.slices[1].inputs = ["config/service.json"];
    });
    const mixedLegacy = setupPackage(t, (doc) => {
      delete doc.slices[0].inputs;
      delete doc.slices[0].resource;
    });
    for (const dir of [overlapping, mixedLegacy]) {
      for (const stage of ["draft", "final"]) {
        const result = freeze(dir, { stage });
        assert.equal(result.outcome, "PASS");
        assert.deepEqual(result.findings, []);
      }
    }
  });

  it("still fails an existing freeze check when a serial chain warning is present", (t) => {
    const dir = setupPackage(t, (doc) => {
      doc.slices[1].command_ids = ["CMD-MISSING"];
    });
    const result = freeze(dir, { stage: "final" });
    assert.equal(result.outcome, "FAIL");
    assert.ok(result.findings.some((f) => f.code === "unknown_command_id"));
    assert.ok(result.findings.some((f) => f.code === "false_serial_chain" && f.blocking === false));
  });
});

describe("plan-package (Alphazedehq#628 declared artifacts and named unreadable files)", () => {
  function setupValidPackage(t) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "plan-pkg-628-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    const plan = "# Plan\n";
    writeFileSync(path.join(dir, "plan.md"), plan);
    const seitDoc = JSON.stringify({
      source_baseline: { planning_inputs: [{ path: "plan.md", sha256: sha(plan) }] },
      procedures_and_commands: [],
      proof_cases: [],
    });
    writeFileSync(path.join(dir, "seit.json"), seitDoc);
    const digest = sha([sha(plan), sha(seitDoc)].join("\n"));
    const contract = planningContract(digest, { units: ["W1"], kind: "wave", dir });
    const doc = {
      journey_settings: { planning_review: { candidate_digest: digest }, ...contract.journey_settings },
      boundary_contract: contract.boundary_contract,
      waves: [{ id: "W1", slice_ids: ["S1"] }],
      dependencies: [],
      slices: [{ id: "S1", role: "Implementer", write_set: ["a.js"], command_ids: [] }],
    };
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify(doc));
    return dir;
  }

  it("ignores an unrelated empty *.json file in the plan directory during freeze", (t) => {
    const dir = setupValidPackage(t);
    writeFileSync(path.join(dir, "unrelated-notes.json"), "");
    const res = freeze(dir, { stage: "final" });
    assert.equal(res.outcome, "PASS", JSON.stringify(res));
    assert.deepEqual(res.findings, []);
  });

  it("names the offending declared artifact when unreadable or invalid JSON", (t) => {
    for (const bad of ["authority.json", "plan-integration.json"]) {
      const dir = setupValidPackage(t);
      writeFileSync(path.join(dir, bad), "");
      const res = freeze(dir, { stage: "final" });
      assert.equal(res.outcome, "FAIL", bad);
      assert.equal(res.findings[0]?.code, "planning_input_unreadable", JSON.stringify(res));
      assert.equal(res.findings[0]?.path, bad, JSON.stringify(res));
    }
  });
});
