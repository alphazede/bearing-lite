// Public, synthetic orchestration fixtures. No live launcher or provider is used.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { planningContract } from "../../planning-contract-fixture.mjs";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(ROOT, "hooks/code-mode.cjs");
const require = createRequire(import.meta.url);
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const json = (file) => JSON.parse(readFileSync(file, "utf8"));
export function put(file, value) {
	const temp = file + "." + process.pid + ".tmp";
	writeFileSync(temp, JSON.stringify(value));
	renameSync(temp, file);
}
export const capabilities = [
	"aggregate",
	"dispatch",
	"evidence",
	"lifecycle-state",
	"parallel",
	"ready-set",
	"validate",
];
export const readyInput = {
	slices: [
		{ id: "A", write_set: ["state/a.txt"] },
		{ id: "B", depends_on: ["A"], write_set: ["state/b.txt"] },
		{ id: "C", write_set: ["state/c.txt"] },
	],
	assignments: { A: "COMPLETED" },
};
export const transitionInput = { from_state: "READY", to_state: "IN_PROGRESS" };
export const validationInput = { plan_dir: "plan", stage: "draft" };

function planFixture(workspace) {
	const dir = path.join(workspace, "plan");
	mkdirSync(dir);
	const plan = "# Example plan\n";
	writeFileSync(path.join(dir, "plan.md"), plan);
	const seit = JSON.stringify({
		source_baseline: {
			planning_inputs: [{ path: "plan/plan.md", sha256: sha(plan) }],
		},
		procedures_and_commands: [],
		proof_cases: [],
	});
	writeFileSync(path.join(dir, "seit.json"), seit);
	const digest = sha([sha(plan), sha(seit)].join("\n"));
	const contract = planningContract(digest, {
		units: ["W1"],
		kind: "wave",
		dir,
	});
	put(path.join(dir, "implementation.json"), {
		journey_settings: {
			planning_review: { candidate_digest: digest },
			...contract.journey_settings,
		},
		boundary_contract: contract.boundary_contract,
		waves: [{ id: "W1", slice_ids: ["A"] }],
		slices: [
			{
				id: "A",
				role: "Implementer",
				write_set: ["state/a.txt"],
				command_ids: [],
				inputs: [],
			},
		],
		dependencies: [],
	});
	return dir;
}

export function processAlive(pid) {
	assert.ok(Number.isInteger(pid) && pid > 1, "invalid owned launcher PID");
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error.code === "ESRCH") return false;
		throw error;
	}
}

async function cleanup(root, children) {
	const control = path.join(root, "control");
	const launchers = [];
	if (existsSync(control)) {
		for (const name of readdirSync(control)) {
			if (name.endsWith(".ready")) {
				const marker = path.join(control, name);
				if (!existsSync(marker)) continue;
				try {
					launchers.push({ marker, pid: json(marker).pid });
				} catch {
					continue;
				}
				put(path.join(control, name.replace(/\.ready$/, ".release")), {
					cancel: true,
				});
			}
		}
	}
	for (const { child } of children) {
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
	}
	await Promise.allSettled(children.map((entry) => entry.result));
	const deadline = Date.now() + 5000;
	const pending = (entry) =>
		existsSync(entry.marker) && processAlive(entry.pid);
	while (launchers.some(pending) && Date.now() < deadline) await delay(25);
	const stillRunning = launchers.filter(pending).map((entry) => entry.pid);
	rmSync(root, { recursive: true, force: true });
	assert.deepEqual(
		stillRunning,
		[],
		"owned launcher did not exit during cleanup",
	);
}

function initCheckout(workspace, home) {
	// Only the disposable repository receives this empty fixture commit.
	const git = (...args) => {
		const proc = spawnSync(
			"git",
			["-C", workspace, "-c", "core.hooksPath=/dev/null", ...args],
			{
				env: { HOME: home, PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1" },
				encoding: "utf8",
				timeout: 10000,
			},
		);
		assert.ifError(proc.error);
		assert.equal(proc.status, 0, proc.stderr);
		return proc.stdout.trim();
	};
	git("init", "-q", "-b", "example-branch");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"--allow-empty",
		"-qm",
		"Synthetic baseline",
	);
	return git("rev-parse", "HEAD");
}

