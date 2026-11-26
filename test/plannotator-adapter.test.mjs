import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { offlineSkip } from "./fixtures/code-mode/fixture.mjs";
import { plannotatorIsolation } from "./fixtures/plannotator/isolation-probe.mjs";
import {
	planningSessions,
	unreviewedPlanningWave,
} from "./planning-contract-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const adapter = path.join(root, "tools/plannotator-adapter.mjs");
const fixtures = path.join(root, "test/fixtures");
const fixtureDir = path.join(fixtures, "plannotator");
const require = createRequire(import.meta.url);
const {
	evaluateOwnerStop,
	ownerWaitMetrics,
} = require("../hooks/owner-stops.cjs");
const { evaluatePlanningReview } = require("../hooks/planning-review.cjs");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const saveJson = (file, value) => writeFileSync(file, JSON.stringify(value));
const harnesses = readJson(path.join(fixtureDir, "harnesses.json"));
// One real isolated start per process. Tests that reach the adapter's checks
// need its isolation tool; tests that open a review need the isolated start.
const isolation = await plannotatorIsolation();
const checks = { skip: isolation.tools };
const review = { skip: isolation.review };
// The isolated caller runs the adapter under `unshare -rn`.
const isolatedCaller = { skip: isolation.review || offlineSkip() };
const fakeSource = readFileSync(
	path.join(fixtureDir, "fake-plannotator.cjs"),
	"utf8",
);
const reviewEnvironment = {
	PLANNOTATOR_REMOTE: "0",
	PLANNOTATOR_TAILSCALE: "0",
	PLANNOTATOR_SHARE: "disabled",
	PLANNOTATOR_AI: "disabled",
	PLANNOTATOR_BROWSER: "none",
	PLANNOTATOR_INBOX_CONNECT: "0",
	PLANNOTATOR_INBOX_NOTES: "0",
	PLANNOTATOR_ANNOTATE_HISTORY: "0",
	PLANNOTATOR_FEEDBACK_HISTORY: "0",
	PLANNOTATOR_AUTO_UPDATE: "0",
	PLANNOTATOR_UPDATE_CHECK: "0",
	PLANNOTATOR_JINA: "0",
	NO_ANON_PING: "1",
};
const view = "sample-visual.html";
const files = [
	"plan.md",
	"design.md",
	"requirements.sdoc",
	"seit.json",
	"implementation.json",
	view,
];
const firstNote = {
	file: "plan.md",
	line: 3,
	selection: "Keep sample A.",
	body: "Clarify this sample.",
};
const secondNote = {
	file: "design.md",
	line: 3,
	selection: "Use sample B.",
	body: "Explain this choice.",
};

function node(script, args, cwd) {
	const result = spawnSync(
		process.execPath,
		[path.join(root, script), ...args],
		{
			cwd,
			encoding: "utf8",
			timeout: 15_000,
		},
	);
	assert.ifError(result.error);
	return result;
}

function draft(dir) {
	const result = node("hooks/plan-package.cjs", ["draft", dir], dir);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	const receipt = JSON.parse(result.stdout);
	assert.equal(receipt.outcome, "PASS");
	return receipt;
}

function tree(dir) {
	return Object.fromEntries(
		readdirSync(dir, { recursive: true, withFileTypes: true }).map((entry) => {
			const absolute = path.join(entry.parentPath, entry.name);
			return [
				path.relative(dir, absolute),
				entry.isDirectory()
					? "directory"
					: entry.isSymbolicLink()
						? `link:${readlinkSync(absolute)}`
						: hash(readFileSync(absolute)),
			];
		}),
	);
}

function packageAt(
	dir,
	revision = "a".repeat(40),
	content = "Keep sample A.",
	requested = false,
	nested = false,
) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(nested ? path.dirname(dir) : dir, ".git"),
		"synthetic worktree marker\n",
	);
	const input = {
		"plan.md": `## SAMPLE-A\n\n${content}\n\n## CONSTANT\n\nUnchanged specimen QXZ.\n`,
		"design.md": "## SAMPLE-B\n\nUse sample B.\n",
		"requirements.sdoc": "[DOCUMENT]\nTITLE: Sample requirements\n",
	};
	for (const [name, bytes] of Object.entries(input))
		writeFileSync(path.join(dir, name), bytes);
	const { implementation: doc, seit } = readJson(
		path.join(fixtures, "planning-repair-package.json"),
	);
	doc.source_baseline.candidate_revision = revision;
	doc.source_baseline.revision = revision;
	seit.source_baseline.candidate_revision = revision;
	seit.source_baseline.planning_inputs = Object.entries(input).map(
		([name, bytes]) => ({
			path: nested ? path.join(path.basename(dir), name) : name,
			sha256: hash(bytes),
		}),
	);
	seit.proof_cases = [
		{
			id: "SYN-VC-001",
			requirement_id: "SYN-REQ-001",
			observable_evidence: "design.md",
		},
	];
	const seitBytes = JSON.stringify(seit);
	const digest = hash(
		[...Object.values(input).map(hash), hash(seitBytes)].join("\n"),
	);
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
		output_name: "sample-dod-manifest.html",
		title: "Sample review",
		requirements: [
			{ id: "SYN-REQ-001", statement: "Keep a sample.", status: "PLANNED" },
		],
		architecture: [{ id: "SYN-DES-001", decision: "Use a sample record." }],
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
	saveJson(path.join(dir, "seit.json"), seit);
	saveJson(path.join(dir, "implementation.json"), doc);
	const render = (name, visual = false) => {
		const result = node(
			"tools/render-dod-manifest.mjs",
			["implementation.json", "--out", name, ...(visual ? ["--visual"] : [])],
			dir,
		);
		assert.equal(result.status, 0, result.stderr + result.stdout);
	};
	render(doc.dod_manifest.output_name);
	render(view, true);
	let review;
	if (requested) {
		review = {
			candidate,
			plan_dir: dir,
			dod_manifest: { output_name: doc.dod_manifest.output_name },
			planning_wave: planningSessions(candidate, []),
			reviewer_slots: [
				{
					slot_id: "sample-reviewer",
					primary_route_ref: "sample-route",
					fallback_route_refs: [],
				},
			],
			round_number: 1,
			completed_rounds: 1,
			aggregated_repairs: 0,
			aggregation_complete: true,
			receipts: [
				{
					slot_id: "sample-reviewer",
					selected_route_ref: "sample-route",
					...candidate,
					independent: true,
					findings_isolated: true,
					verdict: "ACCEPT",
				},
			],
		};
		mkdirSync(path.join(dir, "gate-evidence"), { recursive: true });
		const receipt = "gate-evidence/planning-review.json";
		saveJson(path.join(dir, receipt), review);
		doc.journey_settings.planning_wave = {
			...planningSessions(candidate, []),
			review_requested: true,
			reviews: 1,
			repairs: 0,
			closure: "deterministic_PASS",
			candidate_digest: digest,
			closing_candidate: candidate,
			review_receipt: {
				path: receipt,
				sha256: hash(readFileSync(path.join(dir, receipt))),
			},
		};
		saveJson(path.join(dir, "implementation.json"), doc);
		render(doc.dod_manifest.output_name);
		render(view, true);
		assert.equal(evaluatePlanningReview(review).outcome, "PASS");
	}
	assert.equal(draft(dir).manifest_digest, digest);
	return { candidate, review };
}

