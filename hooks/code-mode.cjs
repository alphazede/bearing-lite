"use strict";

// Code Mode pilot: typed, allowlisted capabilities over the existing ready-set,
// transition-order and plan-package checks, plus a sandboxed routine runner.
// Opt-in only: without code_mode: true in the trusted context, a request goes
// to the context's direct adapter as before. See docs/guides/code-mode.md.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isObject = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const STATUSES = ["COMPLETE", "READY", "WAITING_ON", "OWNER_DECISION_REQUIRED"];
const TRANSIENT = new Set([
	"lock_busy",
	"stale_state",
	"in_progress",
	"cancelled",
]);
const DEFAULT_LIMITS = {
	cpu_seconds: 10,
	memory_bytes: 512 * 1024 * 1024,
	wall_ms: 30000,
	output_bytes: 1024 * 1024,
};
const SCRATCH_BYTES = 16 * 1024 * 1024;
const OPEN_FILES = 48;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_CODE_BYTES = 64 * 1024;
const SIGXCPU_EXIT = 128 + 24;

class Fail extends Error {
	constructor(code, extra = {}) {
		super(code);
		this.code = code;
		this.extra = extra;
	}
}

// --- Catalogue ------------------------------------------------------------

const DRAFT = "https://json-schema.org/draft/2020-12/schema";
const str = { type: "string", minLength: 1 };
const strings = { type: "array", items: { type: "string" } };
const REF = {
	type: "object",
	required: ["path", "sha256"],
	properties: {
		path: str,
		sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
	},
};
const STATUS = { enum: STATUSES };
const AGGREGATE = {
	type: "object",
	required: ["status", "blockers", "next_action", "evidence_refs"],
	additionalProperties: false,
	properties: {
		status: STATUS,
		blockers: strings,
		next_action: { type: ["string", "null"] },
		evidence_refs: { type: "array", items: REF },
	},
};
const ERROR = {
	type: "object",
	required: ["code"],
	properties: { code: { type: "string", pattern: "^[a-z_]{1,64}$" } },
};

