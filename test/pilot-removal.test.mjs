// BLX-VC-007: opt-in behavior and rollback against the pre-pilot headless contract.
// The proof pilot was withdrawn (AM-50). No live agent or owner action is used.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	fixture as codeFixture,
	evidence,
	parseOutcome,
	program,
	readyInput,
	request,
	start,
} from "./fixtures/code-mode/fixture.mjs";
import { unreviewedPlanningWave } from "./planning-contract-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// The rebuilt delivery branch uses the later main revision. The plan pins
// d6007f6; observe both rather than substituting one for the other.
const plannedBase = "d6007f6e547296ba57351d5921105166fcb270a9";
const mainBase = "fd89e3df9325c6880e6c9902329e0ac95c124be7";
const temp = mkdtempSync(path.join(tmpdir(), "pilot-removal-"));
after(() => rmSync(temp, { recursive: true, force: true }));
const home = path.join(temp, "home");
mkdirSync(home);
const env = { HOME: home, PATH: process.env.PATH, LANG: "C" };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const load = (file) => JSON.parse(readFileSync(file, "utf8"));
const save = (file, doc) => writeFileSync(file, JSON.stringify(doc));
const fresh = () => mkdtempSync(path.join(temp, "case-"));
const fixtures = path.join(root, "test/fixtures");
const canonical = "sample-dod-manifest.html";
const visual = "sample-visual.html";
const outline = "skills/reviewer/references/optional-techniques.md";
const loop = "skills/bearing-lite/references/wave-operations.md";
const renderer = "tools/render-dod-manifest.mjs";

function command(executable, args, options = {}) {
	const result = spawnSync(executable, args, {
		encoding: "utf8",
		input: "",
		env,
		timeout: 60_000,
		maxBuffer: 32 * 1024 * 1024,
		...options,
	});
	assert.ifError(result.error);
	assert.equal(result.signal, null);
	return result;
}

function node(packageRoot, dir, script, args = [], data, commandEnv = env) {
	return command(process.execPath, [path.join(packageRoot, script), ...args], {
		cwd: dir,
		env: commandEnv,
		input: data === undefined ? "" : JSON.stringify(data),
	});
}

function success(result) {
	assert.equal(result.status, 0, result.stdout + result.stderr);
	return result;
}

function snapshot(dir) {
	return Object.fromEntries(
		readdirSync(dir, { recursive: true })
			.filter((file) => statSync(path.join(dir, file)).isFile())
			.sort()
			.map((file) => [file, sha(readFileSync(path.join(dir, file)))]),
	);
}

function plan(dir) {
	const { implementation: doc, seit } = load(
		path.join(fixtures, "planning-repair-package.json"),
	);
	const content = "# Sample plan\n\nPreserve the sample record.\n";
	writeFileSync(path.join(dir, ".git"), "synthetic worktree marker\n");
	writeFileSync(path.join(dir, "plan.md"), content);
	seit.source_baseline.planning_inputs = [
		{ path: "plan.md", sha256: sha(content) },
	];
	seit.proof_cases[0].observable_evidence = "plan.md";
	const seitBytes = JSON.stringify(seit);
	writeFileSync(path.join(dir, "seit.json"), seitBytes);
	const digest = sha(`${sha(content)}\n${sha(seitBytes)}`);
	const revision = doc.source_baseline.candidate_revision;
	doc.source_baseline.revision = revision;
	const candidate = {
		candidate_ref: "sample",
		candidate_revision: revision,
		candidate_digest: digest,
	};
	doc.journey_settings.planning_review = { candidate_digest: digest };
	doc.journey_settings.planning_wave = unreviewedPlanningWave(digest, [], {
		closing_candidate: candidate,
	});
	doc.dod_manifest = {
		template_version: "1.0.1",
		output_name: canonical,
		title: "Sample review",
		requirements: [
			{
				id: "AC-SYN-001",
				statement: "Preserve the sample.",
				status: "PLANNED",
			},
		],
		architecture: [{ id: "CONTRACT-SYN-008", decision: "Record the sample." }],
		tasks: doc.slices.map(({ id, role, write_set, depends_on }) => ({
			id,
			role,
			write_set,
			depends_on: depends_on ?? [],
			route: "sample-route",
			status: "PLANNED",
		})),
		documentation: [{ surface: "plan.md", impact: "Describe the sample." }],
	};
	save(path.join(dir, "implementation.json"), doc);
	return candidate;
}

