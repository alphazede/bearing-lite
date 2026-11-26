"use strict";

// Code Mode pilot: typed, allowlisted capabilities over the existing ready-set,
// transition-order and plan-package checks, plus a sandboxed routine runner.
// Opt-in only: without code_mode: true in the trusted context, a request goes
// to the context's direct adapter as before. See docs/guides/code-mode.md.
const fs = require("node:fs");
const path = require("node:path");
const { Socket } = require("node:net");
const { createHash, randomUUID } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

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
		this.code =
			typeof code === "string" && /^[a-z_]{1,64}$/.test(code)
				? code
				: "output_schema_error";
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
				packet_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
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
			// Retain the exact launcher result; only accept canonical receipt paths.
			if (
				result.receipt &&
				verifyRef(ctx, result.receipt).path !== result.receipt.path
			)
				throw new Fail("evidence_ref_invalid");
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
			const evidence_refs = input.evidence_refs.map((ref) => ({
				...ref,
				...verifyRef(ctx, ref),
			}));
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
		if (!Object.hasOwn(value, key)) return `${at}.${key}`;
	for (const [key, item] of Object.entries(value)) {
		const sub = Object.hasOwn(schema.properties ?? {}, key)
			? schema.properties[key]
			: schema.additionalProperties;
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

function atomicWrite(file, bytes, durable = false) {
	const dir = path.dirname(file);
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	const temp = path.join(dir, "." + randomUUID() + ".tmp");
	try {
		fs.writeFileSync(temp, bytes, { flag: "wx", mode: 0o600, flush: durable });
		fs.renameSync(temp, file);
		if (durable) {
			const fd = fs.openSync(dir, "r");
			try {
				fs.fsyncSync(fd);
			} finally {
				fs.closeSync(fd);
			}
		}
	} finally {
		fs.rmSync(temp, { force: true });
	}
}
const put = (file, value) => atomicWrite(file, JSON.stringify(value), true);
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
	if (
		typeof value !== "string" ||
		!value ||
		!value.isWellFormed() ||
		value.includes("\0")
	)
		return null;
	const slash = value.replaceAll("\\", "/");
	if (slash.startsWith("/") || /^[a-zA-Z]:/.test(slash)) return null;
	const norm = path.posix.normalize(slash);
	if (
		!norm ||
		norm === "." ||
		norm === "./" ||
		norm === ".." ||
		norm.startsWith("../") ||
		/^[a-zA-Z]:/.test(norm)
	) {
		return null;
	}
	return norm;
}

function existingRealPath(probe) {
	let current = probe;
	while (true) {
		try {
			return {
				real: fs.realpathSync.native(current),
				exists: current === probe,
			};
		} catch (error) {
			if (error.code !== "ENOENT") return null;
			try {
				if (fs.lstatSync(current).isSymbolicLink()) return null;
			} catch (missing) {
				if (missing.code !== "ENOENT") return null;
			}
			const parent = path.dirname(current);
			if (parent === current) return null;
			current = parent;
		}
	}
}