function authorityFixture(workspace, revision) {
	const session = "synthetic-session";
	const activation = path.join(workspace, "task-opt-in.md");
	writeFileSync(
		activation,
		[
			"- bearing_session: " +
				JSON.stringify({
					session_id: session,
					owner_requested: true,
					task_id: "example-task",
				}),
			"### task_id: example-task",
			"- status: IN_PROGRESS",
			"- assigned_role: Implementer",
			"- next_action: run a bounded routine",
		].join("\n") + "\n",
	);
	const journey = path.join(workspace, "journey.json");
	put(journey, {
		schema_version: "1",
		state_generation: 1,
		journey: {
			id: "example-journey",
			title: "Synthetic journey",
			status: "implementation",
			planning_repository: "example/project",
		},
		decisions: [],
		open_decisions: [],
		planning_receipts: [],
		profile_selection: { profile: "synthetic" },
		checkout_lease: {
			journey: "example-journey",
			controller: "fixture-controller",
			repository: "example/project",
			checkout: workspace,
			branch: "example-branch",
			candidate_revision: revision,
			acquired_at: "2026-01-01T00:00:00Z",
			generation: 1,
			state: "active",
		},
		unrelated: { keep: "unchanged" },
	});
	const ledger = path.join(workspace, "state/effects.log");
	writeFileSync(ledger, "");
	const binding = path.join(workspace, "binding.json");
	const frozen = require(
		path.join(ROOT, "hooks/profiles.cjs"),
	).freezeSelectedRoutes({
		profile: {
			roles: {
				implementer: {
					enabled: true,
					primary: {
						harness: "fixture-harness",
						model: "fixture-model",
						reasoning: "fixture-effort",
					},
					ordered_fallbacks: [],
				},
			},
		},
	});
	assert.match(frozen.digest, /^[a-f0-9]{64}$/);
	put(binding, frozen);
	return { session, activation, journey, ledger, binding };
}

export function fixture(t, options = {}) {
	// The Linux pilot mounts /tmp as scratch. The same unique path is owned
	// by the test on the host if an isolation regression fails open.
	const root = mkdtempSync("/tmp/bearing-code-mode-");
	const children = [];
	t.after(() => cleanup(root, children));
	const workspace = path.join(root, "workspace");
	const evidenceDir = path.join(root, "evidence");
	const control = path.join(root, "control");
	const journal = path.join(root, "journal");
	const home = path.join(root, "home");
	for (const dir of [
		workspace,
		evidenceDir,
		control,
		journal,
		home,
		path.join(workspace, "state"),
	]) {
		mkdirSync(dir, { recursive: true });
	}
	const revision = initCheckout(workspace, home);
	const { session, activation, journey, ledger, binding } = authorityFixture(
		workspace,
		revision,
	);
	const plan = planFixture(workspace);
	const source = path.join(evidenceDir, "source.json");
	writeFileSync(source, '{"value":"sample evidence"}\n');
	const sourceRef = { path: "source.json", sha256: sha(readFileSync(source)) };
	const config = path.join(root, "context.json");
	const endpoint = path.join(HERE, "launcher.cjs");
	// Distinct packet names exercise scheduling. Every alias contains the same reviewed instructions.
	const packetBody = "Write the authorized synthetic ledger entry.\n";
	for (const packet of [
		"sample",
		"authorized",
		"norm-ok",
		"only-requested",
		"bad-output",
		"bad-ref",
		"first",
		"second",
		"cancel",
		"after-cancel",
		"once",
		"step-1",
		"step-2",
		"step-3",
		"step-4",
		"stale-effect",
		"fresh-effect",
		"left",
		"right",
		"locked-first",
		"locked-second",
		"partial",
		"direct-sibling",
	]) {
		writeFileSync(path.join(workspace, packet), packetBody);
	}
	const grantFile = path.join(root, "grant.json");
	put(grantFile, {
		binding_sha256: sha(readFileSync(binding)),
		role: "implementer",
		packet_sha256: sha(packetBody),
		write_set: ["state/effects.log"],
		session_id: session,
	});
	const context = {
		workspace,
		evidence_dir: evidenceDir,
		journal_dir: journal,
		journey_path: journey,
		session_id: session,
		binding_path: binding,
		grant_path: grantFile,
		grant_sha256: sha(readFileSync(grantFile)),
		binding_sha256: sha(readFileSync(binding)),
		write_set: ["state/effects.log", "journey.json"],
		lock_path: path.join(workspace, "lifecycle.lock"),
		allowed_capabilities: capabilities,
		allowed_direct: ["ready-set", "legacy-status"],
		launcher: [
			process.execPath,
			endpoint,
			"dispatch",
			control,
			workspace,
			evidenceDir,
		],
		direct: [
			process.execPath,
			endpoint,
			"direct",
			control,
			workspace,
			evidenceDir,
		],
		code_mode: true,
		...options,
	};
	put(config, context);
	return {
		root,
		workspace,
		evidenceDir,
		control,
		journal,
		home,
		activation,
		journey,
		binding,
		ledger,
		plan,
		sourceRef,
		config,
		context,
		children,
	};
}