const CAPABILITIES = {
	"ready-set": {
		effect: "read",
		authority: "none",
		scope: "request input",
		input: {
			type: "object",
			required: ["slices"],
			additionalProperties: false,
			properties: {
				slices: {
					type: "array",
					items: {
						type: "object",
						required: ["id"],
						properties: {
							id: str,
							depends_on: strings,
							write_set: strings,
							inputs: strings,
							resource: { type: "string" },
							resource_groups: strings,
						},
					},
				},
				assignments: {
					type: "object",
					additionalProperties: { type: "string" },
				},
				pending: { type: "array", items: { type: "object" } },
				busy_resources: strings,
				available_inputs: strings,
			},
		},
		output: {
			type: "object",
			required: ["ready", "excluded"],
			properties: {
				ready: strings,
				excluded: {
					type: "array",
					items: { type: "object", required: ["slice", "cause"] },
				},
			},
		},
		run: (_ctx, input) => require("./ready-set.cjs").evaluate(input),
	},
	"lifecycle-state": {
		effect: "read",
		authority: "none",
		scope: "journey state generation",
		input: {
			oneOf: [
				{
					type: "object",
					required: ["read"],
					additionalProperties: false,
					properties: { read: { const: "generation" } },
				},
				{
					type: "object",
					required: ["from_state", "to_state"],
					properties: {
						from_state: { type: "string" },
						to_state: { type: "string" },
						read: false,
					},
				},
			],
		},
		output: {
			type: "object",
			anyOf: [
				{
					required: ["generation"],
					properties: { generation: { type: "integer" } },
				},
				{
					required: ["outcome", "reason"],
					properties: {
						outcome: { type: "string" },
						reason: { type: "string" },
					},
				},
			],
		},
		run: (ctx, input) =>
			input.read === "generation"
				? { generation: generation(ctx) }
				: require("./transition-order.cjs").evaluate(input),
	},
	validate: {
		effect: "read",
		authority: "none",
		scope: "plan directory inside the workspace",
		input: {
			type: "object",
			required: ["plan_dir", "stage"],
			additionalProperties: false,
			properties: { plan_dir: str, stage: { enum: ["draft", "final"] } },
		},
		output: {
			type: "object",
			required: ["outcome", "stage", "findings"],
			properties: {
				outcome: { type: "string" },
				stage: { type: "string" },
				findings: { type: "array" },
			},
		},
		run: (ctx, input) =>
			require("./plan-package.cjs").freeze(
				inside(ctx.workspace, input.plan_dir),
				{ stage: input.stage },
			),
	},
	evidence: {
		effect: "read",
		authority: "none",
		scope: "evidence store",
		input: { ...REF, additionalProperties: false },
		output: { ...REF, additionalProperties: false },
		run: (ctx, input) => verifyRef(ctx, input),
	},
	parallel: {
		effect: "as each call",
		authority: "as each call",
		scope: "as each call",
		input: {
			type: "object",
			required: ["calls"],
			additionalProperties: false,
			properties: {
				calls: {
					type: "array",
					minItems: 1,
					maxItems: 16,
					items: {
						type: "object",
						required: ["capability", "input"],
						additionalProperties: false,
						properties: { capability: str, input: {} },
					},
				},
			},
		},
		output: {
			type: "object",
			required: ["calls"],
			properties: {
				calls: {
					type: "array",
					items: {
						type: "object",
						required: ["capability", "status"],
						properties: {
							capability: str,
							status: { enum: ["COMPLETE", "WAITING_ON"] },
							error: ERROR,
						},
					},
				},
			},
		},
		run: runParallel,
	},
	dispatch: {
		effect: "write: one role launch through the trusted launcher",
		authority:
			"frozen binding digest, bound activation, context write set, named lock, state generation",
		scope: "context write set",
		input: {
			type: "object",
			required: ["role", "packet", "write_set"],
			additionalProperties: false,
			properties: {
				role: str,
				packet: str,
				write_set: { ...strings, minItems: 1 },
			},
		},
		output: {
			type: "object",
			required: ["status"],
			properties: {
				status: { enum: ["COMPLETE", "WAITING_ON"] },
				receipt: REF,
				error: ERROR,
				message: { type: "string", maxLength: 4096 },
			},
		},
		run: runDispatch,
		after: (ctx, result) => {
			if (result.receipt) verifyRef(ctx, result.receipt);
			if (result.status !== "COMPLETE")
				throw new Fail(result.error?.code ?? "partial_effect");
			if (!result.receipt) throw new Fail("evidence_ref_invalid");
		},
	},
	aggregate: {
		effect: "none",
		authority: "none",
		scope: "request outcome",
		input: AGGREGATE,
		output: AGGREGATE,
		run: (ctx, input, state) => {
			const evidence_refs = input.evidence_refs.map((ref) =>
				verifyRef(ctx, ref),
			);
			const normalized = { ...input, evidence_refs };
			state.aggregate = normalized;
			return normalized;
		},
	},
};

function catalogue() {
	return Object.entries(CAPABILITIES)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, cap]) => ({
			name,
			version: "1",
			input_schema: { $schema: DRAFT, ...cap.input },
			output_schema: { $schema: DRAFT, ...cap.output },
			effect: cap.effect,
			authority: cap.authority,
			scope: cap.scope,
			evidence:
				"exact JSON result bytes in the evidence store, referenced by path and SHA-256",
		}));
}

const is = (type, value) =>
	type === "null"
		? value === null
		: type === "array"
			? Array.isArray(value)
			: type === "object"
				? isObject(value)
				: type === "integer"
					? Number.isInteger(value)
					: typeof value === type;

function scalarOk(schema, value) {
	if (schema.type && ![].concat(schema.type).some((type) => is(type, value)))
		return false;
	if ("const" in schema && value !== schema.const) return false;
	if (schema.enum && !schema.enum.includes(value)) return false;
	if (typeof value !== "string") return true;
	return (
		value.length >= (schema.minLength ?? 0) &&
		value.length <= (schema.maxLength ?? Infinity) &&
		(!schema.pattern || new RegExp(schema.pattern).test(value))
	);
}

function checkArray(schema, value, at) {
	if (
		value.length < (schema.minItems ?? 0) ||
		value.length > (schema.maxItems ?? Infinity)
	)
		return at;
	if (!schema.items) return null;
	for (const [i, item] of value.entries()) {
		const error = check(schema.items, item, `${at}[${i}]`);
		if (error) return error;
	}
	return null;
}