function descendant(base, file) {
	const relative = path.relative(base, file);
	return (
		relative !== "" &&
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}

function inside(root, relative) {
	const norm = normalizeRelativePath(relative);
	if (!norm) throw new Fail("schema_error");
	const base = fs.realpathSync.native(root);
	const file = path.resolve(base, norm);
	const resolved = descendant(base, file) ? existingRealPath(file) : null;
	if (
		!resolved ||
		(!descendant(base, resolved.real) &&
			(resolved.exists || resolved.real !== base)) ||
		(resolved.exists &&
			norm.endsWith("/") &&
			!fs.statSync(resolved.real).isDirectory())
	) {
		throw new Fail("schema_error");
	}
	return file;
}

function fileDigest(file, maxBytes = Infinity) {
	const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
	try {
		const stat = fs.fstatSync(fd);
		if (!stat.isFile() || stat.size > maxBytes) return null;
		const hash = createHash("sha256"),
			buffer = Buffer.alloc(64 * 1024);
		let seen = 0;
		for (;;) {
			const count = fs.readSync(fd, buffer, 0, buffer.length, null);
			if (!count) return hash.digest("hex");
			seen += count;
			if (seen > maxBytes) return null;
			hash.update(buffer.subarray(0, count));
		}
	} finally {
		fs.closeSync(fd);
	}
}

function verifyRef(ctx, ref) {
	const norm = normalizeRelativePath(ref?.path);
	if (!norm || norm.endsWith("/")) throw new Fail("evidence_ref_invalid");
	try {
		const store = fs.realpathSync.native(ctx.evidence_dir);
		const file = fs.realpathSync.native(path.resolve(store, norm));
		if (descendant(store, file) && fileDigest(file) === ref.sha256) {
			return { path: norm, sha256: ref.sha256 };
		}
	} catch {
		/* missing or unreadable: refused below */
	}
	throw new Fail("evidence_ref_invalid");
}

function store(ctx, state, bytes, meta) {
	const digest = sha(bytes);
	const dir = path.join(fs.realpathSync.native(ctx.evidence_dir), "code-mode");
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	if (fs.realpathSync.native(dir) !== dir)
		throw new Fail("evidence_ref_invalid");
	const file = path.join(dir, digest);
	if (fs.existsSync(file)) {
		if (fs.lstatSync(file).isSymbolicLink() || fileDigest(file) !== digest)
			throw new Fail("evidence_ref_invalid");
	} else atomicWrite(file, bytes);
	const ref = { path: `code-mode/${digest}`, sha256: digest, ...meta };
	state.refs.push(ref);
	return ref;
}

const journalFile = (ctx, kind, key) =>
	path.join(ctx.journal_dir, `${kind}-${sha(key)}.json`);
const generation = (ctx) =>
	JSON.parse(fs.readFileSync(ctx.journey_path, "utf8")).state_generation;

// Serialize the short PID-file claim/release using the existing directory inode.
function withLockDirectory(file, fn) {
	const fd = fs.openSync(path.dirname(file), "r");
	try {
		const locked = spawnSync("flock", ["-x", "3"], {
			stdio: ["ignore", "ignore", "ignore", fd],
			timeout: 5000,
		});
		if (locked.error?.code === "ETIMEDOUT") throw new Fail("lock_busy");
		if (locked.status !== 0) throw new Fail("lock_unavailable");
		return fn();
	} finally {
		fs.closeSync(fd);
	}
}
function acquire(file, busy = "lock_busy") {
	withLockDirectory(file, () => {
		if (fs.existsSync(file)) {
			const pid = Number(fs.readFileSync(file, "utf8"));
			if (!Number.isSafeInteger(pid) || pid < 1 || alive(pid))
				throw new Fail(busy);
		}
		put(file, process.pid);
		live.locks.add(file);
	});
}
function release(file) {
	if (!live.locks.has(file)) return;
	withLockDirectory(file, () => {
		if (Number(fs.readFileSync(file, "utf8")) === process.pid)
			fs.unlinkSync(file);
		live.locks.delete(file);
	});
}
function releaseLocks() {
	for (const file of live.locks) release(file);
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

async function adapter(command, payload, limit = Infinity) {
	const child = spawn(command[0], command.slice(1), {
		stdio: ["pipe", "pipe", "inherit"],
	});
	const closed = track(child);
	const parts = [];
	let size = 0;
	child.stdout.on("data", (chunk) => {
		size += chunk.length;
		if (size > limit) child.kill("SIGKILL");
		else parts.push(chunk);
	});
	child.stdin.on("error", () => {});
	child.stdin.end(JSON.stringify(payload));
	const spawned = new Promise((_resolve, reject) =>
		child.once("error", reject),
	);
	await Promise.race([closed, spawned]);
	if (size > limit) throw new Fail("output_limit");
	try {
		return JSON.parse(Buffer.concat(parts));
	} catch {
		throw new Fail("output_schema_error");
	}
}

function resolvePacketDigest(ctx, input) {
	if (input.role.includes("\0") || input.packet.includes("\0"))
		throw new Fail("schema_error");
	const packetPath = path.isAbsolute(input.packet)
		? input.packet
		: path.resolve(ctx.workspace, input.packet);
	let actual;
	try {
		actual = fileDigest(packetPath, 4 * 1024 * 1024);
		if (!actual) throw new Fail("grant_mismatch");
	} catch {
		throw new Fail("grant_mismatch");
	}
	if (input.packet_sha256 && input.packet_sha256 !== actual)
		throw new Fail("grant_mismatch");
	return actual;
}

function sameNormalizedWrites(left, right) {
	if (left.length !== right.length) return false;
	const a = [...left].sort();
	const b = [...right].sort();
	return a.every((entry, i) => entry === b[i]);
}

function verifyGrant(ctx, input, writeSet, packetSha256) {
	if (!ctx.grant_path || !ctx.grant_sha256) throw new Fail("grant_mismatch");
	let grant = null;
	try {
		const raw = fs.readFileSync(ctx.grant_path);
		if (sha(raw) !== ctx.grant_sha256) throw new Fail("grant_mismatch");
		grant = JSON.parse(raw.toString("utf8"));
	} catch (error) {
		if (error instanceof Fail) throw error;
		throw new Fail("grant_mismatch");
	}
	const grantWrites = Array.isArray(grant?.write_set)
		? grant.write_set.map(normalizeRelativePath)
		: null;
	if (
		!isObject(grant) ||
		grant.binding_sha256 !== ctx.binding_sha256 ||
		grant.role !== input.role ||
		grant.packet_sha256 !== packetSha256 ||
		(grant.session_id !== undefined && grant.session_id !== ctx.session_id) ||
		!grantWrites?.length ||
		grantWrites.some((entry) => entry === null) ||
		!sameNormalizedWrites(grantWrites, writeSet)
	) {
		throw new Fail("grant_mismatch");
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
	const packetSha256 = resolvePacketDigest(ctx, input);

	return { writeSet: normalized, packetSha256 };
}

// Write grants describe names, not aliases. Missing suffixes are valid for
// creation, but every existing component must be of the expected kind.
function writePathSafe(base, entry) {
	const directory = entry.endsWith("/");
	const parts = entry.split("/").filter(Boolean);
	let file = base;
	for (const [i, part] of parts.entries()) {
		file = path.join(file, part);
		try {
			const stat = fs.lstatSync(file);
			if (stat.isSymbolicLink()) return false;
			if (i < parts.length - 1 || directory) {
				if (!stat.isDirectory()) return false;
			} else if (!stat.isFile() && !stat.isDirectory()) return false;
		} catch (error) {
			return error.code === "ENOENT";
		}
	}
	return true;
}

// Journal before the effect; on resume, ask the launcher what durably happened.
async function runDispatch(ctx, input, state, key) {
	acquire(ctx.lock_path);
	try {
		if (generation(ctx) !== state.request.generation)
			throw new Fail("stale_state");
		const { writeSet, packetSha256 } = authorize(ctx, input);
		const file = journalFile(ctx, "call", key);

		const bound = {
			...input,
			workspace: fs.realpathSync.native(ctx.workspace),
			write_set: writeSet,
			packet_sha256: packetSha256,
			binding_path: ctx.binding_path,
			binding_sha256: ctx.binding_sha256,
			idempotency_key: key,
			grant_path: ctx.grant_path,
			grant_sha256: ctx.grant_sha256,
		};
		if (!writeSet.every((entry) => writePathSafe(bound.workspace, entry)))
			throw new Fail("write_set_denied");
		verifyGrant(ctx, input, writeSet, packetSha256);
		const identity = sha(
			JSON.stringify([
				bound.workspace,
				bound.binding_sha256,
				bound.grant_sha256,
				bound.role,
				packetSha256,
				[...writeSet].sort(),
			]),
		);
		const recorded = read(file);
		if (recorded?.identity && recorded.identity !== identity)
			throw new Fail("idempotency_conflict");
		if (!recorded && fs.existsSync(file)) throw new Fail("partial_effect");
		if (recorded?.state === "done" && recorded.identity === identity)
			return recorded.result;
		if (recorded) {
			const observed = await adapter(
				ctx.launcher,
				{
					...bound,
					operation: "reconcile",
				},
				limitsOf(ctx).output_bytes,
			);
			if (observed?.status === "COMPLETE") {
				put(file, { state: "done", identity, result: observed });
				return observed;
			}
			if (observed?.status !== "NOT_STARTED") return observed;
		}
		put(file, { state: "started", identity });
		const result = await adapter(
			ctx.launcher,
			{
				...bound,
				operation: "dispatch",
			},
			limitsOf(ctx).output_bytes,
		);
		put(file, { state: "done", identity, result });
		return result;
	} finally {
		release(ctx.lock_path);
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
	if (++state.callCount > 128) throw new Fail("request_limit");
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
	const result = await adapter(
		ctx.direct,
		{
			capability: name,
			input,
			binding_path: ctx.binding_path,
			binding_sha256: ctx.binding_sha256,
		},
		ctx.code_mode === true ? limitsOf(ctx).output_bytes : Infinity,
	);
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

// Keep the scope populated until the trusted wrapper reads the final kernel
// counter. Emit the scope cgroup path before launching the routine so the
// parent can verify limits and arm its watcher before ready. The routine must
// never inherit the observation pipe (fd 4).
const SCOPE_OBSERVER = `
IFS=: read -r hierarchy controllers group < /proc/self/cgroup || exit 1
[ "$hierarchy" = 0 ] && [ -n "$group" ] || exit 1
events=/sys/fs/cgroup$group/memory.events
read_oom() {
	while read -r key value; do
		if [ "$key" = oom_kill ]; then oom=$value; return 0; fi
	done < "$events"
	return 1
}
read_oom || exit 1
before=$oom
printf 'scope:%s\\n' "$group" >&4
"$@" 4>&-
status=$?
if read_oom; then
	if [ "$oom" -gt "$before" ]; then
		printf 'oom\\n' >&4
	else
		printf 'clear\\n' >&4
	fi
else
	printf 'error\\n' >&4
fi
exit "$status"
`;

// systemd user scope in background.slice (memory, tasks, no oom-kill unit
// failure) -> prlimit (CPU, open files) -> bwrap (no network, clean
// environment, read-only minimal root, tmpfs scratch) -> node --permission (no
// child process, worker or read outside scratch).
function sandboxArgs(limits) {
	const runner = fs.realpathSync(__filename);
	const scope = [
		"--user",
		"--scope",
		"--slice=background.slice",
		"--quiet",
		"--collect",
		"-p",
		`MemoryMax=${limits.memory_bytes}`,
		"-p",
		"MemorySwapMax=0",
		"-p",
		"TasksMax=64",
		"-p",
		"OOMPolicy=continue",
		"--",
		"/bin/sh",
		"-c",
		SCOPE_OBSERVER,
		"code-mode-scope",
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
		"--dev",
		"/dev",
		"--proc",
		"/proc",
		"--size",
		String(SCRATCH_BYTES),
		"--tmpfs",
		"/tmp",
		"--ro-bind",
		fs.realpathSync(process.execPath),
		process.execPath,
		"--ro-bind",
		runner,
		runner,
		"--setenv",
		"HOME",
		"/tmp",
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
// Decode complete newline-delimited frames only after accounting for their bytes.
// The parent reads fd 3 as a stream so Node never deserializes unbounded child IPC.
function frames(stream, budget, receive, failed) {
	let pending = Buffer.alloc(0),
		remaining = budget;
	let stopped = false;
	stream.on("error", (error) => {
		if (!stopped) failed(error);
		stopped = true;
	});
	stream.on("data", (chunk) => {
		if (stopped) return;
		try {
			remaining -= chunk.length;
			if (remaining < 0) throw new Fail("output_limit");
			pending = Buffer.concat([pending, chunk]);
			for (
				let end = pending.indexOf(10);
				end !== -1;
				end = pending.indexOf(10)
			) {
				const msg = JSON.parse(pending.subarray(0, end));
				pending = pending.subarray(end + 1);
				receive(msg);
			}
		} catch (error) {
			stopped = true;
			failed(error);
		}
	});
}
function sendFrame(stream, msg, callback) {
	if (!stream.destroyed && stream.writable)
		stream.write(JSON.stringify(msg) + "\n", callback);
}

// Inspect effective kernel controls before sending any routine source.
function verifyScope(group, limits) {
	if (!group || !group.startsWith("/")) throw new Fail("sandbox_unavailable");
	const root = path.join("/sys/fs/cgroup", group);
	for (const [file, maximum] of [
		["memory.max", limits.memory_bytes],
		["memory.swap.max", 0],
		["pids.max", 64],
	]) {
		const actual = Number(
			fs.readFileSync(path.join(root, file), "utf8").trim(),
		);
		if (!Number.isFinite(actual) || actual > maximum)
			throw new Fail("sandbox_unavailable");
	}
	return root;
}

function sandboxScope(pid, limits) {
	const group = fs
		.readFileSync(`/proc/${pid}/cgroup`, "utf8")
		.split("\n")
		.find((line) => line.startsWith("0::"))
		?.slice(3);
	return verifyScope(group, limits);
}

function observeScope(scope, run) {
	const events = path.join(scope, "memory.events");
	const count = () =>
		Number(/^oom_kill (\d+)$/m.exec(fs.readFileSync(events, "utf8"))?.[1]);
	const before = count();
	run.memoryWatch = fs.watch(events, () => {
		try {
			if (count() > before) run.oom = true;
		} catch (error) {
			if (error.code !== "ENOENT" && error.code !== "ENODEV")
				run.observerError = true;
		}
	});
	run.memoryWatch.on("error", () => {
		run.observerError = true;
	});
}

function observeLimits(pid, limits, run, group = null) {
	if (run.scopeObserved) return;
	try {
		const scope = group
			? verifyScope(group, limits)
			: sandboxScope(pid, limits);
		observeScope(scope, run);
		run.scopeObserved = true;
	} catch (error) {
		if (group && (error.code === "ENOENT" || error.code === "ENODEV")) return;
		throw new Fail("sandbox_unavailable");
	}
}

function serve(ctx, state, child, code, run, limits) {
	const stream = child.stdio[3];
	let ordinal = 0;
	const fail = (error) => {
		run.protocolError ??=
			error instanceof Fail ? error : new Fail("output_schema_error");
		child.kill("SIGKILL");
	};
	frames(
		stream,
		MAX_REQUEST_BYTES + limits.output_bytes,
		(message) => {
			if (run.finished || run.protocolError || run.wall) return;
			if (!run.started && message?.type === "ready") {
				observeLimits(child.pid, limits, run);
				run.started = true;
				sendFrame(stream, { type: "run", code });
			} else if (
				run.started &&
				message?.type === "call" &&
				message.id === ++ordinal
			) {
				const key = `${state.request.idempotency_key}#${ordinal}`;
				const work = execute(ctx, state, message.capability, message.input, key)
					.then(
						(value) =>
							sendFrame(stream, { type: "reply", id: message.id, value }),
						(error) => {
							run.callError ??= error;
							sendFrame(stream, {
								type: "reply",
								id: message.id,
								error: { code: error.code ?? "program_error" },
							});
						},
					)
					.catch(fail);
				run.pending.add(work);
				work.finally(() => run.pending.delete(work));
			} else if (
				run.started &&
				(message?.type === "result" || message?.type === "error")
			) {
				if (
					message.type === "result" &&
					Buffer.byteLength(JSON.stringify(message.value) ?? "") >
						limits.output_bytes
				)
					throw new Fail("output_limit");
				run.finished = message;
			} else throw new Fail("output_schema_error");
		},
		fail,
	);
}

function runProgram(ctx, state, code) {
	const limits = limitsOf(ctx);
	const env = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
	for (const key of ["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"])
		if (process.env[key]) env[key] = process.env[key];
	const child = spawn("systemd-run", sandboxArgs(limits), {
		stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
		env,
	});
	const closed = track(child);
	const out = collector(limits.output_bytes, child);
	let scopeBuffer = "";
	const run = {
		started: false,
		finished: null,
		callError: null,
		wall: false,
		pending: new Set(),
		scopeGroup: null,
		scopeObserved: false,
		scopeResult: null,
	};
	child.stdio[4].on("data", (chunk) => {
		scopeBuffer += chunk;
		for (
			let end = scopeBuffer.indexOf("\n");
			end !== -1;
			end = scopeBuffer.indexOf("\n")
		) {
			const line = scopeBuffer.slice(0, end);
			scopeBuffer = scopeBuffer.slice(end + 1);
			if (line.startsWith("scope:")) run.scopeGroup = line.slice(6);
			else if (line) run.scopeResult = line;
		}
		if (run.scopeGroup && !run.scopeObserved && !run.scopeResult) {
			try {
				observeLimits(child.pid, limits, run, run.scopeGroup);
			} catch {
				run.observerError = true;
				child.kill("SIGKILL");
			}
		}
	});
	child.stdio[4].on("error", () => {
		run.observerError = true;
	});
	serve(ctx, state, child, code, run, limits);
	const timer = setTimeout(() => {
		run.wall = true;
		for (const active of live.children.keys()) active.kill("SIGKILL");
	}, limits.wall_ms);
	const spawnError = new Promise((resolve) => child.once("error", resolve));
	return Promise.race([closed, spawnError.then(() => ({ code: -1 }))]).then(
		async (exit) => {
			if (run.pending.size && (run.wall || run.protocolError || out.overflow))
				for (const active of live.children.keys()) active.kill("SIGKILL");
			await Promise.all(run.pending);
			clearTimeout(timer);
			run.memoryWatch?.close();
			if (run.oom || run.scopeResult === "oom")
				throw new Fail("resource_limit", { limit: "memory" });
			if (
				run.observerError ||
				run.scopeResult === "error" ||
				(run.started && exit.code === 0 && run.scopeResult !== "clear")
			)
				throw new Fail("sandbox_unavailable");
			if (run.protocolError) throw run.protocolError;
			if (run.callError && !run.wall && !out.overflow) throw run.callError;
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
			if (
				run.finished?.type === "result" &&
				exit.code === 0 &&
				!out.overflow &&
				!run.wall
			) {
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
	return new Fail(started ? "program_error" : "sandbox_unavailable");
}

function sandboxMain() {
	const stream = new Socket({ fd: 3, readable: true, writable: true });
	const AsyncFunction = (async () => {}).constructor;
	const pending = new Map();
	let next = 0;
	const call = (capability, input) =>
		new Promise((resolve, reject) => {
			const id = ++next;
			pending.set(id, { resolve, reject });
			sendFrame(stream, { type: "call", id, capability, input });
		});
	const finish = (message) => sendFrame(stream, message, () => process.exit(0));
	frames(
		stream,
		DEFAULT_LIMITS.output_bytes + MAX_REQUEST_BYTES,
		(message) => {
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
		},
		() => process.exit(1),
	);
	sendFrame(stream, { type: "ready" });
}

// --- Request handling -------------------------------------------------------

function outcome(state, error) {
	const agg = state.aggregate;
	const result = {
		request_id:
			typeof state.request.request_id === "string"
				? state.request.request_id
				: "",
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
	if (Buffer.byteLength(JSON.stringify(result)) > 64 * 1024) {
		return {
			request_id:
				typeof state.request.request_id === "string" &&
				Buffer.byteLength(state.request.request_id) <= 4096
					? state.request.request_id
					: "",
			status: "WAITING_ON",
			blockers: ["output_limit"],
			next_action: "inspect the retained evidence",
			evidence_refs: state.refs
				.filter((r) => r.kind === "diagnostic")
				.slice(0, 1),
			mode: state.mode,
			error: { code: "output_limit" },
		};
	}
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
		const file = inside(ctx.workspace, entry.path);
		if (fs.statSync(file).isFile()) source = fs.readFileSync(file);
	} catch {
		/* unreadable: mismatch */
	}
	if (!source || sha(source) !== entry.sha256)
		throw new Fail("routine_digest_mismatch");
	return source.toString("utf8");
}

function operationDigest(ctx, req) {
	const { request_id, ...operation } = req;
	return sha(
		JSON.stringify([ctx, operation], (_, value) =>
			isObject(value)
				? Object.fromEntries(
						Object.entries(value).sort(([a], [b]) =>
							a < b ? -1 : a > b ? 1 : 0,
						),
					)
				: value,
		),
	);
}

function beginRequest(ctx, req, fallback) {
	const file = journalFile(ctx, "request", req.idempotency_key);
	fs.mkdirSync(ctx.journal_dir, { recursive: true, mode: 0o700 });
	acquire(file + ".lock", "in_progress");
	const recorded = read(file);
	const digest = operationDigest(ctx, req);
	if (fs.existsSync(file) && (!recorded || !recorded.digest))
		throw new Fail("partial_effect");
	if (recorded && !["running", "retryable", "done"].includes(recorded.state))
		throw new Fail("partial_effect");
	if (recorded && recorded.digest !== digest)
		throw new Fail("idempotency_conflict");
	if (recorded?.state === "done") {
		for (const ref of recorded.outcome.evidence_refs) verifyRef(ctx, ref);
		return { replay: { ...recorded.outcome, request_id: req.request_id } };
	}
	if (recorded?.mode === "direct") throw new Fail("partial_effect");
	put(file, {
		state: "running",
		pid: process.pid,
		digest,
		mode: fallback ? "direct" : "runtime",
	});
	live.journal = file;
	live.digest = digest;
	return null;
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
	const fallback =
		"capability" in req &&
		!Object.hasOwn(CAPABILITIES, req.capability) &&
		(ctx.allowed_direct ?? []).includes(req.capability);
	const replay = beginRequest(ctx, req, fallback);
	if (replay) return replay;
	if ("capability" in req) {
		if (fallback) {
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
	if (
		result.error &&
		TRANSIENT.has(result.error.code) &&
		result.mode !== "direct"
	)
		put(live.journal, { state: "retryable", digest: live.digest });
	else
		put(live.journal, { state: "done", digest: live.digest, outcome: result });
	live.journal = null;
}

async function cancel() {
	live.cancelling = true;
	for (const [child] of live.children) child.kill("SIGKILL");
	await Promise.all(live.children.values());
	const result = outcome(
		live.request,
		new Fail(live.request.mode === "direct" ? "partial_effect" : "cancelled"),
	);
	finishJournal(result);
	releaseLocks();
	process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(1));
}

async function main(argv) {
	if (argv[0] === "__sandbox") return sandboxMain();
	const at = argv.indexOf("--context");
	const ctx = JSON.parse(fs.readFileSync(argv[at + 1], "utf8"));
	if (argv[0] === "describe") return emit(catalogue());
	const state = { request: {}, refs: [], mode: "runtime", callCount: 0 };
	live.request = state;
	process.once("SIGTERM", cancel);
	let result;
	try {
		const parts = [];
		let size = 0;
		for await (const chunk of process.stdin) {
			size += chunk.length;
			if (size > MAX_REQUEST_BYTES) throw new Fail("request_limit");
			parts.push(chunk);
		}
		const raw = Buffer.concat(parts, size);
		try {
			state.request = JSON.parse(raw);
		} catch {
			throw new Fail("schema_error");
		}
		if (!isObject(state.request)) state.request = {};
		const done = await handle(ctx, state.request, state);
		if (done?.replay) {
			releaseLocks();
			return emit(done.replay);
		}
		result = outcome(state);
	} catch (error) {
		if (!(error instanceof Fail)) console.error(error?.stack ?? String(error));
		result = outcome(
			state,
			error instanceof Fail ? error : new Fail("program_error"),
		);
	}
	if (live.cancelling) return; // cancel() reports this request
	try {
		finishJournal(result);
	} finally {
		releaseLocks();
	}
	emit(result);
}

module.exports = { catalogue, check };

if (require.main === module) main(process.argv.slice(2));