const handoff = {
	handoff: {
		verdict: "PASS",
		candidate_ref: "sample",
		changed_paths: ["sample.txt"],
		tests: "ok",
		findings: "none",
		blocker: "none",
	},
	required_assurance: "none",
	assurance_accepted: [],
	candidate_matched: true,
};

function observe(result, dir) {
	// Only normalize the scratch directory allocated by the test. Everything
	// else (including error text and all JSON fields) must remain identical.
	return {
		exit: result.status,
		stdout: result.stdout.replaceAll(dir, "<plan>"),
		stderr: result.stderr.replaceAll(dir, "<plan>"),
	};
}

function render(packageRoot, dir, visualMode = false, name = canonical) {
	return node(packageRoot, dir, renderer, [
		"implementation.json",
		"--out",
		name,
		...(visualMode ? ["--visual"] : []),
	]);
}

function core(packageRoot, dir, commandEnv = env) {
	const beforeFiles = snapshot(dir);
	const draft = node(
		packageRoot,
		dir,
		"hooks/plan-package.cjs",
		["draft", "."],
		undefined,
		commandEnv,
	);
	const wave = node(
		packageRoot,
		dir,
		"hooks/plan-package.cjs",
		["wave", ".", "SYN-W1"],
		undefined,
		commandEnv,
	);
	const ready = node(
		packageRoot,
		dir,
		"hooks/plan-package.cjs",
		["ready", "."],
		{ assignments: {} },
		commandEnv,
	);
	const closeout = node(
		packageRoot,
		dir,
		"hooks/closeout.cjs",
		[],
		handoff,
		commandEnv,
	);
	const blocked = node(
		packageRoot,
		dir,
		"hooks/closeout.cjs",
		[],
		{
			...handoff,
			mode: "protected_completion",
			required_assurance: ["Validator"],
			candidate_matched: false,
		},
		commandEnv,
	);
	const manifest = node(
		packageRoot,
		dir,
		renderer,
		["implementation.json", "--out", canonical],
		undefined,
		commandEnv,
	);
	const check = node(
		packageRoot,
		dir,
		renderer,
		["implementation.json", "--out", canonical, "--check"],
		undefined,
		commandEnv,
	);
	for (const result of [draft, wave, ready, closeout, blocked, manifest, check])
		success(result);
	assert.equal(JSON.parse(draft.stdout).outcome, "PASS");
	assert.equal(JSON.parse(wave.stdout).outcome, "PASS");
	assert.deepEqual(JSON.parse(ready.stdout).ready, ["SYN-S1"]);
	assert.equal(JSON.parse(closeout.stdout).reason, "handoff_complete");
	assert.equal(JSON.parse(blocked.stdout).outcome, "BLOCK");
	const files = snapshot(dir);
	const html = readFileSync(path.join(dir, canonical), "utf8");
	assert.match(html, /Sample review/);
	assert.deepEqual(
		files,
		{ ...beforeFiles, [canonical]: sha(html) },
		"Only the canonical manifest may be written",
	);
	return {
		draft: observe(draft, dir),
		wave: observe(wave, dir),
		ready: observe(ready, dir),
		closeout: observe(closeout, dir),
		blocked: observe(blocked, dir),
		manifest: observe(manifest, dir),
		check: observe(check, dir),
		files,
	};
}

function archive(revision) {
	const dir = fresh();
	const tar = success(
		command("git", ["archive", revision], { cwd: root, encoding: null }),
	);
	success(command("tar", ["-xf", "-", "-C", dir], { input: tar.stdout }));
	return dir;
}