export function configure(f, changes) {
	Object.assign(f.context, changes);
	put(f.config, f.context);
}

export function authorizeFixtureWrites(f, writes) {
	const file = f.context.grant_path;
	put(file, { ...json(file), write_set: writes });
	configure(f, { grant_sha256: sha(readFileSync(file)) });
}

export const dispatchInput = (packet = "sample") => ({
	role: "implementer",
	packet,
	write_set: ["state/effects.log"],
});

export const aggregateInput = {
	status: "READY",
	blockers: [],
	next_action: "inspect the result",
	evidence_refs: [],
};

export const request = (id, capability, input, generation = 1) => ({
	request_id: id,
	idempotency_key: id,
	generation,
	capability,
	input,
});

export const program = (id, code, generation = 1) => ({
	request_id: id,
	idempotency_key: id,
	generation,
	code,
});

export function checkRuntime() {
	assert.ok(
		existsSync(CLI),
		"Expected Code Mode public entry point hooks/code-mode.cjs; runtime behavior is not implemented at the baseline",
	);
}

// Never inherit real credentials. The only ambient credential test values are
// synthetic strings supplied explicitly by its caller.
function runtimeEnv(f, extra) {
	const env = { HOME: f.home, PATH: process.env.PATH, LANG: "C" };
	for (const key of ["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) {
		if (process.env[key]) env[key] = process.env[key];
	}
	return { ...env, ...extra };
}

export async function describe(f) {
	checkRuntime();
	const run = spawnSync(
		process.execPath,
		[CLI, "describe", "--context", f.config],
		{
			cwd: f.workspace,
			env: runtimeEnv(f),
			encoding: "utf8",
			timeout: 10000,
			maxBuffer: 128 * 1024,
		},
	);
	assert.ifError(run.error);
	assert.equal(run.status, 0, run.stderr);
	return JSON.parse(run.stdout);
}

export function start(f, req, { extraEnv, offline = false } = {}) {
	checkRuntime();
	const args = [CLI, "--context", f.config];
	const child = spawn(
		offline ? "unshare" : process.execPath,
		offline ? ["-rn", process.execPath, ...args] : args,
		{
			cwd: f.workspace,
			env: runtimeEnv(f, extraEnv),
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
	let stdout = "",
		stderr = "",
		overflow = false;
	const append = (chunk, stream) => {
		if (
			Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + chunk.length >
			128 * 1024
		) {
			overflow = true;
			child.kill("SIGTERM");
		} else if (stream === "stdout") stdout += chunk;
		else stderr += chunk;
	};
	child.stdout.on("data", (chunk) => append(chunk, "stdout"));
	child.stderr.on("data", (chunk) => append(chunk, "stderr"));
	child.stdin.on("error", () => {}); // Child exit is reported by result, not an incidental EPIPE.
	const result = new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code, signal) =>
			resolve({ code, signal, stdout, stderr, overflow }),
		);
	});
	const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
	result.then(
		() => clearTimeout(timer),
		() => clearTimeout(timer),
	);
	f.children.push({ child, result });
	child.stdin.end(JSON.stringify(req));
	return { child, result };
}

export function parseOutcome(run) {
	assert.equal(
		run.overflow,
		false,
		"public outcome exceeded test collection bound",
	);
	assert.equal(run.signal, null, run.stderr);
	assert.ok([0, 1].includes(run.code), run.stderr);
	assert.ok(run.stdout.trim(), "no typed outcome: " + run.stderr);
	assert.ok(
		Buffer.byteLength(run.stdout) <= 64 * 1024,
		"compact outcome exceeds 64 KiB",
	);
	const outcome = JSON.parse(run.stdout);
	assert.ok(
		["COMPLETE", "READY", "WAITING_ON", "OWNER_DECISION_REQUIRED"].includes(
			outcome.status,
		),
		JSON.stringify(outcome),
	);
	assert.equal(typeof outcome.request_id, "string");
	assert.ok(Array.isArray(outcome.blockers));
	assert.ok(
		outcome.next_action === null || typeof outcome.next_action === "string",
	);
	assert.ok(Array.isArray(outcome.evidence_refs));
	return outcome;
}

export async function run(f, req, options) {
	const outcome = parseOutcome(await start(f, req, options).result);
	assert.equal(outcome.request_id, req.request_id);
	return outcome;
}