function checkObject(schema, value, at) {
	for (const key of schema.required ?? [])
		if (!(key in value)) return `${at}.${key}`;
	for (const [key, item] of Object.entries(value)) {
		const sub = schema.properties?.[key] ?? schema.additionalProperties;
		const error = sub !== undefined && check(sub, item, `${at}.${key}`);
		if (error) return error;
	}
	return null;
}

// Validates the JSON Schema keywords the catalogue uses; returns an error path or null.
function check(schema, value, at = "$") {
	if (schema === false || !scalarOk(schema, value)) return at;
	const nested = Array.isArray(value)
		? checkArray(schema, value, at)
		: isObject(value)
			? checkObject(schema, value, at)
			: null;
	if (nested) return nested;
	if (
		schema.oneOf &&
		schema.oneOf.filter((sub) => !check(sub, value, at)).length !== 1
	)
		return at;
	if (schema.anyOf && !schema.anyOf.some((sub) => !check(sub, value, at)))
		return at;
	return null;
}

// --- Files, evidence, journal and lock --------------------------------------

function put(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temp, JSON.stringify(value));
	fs.renameSync(temp, file);
}
const read = (file) => {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
};

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

function normalizeRelativePath(value) {
	if (typeof value !== "string" || !value || value.includes("\0")) return null;
	const slash = value.replaceAll("\\", "/");
	if (slash.startsWith("/") || /^[a-zA-Z]:(?:\/|$)/.test(slash)) return null;
	const norm = path.posix.normalize(slash);
	if (
		!norm ||
		norm === "." ||
		norm === "./" ||
		norm === ".." ||
		norm.startsWith("../")
	) {
		return null;
	}
	return norm;
}

function existingRealPath(probe) {
	let current = probe;
	while (true) {
		try {
			return fs.realpathSync(current);
		} catch (error) {
			if (error.code !== "ENOENT") return null;
			try {
				if (fs.lstatSync(current).isSymbolicLink()) return null;
			} catch {
				/* missing segment: walk to parent */
			}
			const parent = path.dirname(current);
			if (parent === current) return null;
			current = parent;
		}
	}
}

function inside(root, relative) {
	const norm = normalizeRelativePath(relative);
	if (!norm) throw new Fail("schema_error");
	const base = fs.realpathSync(root);
	const file = path.resolve(base, norm);
	const real = file.startsWith(base + path.sep) ? existingRealPath(file) : null;
	if (!real || (real !== base && !real.startsWith(base + path.sep))) {
		throw new Fail("schema_error");
	}
	return file;
}

function verifyRef(ctx, ref) {
	const norm = normalizeRelativePath(ref?.path);
	if (!norm) throw new Fail("evidence_ref_invalid");
	try {
		const store = fs.realpathSync(ctx.evidence_dir);
		const file = fs.realpathSync(path.resolve(store, norm));
		if (
			file.startsWith(store + path.sep) &&
			sha(fs.readFileSync(file)) === ref.sha256
		) {
			return { path: norm, sha256: ref.sha256 };
		}
	} catch {
		/* missing or unreadable: refused below */
	}
	throw new Fail("evidence_ref_invalid");
}

function store(ctx, state, bytes, meta) {
	const digest = sha(bytes);
	const file = path.join(ctx.evidence_dir, "code-mode", digest);
	if (!fs.existsSync(file)) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(`${file}.tmp`, bytes);
		fs.renameSync(`${file}.tmp`, file);
	}
	const ref = { path: `code-mode/${digest}`, sha256: digest, ...meta };
	state.refs.push(ref);
	return ref;
}

const journalFile = (ctx, kind, key) =>
	path.join(ctx.journal_dir, `${kind}-${sha(key)}.json`);
const generation = (ctx) =>
	JSON.parse(fs.readFileSync(ctx.journey_path, "utf8")).state_generation;

// shortcut: a crashed holder's lock is taken over without a compare-and-swap;
// two simultaneous takeovers could both proceed. Upgrade before multi-host use.
function acquire(file) {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			fs.writeFileSync(file, String(process.pid), { flag: "wx" });
			live.locks.add(file);
			return;
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
		}
		let holder = NaN;
		try {
			holder = Number(fs.readFileSync(file, "utf8"));
		} catch {
			continue;
		}
		if (alive(holder)) throw new Fail("lock_busy");
		fs.rmSync(file, { force: true });
	}
	throw new Fail("lock_busy");
}
function releaseLocks() {
	for (const file of live.locks) {
		try {
			if (fs.readFileSync(file, "utf8") === String(process.pid))
				fs.rmSync(file);
		} catch {
			/* already gone */
		}
	}
	live.locks.clear();
}