let baseline;
let golden;
before(() => {
	const original = archive(plannedBase);
	baseline = archive(mainBase);
	const left = fresh();
	const right = fresh();
	plan(left);
	plan(right);
	golden = core(baseline, right);
	assert.deepEqual(
		core(original, left),
		golden,
		"Both pinned baseline revisions must agree",
	);
});

test("BLX-VC-007 golden headless outputs at the two pinned revisions", (t) => {
	t.diagnostic(JSON.stringify({ plannedBase, mainBase, golden }));
});

function scratchPackage() {
	const dir = fresh();
	// Copy every package surface, including the optional guides. Never modify
	// the running checkout, and never include its .git directory.
	for (const rel of [
		"package.json",
		...load(path.join(root, "package.json")).files,
		"docs",
	]) {
		cpSync(path.join(root, rel), path.join(dir, rel), { recursive: true });
	}
	return dir;
}

function removeFiles(packageRoot, files) {
	for (const file of files) {
		const target = path.join(packageRoot, file);
		assert.ok(existsSync(target), `Expected pilot file: ${file}`);
		rmSync(target);
		assert.equal(existsSync(target), false);
	}
}

function withoutSection(packageRoot, file, heading) {
	const text = readFileSync(path.join(packageRoot, file), "utf8");
	const start = text.indexOf(`\n## ${heading}\n`);
	assert.notEqual(start, -1, `Missing optional section: ${heading}`);
	const next = text.indexOf("\n## ", start + 1);
	return {
		section: text.slice(start, next < 0 ? undefined : next),
		ordinary: text.slice(0, start) + (next < 0 ? "" : text.slice(next)),
	};
}

const skillSections = [
	[outline, "Change outline"],
	[loop, "Measured repair loop"],
];
const removals = {
	"Code Mode": (dir) =>
		removeFiles(dir, [
			"hooks/code-mode.cjs",
			"schemas/code-mode.schema.json",
			"docs/guides/code-mode.md",
		]),
	"Visual Manifest": (dir) => {
		// Visual is in the same file as the legacy renderer, not a removable
		// module. Roll back that pilot file alone, leaving all other candidate files.
		cpSync(path.join(baseline, renderer), path.join(dir, renderer));
	},
	Plannotator: (dir) =>
		removeFiles(dir, [
			"tools/plannotator-adapter.mjs",
			"tools/plannotator-relay.mjs",
			"schemas/owner-feedback.schema.json",
			"docs/guides/plannotator-review.md",
		]),
	"Skill text": (dir) => {
		for (const [file, heading] of skillSections) {
			const { ordinary } = withoutSection(dir, file, heading);
			writeFileSync(path.join(dir, file), ordinary);
			assert.equal(
				readFileSync(path.join(dir, file), "utf8"),
				ordinary,
				"Rollback must preserve the other sections",
			);
		}
	},
};

function coreMatches(packageRoot, dir, commandEnv = env, toolAvailable = true) {
	// Compare the plan the operator just used, including any permitted pilot artifacts.
	const bin = fresh();
	const marker = path.join(bin, "ordinary-tool-call");
	if (toolAvailable) {
		writeFileSync(
			path.join(bin, "plannotator"),
			`#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "called")\n`,
			{ mode: 0o700 },
		);
		commandEnv = {
			...commandEnv,
			PATH: bin + path.delimiter + commandEnv.PATH,
		};
	}
	const reference = fresh();
	cpSync(dir, reference, { recursive: true });
	assert.deepEqual(
		core(packageRoot, dir, commandEnv),
		core(baseline, reference, commandEnv),
	);
	assert.equal(
		existsSync(marker),
		false,
		"Ordinary commands must not start the review tool",
	);
}

function missingTools(names = []) {
	const dir = fresh();
	for (const name of names) {
		const found = success(command("which", [name])).stdout.trim();
		symlinkSync(found, path.join(dir, name));
	}
	return { ...env, PATH: dir };
}

const codeGolden = load(path.join(fixtures, "code-mode/golden.json"))[
	"ready-set"
];