let sandboxProbe;
// Asks the runtime itself whether it can start its routine sandbox: a trivial
// routine either completes, or the runtime refuses it as sandbox_unavailable
// through the same checks every routine run uses. Resolves false when the
// sandbox works, otherwise a skip reason carrying the runtime's diagnostic.
export function sandboxSkip() {
	sandboxProbe ??= (async () => {
		const after = [];
		const f = fixture({ after: (fn) => after.push(fn) });
		try {
			const out = await run(f, program("sandbox-probe", "return true;"));
			if (out.status === "COMPLETE") return false;
			assert.equal(out.error?.code, "sandbox_unavailable", JSON.stringify(out));
			const ref = out.evidence_refs.find(
				(entry) => entry.kind === "diagnostic",
			);
			const detail = ref
				? evidenceBytes(f, ref).toString().trim().split("\n")[0]
				: "no diagnostic";
			return "routine sandbox unavailable on this host: " + detail;
		} finally {
			for (const fn of after) await fn();
		}
	})();
	return sandboxProbe;
}

// The offline entry starts the runtime in an unprivileged user and network
// namespace. Resolves false when the host allows one, otherwise a skip reason.
export function offlineSkip() {
	const probe = spawnSync("unshare", ["-rn", process.execPath, "-e", ""], {
		env: { PATH: process.env.PATH, LANG: "C" },
		encoding: "utf8",
		timeout: 10000,
	});
	if (probe.status === 0) return false;
	const detail = (probe.error?.message ?? probe.stderr).trim();
	return "unprivileged network namespace unavailable on this host: " + detail;
}

export function failure(outcome, code) {
	assert.notEqual(outcome.status, "COMPLETE", JSON.stringify(outcome));
	assert.notEqual(outcome.status, "READY", JSON.stringify(outcome));
	assert.equal(outcome.error?.code, code, JSON.stringify(outcome));
}

export function evidenceBytes(f, ref) {
	assert.equal(typeof ref.path, "string");
	const file = path.resolve(f.evidenceDir, ref.path);
	assert.ok(
		file.startsWith(f.evidenceDir + path.sep),
		"evidence must stay in the owned store",
	);
	const target = realpathSync(file);
	assert.ok(
		target.startsWith(realpathSync(f.evidenceDir) + path.sep),
		"evidence cannot resolve outside its store",
	);
	const bytes = readFileSync(target);
	assert.match(ref.sha256, /^[a-f0-9]{64}$/);
	assert.equal(sha(bytes), ref.sha256);
	return bytes;
}

export function evidence(f, outcome, kind, capability) {
	const ref = outcome.evidence_refs.find(
		(entry) =>
			entry.kind === kind &&
			(capability === undefined || entry.capability === capability),
	);
	assert.ok(ref, "missing evidence for " + kind + " " + (capability ?? ""));
	return evidenceBytes(f, ref);
}

export function workspaceDigest(f) {
	const files = readdirSync(f.workspace, {
		recursive: true,
		withFileTypes: true,
	})
		.filter((entry) => entry.isFile())
		.map((entry) =>
			path.relative(f.workspace, path.join(entry.parentPath, entry.name)),
		)
		.filter((name) => !name.startsWith(".git" + path.sep))
		.sort();
	return sha(
		JSON.stringify(
			files.map((name) => [
				name,
				sha(readFileSync(path.join(f.workspace, name))),
			]),
		),
	);
}

export const effects = (f) =>
	readFileSync(f.ledger, "utf8").split("\n").filter(Boolean);

export function controlMode(f, packet, options) {
	put(path.join(f.control, packet + ".json"), options);
}

export function release(f, packet, cancel = false) {
	put(path.join(f.control, packet + ".release"), { cancel });
}

export async function waitFor(f, marker, running) {
	const deadline = Date.now() + 20000;
	const file = path.join(f.control, marker);
	while (!existsSync(file)) {
		if (running.child.exitCode !== null || running.child.signalCode !== null) {
			assert.fail(
				"runtime exited before readiness: " +
					JSON.stringify(await running.result),
			);
		}
		assert.ok(Date.now() < deadline, "no readiness marker " + marker);
		await delay(25);
	}
}

export function capturedGoldens(f) {
	const ready = require(path.join(ROOT, "hooks/ready-set.cjs")).evaluate(
		readyInput,
	);
	const transition = require(
		path.join(ROOT, "hooks/transition-order.cjs"),
	).evaluate(transitionInput);
	const draft = require(path.join(ROOT, "hooks/plan-package.cjs")).freeze(
		f.plan,
		{ stage: "draft" },
	);
	assert.deepEqual(ready.ready, ["B", "C"]);
	assert.equal(transition.outcome, "ADVISE");
	assert.equal(draft.outcome, "PASS", JSON.stringify(draft.findings));
	return {
		"ready-set": JSON.stringify(ready),
		"lifecycle-state": JSON.stringify(transition),
		validate: JSON.stringify(draft),
	};
}