// --- External adapters ----------------------------------------------------

const live = {
	children: new Map(),
	locks: new Set(),
	journal: null,
	request: null,
	mode: "runtime",
};

function track(child) {
	const closed = new Promise((resolve) =>
		child.once("close", (code, signal) => resolve({ code, signal })),
	);
	live.children.set(child, closed);
	closed.then(() => live.children.delete(child));
	return closed;
}

async function adapter(command, payload) {
	const child = spawn(command[0], command.slice(1), {
		stdio: ["pipe", "pipe", "inherit"],
	});
	const closed = track(child);
	let out = "";
	child.stdout.on("data", (chunk) => {
		out += chunk;
	});
	child.stdin.on("error", () => {});
	child.stdin.end(JSON.stringify(payload));
	const spawned = new Promise((_resolve, reject) =>
		child.once("error", reject),
	);
	await Promise.race([closed, spawned]);
	try {
		return JSON.parse(out);
	} catch {
		throw new Fail("output_schema_error");
	}
}

function authorize(ctx, input) {
	if (!ctx.binding_path || !ctx.binding_sha256)
		throw new Fail("binding_required");
	let actual = null;
	try {
		actual = sha(fs.readFileSync(ctx.binding_path));
	} catch {
		/* unreadable: mismatch */
	}
	if (actual !== ctx.binding_sha256) throw new Fail("binding_mismatch");
	const activation = require("./activation.cjs").evaluate({
		cwd: ctx.workspace,
		session_id: ctx.session_id,
		plan_present: true,
		next_action_known: true,
		assigned_role: input.role,
		router_invoked: true,
	});
	if (activation.reason !== "context_ready")
		throw new Fail("activation_required");
	const allowed = (ctx.write_set ?? [])
		.map(normalizeRelativePath)
		.filter(Boolean);
	const normalized = input.write_set.map(normalizeRelativePath);
	const covered = (entry) =>
		entry !== null &&
		allowed.some(
			(own) => own === entry || (own.endsWith("/") && entry.startsWith(own)),
		);
	if (!normalized.every(covered)) throw new Fail("write_set_denied");
	return normalized;
}

// Journal before the effect; on resume, ask the launcher what durably happened.
async function runDispatch(ctx, input, state, key) {
	const writeSet = authorize(ctx, input);
	const file = journalFile(ctx, "call", key);
	const recorded = read(file);
	if (recorded?.state === "done") return recorded.result;
	const bound = {
		...input,
		write_set: writeSet,
		binding_path: ctx.binding_path,
		binding_sha256: ctx.binding_sha256,
	};
	acquire(ctx.lock_path);
	try {
		if (generation(ctx) !== state.request.generation)
			throw new Fail("stale_state");
		if (recorded?.state === "started") {
			const observed = await adapter(ctx.launcher, {
				...bound,
				operation: "reconcile",
			});
			if (observed?.status === "COMPLETE") {
				put(file, { state: "done", result: observed });
				return observed;
			}
		}
		put(file, { state: "started" });
		const result = await adapter(ctx.launcher, {
			...bound,
			operation: "dispatch",
		});
		put(file, { state: "done", result });
		return result;
	} finally {
		releaseLocks();
	}
}

async function runParallel(ctx, input, state, key) {
	const settled = await Promise.allSettled(
		input.calls.map((entry, i) =>
			execute(ctx, state, entry.capability, entry.input, `${key}.${i}`),
		),
	);
	const calls = settled.map((row, i) => ({
		capability: input.calls[i].capability,
		status: row.status === "fulfilled" ? "COMPLETE" : "WAITING_ON",
		...(row.status === "rejected"
			? { error: { code: row.reason.code ?? "program_error" } }
			: {}),
	}));
	state.calls = calls;
	const failed = calls.find((row) => row.error);
	if (failed) throw new Fail(failed.error.code, { calls });
	return { calls };
}

async function execute(ctx, state, name, input, key) {
	const cap = Object.hasOwn(CAPABILITIES, name) ? CAPABILITIES[name] : null;
	if (!cap || !(ctx.allowed_capabilities ?? []).includes(name))
		throw new Fail("capability_denied");
	if (check(cap.input, input)) throw new Fail("schema_error");
	const result = await cap.run(ctx, input, state, key);
	if (check(cap.output, result)) throw new Fail("output_schema_error");
	store(ctx, state, JSON.stringify(result), { kind: "call", capability: name });
	cap.after?.(ctx, result);
	return result;
}

