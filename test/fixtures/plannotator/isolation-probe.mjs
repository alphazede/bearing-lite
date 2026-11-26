// Asks the Plannotator adapter itself whether it can isolate a review on this
// host: one real start of its isolated review per test process and PATH, with
// the fixture plannotator approving a minimal valid candidate.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unreviewedPlanningWave } from "../../planning-contract-fixture.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const save = (file, value) => writeFileSync(file, JSON.stringify(value));
const visual = "sample-visual.html";
const probes = new Map();

function candidatePackage(dir) {
	const { implementation: doc, seit } = JSON.parse(
		readFileSync(path.join(here, "../planning-repair-package.json"), "utf8"),
	);
	const content = "# Sample plan\n\nPreserve the sample record.\n";
	writeFileSync(path.join(dir, ".git"), "synthetic worktree marker\n");
	writeFileSync(path.join(dir, "plan.md"), content);
	seit.source_baseline.planning_inputs = [
		{ path: "plan.md", sha256: sha(content) },
	];
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
		output_name: "sample-dod-manifest.html",
		title: "Sample review",
		requirements: [
			{
				id: "AC-SYN-001",
				statement: "Preserve the sample.",
				status: "PLANNED",
			},
		],
		architecture: [{ id: "CONTRACT-SYN-001", decision: "Record the sample." }],
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
	const rendered = spawnSync(
		process.execPath,
		[
			path.join(root, "tools/render-dod-manifest.mjs"),
			"implementation.json",
			"--out",
			visual,
			"--visual",
		],
		{ cwd: dir, encoding: "utf8", timeout: 30_000 },
	);
	assert.equal(rendered.status, 0, rendered.stderr + rendered.stdout);
	return candidate;
}

async function probe(hostPath) {
	const dir = mkdtempSync(path.join(tmpdir(), "bearing-isolation-probe-"));
	try {
		const [plan, feedback, bin, scratch, home] = [
			"plan",
			"feedback",
			"bin",
			"scratch",
			"home",
		].map((name) => {
			mkdirSync(path.join(dir, name));
			return path.join(dir, name);
		});
		const candidate = candidatePackage(plan);
		const owner = {
			owner_identity: "sample-owner",
			harness: "codex",
			session_id: "sample-session",
		};
		const at = new Date().toISOString();
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
			owner_session: owner,
		};
		save(path.join(plan, "journey.json"), {
			owner_wait_tracking: true,
			owner_blocked_intervals: [],
			decisions: [],
			open_decisions: [stop],
		});
		save(path.join(plan, "authority.json"), {
			state: "proposed",
			effective: false,
			granting_owner_decisions: [],
		});
		const fake = readFileSync(path.join(here, "fake-plannotator.cjs"), "utf8");
		writeFileSync(
			path.join(bin, "plannotator"),
			`#!${process.execPath}\n${fake.replace("const scenario = {};", () => `const scenario = ${JSON.stringify({ scratchRoot: scratch })};`)}`,
			{ mode: 0o700 },
		);
		const request = {
			enabled: true,
			plan_dir: plan,
			visual_path: visual,
			feedback_dir: feedback,
			candidate,
			owner_stop_id: stop.id,
			owner_session: { ...owner, payload: { session_id: owner.session_id } },
		};
		const child = spawn(
			process.execPath,
			[path.join(root, "tools/plannotator-adapter.mjs")],
			{
				cwd: plan,
				env: {
					PATH: `${bin}${path.delimiter}${hostPath}`,
					HOME: home,
					TMPDIR: scratch,
					LANG: "C",
				},
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (data) => {
			stdout += data;
		});
		child.stderr.setEncoding("utf8").on("data", (data) => {
			stderr += data;
		});
		const deadline = setTimeout(() => child.kill("SIGKILL"), 60_000);
		child.stdin.end(JSON.stringify(request));
		await new Promise((resolve, reject) => {
			child.on("error", reject);
			child.on("close", resolve);
		});
		clearTimeout(deadline);
		const outcome = JSON.parse(stdout);
		const opened = /Review ready at http:\/\/127\.0\.0\.1:\d+\//.test(stderr);
		if (outcome.status === "answer_delivered" && opened)
			return { tools: false, review: false };
		if (outcome.status === "fallback" && outcome.reason === "unavailable") {
			const reason =
				"Plannotator adapter cannot isolate a review on this host: its isolation tool (bwrap) is not on PATH";
			return { tools: reason, review: reason };
		}
		// Only an isolated start that failed before the review opened is a host
		// capability gap; every other outcome is a failure the suite must show.
		assert.ok(
			outcome.status === "fallback" &&
				outcome.reason === "disconnected" &&
				!opened,
			`Unexpected isolation probe outcome: ${stdout}${stderr}`,
		);
		const detail =
			stderr.split("\n").find((line) => line.trim()) ?? "no diagnostic";
		// A host that runs a minimal bwrap namespace can isolate; the adapter
		// failing there is a regression to show, not a capability gap to skip.
		const minimal = spawnSync(
			"bwrap",
			["--unshare-all", "--die-with-parent", "--ro-bind", "/", "/", "true"],
			{ env: { PATH: hostPath }, encoding: "utf8", timeout: 30_000 },
		);
		assert.notEqual(
			minimal.status,
			0,
			`bwrap isolates on this host, but the adapter's isolated review did not start: ${stdout}${stderr}`,
		);
		return {
			tools: false,
			review: `Plannotator adapter cannot start its isolated review on this host: ${detail.trim()}`,
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Resolves { tools, review }: false when the capability exists, otherwise a skip
// reason. tools: the adapter finds its isolation tool, so its checks run.
// review: an isolated review starts.
export function plannotatorIsolation(hostPath = process.env.PATH ?? "") {
	if (!probes.has(hostPath)) probes.set(hostPath, probe(hostPath));
	return probes.get(hostPath);
}