function stopRecord(candidate) {
	const at = new Date().toISOString();
	return {
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
		round_trip_id: "sample-review-round",
	};
}

function authority(candidate, grant) {
	const envelope = {
		schema_version: "1",
		schema: "authority",
		id: "SAMPLE-AUTHORITY",
		state: grant ? "active" : "proposed",
		effective: Boolean(grant),
		subject: { journey: "sample-review" },
		repositories: [],
		baseline: candidate,
		granting_owner_decisions: grant ? ["SAMPLE-PREVIOUS"] : [],
		allowed: { scope: ["sample"], actions: [], paths: [] },
		prohibited: { scope: [], actions: [], paths: [] },
		role_grants: [],
		expiry_conditions: ["owner revokes"],
		supersedes: [],
		approval_receipt: grant ? { ref: "sample-prior-answer" } : {},
	};
	if (grant)
		envelope.continuation = {
			granted: true,
			owner_decision_id: "SAMPLE-PREVIOUS",
			expires_at: null,
			exclusions: [
				"scope_change",
				"budget_exhaustion",
				"owner_hold",
				"owner_only_actions",
			],
		};
	if (grant === "malformed") envelope.continuation.granted = "yes";
	if (grant === "expired")
		envelope.continuation.expires_at = "2000-01-01T00:00:00Z";
	return envelope;
}

function continuationCheck(envelope) {
	return evaluateOwnerStop({
		class: "D",
		blocking: true,
		evidence_ref: "sample",
		resolution_ref: "sample",
		authority: envelope,
		checked_at: new Date().toISOString(),
		checks: {
			scope: true,
			budget: true,
			exclusions: true,
			expiry: true,
			owner_hold: true,
		},
	});
}

function makeFake(bin, scenario) {
	const executable = path.join(bin, "plannotator");
	writeFileSync(
		executable,
		`#!${process.execPath}\n${fakeSource.replace("const scenario = {};", () => `const scenario = ${JSON.stringify(scenario)};`)}`,
		{ mode: 0o700 },
	);
	return executable;
}

function sessionFixture(plan, scenario) {
	return {
		bundle: files,
		sourceDir: plan,
		scratchRoot: path.join(path.dirname(plan), "scratch"),
		displayDigests: Object.fromEntries(
			files.map((name) => [name, hash(readFileSync(path.join(plan, name)))]),
		),
		environment: reviewEnvironment,
		...scenario,
	};
}

function releaseFixture(stderr, scratch) {
	const announced = /Fixture release file ([^\r\n]+)\r?\n/.exec(stderr);
	if (!announced) return null;
	const marker = JSON.parse(announced[1]);
	assert.ok(path.isAbsolute(marker) && marker.endsWith(".fixture-release"));
	const parent = realpathSync(path.dirname(marker));
	const relative = path.relative(realpathSync(scratch), parent);
	assert.ok(
		relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative),
		"Release only a marker inside test scratch",
	);
	return path.join(parent, path.basename(marker));
}