async function codeMode(f, state) {
	const marker = path.join(f.control, "direct.log");
	const before = snapshot(f.workspace);
	const req =
		state === "missing"
			? program("missing-systemd", "return 1;")
			: request(state, "ready-set", readyInput);
	const run = await start(
		f,
		req,
		state === "missing"
			? { extraEnv: { PATH: missingTools(["flock"]).PATH } }
			: {},
	).result;
	const out = parseOutcome(run);
	assert.equal(out.request_id, req.request_id);
	assert.deepEqual(
		snapshot(f.workspace),
		before,
		"Read-only call must preserve workspace",
	);
	if (state === "missing") {
		assert.equal(run.code, 1);
		assert.equal(out.status, "WAITING_ON");
		assert.equal(out.error?.code, "sandbox_unavailable");
		assert.equal(existsSync(marker), false);
		return;
	}
	assert.equal(run.code, 0, run.stderr);
	assert.equal(out.status, "COMPLETE");
	assert.equal(out.mode, state === "enabled" ? "runtime" : "direct");
	assert.equal(evidence(f, out, "call", "ready-set").toString(), codeGolden);
	if (state === "disabled")
		assert.equal(readFileSync(marker, "utf8"), "ready-set\n");
	else assert.equal(existsSync(marker), false);
}

function visualMode(state, packageRoot, dir) {
	const before = snapshot(dir);
	if (state === "enabled") {
		success(render(packageRoot, dir, true, visual));
		const output = readFileSync(path.join(dir, visual), "utf8");
		assert.match(output, /id="case-SEIT-SYN-001"/);
		assert.match(output, /href="#case-SEIT-SYN-001"/);
		assert.deepEqual(snapshot(dir), { ...before, [visual]: sha(output) });
	} else if (state === "missing") {
		const seit = path.join(dir, "seit.json");
		const parked = path.join(temp, "missing-seit.json");
		renameSync(seit, parked);
		try {
			const failed = render(packageRoot, dir, true, visual);
			assert.equal(failed.status, 1);
			assert.match(failed.stderr, /ENOENT.*seit\.json/);
			assert.equal(existsSync(path.join(dir, visual)), false);
			const result = success(render(packageRoot, dir));
			assert.deepEqual(observe(result, dir), golden.manifest);
			assert.equal(
				sha(readFileSync(path.join(dir, canonical))),
				golden.files[canonical],
			);
		} finally {
			renameSync(parked, seit);
		}
	} else if (state === "removed") {
		const failed = render(packageRoot, dir, true, visual);
		assert.equal(failed.status, 2);
		assert.match(failed.stderr, /USAGE: Unknown flag: --visual/);
		assert.deepEqual(snapshot(dir), before);
	} else {
		const result = success(render(packageRoot, dir));
		assert.deepEqual(observe(result, dir), golden.manifest);
		assert.deepEqual(snapshot(dir), {
			...before,
			[canonical]: golden.files[canonical],
		});
	}
}

