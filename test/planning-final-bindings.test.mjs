/** Final freeze regressions from the owner-approved three-finding follow-up. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { unreviewedPlanningWave } from "./planning-contract-fixture.mjs";

const require = createRequire(import.meta.url);
const { freeze } = require("../hooks/plan-package.cjs");
const { checkRegister } = require("../hooks/register-precheck.cjs");
const precheck = fileURLToPath(
	new URL("../hooks/register-precheck.cjs", import.meta.url),
);
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const corpus = JSON.parse(read("./fixtures/planning-repair-package.json"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
	const dir = mkdtempSync(path.join(tmpdir(), "final-planning-bindings-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const put = (rel, text) => writeFileSync(path.join(dir, rel), text);
	put(".git", "owned synthetic repository marker");
	put("plan.md", read("./fixtures/register-precheck/plan.md"));
	put("register.sdoc", read("./fixtures/register-precheck/valid.sdoc"));
	put("evidence.txt", read("./fixtures/register-precheck/evidence.txt"));
	put("notes.md", "Unconsumed planning notes.\n");
	const doc = structuredClone(corpus.implementation);
	const seit = structuredClone(corpus.seit);
	seit.proof_cases = ["REG-1", "REG-2"].map((requirement_id, i) => ({
		...seit.proof_cases[0],
		id: `SEIT-${i + 1}`,
		requirement_id,
	}));
	doc.boundary_contract = {
		not_applicable: true,
		reason: "Local planning checks; no component boundary changes.",
	};
	doc.journey_settings.journey_type = "specification";
	doc.journey_settings.requirement_register = "register.sdoc";
	doc.journey_settings.planning_wave = unreviewedPlanningWave(
		"0".repeat(64),
		[],
	);
	const wave = doc.journey_settings.planning_wave;
	let revision = 0;
	function refresh(extraInputs = []) {
		const register = readFileSync(path.join(dir, "register.sdoc"));
		put(
			"authority.json",
			JSON.stringify({
				requirement_register: { path: "register.sdoc", sha256: sha(register) },
			}),
		);
		seit.source_baseline.planning_inputs = [
			"plan.md",
			"register.sdoc",
			"notes.md",
			...extraInputs,
		].map((file) => ({
			path: file,
			sha256: sha(readFileSync(path.join(dir, file))),
		}));
		const bytes = JSON.stringify(seit);
		put("seit.json", bytes);
		const inputs = [
			...seit.source_baseline.planning_inputs,
			{ path: "seit.json", sha256: sha(bytes) },
		];
		const digest = sha(inputs.map((row) => row.sha256).join("\n"));
		const closing = {
			candidate_ref: "plan",
			candidate_revision: `r${++revision}`,
			candidate_digest: digest,
		};
		doc.journey_settings.planning_review = { candidate_digest: digest };
		Object.assign(wave, {
			candidate_digest: digest,
			closing_candidate: closing,
		});
		return { inputs, closing };
	}
	const initial = refresh();
	const run = (stage = "final") => {
		put("implementation.json", JSON.stringify(doc));
		return freeze(dir, { stage });
	};
	return { dir, doc, seit, wave, put, refresh, initial, run };
}
const rejects = (result) =>
	assert.equal(result.outcome, "FAIL", JSON.stringify(result));

test("draft advises on final-only planning wave gaps", (t) => {
	const fx = fixture(t);
	const { closing_candidate: closing } = fx.wave;
	fx.wave.required_sessions = ["mbse"];
	fx.wave.sessions = [
		{
			session: "mbse",
			...closing,
			candidate_revision: "earlier",
			verdict: "READY",
		},
	];
	const cases = [
		["reviews", "planning_wave_review_count"],
		["repairs", "planning_wave_repair_limit"],
		["closure", "planning_wave_closure_missing"],
		["closing_candidate", "planning_wave_candidate_mismatch"],
	];
	for (const [field] of cases) delete fx.wave[field];
	const expectGaps = (stage, codes) => {
		const result = fx.run(stage);
		assert.equal(result.outcome, stage === "draft" ? "PASS" : "FAIL");
		for (const code of codes) {
			const finding = result.findings.find((item) => item.code === code);
			assert.ok(finding, `${stage}: missing ${code}`);
			assert.equal(finding.blocking === false, stage === "draft");
		}
	};
	for (const stage of ["final", "draft"]) {
		expectGaps(
			stage,
			cases.map(([, code]) => code),
		);
	}
	Object.assign(fx.wave, {
		reviews: 0,
		repairs: 0,
		closure: "deterministic_PASS",
		closing_candidate: closing,
	});
	for (const stage of ["final", "draft"]) {
		expectGaps(stage, ["planning_wave_sessions_incomplete"]);
	}
	fx.wave.sessions[0].adopted_to = closing;
	fx.wave.sessions[0].inputs = [fx.initial.inputs[0]];
	assert.deepEqual(fx.run("draft").findings, []);
	assert.deepEqual(fx.run().findings, []);
});

test("a malformed closing receipt advises in draft and blocks final freeze", (t) => {
	const fx = fixture(t);
	const receipt = JSON.stringify({ aggregated_repairs: { toString: null } });
	fx.put("review-receipt.json", receipt);
	Object.assign(fx.wave, {
		review_requested: true,
		reviews: 1,
		review_receipt: { path: "review-receipt.json", sha256: sha(receipt) },
	});

	const draft = fx.run("draft");
	assert.equal(draft.outcome, "PASS", JSON.stringify(draft));
	assert.ok(
		draft.findings.some(
			(f) =>
				f.code === "planning_wave_closure_unreadable" && f.blocking === false,
		),
	);
	rejects(fx.run());
});

test("final freeze accepts zero review rounds for a review-free wave", (t) => {
	const fx = fixture(t);
	const rows = fx.doc.journey_settings.review_rounds;
	const wave = rows.find((row) => row.unit_kind === "wave");
	wave.reviewer_rounds = 0;
	const final = fx.run();
	assert.equal(final.outcome, "PASS", JSON.stringify(final));
	const planning = rows.find((row) => row.unit_kind === "planning");
	planning.reviewer_rounds = 0;
	const invalid = fx.run();
	rejects(invalid);
	assert.ok(
		invalid.findings.some(
			(f) => f.code === "review_round_invalid" && f.unit_id === "planning",
		),
	);
});

test("final freeze rejects requirements-stage pending case bindings while draft remains valid", (t) => {
	const fx = fixture(t);
	const register = read("./fixtures/register-precheck/valid.sdoc").replace(
		/^VERIFICATION_CASE[^\n]*\n/gm,
		"",
	);
	fx.put("register.sdoc", register);
	fx.refresh();
	const early = checkRegister({
		register,
		technicalPlan: read("./fixtures/register-precheck/plan.md"),
		files: {
			"evidence.txt": read("./fixtures/register-precheck/evidence.txt"),
		},
		stage: "requirements",
	});
	assert.equal(early.outcome, "PASS");
	assert.equal(early.pending_bindings.length, 2);
	assert.equal(fx.run("draft").outcome, "PASS");
	const result = fx.run();
	rejects(result);
	assert.ok(
		result.findings.some(
			(f) =>
				f.code === "register_precheck_failed" &&
				f.class === "verification" &&
				f.uid === "REG-1",
		),
		JSON.stringify(result),
	);
});

test("final freeze resolves bound case IDs against actual SEIT and accepts valid bindings", (t) => {
	const fx = fixture(t);
	assert.equal(fx.run().outcome, "PASS");
	fx.seit.proof_cases.pop();
	fx.refresh();
	const result = fx.run();
	rejects(result);
	assert.ok(
		result.findings.some(
			(f) => f.code === "register_precheck_failed" && /SEIT-2/.test(f.message),
		),
		JSON.stringify(result),
	);
});

test("final freeze shares the requirements-stage decision context in bound alignment", (t) => {
	const fx = fixture(t);
	const alignment = read("./fixtures/register-precheck/plan.md");
	const register = read("./fixtures/register-precheck/valid.sdoc");
	fx.put("alignment.md", alignment);
	fx.put("plan.md", alignment.replace(/^\| DEC-1[^\n]*\n/m, ""));
	const early = checkRegister({
		register,
		technicalPlan: alignment,
		files: {
			"evidence.txt": read("./fixtures/register-precheck/evidence.txt"),
		},
		stage: "requirements",
	});
	assert.equal(early.outcome, "PASS");
	fx.refresh();
	assert.ok(fx.run().findings.some((f) => f.class === "decision"));
	fx.refresh(["alignment.md"]);
	const final = fx.run();
	assert.equal(final.outcome, "PASS", JSON.stringify(final));
	const cli = spawnSync(
		process.execPath,
		[
			precheck,
			"--seit",
			"seit.json",
			"--alignment",
			"alignment.md",
			"register.sdoc",
			"plan.md",
			fx.dir,
		],
		{ cwd: fx.dir, encoding: "utf8", timeout: 10_000 },
	);
	assert.equal(cli.status, 0, cli.stdout || cli.stderr);
	fx.put("alignment.md", alignment.replace("DEC-1", "DEC-2"));
	const stale = fx.run();
	rejects(stale);
	assert.ok(
		stale.findings.some(
			(f) => f.code === "digest_mismatch" && f.path === "alignment.md",
		),
	);
	fx.put("plan.md", alignment);
	fx.put("alignment.md", "# Alignment without decision declarations\n");
	fx.refresh(["alignment.md"]);
	const planOnly = fx.run();
	assert.equal(planOnly.outcome, "PASS", JSON.stringify(planOnly));
});

test("final freeze uses the bound workspace used by MBSE precheck", (t) => {
	const fx = fixture(t);
	const context = read("./fixtures/register-precheck/plan.md");
	fx.put("workspace.md", context);
	fx.put("alignment.md", context.replace("DEC-1", "DEC-2"));
	fx.put("plan.md", context.replace(/^\| DEC-1[^\n]*\n/m, ""));

	fx.refresh(["alignment.md"]);
	const unbound = fx.run();
	rejects(unbound);
	assert.ok(unbound.findings.some((f) => f.class === "decision"));

	fx.refresh(["workspace.md", "alignment.md"]);
	const bound = fx.run();
	assert.equal(bound.outcome, "PASS", JSON.stringify(bound));
});

test("fenced decision examples do not satisfy register traces", (t) => {
	const fx = fixture(t);
	const context = read("./fixtures/register-precheck/plan.md");
	fx.put(
		"alignment.md",
		"# Decision syntax\n\n```markdown\n| DEC-1 | Example only. |\n```\n\n" +
			"~~~markdown\n## DEC-1 Example heading\n~~~\n",
	);
	fx.put("plan.md", context.replace(/^\| DEC-1[^\n]*\n/m, ""));
	fx.refresh(["alignment.md"]);
	const final = fx.run();
	rejects(final);
	assert.ok(final.findings.some((f) => f.class === "decision"));

	const cli = spawnSync(
		process.execPath,
		[
			precheck,
			"--alignment",
			"alignment.md",
			"register.sdoc",
			"plan.md",
			fx.dir,
		],
		{ cwd: fx.dir, encoding: "utf8", timeout: 10_000 },
	);
	assert.equal(cli.status, 1, cli.stdout || cli.stderr);
	assert.ok(
		JSON.parse(cli.stdout).findings.some((f) => f.class === "decision"),
	);

	fx.put("alignment.md", "~~~markdown\n## DEC-2 Example heading\n");
	fx.put("plan.md", context);
	fx.refresh(["alignment.md"]);
	const declared = fx.run();
	assert.equal(declared.outcome, "PASS", JSON.stringify(declared));
});

test("an authority-declared register also requires strict final validation", (t) => {
	const fx = fixture(t);
	delete fx.doc.journey_settings.journey_type;
	delete fx.doc.journey_settings.requirement_register;
	fx.put(
		"register.sdoc",
		read("./fixtures/register-precheck/valid.sdoc").replace(
			/^VERIFICATION_CASE[^\n]*\n/gm,
			"",
		),
	);
	fx.refresh();
	const result = fx.run();
	rejects(result);
	assert.ok(
		result.findings.some(
			(f) =>
				f.code === "register_precheck_failed" && f.class === "verification",
		),
		JSON.stringify(result),
	);
});

for (const name of ["register.sdoc", "plan.md", "seit.json", "evidence.txt"]) {
	test(`final freeze fails closed on unreadable ${name}`, (t) => {
		const fx = fixture(t);
		rmSync(path.join(fx.dir, name));
		mkdirSync(path.join(fx.dir, name)); // Deterministic unreadable file on any user's permissions.
		const result = fx.run();
		rejects(result);
		assert.ok(
			result.findings.some((f) =>
				name === "evidence.txt"
					? f.code === "register_precheck_failed" && f.class === "citation"
					: f.code === "planning_input_unreadable" && f.path === name,
			),
			JSON.stringify(result),
		);
	});
}

test("final register validation rejects missing or ambiguous bound technical-plan context", (t) => {
	for (const ambiguous of [false, true]) {
		const fx = fixture(t);
		const plan = read("./fixtures/register-precheck/plan.md");
		fx.put("other-technical-plan.md", plan);
		if (ambiguous)
			fx.seit.source_baseline.planning_inputs.push({
				path: "other-technical-plan.md",
				sha256: sha(plan),
			});
		else
			fx.seit.source_baseline.planning_inputs =
				fx.seit.source_baseline.planning_inputs.filter(
					(row) => row.path !== "plan.md",
				);
		const bytes = JSON.stringify(fx.seit);
		fx.put("seit.json", bytes);
		const digest = sha(
			[
				...fx.seit.source_baseline.planning_inputs.map((row) => row.sha256),
				sha(bytes),
			].join("\n"),
		);
		fx.doc.journey_settings.planning_review.candidate_digest = digest;
		fx.wave.candidate_digest = digest;
		fx.wave.closing_candidate.candidate_digest = digest;
		const result = fx.run();
		rejects(result);
		assert.ok(
			result.findings.some(
				(f) => f.code === "register_precheck_context_invalid",
			),
			JSON.stringify(result),
		);
	}
});

test("RC6-6 final freeze binds the technical plan written after the SEIT return", (t) => {
	const fx = fixture(t);
	const [technicalPlan, ...earlyInputs] =
		fx.seit.source_baseline.planning_inputs;
	fx.seit.source_baseline.planning_inputs = earlyInputs;
	const seitBytes = JSON.stringify(fx.seit);
	fx.put("seit.json", seitBytes);
	fx.doc.journey_settings.final_technical_plan = technicalPlan;
	const expected = sha(
		[...earlyInputs, technicalPlan, { sha256: sha(seitBytes) }]
			.map((row) => row.sha256)
			.join("\n"),
	);
	fx.doc.journey_settings.planning_review.candidate_digest = expected;
	fx.wave.candidate_digest = expected;
	fx.wave.closing_candidate.candidate_digest = expected;

	const frozen = fx.run();
	assert.equal(frozen.outcome, "PASS", JSON.stringify(frozen));
	assert.equal(frozen.manifest_digest, expected);
	assert.equal(readFileSync(path.join(fx.dir, "seit.json"), "utf8"), seitBytes);

	fx.doc.journey_settings.final_technical_plan = {
		...technicalPlan,
		path: path.join(fx.dir, "plan.md"),
	};
	const absolute = fx.run();
	rejects(absolute);
	assert.ok(
		absolute.findings.some((f) => f.code === "malformed_planning_input"),
	);

	fx.doc.journey_settings.final_technical_plan = technicalPlan;
	fx.put(
		"plan.md",
		read("./fixtures/register-precheck/plan.md") + "Unbound change.\n",
	);
	const stale = fx.run();
	rejects(stale);
	assert.ok(
		stale.findings.some(
			(f) => f.code === "digest_mismatch" && f.path === "plan.md",
		),
	);
});

test("no-review closure adopts unchanged consumed inputs without rewriting the original return", (t) => {
	const fx = fixture(t);
	fx.put(
		"notes.md",
		"Changed notes outside the specialist's consumed inputs.\n",
	);
	const { closing } = fx.refresh();
	const source = {
		session: "mbse",
		...fx.initial.closing,
		verdict: "READY",
		inputs: [fx.initial.inputs[0]],
		adopted_to: closing,
	};
	fx.wave.required_sessions = ["mbse"];
	fx.wave.sessions = [source];
	const original = structuredClone(source);
	assert.equal(fx.run().outcome, "PASS");
	assert.deepEqual(fx.wave.sessions[0], original);
	assert.equal(
		JSON.parse(readFileSync(path.join(fx.dir, "implementation.json")))
			.journey_settings.planning_wave.sessions[0].candidate_revision,
		fx.initial.closing.candidate_revision,
	);
});

test("no-review adoption rejects changed consumed inputs even with a forged recorded snapshot", (t) => {
	const fx = fixture(t);
	fx.put(
		"plan.md",
		read("./fixtures/register-precheck/plan.md") + "Changed consumed plan.\n",
	);
	const { closing } = fx.refresh();
	fx.wave.required_sessions = ["mbse"];
	fx.wave.sessions = [
		{
			session: "mbse",
			...fx.initial.closing,
			verdict: "READY",
			inputs: [fx.initial.inputs[0]],
			adopted_to: closing,
		},
	];
	fx.wave.input_digests = fx.initial.inputs;
	const result = fx.run();
	rejects(result);
	assert.ok(
		result.findings.some((f) => f.code === "planning_wave_sessions_incomplete"),
		JSON.stringify(result),
	);
});

test("no-review adoption never trusts recorded hashes over changed bytes", (t) => {
	const fx = fixture(t);
	const closing = fx.initial.closing;
	fx.wave.required_sessions = ["mbse"];
	fx.wave.sessions = [
		{
			session: "mbse",
			...closing,
			candidate_revision: "earlier",
			verdict: "READY",
			inputs: [fx.initial.inputs[0]],
			adopted_to: closing,
		},
	];
	fx.put("plan.md", "Changed without refreshing the manifest.\n");
	const result = fx.run();
	rejects(result);
	assert.ok(
		result.findings.some((f) => f.code === "digest_mismatch"),
		JSON.stringify(result),
	);
});