async function direct(ctx, state, name, input) {
	const result = await adapter(ctx.direct, {
		capability: name,
		input,
		binding_path: ctx.binding_path,
		binding_sha256: ctx.binding_sha256,
	});
	store(ctx, state, JSON.stringify(result), { kind: "call", capability: name });
	if (
		isObject(result) &&
		typeof result.status === "string" &&
		result.status !== "COMPLETE"
	) {
		throw new Fail(result.error?.code ?? "direct_refused");
	}
}

// --- Sandboxed routine runner ---------------------------------------------

function limitsOf(ctx) {
	const limits = { ...DEFAULT_LIMITS };
	for (const key of Object.keys(limits)) {
		const lower = ctx.limits?.[key];
		if (Number.isInteger(lower) && lower > 0)
			limits[key] = Math.min(limits[key], lower);
	}
	return limits;
}

// systemd user scope (memory, tasks) -> prlimit (CPU, open files) -> bwrap
// (no network, clean environment, read-only minimal root, tmpfs scratch) ->
// node --permission (no child process, worker or read outside scratch).
function sandboxArgs(limits) {
	const runner = fs.realpathSync(__filename);
	const scope = [
		"--user",
		"--scope",
		"--quiet",
		"--collect",
		"-p",
		`MemoryMax=${limits.memory_bytes}`,
		"-p",
		"MemorySwapMax=0",
		"-p",
		"TasksMax=64",
		"--",
		"prlimit",
		`--cpu=${limits.cpu_seconds}:${limits.cpu_seconds + 1}`,
		`--nofile=${OPEN_FILES}`,
		"--",
	];
	const node = [
		process.execPath,
		"--permission",
		"--allow-fs-read=/tmp",
		`--allow-fs-read=${runner}`,
		"--allow-fs-write=/tmp",
		runner,
		"__sandbox",
	];
	return [...scope, ...bwrapArgs(runner), "--", ...node];
}

function bwrapArgs(runner) {
	const nodeDir = path.dirname(fs.realpathSync(process.execPath));
	const system = ["/lib", "/lib64", "/bin"].flatMap((dir) => {
		try {
			return fs.lstatSync(dir).isSymbolicLink()
				? ["--symlink", fs.readlinkSync(dir), dir]
				: ["--ro-bind", dir, dir];
		} catch {
			return [];
		}
	});
	return [
		"bwrap",
		"--unshare-all",
		"--clearenv",
		"--die-with-parent",
		"--new-session",
		"--cap-drop",
		"ALL",
		"--ro-bind",
		"/usr",
		"/usr",
		...system,
		"--ro-bind",
		nodeDir,
		nodeDir,
		"--ro-bind",
		runner,
		runner,
		"--dev",
		"/dev",
		"--proc",
		"/proc",
		"--size",
		String(SCRATCH_BYTES),
		"--tmpfs",
		"/tmp",
		"--setenv",
		"HOME",
		"/tmp",
		"--setenv",
		"NODE_CHANNEL_FD",
		"3",
		"--chdir",
		"/tmp",
	];
}

// Keeps at most the output limit of combined stdout and stderr; kills on overflow.
function collector(limit, child) {
	const out = { chunks: [], observed: 0, retained: 0, overflow: false };
	const collect = (chunk) => {
		out.observed += chunk.length;
		const room = limit - out.retained;
		if (room > 0) {
			out.chunks.push(chunk.subarray(0, room));
			out.retained += Math.min(room, chunk.length);
		}
		if (out.observed > limit && !out.overflow) {
			out.overflow = true;
			child.kill("SIGKILL");
		}
	};
	child.stdout.on("data", collect);
	child.stderr.on("data", collect);
	return out;
}

// Answers the routine's call() requests in the trusted process.
function serve(ctx, state, child, code, run) {
	const reply = (message) => child.connected && child.send(message);
	child.on("message", (message) => {
		if (message?.type === "ready") {
			run.started = true;
			child.send({ type: "run", code });
		} else if (message?.type === "call") {
			const key = `${state.request.idempotency_key}#${message.id}`;
			execute(ctx, state, message.capability, message.input, key).then(
				(value) => reply({ type: "reply", id: message.id, value }),
				(error) => {
					run.callError ??= error;
					reply({
						type: "reply",
						id: message.id,
						error: { code: error.code ?? "program_error" },
					});
				},
			);
		} else if (message?.type === "result" || message?.type === "error") {
			run.finished ??= message;
		}
	});
}