function adapterMode(state, packageRoot, dir, candidate) {
	const scratch = fresh();
	const feedback = fresh();
	const bin = fresh();
	const at = "2026-01-01T00:00:00.000Z";
	const ownerSession = {
		owner_identity: "sample-owner",
		harness: "codex",
		session_id: "sample-session",
	};
	const stop = {
		record_type: "owner_stop",
		id: "SAMPLE-STOP",
		class: "E",
		question: "Accept this sample?",
		why_owner: "Candidate review",
		evidence_ref: candidate.candidate_digest,
		...candidate,
		affected_slices: ["SYN-S1"],
		blocking: true,
		status: "asked",
		created_at: at,
		asked_at: at,
		answered_at: null,
		cancelled_at: null,
		round_trip_id: "sample-round",
		owner_session: ownerSession,
	};
	save(path.join(dir, "journey.json"), {
		owner_wait_tracking: true,
		owner_blocked_intervals: [],
		decisions: [],
		open_decisions: [stop],
	});
	save(path.join(dir, "authority.json"), {
		state: "proposed",
		effective: false,
		granting_owner_decisions: [],
	});
	if (state === "enabled") success(render(packageRoot, dir, true, visual));
	if (state === "enabled" || state === "disabled") {
		const fake = readFileSync(
			path.join(fixtures, "plannotator/fake-plannotator.cjs"),
			"utf8",
		);
		const scenario = {
			scratchRoot: scratch,
			bundle: [
				"plan.md",
				"seit.json",
				"implementation.json",
				visual,
				"revision-diff.md",
			],
		};
		writeFileSync(
			path.join(bin, "plannotator"),
			`#!${process.execPath}\n${fake.replace("const scenario = {};", () => `const scenario = ${JSON.stringify(scenario)};`)}`,
			{ mode: 0o700 },
		);
	}
	const before = snapshot(dir);
	const req = {
		...(state === "disabled" ? {} : { enabled: true }),
		plan_dir: dir,
		visual_path: visual,
		feedback_dir: feedback,
		candidate,
		owner_stop_id: stop.id,
		owner_session: {
			...ownerSession,
			payload: { session_id: ownerSession.session_id },
		},
	};
	if (state !== "removed") {
		const result = node(
			packageRoot,
			dir,
			"tools/plannotator-adapter.mjs",
			[],
			req,
			{
				...env,
				PATH:
					state === "missing"
						? bin
						: `${bin}${path.delimiter}${process.env.PATH}`,
				TMPDIR: scratch,
			},
		);
		const outcome = JSON.parse(result.stdout);
		if (state === "enabled") {
			assert.equal(result.status, 0, result.stdout + result.stderr);
			assert.equal(outcome.status, "answer_delivered");
			assert.equal(outcome.answer.kind, "approve_intent");
			assert.equal(outcome.answer.candidate_digest, candidate.candidate_digest);
			assert.equal(outcome.answer.owner_stop_id, stop.id);
			const records = readFileSync(
				path.join(feedback, candidate.candidate_digest, "feedback.jsonl"),
				"utf8",
			)
				.trim()
				.split("\n")
				.map(JSON.parse);
			assert.equal(records.length, 1);
			assert.equal(records[0].kind, "approve_intent");
			assert.equal(records[0].request_id, outcome.answer.request_id);
			assert.match(
				result.stderr,
				/Review ready at http:\/\/127\.0\.0\.1:\d+\//,
			);
		} else {
			assert.equal(result.status, 1, result.stdout + result.stderr);
			assert.deepEqual(outcome, {
				status: "fallback",
				reason: state === "disabled" ? "disabled" : "unavailable",
			});
			assert.doesNotMatch(result.stderr, /Review ready at/);
			assert.deepEqual(snapshot(feedback), {});
		}
	}
	assert.deepEqual(
		snapshot(dir),
		before,
		"The owner stop and authority remain unchanged",
	);
	assert.deepEqual(readdirSync(scratch), []);
	// The actual ordinary gate is still pending, even after an approve intent.
	const pending = success(
		node(packageRoot, dir, "hooks/owner-stops.cjs", ["journey.json", at]),
	);
	assert.equal(JSON.parse(pending.stdout).pending, 1);
	const baselinePending = success(
		node(baseline, dir, "hooks/owner-stops.cjs", ["journey.json", at]),
	);
	assert.deepEqual(observe(pending, dir), observe(baselinePending, dir));
}

