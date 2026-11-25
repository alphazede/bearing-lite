#!/usr/bin/env node
/**
 * Optional Plannotator owner-review adapter (BC-FLOW-05, BC-FLOW-06).
 * stdin: one JSON request. stdout: one JSON outcome. stderr: review progress.
 * Shows a read-only snapshot of the exact candidate in an isolated, loopback-only
 * Plannotator session and appends typed feedback to
 * <feedback_dir>/<candidate digest>/feedback.jsonl. It never writes the plan
 * package, journey.json or authority.json and never grants authority: an
 * approval is an approve_intent for the existing owner-decision procedure.
 * Node.js standard library only. Guide: docs/guides/plannotator-review.md.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	appendFileSync,
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { evaluateOwnerStop } = require("../hooks/owner-stops.cjs");
const { evaluatePlanningReview } = require("../hooks/planning-review.cjs");
const self = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(self), "..");
const MAX_RESULT_BYTES = 256 * 1024;
const DIFF = "revision-diff.md";
// File types Plannotator 0.29.4 opens in a bundle (its own refusal message lists them).
const PLANNOTATOR_TYPES = new Set(
	".md .mdx .txt .adoc .asciidoc .html .htm .mmd .mermaid .dot .gv .yaml .yml .json .jsonc .json5 .toml .ini .cfg .conf .properties .csv .tsv .log .xml".split(
		" ",
	),
);
// Upstream features that leave the machine or change host settings stay off.
const LOCAL_ONLY = {
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

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const text = (v) => typeof v === "string" && v.trim().length > 0;
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const escapeHtml = (s) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const reject = (reason) => {
	throw Object.assign(new Error(reason), {
		outcome: { status: "rejected", reason },
	});
};

function which(name, env = process.env) {
	for (const dir of (env.PATH ?? "").split(":").filter(Boolean)) {
		const file = path.join(dir, name);
		try {
			if (statSync(file).isFile()) return file;
		} catch {}
	}
	return null;
}

function inside(dir, name) {
	const file = path.resolve(dir, String(name));
	const relative = path.relative(dir, file);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
		reject("path_outside_package");
	return file;
}

// The candidate as plan-package draft sees it, plus the bytes shown to the owner.
function preflight(req) {
	const dir = path.resolve(String(req.plan_dir));
	const { candidate } = req;
	const seit = readJson(path.join(dir, "seit.json"));
	const names = [
		...(seit.source_baseline?.planning_inputs ?? []).map((i) => i.path),
		"seit.json",
		"implementation.json",
		req.visual_path,
	];
	const draft = spawnSync(
		process.execPath,
		[path.join(root, "hooks/plan-package.cjs"), "draft", dir],
		{ cwd: dir, encoding: "utf8", timeout: 120_000 },
	);
	let receipt = {};
	try {
		receipt = JSON.parse(draft.stdout);
	} catch {}
	if (receipt.outcome !== "PASS") reject("changed_package");
	if (
		receipt.manifest_digest !== candidate?.candidate_digest ||
		seit.source_baseline?.candidate_revision !== candidate.candidate_revision
	)
		reject("stale_candidate");
	const shown = new Map(
		names.map((name) => [name, readFileSync(inside(dir, name))]),
	);
	checkStop(dir, req);
	const binding = grantBinding(readJson(path.join(dir, "authority.json")));
	const wave = readJson(path.join(dir, "implementation.json")).journey_settings
		?.planning_wave;
	if (wave?.review_requested === true) {
		let review = null;
		try {
			const file = inside(dir, wave.review_receipt.path);
			if (sha256(readFileSync(file)) === wave.review_receipt.sha256)
				review = readJson(file);
		} catch {}
		if (!review || evaluatePlanningReview(review).outcome !== "PASS")
			reject("planning_review_required");
	}
	return { names, shown, binding };
}

// The pending owner stop for this candidate, asked in this owner session.
function checkStop(dir, req) {
	const { candidate } = req;
	const journey = readJson(path.join(dir, "journey.json"));
	const stop = journey.open_decisions?.find(
		(d) =>
			d?.record_type === "owner_stop" &&
			d.id === req.owner_stop_id &&
			d.status === "asked",
	);
	if (!stop) reject("absent_stop");
	if (
		stop.candidate_digest !== candidate.candidate_digest ||
		stop.candidate_revision !== candidate.candidate_revision
	)
		reject("stale_candidate");
	const session = req.owner_session ?? {};
	const bound = stop.owner_session ?? {};
	if (!text(session.owner_identity)) reject("missing_owner_identity");
	if (
		session.owner_identity !== bound.owner_identity ||
		session.harness !== bound.harness ||
		!text(session.session_id) ||
		session.session_id !== bound.session_id ||
		session.payload?.session_id !== bound.session_id
	)
		reject("owner_session_mismatch");
}

// Initial class E approval needs no grant; a later stop binds the existing one.
function grantBinding(a) {
	if (a?.effective !== true && !a?.granting_owner_decisions?.length) return {};
	if (a.continuation === undefined) reject("missing_grant");
	// Without condition checks the unchanged evaluator stops after grant shape
	// and expiry; the owner procedure still verifies the conditions.
	const { reason } = evaluateOwnerStop({
		class: "D",
		blocking: true,
		evidence_ref: "authority.json",
		authority: a,
		checked_at: new Date().toISOString(),
	});
	if (reason === "continuation_expired") reject("expired_grant");
	if (reason !== "continuation_conditions_unverified")
		reject("malformed_grant");
	return {
		authority_id: a.id,
		granting_owner_decision_id: a.continuation.owner_decision_id,
	};
}

function sections(bytes) {
	const out = new Map();
	let id = "(preamble)";
	for (const line of String(bytes ?? "").split("\n")) {
		const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
		if (heading) id = heading[1];
		out.set(id, [...(out.has(id) ? [out.get(id)] : []), line].join("\n"));
	}
	return out;
}

// Changed sections only, against the last owner-reviewed candidate.
function revisionDiff(names, shown, candidate, last) {
	if (!last?.plan_dir) return "# Revision comparison\n\nno prior review\n";
	const quote = (s) => (s ?? "(absent)").replace(/^/gm, "> ");
	const out = [
		"# Revision comparison",
		"",
		`Last owner-reviewed: ${last.candidate_digest} (revision ${last.candidate_revision})`,
		`Current: ${candidate.candidate_digest} (revision ${candidate.candidate_revision})`,
		"",
	];
	for (const name of names) {
		const file = inside(path.resolve(String(last.plan_dir)), name);
		const before = existsSync(file) ? readFileSync(file) : null;
		const after = shown.get(name);
		if (before?.equals(after)) continue;
		if (!name.endsWith(".md")) {
			out.push(
				`## ${name}`,
				"",
				`Changed bytes: ${before ? sha256(before) : "(absent)"} to ${sha256(after)}`,
				"",
			);
			continue;
		}
		const [old, now] = [sections(before), sections(after)];
		for (const id of new Set([...old.keys(), ...now.keys()]))
			if (old.get(id) !== now.get(id))
				out.push(
					`## ${name}: ${id}`,
					"",
					"Before:",
					"",
					quote(old.get(id)),
					"",
					"After:",
					"",
					quote(now.get(id)),
					"",
				);
	}
	return out.join("\n");
}

// Plannotator feedback Markdown: "## <file>", then "### N. (line L) Feedback on: "<selection>"" and "> body".
function parseFeedback(markdown) {
	const entries = [];
	let file = null;
	let entry = null;
	for (const line of markdown.split("\n")) {
		// HTML groups carry a "(converted from HTML ...)" suffix after the path.
		const group = /^## (.+?)(?: \(converted from HTML\b.*\))?$/.exec(line);
		const head =
			/^### \d+\. (?:\(lines? (\d+)(?:-\d+)?\) )?Feedback on: "(.*)"$/.exec(
				line,
			);
		if (group) [file, entry] = [group[1].trim(), null];
		else if (head) {
			entry = { file, line: Number(head[1]), selection: head[2], body: [] };
			entries.push(entry);
		} else if (/^###/.test(line)) reject("unmappable_annotation");
		else if (entry && line.startsWith(">"))
			entry.body.push(line.replace(/^> ?/, ""));
	}
	return entries;
}

function sectionOf(name, bytes, { line, selection }) {
	const lines = bytes.toString("utf8").split("\n");
	const first = selection.split("\n")[0];
	if (name.endsWith(".md") && first && lines[line - 1]?.includes(first)) {
		for (let i = line - 1; i >= 0; i--) {
			const heading = /^#{1,6}\s+(.+?)\s*$/.exec(lines[i]);
			if (heading) return heading[1];
		}
	}
	if (name.endsWith(".html") && first) {
		const html = bytes.toString("utf8");
		const at = html.indexOf(escapeHtml(first));
		if (at >= 0 && html.indexOf(escapeHtml(first), at + 1) < 0) {
			const ids = [
				...html.slice(0, at).matchAll(/<section[^>]*\sid="([^"]+)"/g),
			];
			if (ids.length) return ids.at(-1)[1];
		}
	}
	// shortcut: JSON and SDoc anchors are unmapped; add JSON Pointer and SDoc UID mapping when owners annotate them.
	return reject("unmappable_annotation");
}

function mapEntries(entries, names, shown, snap) {
	return entries.map((e) => {
		const name = names.find((n) =>
			[n, path.join(snap, n), path.join(snap, `${n}.txt`)].includes(e.file),
		);
		if (!name)
			reject(
				String(e.file).split(/[\\/]/).includes("..")
					? "path_outside_package"
					: "unmappable_annotation",
			);
		return {
			artifact_path: name,
			section_id: sectionOf(name, shown.get(name), e),
			body: escapeHtml(e.body.join("\n")),
		};
	});
}

// Runs inside the sandbox: Plannotator plus a Unix-socket relay to its loopback
// port, so an owner's SSH forward can reach the isolated session.
function relay(socket, command, args) {
	const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
	let port = null;
	const server = net.createServer((client) => {
		if (!port) return client.destroy();
		const upstream = net.connect(Number(port), "127.0.0.1");
		client.pipe(upstream).pipe(client);
		upstream.on("error", () => client.destroy());
		client.on("error", () => upstream.destroy());
	});
	server.on("error", (error) =>
		process.stderr.write(`Owner access socket unavailable: ${error.code}\n`),
	);
	server.listen(socket, () =>
		process.stderr.write(`Owner access socket ${JSON.stringify(socket)}\n`),
	);
	child.stderr.on("data", (data) => {
		process.stderr.write(data);
		port ??=
			/http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/.exec(String(data))?.[1] ??
			null;
	});
	child.on("close", (code, signal) => {
		server.close();
		if (signal) process.kill(process.pid, signal);
		else process.exitCode = code;
	});
}

// Isolated session: no network but loopback, no capabilities, read-only system,
// read-only snapshot, writable private scratch only.
function sandboxArgs(scratch, snap, plannotator, env) {
	const binds = new Set(
		["/usr", "/etc", path.dirname(process.execPath), root].concat(
			[process.execPath, plannotator].map((f) => path.dirname(realpathSync(f))),
		),
	);
	const system = ["/lib", "/lib64", "/bin", "/sbin"].flatMap((dir) => {
		try {
			const real = realpathSync(dir);
			return real !== dir
				? ["--symlink", path.relative("/", real), dir]
				: ["--ro-bind", dir, dir];
		} catch {
			return [];
		}
	});
	return [
		"--unshare-all",
		"--die-with-parent",
		"--new-session",
		"--cap-drop",
		"ALL",
		...[...binds].flatMap((dir) => ["--ro-bind", dir, dir]),
		...system,
		"--dev",
		"/dev",
		"--proc",
		"/proc",
		"--tmpfs",
		"/tmp",
		"--bind",
		scratch,
		scratch,
		"--ro-bind",
		snap,
		snap,
		"--clearenv",
		...Object.entries(env).flatMap(([k, v]) => ["--setenv", k, v]),
		"--chdir",
		scratch,
	];
}

function session(bwrap, plannotator, scratch, targets) {
	const snap = path.dirname(targets[0]);
	const resultFile = path.join(scratch, "result.json");
	const env = {
		...LOCAL_ONLY,
		PATH: "/usr/bin:/bin",
		HOME: path.join(scratch, "home"),
		TMPDIR: scratch,
		LANG: "C.UTF-8",
		PLANNOTATOR_DATA_DIR: path.join(scratch, "data"),
	};
	mkdirSync(env.HOME, { recursive: true });
	mkdirSync(env.PLANNOTATOR_DATA_DIR, { recursive: true });
	rmSync(path.join(scratch, "s"), { force: true });
	const args = [
		...sandboxArgs(scratch, snap, plannotator, env),
		"--",
		process.execPath,
		self,
		"relay",
		path.join(scratch, "s"),
		plannotator,
		"annotate",
		...targets,
		"--gate",
		"--json",
		"--require-approval",
		"--render-html",
		"--result-file",
		resultFile,
	];
	return new Promise((resolve) => {
		const child = spawn(bwrap, args, { stdio: ["ignore", "ignore", "pipe"] });
		let opened = false;
		child.stderr.on("data", (data) => {
			process.stderr.write(data);
			opened ||= /http:\/\/(127\.0\.0\.1|localhost):/.test(String(data));
		});
		child.on("error", () => resolve({ code: null }));
		child.on("close", (code) => resolve({ code, resultFile, opened }));
	});
}

// A result counts only with the matching strict exit: 0 approved, 1 annotated or dismissed.
function readResult({ code, resultFile }) {
	if (!resultFile || !existsSync(resultFile)) return null;
	if (statSync(resultFile).size > MAX_RESULT_BYTES)
		reject("oversized_feedback");
	const result = readJson(resultFile);
	const expected = { approved: 0, annotated: 1, dismissed: 1 }[result.decision];
	return expected === code ? result : null;
}

async function review(req) {
	if (req?.enabled !== true) return { status: "fallback", reason: "disabled" };
	const plannotator = which("plannotator");
	const bwrap = which("bwrap");
	if (!plannotator || !bwrap)
		return { status: "fallback", reason: "unavailable" };
	const { names, shown, binding } = preflight(req);
	const { candidate } = req;
	const scratch = mkdtempSync(path.join(tmpdir(), "bor-"));
	try {
		const snap = path.join(scratch, "candidate");
		const view = new Map(shown).set(
			DIFF,
			Buffer.from(revisionDiff(names, shown, candidate, req.last_reviewed)),
		);
		const show = (alias) =>
			[...view].map(([name, bytes]) => {
				const target = path.join(snap, alias(name));
				mkdirSync(path.dirname(target), { recursive: true });
				if (!existsSync(target)) writeFileSync(target, bytes, { mode: 0o444 });
				chmodSync(target, 0o444);
				return target;
			});
		let run = await session(
			bwrap,
			plannotator,
			scratch,
			show((n) => n),
		);
		// A refused bundle (exit 2 before the session opens, e.g. for .sdoc) gets one
		// retry with .txt copies of the types Plannotator does not open.
		if (run.code === 2 && !run.opened)
			run = await session(
				bwrap,
				plannotator,
				scratch,
				show((n) => (PLANNOTATOR_TYPES.has(path.extname(n)) ? n : `${n}.txt`)),
			);
		const result = readResult(run);
		const after = preflight(req);
		if (names.some((name) => !after.shown.get(name).equals(shown.get(name))))
			reject("changed_package");
		if (!result) return { status: "fallback", reason: "disconnected" };
		if (result.decision === "dismissed")
			return { status: "pending", reason: "cancelled" };
		const notes = mapEntries(
			parseFeedback(String(result.feedback ?? "")),
			names,
			shown,
			snap,
		);
		return deliver(req, result.decision === "approved", notes, binding);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

// Appends the typed records outside the package and returns the outcome.
function deliver(req, approved, notes, binding) {
	const { candidate } = req;
	if (!approved && !notes.length)
		return { status: "pending", reason: "cancelled" };
	const base = {
		candidate_digest: candidate.candidate_digest,
		revision: candidate.candidate_revision,
		owner_stop_id: req.owner_stop_id,
		request_id: randomUUID(),
		timestamp: new Date().toISOString(),
	};
	const records = notes.map((note) => ({
		...base,
		...note,
		kind: approved ? "comment" : "request_changes",
	}));
	if (approved)
		records.push({
			...base,
			artifact_path: req.visual_path,
			section_id: "candidate",
			kind: "approve_intent",
			body: "",
		});
	const store = path.join(
		path.resolve(String(req.feedback_dir)),
		candidate.candidate_digest,
	);
	mkdirSync(store, { recursive: true });
	appendFileSync(
		path.join(store, "feedback.jsonl"),
		records.map((r) => `${JSON.stringify(r)}\n`).join(""),
	);
	if (!approved)
		return { status: "changes_requested", feedback: records.length };
	const owner = req.owner_session;
	return {
		status: "answer_delivered",
		answer: {
			kind: "approve_intent",
			candidate_ref: candidate.candidate_ref,
			candidate_digest: base.candidate_digest,
			revision: base.revision,
			owner_stop_id: base.owner_stop_id,
			owner_identity: owner.owner_identity,
			harness: owner.harness,
			session_id: owner.payload.session_id,
			request_id: base.request_id,
			timestamp: base.timestamp,
			...binding,
		},
	};
}

if (process.argv[2] === "relay") {
	relay(process.argv[3], process.argv[4], process.argv.slice(5));
} else {
	let input = "";
	process.stdin.setEncoding("utf8");
	for await (const chunk of process.stdin) input += chunk;
	let outcome;
	try {
		outcome = await review(JSON.parse(input));
	} catch (error) {
		outcome = error.outcome ?? {
			status: "rejected",
			reason: "invalid_request",
		};
	}
	process.stdout.write(`${JSON.stringify(outcome)}\n`);
	process.exitCode = outcome.status === "answer_delivered" ? 0 : 1;
}