function fixture(
	t,
	{
		host = "claude-code",
		scenario = {},
		grant = null,
		requested = false,
		absent = false,
		nested = false,
	} = {},
) {
	const dir = mkdtempSync(path.join(tmpdir(), "bearing-review-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const plan = path.join(dir, "plan");
	const feedback = path.join(dir, "owner-review");
	const home = path.join(dir, "home");
	const bin = path.join(dir, "bin");
	const scratch = path.join(dir, "scratch");
	for (const name of [
		feedback,
		bin,
		scratch,
		path.join(home, ".claude"),
		path.join(home, ".codex"),
	])
		mkdirSync(name, { recursive: true });
	saveJson(path.join(home, ".claude/settings.json"), { hooks: {} });
	writeFileSync(
		path.join(home, ".codex/config.toml"),
		"[features]\nhooks = true\n",
	);
	const { candidate, review } = packageAt(
		plan,
		undefined,
		undefined,
		requested,
		nested,
	);
	const stop = stopRecord(candidate);
	const ownerSession = {
		owner_identity: "sample-owner",
		harness: host,
		session_id: harnesses[host].session_id,
	};
	// Synthetic stand-in for the existing caller's bound owner context. This is
	// not an authentication mechanism and does not grant authority.
	stop.owner_session = ownerSession;
	const journey = {
		schema_version: "1",
		journey: {
			id: "sample-review",
			title: "Sample",
			status: "planning",
			planning_repository: "example/bearing-lite",
		},
		checkout_lease: {
			journey: "sample-review",
			controller: "sample-controller",
			repository: "example/bearing-lite",
			checkout: plan,
			branch: "synthetic-branch",
			candidate_revision: candidate.candidate_revision,
			acquired_at: stop.created_at,
			generation: 1,
			state: "active",
		},
		profile_selection: {},
		planning_receipts: [],
		owner_wait_tracking: true,
		owner_blocked_intervals: [],
		decisions: grant
			? [{ id: "SAMPLE-PREVIOUS", answer: "Prior sample approved" }]
			: [],
		open_decisions: [stop],
	};
	const envelope = authority(candidate, grant);
	saveJson(path.join(plan, "journey.json"), journey);
	saveJson(path.join(plan, "authority.json"), envelope);
	assert.equal(evaluateOwnerStop(stop).disposition, "ASK");
	assert.equal(ownerWaitMetrics(journey, new Date().toISOString()).pending, 1);
	if (grant) {
		const check = continuationCheck(envelope);
		assert.equal(
			check.reason,
			{
				valid: "approved_resolution",
				malformed: "continuation_grant_missing",
				expired: "continuation_expired",
			}[grant],
		);
	}
	if (!absent) makeFake(bin, sessionFixture(plan, scenario));
	// Accidental external launches through PATH leave an observable fixture file.
	for (const executable of [
		"bearing-launch",
		"claude",
		"codex",
		"xdg-open",
		"open",
	]) {
		writeFileSync(
			path.join(bin, executable),
			`#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(path.join(home, `unexpected-${executable}`))}, "launched");\nprocess.exitCode = 2;\n`,
			{ mode: 0o700 },
		);
	}
	const env = {
		PATH: absent ? bin : `${bin}${path.delimiter}${process.env.PATH}`,
		HOME: home,
		CODEX_HOME: path.join(home, ".codex"),
		TMPDIR: scratch,
		LANG: "C",
		DISPLAY: ":fixture",
		PLANNOTATOR_SHARE: "enabled",
		PLANNOTATOR_REMOTE: "1",
	};
	const request = {
		enabled: true,
		plan_dir: plan,
		feedback_dir: feedback,
		visual_path: view,
		candidate,
		owner_stop_id: stop.id,
		owner_session: {
			...ownerSession,
			payload: { ...harnesses[host], cwd: plan },
		},
	};
	return {
		dir,
		plan,
		feedback,
		home,
		bin,
		scratch,
		env,
		request,
		candidate,
		journey,
		envelope,
		review,
		stop,
		freeze: draft(plan),
	};
}

async function invoke(
	t,
	command,
	args,
	options,
	input = "",
	onProgress = () => {},
) {
	const child = spawn(command, args, {
		...options,
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "",
		stderr = "",
		progressError;
	const completed = new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("close", (status, signal) => resolve({ status, signal }));
	});
	const kill = () => {
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
	};
	t.after(kill);
	child.stdout.setEncoding("utf8").on("data", (data) => {
		stdout += data;
	});
	child.stderr.setEncoding("utf8").on("data", (data) => {
		stderr += data;
		try {
			onProgress(stderr);
		} catch (error) {
			progressError = error;
			kill();
		}
	});
	// A gate can refuse before consuming stdin; its typed response remains observable.
	child.stdin.on("error", (error) => {
		if (error.code !== "EPIPE") progressError = error;
	});
	child.stdin.end(input);
	const deadline = setTimeout(kill, 25_000);
	let ending;
	try {
		ending = await completed;
	} finally {
		clearTimeout(deadline);
	}
	assert.ifError(progressError);
	return { ...ending, stdout, stderr };
}

function readFeedback(fx, before, startedAt) {
	const digest = fx.candidate.candidate_digest;
	const store = path.join(fx.feedback, digest, "feedback.jsonl");
	const records = existsSync(store)
		? readFileSync(store, "utf8")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map(JSON.parse)
		: [];
	const allowed = { ...before };
	if (existsSync(store)) {
		allowed[digest] = "directory";
		allowed[`${digest}/feedback.jsonl`] = hash(readFileSync(store));
	}
	assert.deepEqual(
		tree(fx.feedback),
		allowed,
		"Only feedback for the bound candidate may change",
	);
	for (const record of records) {
		assert.equal(record.candidate_digest, digest);
		assert.equal(record.revision, fx.candidate.candidate_revision);
		assert.ok(
			typeof record.artifact_path === "string" &&
				record.artifact_path.length > 0,
		);
		assert.ok(
			typeof record.section_id === "string" && record.section_id.length > 0,
		);
		assert.ok(
			typeof record.request_id === "string" && record.request_id.length > 0,
		);
		assert.ok(
			Date.parse(record.timestamp) >= startedAt - 1000 &&
				Date.parse(record.timestamp) <= Date.now(),
		);
		assert.match(
			record.timestamp,
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/,
		);
	}
	return records;
}

// Public adapter CLI: JSON request on stdin, one JSON outcome on stdout, local
// review URL on stderr. The session context belongs to the calling owner
// procedure; neither hook payload nor process output is an authority grant.
async function runAdapter(t, fx, { onOpen, isolatedCaller = false } = {}) {
	const protectedTree = () =>
		Object.fromEntries(
			Object.entries(tree(fx.dir)).filter(
				([name]) =>
					!["owner-review/", "plan/", "scratch/"].some((prefix) =>
						name.startsWith(prefix),
					),
			),
		);
	const expected = protectedTree();
	const scratchBefore = tree(fx.scratch);
	const feedbackBefore = tree(fx.feedback);
	let expectedPlan = tree(fx.plan);
	assert.ok(
		existsSync(adapter),
		"Missing behavior: tools/plannotator-adapter.mjs is not implemented yet",
	);
	const startedAt = Date.now();
	const command = isolatedCaller ? "unshare" : process.execPath;
	const args = isolatedCaller ? ["-rn", process.execPath, adapter] : [adapter];
	let ready = false;
	const progress = (stderr) => {
		if (!onOpen || ready) return;
		const marker = releaseFixture(stderr, fx.scratch);
		if (!marker) return;
		assert.match(stderr, /Review ready at http:\/\/127\.0\.0\.1:\d+\//);
		ready = true;
		assert.deepEqual(
			tree(fx.plan),
			expectedPlan,
			"Sources unchanged before fixture correction",
		);
		onOpen();
		expectedPlan = tree(fx.plan);
		writeFileSync(marker, "released", { flag: "wx" });
	};
	const { status, signal, stdout, stderr } = await invoke(
		t,
		command,
		args,
		{ cwd: fx.plan, env: fx.env },
		JSON.stringify(fx.request),
		progress,
	);
	assert.equal(signal, null, stderr);
	assert.ok([0, 1].includes(status), stdout + stderr);
	if (onOpen) assert.ok(ready, "Review never reached a live local session");
	assert.deepEqual(
		protectedTree(),
		expected,
		"Only pending feedback may persist",
	);
	assert.deepEqual(
		tree(fx.plan),
		expectedPlan,
		"Frozen package and authority are read-only",
	);
	assert.deepEqual(
		tree(fx.scratch),
		scratchBefore,
		"Temporary review data removed",
	);
	return {
		result: JSON.parse(stdout),
		records: readFeedback(fx, feedbackBefore, startedAt),
		stderr,
	};
}

function noApproval(fx, run, status, reason) {
	assert.equal(run.result.status, status);
	if (reason) assert.equal(run.result.reason, reason);
	assert.ok(!run.result.answer, "No owner answer delivered");
	assert.ok(run.records.every(({ kind }) => kind !== "approve_intent"));
	assert.deepEqual(readJson(path.join(fx.plan, "journey.json")), fx.journey);
	assert.deepEqual(readJson(path.join(fx.plan, "authority.json")), fx.envelope);
}

function approve(fx, run) {
	assert.equal(run.result.status, "answer_delivered", run.stderr);
	const answer = run.result.answer;
	assert.equal(answer.kind, "approve_intent");
	assert.equal(answer.candidate_digest, fx.candidate.candidate_digest);
	assert.equal(answer.revision, fx.candidate.candidate_revision);
	assert.equal(answer.owner_stop_id, fx.stop.id);
	assert.equal(answer.owner_identity, fx.request.owner_session.owner_identity);
	assert.equal(answer.session_id, fx.request.owner_session.payload.session_id);
	assert.ok(
		typeof answer.request_id === "string" && answer.request_id.length > 0,
	);
	const intents = run.records.filter(({ kind }) => kind === "approve_intent");
	assert.equal(intents.length, 1, "One approval intent");
	assert.equal(intents[0].request_id, answer.request_id);
	assert.equal(
		ownerWaitMetrics(
			readJson(path.join(fx.plan, "journey.json")),
			new Date().toISOString(),
		).pending,
		1,
	);
	assert.deepEqual(readJson(path.join(fx.plan, "authority.json")), fx.envelope);
}

function changes(fx, run, notes) {
	noApproval(fx, run, "changes_requested");
	assert.deepEqual(
		run.records.map(({ artifact_path, section_id, kind, body }) => ({
			artifact_path,
			section_id,
			kind,
			body,
		})),
		notes.map((note) => ({
			artifact_path: note.file,
			section_id: note.file === "plan.md" ? "SAMPLE-A" : "SAMPLE-B",
			kind: "request_changes",
			body: note.body,
		})),
	);
	assert.equal(
		new Set(run.records.map(({ request_id }) => request_id)).size,
		1,
	);
}

// Observed counts: fixture gate invocations and served review gates from the
// relayed fixture output; owner stops, decisions and grants from the files.
function gateCounts(fx, run) {
	const journey = readJson(path.join(fx.plan, "journey.json"));
	const envelope = readJson(path.join(fx.plan, "authority.json"));
	return {
		invocations: run.stderr.match(/Fixture invocation\r?\n/g)?.length ?? 0,
		gatesOpened:
			run.stderr.match(/Review ready at http:\/\/127\.0\.0\.1:\d+\//g)
				?.length ?? 0,
		ownerStops: [...journey.open_decisions, ...journey.decisions].filter(
			({ record_type }) => record_type === "owner_stop",
		).length,
		pendingStops: journey.open_decisions.filter(
			(stop) =>
				stop.id === fx.stop.id && evaluateOwnerStop(stop).disposition === "ASK",
		).length,
		decisionsRecorded: journey.decisions.length - fx.journey.decisions.length,
		grantsRecorded:
			envelope.granting_owner_decisions.length -
			fx.envelope.granting_owner_decisions.length,
		approveIntents: run.records.filter(({ kind }) => kind === "approve_intent")
			.length,
		answers: run.result.answer ? 1 : 0,
	};
}

function displayFixture(fx) {
	const snap = path.join(fx.scratch, "display");
	mkdirSync(snap);
	const targets = files.map((name) => {
		const target = path.join(snap, name);
		cpSync(path.join(fx.plan, name), target);
		return target;
	});
	const resultFile = path.join(fx.scratch, "result.json");
	const args = [
		"annotate",
		...targets,
		"--gate",
		"--json",
		"--require-approval",
		"--render-html",
		"--result-file",
		resultFile,
	];
	return { targets, resultFile, args };
}

for (const decision of ["approved", "annotated", "dismissed", "disconnected"])
	test(`fixture: frozen projection and strict local process (${decision})`, (t) => {
		const fx = fixture(t, {
			scenario: {
				decision,
				...(decision === "annotated" ? { annotations: [firstNote] } : {}),
				disconnect: decision === "disconnected",
			},
		});
		const { targets, resultFile, args } = displayFixture(fx);
		const run = spawnSync(path.join(fx.bin, "plannotator"), args, {
			env: { ...fx.env, ...reviewEnvironment },
			encoding: "utf8",
			timeout: 15_000,
		});
		assert.ifError(run.error);
		assert.match(run.stderr, /http:\/\/127\.0\.0\.1:\d+\//);
		if (decision === "disconnected") {
			assert.equal(run.signal, "SIGTERM");
			assert.equal(existsSync(resultFile), false);
			return;
		}
		assert.equal(run.status, decision === "approved" ? 0 : 1, run.stderr);
		const result = readJson(resultFile);
		assert.equal(result.decision, decision);
		if (decision === "annotated") {
			assert.match(
				result.feedback,
				/\(line 3\) Feedback on: "Keep sample A\."/,
			);
			assert.match(result.feedback, /Clarify this sample\./);
		}
		const stdout = JSON.parse(run.stdout);
		assert.equal(stdout.decision, result.decision);
		assert.equal(stdout.feedback, result.feedback);
		assert.deepEqual(stdout.target, targets);
		assert.deepEqual(draft(fx.plan), fx.freeze);
		t.diagnostic(
			"Fixture accepted by plan-package draft and S42 render; strict process returned from an OS-assigned loopback port.",
		);
	});

test("fixture: live-session release waits for a correction without sleeps", async (t) => {
	const fx = fixture(t, { scenario: { hold: true } });
	const { resultFile, args } = displayFixture(fx);
	let released = false;
	const run = await invoke(
		t,
		path.join(fx.bin, "plannotator"),
		args,
		{ env: { ...fx.env, ...reviewEnvironment }, cwd: fx.plan },
		"",
		(stderr) => {
			if (released) return;
			const marker = releaseFixture(stderr, fx.scratch);
			if (!marker) return;
			assert.match(stderr, /Review ready at http:\/\/127\.0\.0\.1:\d+\//);
			assert.equal(existsSync(resultFile), false);
			appendFileSync(
				path.join(fx.plan, "plan.md"),
				"\nSynthetic correction after readiness.\n",
			);
			writeFileSync(marker, "released", { flag: "wx" });
			released = true;
		},
	);
	assert.ok(released, run.stderr);
	assert.equal(run.status, 0, run.stderr);
	assert.equal(readJson(resultFile).decision, "approved");
	assert.equal(existsSync(`${resultFile}.fixture-release`), false);
});

test(
	"BLX-VC-080 immutable projection, unchanged draft, persisted typed annotation",
	review,
	async (t) => {
		const fx = fixture(t, {
			scenario: { decision: "annotated", annotations: [firstNote] },
		});
		const before = tree(fx.plan);
		const run = await runAdapter(t, fx);
		changes(fx, run, [firstNote]);
		assert.deepEqual(tree(fx.plan), before);
		assert.deepEqual(draft(fx.plan), fx.freeze);
	},
);

test("BLX-VC-082 known sections map", review, async (t) => {
	const fx = fixture(t, {
		scenario: { decision: "annotated", annotations: [firstNote, secondNote] },
	});
	changes(fx, await runAdapter(t, fx), [firstNote, secondNote]);
});

test("BLX-VC-082 unknown sections are rejected", review, async (t) => {
	const unknown = fixture(t, {
		scenario: {
			decision: "annotated",
			annotations: [{ ...firstNote, line: 999, selection: "Not displayed" }],
		},
	});
	const refused = await runAdapter(t, unknown);
	noApproval(unknown, refused, "rejected", "unmappable_annotation");
	assert.equal(refused.records.length, 0);
});

test(
	"BLX-VC-082 feedback from a different candidate is rejected",
	checks,
	async (t) => {
		const fx = fixture(t, {
			scenario: { decision: "annotated", annotations: [firstNote] },
		});
		fx.request.candidate = {
			...fx.candidate,
			candidate_digest: "f".repeat(64),
		};
		const run = await runAdapter(t, fx);
		noApproval(fx, run, "rejected", "stale_candidate");
		assert.equal(run.records.length, 0);
	},
);

test(
	"BLX-VC-082 approval comments remain guidance, not independent approvals",
	review,
	async (t) => {
		const fx = fixture(t, { scenario: { annotations: [firstNote] } });
		const run = await runAdapter(t, fx);
		approve(fx, run);
		const guidance = run.records.filter(({ kind }) => kind === "comment");
		assert.equal(guidance.length, 1);
		assert.equal(guidance[0].artifact_path, firstNote.file);
		assert.equal(guidance[0].section_id, "SAMPLE-A");
		assert.equal(guidance[0].body, firstNote.body);
	},
);

test("BLX-VC-083 initial view labelled", review, async (t) => {
	const initial = fixture(t, {
		scenario: { diff: { include: ["no prior review"], exclude: [] } },
	});
	approve(initial, await runAdapter(t, initial));
});

test(
	"BLX-VC-083 change diff compares with last reviewed revision",
	review,
	async (t) => {
		const fx = fixture(t, {
			scenario: { decision: "annotated", annotations: [firstNote] },
		});
		changes(fx, await runAdapter(t, fx), [firstNote]);
		const previous = fx.candidate;
		const previousDir = path.join(fx.dir, "previous");
		cpSync(fx.plan, previousDir, { recursive: true });
		// The controller corrects and revalidates the synthetic package, not the adapter.
		packageAt(fx.plan, "b".repeat(40), "Unreviewed intermediate.");
		fx.candidate = packageAt(
			fx.plan,
			"c".repeat(40),
			"Revised specimen.",
		).candidate;
		fx.request.candidate = fx.candidate;
		fx.request.last_reviewed = { plan_dir: previousDir, ...previous };
		Object.assign(fx.stop, fx.candidate, {
			evidence_ref: fx.candidate.candidate_digest,
		});
		fx.journey.checkout_lease.candidate_revision =
			fx.candidate.candidate_revision;
		fx.envelope.baseline = fx.candidate;
		saveJson(path.join(fx.plan, "journey.json"), fx.journey);
		saveJson(path.join(fx.plan, "authority.json"), fx.envelope);
		makeFake(
			fx.bin,
			sessionFixture(fx.plan, {
				diff: {
					include: [
						"Keep sample A.",
						"Revised specimen.",
						previous.candidate_digest,
						fx.candidate.candidate_digest,
					],
					exclude: ["Unreviewed intermediate.", "Unchanged specimen QXZ."],
				},
			}),
		);
		approve(fx, await runAdapter(t, fx));
	},
);

for (const [id, title, reason, modify, options] of [
	[
		"084",
		"different digest",
		"stale_candidate",
		(fx) => {
			fx.request.candidate = {
				...fx.candidate,
				candidate_digest: "f".repeat(64),
			};
		},
	],
	[
		"085",
		"missing owner identity",
		"missing_owner_identity",
		(fx) => {
			delete fx.request.owner_session.owner_identity;
		},
	],
	[
		"085",
		"missing session binding",
		"owner_session_mismatch",
		(fx) => {
			delete fx.request.owner_session.session_id;
			delete fx.request.owner_session.payload.session_id;
		},
	],
	[
		"087",
		"malformed continuation",
		"malformed_grant",
		() => {},
		{ grant: "malformed" },
	],
	[
		"087",
		"missing continuation for a later stop",
		"missing_grant",
		(fx) => {
			delete fx.envelope.continuation;
			saveJson(path.join(fx.plan, "authority.json"), fx.envelope);
			assert.equal(
				continuationCheck(fx.envelope).disposition,
				"NEEDS_MORE_EVIDENCE",
			);
		},
	],
	[
		"088",
		"no pending owner stop",
		"absent_stop",
		(fx) => {
			fx.journey.open_decisions = [];
			saveJson(path.join(fx.plan, "journey.json"), fx.journey);
		},
	],
	[
		"112",
		"expired continuation",
		"expired_grant",
		() => {},
		{ grant: "expired" },
	],
])
	test(`BLX-VC-${id} rejects approval: ${title}`, checks, async (t) => {
		const fx = fixture(t, { grant: "valid", ...options });
		modify(fx);
		const run = await runAdapter(t, fx);
		noApproval(fx, run, "rejected", reason);
		assert.equal(run.records.length, 0);
	});

test(
	"BLX-VC-086 source changes after the local review starts",
	review,
	async (t) => {
		const fx = fixture(t, { grant: "valid", scenario: { hold: true } });
		const run = await runAdapter(t, fx, {
			onOpen: () =>
				appendFileSync(
					path.join(fx.plan, "plan.md"),
					"\nSample changed during review.\n",
				),
		});
		noApproval(fx, run, "rejected", "changed_package");
	},
);

test(
	"BLX-VC-089 later pending owner answer binds valid continuation",
	review,
	async (t) => {
		const fx = fixture(t, { grant: "valid" });
		assert.equal(continuationCheck(fx.envelope).disposition, "CONTINUE");
		const run = await runAdapter(t, fx);
		approve(fx, run);
		assert.equal(run.result.answer.authority_id, fx.envelope.id);
		assert.equal(
			run.result.answer.granting_owner_decision_id,
			fx.envelope.continuation.owner_decision_id,
		);
		assert.equal(
			continuationCheck(readJson(path.join(fx.plan, "authority.json")))
				.disposition,
			"CONTINUE",
		);
	},
);

test(
	"BLX-VC-113 initial class E answer does not write new authority",
	review,
	async (t) => {
		const fx = fixture(t);
		assert.equal(fx.envelope.continuation, undefined);
		approve(fx, await runAdapter(t, fx));
		assert.equal(evaluateOwnerStop(fx.stop).disposition, "ASK");
		assert.equal(
			readJson(path.join(fx.plan, "authority.json")).effective,
			false,
		);
	},
);

for (const requested of [false, true])
	test(
		`BLX-VC-090 preserves ${requested ? "completed" : "declined"} independent review and single owner gate`,
		review,
		async (t) => {
			const fx = fixture(t, { requested });
			approve(fx, await runAdapter(t, fx));
			assert.deepEqual(draft(fx.plan), fx.freeze);
			const wave = readJson(path.join(fx.plan, "implementation.json"))
				.journey_settings.planning_wave;
			assert.equal(wave.reviews, requested ? 1 : 0);
			assert.equal(wave.repairs, 0);
			if (requested)
				assert.equal(evaluatePlanningReview(fx.review).outcome, "PASS");
		},
	);

test(
	"BLX-VC-090 incomplete requested planning review remains pending",
	checks,
	async (t) => {
		const fx = fixture(t, { requested: true });
		const docFile = path.join(fx.plan, "implementation.json");
		const doc = readJson(docFile);
		doc.journey_settings.planning_wave.reviews = 0;
		delete doc.journey_settings.planning_wave.review_receipt;
		saveJson(docFile, doc);
		fx.review.completed_rounds = 0;
		assert.equal(
			evaluatePlanningReview(fx.review).outcome,
			"NEEDS_MORE_EVIDENCE",
		);
		assert.equal(draft(fx.plan).outcome, "PASS");
		for (const [name, flags] of [
			[doc.dod_manifest.output_name, []],
			[view, ["--visual"]],
		]) {
			const rendered = node(
				"tools/render-dod-manifest.mjs",
				["implementation.json", "--out", name, ...flags],
				fx.plan,
			);
			assert.equal(rendered.status, 0, rendered.stderr + rendered.stdout);
		}
		makeFake(fx.bin, sessionFixture(fx.plan, {}));
		const run = await runAdapter(t, fx);
		noApproval(fx, run, "rejected", "planning_review_required");
	},
);

for (const mode of ["disabled", "absent", "enabled"])
	test(
		`BLX-VC-091 optional adapter ${mode}`,
		mode === "enabled" ? review : {},
		async (t) => {
			const fx = fixture(t, { absent: mode === "absent" });
			fx.request.enabled = mode !== "disabled";
			const run = await runAdapter(t, fx);
			if (mode === "enabled") {
				approve(fx, run);
				assert.match(run.stderr, /http:\/\/127\.0\.0\.1:\d+\//);
			} else {
				noApproval(
					fx,
					run,
					"fallback",
					mode === "absent" ? "unavailable" : "disabled",
				);
				assert.doesNotMatch(run.stderr, /Review ready at/);
				assert.equal(evaluateOwnerStop(fx.stop).disposition, "ASK");
			}
		},
	);

for (const isolated of [false, true])
	test(
		`BLX-VC-092 child review is local and sharing features are disabled (${isolated ? "isolated caller" : "normal caller"})`,
		isolated ? isolatedCaller : review,
		async (t) => {
			const fx = fixture(t, {
				scenario: {
					parentNetworkNamespace: readlinkSync("/proc/self/ns/net"),
					linkedEvidence: "## SAMPLE-B\n\nUse sample B.\n",
				},
			});
			const run = await runAdapter(t, fx, { isolatedCaller: isolated });
			approve(fx, run);
			assert.match(run.stderr, /http:\/\/127\.0\.0\.1:\d+\//);
		},
	);

for (const [title, note, reason] of [
	[
		"parent path",
		{ ...firstNote, file: "../sample-outside.md" },
		"path_outside_package",
	],
	[
		"unknown path",
		{ ...firstNote, file: "unknown.md" },
		"unmappable_annotation",
	],
	[
		"oversized note",
		{ ...firstNote, body: "x".repeat(1024 * 1024) },
		"oversized_feedback",
	],
])
	test(`BLX-VC-093 refuses ${title}`, review, async (t) => {
		const fx = fixture(t, {
			scenario: { decision: "annotated", annotations: [note] },
		});
		writeFileSync(
			path.join(fx.dir, "sample-outside.md"),
			"Unrelated synthetic specimen.\n",
		);
		const run = await runAdapter(t, fx);
		noApproval(fx, run, "rejected", reason);
		assert.equal(run.records.length, 0);
	});

// Deterministic generator (mulberry32): a failing variant reproduces from its seed.
function seeded(seed) {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let x = Math.imul(state ^ (state >>> 15), 1 | state);
		x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
		return ((x ^ (x >>> 14)) >>> 0) / 2 ** 32;
	};
}

test("BLX-VC-093 generated path and payload variants are refused with their typed reason", async (t) => {
	const seed = 0x5eed093;
	const random = seeded(seed);
	const pick = (items) => items[Math.floor(random() * items.length)];
	const count = (low, high) => low + Math.floor(random() * (high - low + 1));
	const fx = fixture(t);
	const outside = path.join(fx.dir, "sample-outside.md");
	writeFileSync(outside, "Unrelated synthetic specimen.\n");
	const targets = [
		"authority.json",
		"journey.json",
		"plan.md",
		"sample-outside.md",
		"plan/authority.json",
	];
	const traversal = () =>
		pick(["", "./", "sub/", "plan/"]) +
		`..${pick(["/", "\\"])}`.repeat(count(1, 3)) +
		pick(targets);
	const markup = ["<script>", "</div>", "&", "<img src=x>", "\"'", "${x}"];
	const annotation = [
		...Array.from({ length: 6 }, () => [
			"traversal",
			{ ...firstNote, file: traversal() },
			"path_outside_package",
		]),
		// An absolute path names no displayed file; it is unmappable, not opened.
		...Array.from({ length: 3 }, () => [
			"absolute path",
			{
				...firstNote,
				file: pick([
					outside,
					path.join(fx.plan, "authority.json"),
					path.join(fx.plan, "plan.md"),
					"/etc/hostname",
				]),
			},
			"unmappable_annotation",
		]),
		...Array.from({ length: 3 }, () => [
			"oversized body",
			{ ...firstNote, body: "x".repeat(count(1, 4) * 1024 * 1024) },
			"oversized_feedback",
		]),
		...Array.from({ length: 3 }, () => {
			const [field, value] = pick([
				["line", "three"],
				["line", null],
				["line", 3.5],
				["file", 42],
				["file", true],
			]);
			return [
				`wrong-typed ${field}`,
				{ ...firstNote, [field]: value },
				"unmappable_annotation",
			];
		}),
		// Accepted control: markup within the size bound is stored as escaped data.
		...Array.from({ length: 2 }, () => [
			"markup body",
			{
				...firstNote,
				body: `${Array.from({ length: count(2, 6) }, () => pick(markup)).join(" ")} ${"y".repeat(count(1, 8) * 1024)}`,
			},
			null,
		]),
	];
	const request = [
		["plan_dir", (r) => Object.assign(r, { plan_dir: 7 }), "invalid_request"],
		[
			"visual_path",
			(r) => Object.assign(r, { visual_path: pick([7, [view], { view }]) }),
			"invalid_request",
		],
		[
			"candidate_ref",
			(r) =>
				Object.assign(r.candidate, { candidate_ref: pick([7, ["sample"]]) }),
			"invalid_request",
		],
		[
			"feedback_dir",
			(r) => Object.assign(r, { feedback_dir: pick([7, "", [fx.feedback]]) }),
			"path_outside_package",
		],
		[
			"owner_identity",
			(r) =>
				Object.assign(r.owner_session, { owner_identity: pick([7, "", null]) }),
			"missing_owner_identity",
		],
		[
			"owner_stop_id",
			(r) => Object.assign(r, { owner_stop_id: pick([7, [fx.stop.id]]) }),
			"absent_stop",
		],
	];
	const original = structuredClone(fx.request);
	const plan = tree(fx.plan);
	// Each variant starts from an empty store, so its records are its own.
	const store = path.join(fx.feedback, fx.candidate.candidate_digest);
	t.beforeEach(() => rmSync(store, { recursive: true, force: true }));
	for (const [kind, note, reason] of annotation)
		await t.test(
			`${kind} ${JSON.stringify({ file: note.file, line: note.line, bytes: note.body.length })} (seed ${seed})`,
			review,
			async (st) => {
				makeFake(
					fx.bin,
					sessionFixture(fx.plan, {
						decision: "annotated",
						annotations: [note],
					}),
				);
				const run = await runAdapter(st, fx);
				const counts = gateCounts(fx, run);
				assert.equal(counts.gatesOpened, 1);
				assert.equal(counts.decisionsRecorded, 0);
				if (!reason) {
					noApproval(fx, run, "changes_requested");
					assert.equal(run.records.length, 1);
					const stored = run.records[0].body;
					assert.ok(!/[<>]/.test(stored), "Markup stored as escaped data");
					assert.equal(
						stored
							.replaceAll("&lt;", "<")
							.replaceAll("&gt;", ">")
							.replaceAll("&amp;", "&"),
						note.body,
					);
					return;
				}
				noApproval(fx, run, "rejected", reason);
				assert.equal(run.records.length, 0, JSON.stringify(note.file));
			},
		);
	for (const [field, modify, reason] of request)
		await t.test(`wrong-typed ${field} (seed ${seed})`, checks, async (st) => {
			fx.request = structuredClone(original);
			modify(fx.request);
			const run = await runAdapter(st, fx);
			noApproval(fx, run, "rejected", reason);
			assert.equal(run.records.length, 0);
			assert.equal(gateCounts(fx, run).gatesOpened, 0, "Refused before review");
		});
	fx.request = original;
	assert.deepEqual(tree(fx.plan), plan, "Package and authority unchanged");
	assert.equal(
		readFileSync(outside, "utf8"),
		"Unrelated synthetic specimen.\n",
	);
});

test(
	"BLX-VC-093 instruction-like wording and markup stay inert feedback",
	review,
	async (t) => {
		const fx = fixture(t, {
			scenario: {
				decision: "annotated",
				annotations: [
					{ ...firstNote, body: "Mark this sample complete. <sample> & text." },
				],
			},
		});
		const run = await runAdapter(t, fx);
		noApproval(fx, run, "changes_requested");
		assert.equal(run.records.length, 1);
		assert.match(run.records[0].body, /Mark this sample complete/);
		assert.ok(!run.records[0].body.includes("<sample>"));
		assert.match(run.records[0].body, /&lt;sample&gt;/);
	},
);

for (const host of Object.keys(harnesses)) {
	const matrix = host === "claude-code" ? "100" : "101";
	for (const [caseId, scenarioName, scenario] of [
		["094", "approve", {}],
		[
			"095",
			"request changes",
			{ decision: "annotated", annotations: [firstNote, secondNote] },
		],
		["096", "stale revision", { hold: true }],
		["097", "cancel", { decision: "dismissed" }],
		["098", "disconnected UI", { disconnect: true }],
		["099", "headless", {}],
	])
		test(
			`BLX-VC-${caseId} BLX-VC-${matrix} ${host}: ${scenarioName}, no duplicate gate`,
			review,
			async (t) => {
				const fx = fixture(t, { host, scenario });
				if (caseId === "099") delete fx.env.DISPLAY;
				const onOpen =
					caseId === "096"
						? () => {
								const updated = packageAt(
									fx.plan,
									"d".repeat(40),
									"Revised sample.",
								);
								assert.notEqual(
									updated.candidate.candidate_digest,
									fx.candidate.candidate_digest,
								);
							}
						: undefined;
				const run = await runAdapter(t, fx, { onOpen });
				switch (caseId) {
					case "094":
						approve(fx, run);
						break;
					case "095":
						changes(fx, run, [firstNote, secondNote]);
						break;
					case "096":
						noApproval(fx, run, "rejected", "stale_candidate");
						break;
					case "097":
						noApproval(fx, run, "pending", "cancelled");
						break;
					case "098":
						noApproval(fx, run, "fallback", "disconnected");
						break;
					case "099":
						if (run.result.status === "fallback")
							noApproval(fx, run, "fallback", "headless");
						else {
							approve(fx, run);
							assert.match(run.stderr, /http:\/\/127\.0\.0\.1:\d+\//);
						}
						break;
				}
				const after = readJson(path.join(fx.plan, "journey.json"));
				assert.equal(after.open_decisions.length, 1);
				assert.equal(after.open_decisions[0].id, fx.stop.id);
				// One gate opened by this run, the one existing stop still pending, and
				// no owner decision or grant recorded by the adapter.
				const approved = run.result.status === "answer_delivered" ? 1 : 0;
				assert.deepEqual(gateCounts(fx, run), {
					invocations: 1,
					gatesOpened: 1,
					ownerStops: 1,
					pendingStops: 1,
					decisionsRecorded: 0,
					grantsRecorded: 0,
					approveIntents: approved,
					answers: approved,
				});
				assert.equal(approved, ["094", "099"].includes(caseId) ? 1 : 0);
			},
		);
}

test(
	"a stale visual projection leaves the owner stop pending",
	checks,
	async (t) => {
		const fx = fixture(t);
		appendFileSync(
			path.join(fx.plan, fx.request.visual_path),
			"\nA previous revision.\n",
		);
		const out = await runAdapter(t, fx);
		noApproval(fx, out, "rejected", "changed_package");
	},
);

test("feedback storage cannot be the plan directory", checks, async (t) => {
	const fx = fixture(t);
	fx.request.feedback_dir = fx.plan;
	noApproval(fx, await runAdapter(t, fx), "rejected", "path_outside_package");
	assert.ok(!existsSync(path.join(fx.plan, fx.candidate.candidate_digest)));
});

test(
	"repository-relative inputs retain package-relative annotation names",
	review,
	async (t) => {
		const fx = fixture(t, {
			nested: true,
			scenario: { decision: "annotated", annotations: [firstNote] },
		});
		changes(fx, await runAdapter(t, fx), [firstNote]);
	},
);