function skillMode(t, state, packageRoot) {
	if (state === "removed") {
		for (const [file, heading] of skillSections) {
			const text = readFileSync(path.join(packageRoot, file), "utf8");
			assert.ok(
				!text.split("\n").includes(`## ${heading}`),
				"The removed technique is still offered",
			);
		}
		return;
	}
	for (const [file, heading] of skillSections) {
		const { section, ordinary } = withoutSection(packageRoot, file, heading);
		assert.ok(
			!ordinary.split("\n").includes(`## ${heading}`),
			"The technique must have a single opt-in section",
		);
		if (file === outline) {
			assert.match(section, /only when the owner explicitly requests one/);
			assert.match(
				section,
				/Omit that section for a review without an outline request/,
			);
			assert.match(section, /lacks evidence, mark it as a gap/);
		} else {
			assert.match(section, /only when a packet opts in/);
			assert.match(section, /reruns the same command/);
			assert.match(section, /exhausted allowance\s+leaves the failure open/);
		}
	}
	if (state === "enabled") {
		const result = success(
			command(
				process.execPath,
				[
					"--test",
					"--test-name-pattern=^(review outline|measured repair loop):",
					"test/humanlayer-adoption.test.mjs",
				],
				{ cwd: root },
			),
		);
		assert.match(result.stdout, /^ok \d+ - review outline:/m);
		assert.match(result.stdout, /^ok \d+ - measured repair loop:/m);
		assert.match(result.stdout, /^# fail 0$/m);
	}
	if (state === "missing")
		t.diagnostic(
			"Instruction-only pilot: no external executable; missing view evidence remains a gap in the existing outline.",
		);
}

for (const [pilot, remove] of Object.entries(removals)) {
	for (const state of ["enabled", "disabled", "missing", "removed"]) {
		test(`BLX-VC-007 ${pilot}: ${state}`, async (t) => {
			const packageRoot = state === "removed" ? scratchPackage() : root;
			if (state === "removed") remove(packageRoot);
			const runtime =
				pilot === "Code Mode" && state !== "removed"
					? codeFixture(t, {
							code_mode: state === "disabled" ? undefined : true,
						})
					: null;
			const dir = runtime?.plan ?? fresh();
			const candidate = plan(dir);
			await t.test("pilot entry", async (entry) => {
				if (runtime) await codeMode(runtime, state);
				else if (pilot === "Code Mode")
					assert.equal(
						existsSync(path.join(packageRoot, "hooks/code-mode.cjs")),
						false,
					);
				if (pilot === "Visual Manifest") visualMode(state, packageRoot, dir);
				if (pilot === "Plannotator")
					adapterMode(state, packageRoot, dir, candidate);
				if (pilot === "Skill text") skillMode(entry, state, packageRoot);
			});
			await t.test(
				"headless planning, dispatch and closeout match the baseline",
				() => {
					const commandEnv = state === "missing" ? missingTools() : env;
					coreMatches(
						packageRoot,
						dir,
						{
							...commandEnv,
							HOME: runtime?.home ?? commandEnv.HOME,
						},
						state !== "missing",
					);
				},
			);
		});
	}
}

test("BLX-VC-007 all four pilots removed together", () => {
	const dir = scratchPackage();
	const shared = path.join(dir, outline);
	const retained =
		"\n## Ordinary fixture section\n\nKeep this independent guidance.\n";
	writeFileSync(shared, readFileSync(shared, "utf8") + retained);
	for (const remove of Object.values(removals)) remove(dir);
	assert.ok(
		readFileSync(shared, "utf8").endsWith(retained),
		"Rollback lost independent guidance",
	);
	const planDir = fresh();
	plan(planDir);
	coreMatches(dir, planDir);
});

test("BLX-VC-007 ordinary package contracts after combined removal", (t) => {
	const dir = scratchPackage();
	for (const remove of Object.values(removals)) remove(dir);
	cpSync(path.join(root, "test"), path.join(dir, "test"), { recursive: true });
	const suites = [
		"plan-package",
		"dispatch-record",
		"dod-manifest",
		"gate-chain",
		"hook-contract",
		"orchestration-resilience",
		"reviewer-evidence",
		"skills-conformance",
	];
	const result = success(
		command(
			process.execPath,
			["--test", ...suites.map((name) => `test/${name}.test.mjs`)],
			{ cwd: dir },
		),
	);
	assert.match(result.stdout, /^# fail 0$/m);
	assert.match(result.stdout, /^# pass [1-9]\d*$/m);
	t.diagnostic(
		result.stdout.match(/^# (?:tests|pass|fail|skipped) \d+$/gm).join("; "),
	);
});