function runProgram(ctx, state, code) {
	const limits = limitsOf(ctx);
	const env = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
	for (const key of ["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"])
		if (process.env[key]) env[key] = process.env[key];
	const child = spawn("systemd-run", sandboxArgs(limits), {
		stdio: ["ignore", "pipe", "pipe", "ipc"],
		env,
	});
	const closed = track(child);
	const out = collector(limits.output_bytes, child);
	const run = { started: false, finished: null, callError: null, wall: false };
	serve(ctx, state, child, code, run);
	const timer = setTimeout(() => {
		run.wall = true;
		child.kill("SIGKILL");
	}, limits.wall_ms);
	const spawnError = new Promise((resolve) => child.once("error", resolve));
	return Promise.race([closed, spawnError.then(() => ({ code: -1 }))]).then(
		(exit) => {
			clearTimeout(timer);
			if (out.observed > 0) {
				const truncated =
					out.observed > out.retained
						? { observed_bytes: out.observed, truncated: true }
						: {};
				store(ctx, state, Buffer.concat(out.chunks), {
					kind: "diagnostic",
					bytes: out.retained,
					...truncated,
				});
			}
			if (run.finished?.type === "result" && !out.overflow && !run.wall) {
				store(ctx, state, JSON.stringify(run.finished.value), {
					kind: "result",
				});
				return;
			}
			throw exitFailure({ ...exit, ...run, overflow: out.overflow });
		},
	);
}

function exitFailure({
	code,
	signal,
	overflow,
	wall,
	started,
	finished,
	callError,
}) {
	if (overflow) return new Fail("output_limit");
	if (wall) return new Fail("resource_limit", { limit: "wall" });
	if (finished?.type === "error") return callError ?? new Fail("program_error");
	if (code === SIGXCPU_EXIT || signal === "SIGXCPU")
		return new Fail("resource_limit", { limit: "cpu" });
	// Not killed by this process: the scope's out-of-memory stop is the remaining killer.
	if (signal || code > 128)
		return new Fail("resource_limit", { limit: "memory" });
	return new Fail(started ? "program_error" : "sandbox_unavailable");
}

function sandboxMain() {
	const AsyncFunction = (async () => {}).constructor;
	const pending = new Map();
	let next = 0;
	const call = (capability, input) =>
		new Promise((resolve, reject) => {
			const id = ++next;
			pending.set(id, { resolve, reject });
			process.send({ type: "call", id, capability, input });
		});
	const finish = (message) => process.send(message, () => process.exit(0));
	process.on("message", (message) => {
		if (message.type === "reply") {
			const entry = pending.get(message.id);
			pending.delete(message.id);
			if (message.error)
				entry?.reject(
					Object.assign(new Error(message.error.code), message.error),
				);
			else entry?.resolve(message.value);
		} else if (message.type === "run") {
			Promise.resolve()
				.then(() =>
					new AsyncFunction("call", "require", message.code)(call, require),
				)
				.then(
					(value) =>
						finish({
							type: "result",
							value: value === undefined ? null : value,
						}),
					(error) => {
						console.error(error?.stack ?? String(error));
						finish({ type: "error" });
					},
				);
		}
	});
	process.send({ type: "ready" });
}

// --- Request handling -------------------------------------------------------

function outcome(state, error) {
	const agg = state.aggregate;
	const result = {
		request_id: state.request.request_id ?? "",
		status: error ? "WAITING_ON" : (agg?.status ?? "COMPLETE"),
		blockers: error ? [error.code] : (agg?.blockers ?? []),
		next_action: error
			? TRANSIENT.has(error.code)
				? "retry after the current work finishes"
				: "inspect the refusal and its evidence"
			: (agg?.next_action ?? null),
		evidence_refs: state.refs,
		mode: state.mode,
	};
	if (state.calls) result.calls = state.calls;
	if (error)
		result.error = {
			code: error.code,
			...(error.extra?.limit ? { limit: error.extra.limit } : {}),
		};
	return result;
}

function validRequest(req) {
	const kinds = ["capability", "code", "routine"].filter(
		(key) => isObject(req) && key in req,
	);
	return (
		isObject(req) &&
		typeof req.request_id === "string" &&
		req.request_id &&
		typeof req.idempotency_key === "string" &&
		req.idempotency_key &&
		Number.isInteger(req.generation) &&
		kinds.length === 1 &&
		(!("capability" in req) || typeof req.capability === "string") &&
		(!("code" in req) || typeof req.code === "string") &&
		(!("routine" in req) || typeof req.routine === "string")
	);
}

function programSource(ctx, req) {
	if ("code" in req) return req.code;
	const entry = ctx.reviewed_routines?.[req.routine];
	if (!entry) throw new Fail("capability_denied");
	let source = null;
	try {
		source = fs.readFileSync(inside(ctx.workspace, entry.path));
	} catch {
		/* unreadable: mismatch */
	}
	if (!source || sha(source) !== entry.sha256)
		throw new Fail("routine_digest_mismatch");
	return source.toString("utf8");
}

async function handle(ctx, req, state) {
	if (!validRequest(req)) throw new Fail("schema_error");
	if (ctx.code_mode !== true) {
		state.mode = "direct";
		if (
			!("capability" in req) ||
			!(ctx.allowed_direct ?? []).includes(req.capability)
		)
			throw new Fail("capability_denied");
		return direct(ctx, state, req.capability, req.input);
	}
	const file = journalFile(ctx, "request", req.idempotency_key);
	const recorded = read(file);
	if (recorded?.state === "done")
		return { replay: { ...recorded.outcome, request_id: req.request_id } };
	if (
		recorded?.state === "running" &&
		recorded.pid !== process.pid &&
		alive(recorded.pid)
	)
		throw new Fail("in_progress");
	put(file, { state: "running", pid: process.pid });
	live.journal = file;
	if ("capability" in req) {
		if (
			!Object.hasOwn(CAPABILITIES, req.capability) &&
			(ctx.allowed_direct ?? []).includes(req.capability)
		) {
			state.mode = "direct";
			return direct(ctx, state, req.capability, req.input);
		}
		return execute(
			ctx,
			state,
			req.capability,
			req.input,
			`${req.idempotency_key}#0`,
		);
	}
	const code = programSource(ctx, req);
	if (Buffer.byteLength(code) > MAX_CODE_BYTES) throw new Fail("request_limit");
	return runProgram(ctx, state, code);
}

function emit(result) {
	process.stdout.write(`${JSON.stringify(result)}\n`);
	process.exitCode = result.error ? 1 : 0;
}

function finishJournal(result) {
	if (!live.journal) return;
	if (result.error && TRANSIENT.has(result.error.code))
		fs.rmSync(live.journal, { force: true });
	else put(live.journal, { state: "done", outcome: result });
	live.journal = null;
}

async function cancel() {
	live.cancelling = true;
	for (const [child] of live.children) child.kill("SIGKILL");
	await Promise.all(live.children.values());
	releaseLocks();
	const result = outcome(live.request, new Fail("cancelled"));
	finishJournal(result);
	process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(1));
}

async function main(argv) {
	if (argv[0] === "__sandbox") return sandboxMain();
	const at = argv.indexOf("--context");
	const ctx = JSON.parse(fs.readFileSync(argv[at + 1], "utf8"));
	if (argv[0] === "describe") return emit(catalogue());
	const state = { request: {}, refs: [], mode: "runtime" };
	live.request = state;
	process.once("SIGTERM", cancel);
	let result;
	try {
		const raw = fs.readFileSync(0);
		if (raw.length > MAX_REQUEST_BYTES) throw new Fail("request_limit");
		try {
			state.request = JSON.parse(raw);
		} catch {
			throw new Fail("schema_error");
		}
		if (!isObject(state.request)) state.request = {};
		const done = await handle(ctx, state.request, state);
		if (done?.replay) return emit(done.replay);
		result = outcome(state);
	} catch (error) {
		if (!(error instanceof Fail)) console.error(error?.stack ?? String(error));
		result = outcome(
			state,
			error instanceof Fail ? error : new Fail("program_error"),
		);
	} finally {
		releaseLocks();
	}
	if (live.cancelling) return; // cancel() reports this request
	finishJournal(result);
	emit(result);
}

module.exports = { catalogue, check };

if (require.main === module) main(process.argv.slice(2));
