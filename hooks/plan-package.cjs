"use strict";

/**
 * Map the Route freeze (#70, #73, #77, #80): pure checks over a planning package.
 * checkRoles: every command a slice runs whose seit procedure names an actor
 * must name the slice's role. checkWorkClass validates light slices;
 * checkPlanningRoles excludes planning-only roles from Lifecycle implementation slices.
 * verifyDigests: every planning input digest
 * embedded in seit.json matches the file on disk; the manifest digest over
 * those inputs plus seit.json matches implementation.json's
 * planning_review.candidate_digest; missing artifacts, inputs, digests, or a
 * specification Journey's SDoc register fail closed. checkLivePins (#135):
 * every live register_sha256 pin in the repository write set must match the
 * recorded authority.json baseline, naming offenders with file:line;
 * gate-evidence/dated-receipt paths and HISTORICAL_GATE-marked values are allow-listed.
 * CLI: node <plugin root>/hooks/plan-package.cjs <plan dir> -> JSON, exit 1 on a blocking finding.
 * CLI: node <plugin root>/hooks/plan-package.cjs draft <plan dir> -> the pre-review freeze
 * (#205): every check except the completed planning-wave receipt.
 * CLI: node <plugin root>/hooks/plan-package.cjs wave <plan dir> <wave id> -> one wave's
 * slices, write sets, and resolved commands (#190), exit 1 on any finding.
 * CLI: node <plugin root>/hooks/plan-package.cjs ready <plan dir> -> ready slices
 * across all waves, using scheduling state read as JSON on stdin.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");
const { isDeepStrictEqual } = require("node:util");

const { loadVerifiedMermaidView } = require("./manifest-view-binding.cjs");
const { checkReviewRounds } = require("./assurance-budget.cjs");
const { checkRegisterFiles } = require("./register-precheck.cjs");
const { evaluate: evaluateReadySet } = require("./ready-set.cjs");
const {
	POLICY: REVIEW_POLICY,
	planningSessionsVerdict,
	evaluatePlanningReview,
	repoRoot,
	sameCandidate,
} = require("./planning-review.cjs");

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

/** Walk any object graph and yield slice-like nodes. */
function* slices(node) {
	if (Array.isArray(node)) {
		for (const item of node) yield* slices(item);
	} else if (node && typeof node === "object") {
		const ids = [
			...(node.command_ids || []),
			...(node.post_step_command_ids || []),
		];
		if (typeof node.id === "string" && typeof node.role === "string") {
			yield { id: node.id, role: node.role, commandIds: ids };
		}
		for (const value of Object.values(node)) yield* slices(value);
	}
}

function checkRoles(seit, implementation) {
	const procedures = new Map(
		(seit?.procedures_and_commands || []).map((p) => [p.id, p]),
	);
	const findings = [];
	for (const slice of slices(implementation)) {
		for (const command_id of slice.commandIds) {
			const procedure = procedures.get(command_id);
			if (!procedure) {
				findings.push({
					code: "unknown_command_id",
					step: slice.id,
					command_id,
				});
			} else if (
				typeof procedure.actor === "string" &&
				procedure.actor !== slice.role
			) {
				findings.push({
					code: "actor_role_mismatch",
					step: slice.id,
					command_id,
					seit_actor: procedure.actor,
					implementation_role: slice.role,
					files: ["seit.json", "implementation.json"],
				});
			}
		}
	}
	return findings;
}

/** #77: a light slice must run at least one command and be routed to the Light Implementer. */
function checkWorkClass(node, findings = []) {
	for (const slice of sliceNodes(node)) {
		if (slice.work_class === "light" && typeof slice.id === "string") {
			if (!(slice.command_ids || []).length)
				findings.push({ code: "light_slice_without_command", step: slice.id });
			if (slice.role !== "Light Implementer")
				findings.push({
					code: "light_slice_role",
					step: slice.id,
					role: slice.role,
				});
		}
	}
	return findings;
}

/** #80/#580: MBSE and Integration and Test are planning-only and never a Lifecycle implementation slice. */
function isPlanningOnlySliceRole(role) {
	return (
		typeof role === "string" &&
		/^(?:mbse|integration[ _-]+(?:and[ _-]+)?test|requirements[ _-]+engineer|systems[ _-]+modeler)(?:$|[\s/.])/i.test(
			role.trim(),
		)
	);
}

function checkPlanningRoles(node, findings = []) {
	for (const slice of sliceNodes(node)) {
		if (isPlanningOnlySliceRole(slice.role)) {
			findings.push({
				code: "planning_role_in_lifecycle",
				step: typeof slice.id === "string" ? slice.id : null,
				role: slice.role,
			});
		}
	}
	return findings;
}

function withFilePath(error, filePath) {
	if (error && typeof error === "object" && !error.filePath && filePath)
		error.filePath = filePath;
	return error;
}

function readFileChecked(file, label = file) {
	try {
		return fs.readFileSync(file);
	} catch (error) {
		throw withFilePath(error, label);
	}
}

function readJson(file, label = file, ignoreBlank = false) {
	if (!fs.existsSync(file)) return null;
	try {
		const text = fs.readFileSync(file, "utf8");
		return ignoreBlank && !text.trim() ? null : JSON.parse(text);
	} catch (error) {
		throw withFilePath(error, label);
	}
}

function planningInputs(seit, implementation) {
	const inputs = seit?.source_baseline?.planning_inputs;
	const finalPlan = implementation?.journey_settings?.final_technical_plan;
	const seitInputs = Array.isArray(inputs) ? inputs : [];
	return finalPlan === undefined ? seitInputs : [...seitInputs, finalPlan];
}

function verifyPackageDigests(dir, parsed) {
	const findings = [];
	for (const name of ["seit.json", "implementation.json"]) {
		if (!fs.existsSync(path.join(dir, name)))
			findings.push({ code: "missing_artifact", path: name });
	}
	if (findings.length) return { manifest_digest: null, findings };
	const seit = parsed
		? parsed.seit
		: readJson(path.join(dir, "seit.json"), "seit.json");
	const implementation = parsed
		? parsed.implementation
		: readJson(path.join(dir, "implementation.json"), "implementation.json");
	const root = repoRoot(dir);
	const inputs = seit?.source_baseline?.planning_inputs;
	if (!Array.isArray(inputs) || !inputs.length) {
		findings.push({ code: "missing_planning_inputs", path: "seit.json" });
	}
	const actual = [];
	const input_digests = [];
	const lateInput = implementation?.journey_settings?.final_technical_plan;
	let finalPlanText;
	let alignmentText;
	for (const input of planningInputs(seit, implementation)) {
		if (
			typeof input?.path !== "string" ||
			!/^[0-9a-f]{64}$/.test(input?.sha256 || "")
		) {
			findings.push({
				code: "malformed_planning_input",
				...(typeof input?.git_blob === "string"
					? { reason: "sha256_required" }
					: {}),
				input,
			});
			continue;
		}
		const isAlignment =
			input !== lateInput &&
			path.resolve(root, input.path) === path.resolve(dir, "alignment.md");
		let bytes;
		if (input === lateInput) {
			try {
				if (path.win32.isAbsolute(input.path))
					throw new Error("late technical plan path must be relative");
				bytes = withContainedFile(fs.realpathSync(root), input.path, (fd) =>
					fs.readFileSync(fd),
				);
				finalPlanText = bytes.toString("utf8");
			} catch (error) {
				findings.push(
					error.code === "ENOENT"
						? { code: "missing_input", path: input.path }
						: {
								code: "malformed_planning_input",
								field: "journey_settings.final_technical_plan",
							},
				);
				continue;
			}
		} else {
			const file = path.resolve(root, input.path);
			if (!fs.existsSync(file)) {
				findings.push({ code: "missing_input", path: input.path });
				continue;
			}
			bytes = readFileChecked(file, input.path);
		}
		const digest = sha256(bytes);
		actual.push(digest);
		input_digests.push({ path: input.path, sha256: digest });
		if (digest !== input.sha256) {
			findings.push({
				code: "digest_mismatch",
				path: input.path,
				recorded: input.sha256,
				actual: digest,
			});
		} else if (isAlignment) {
			alignmentText = bytes.toString("utf8");
		}
	}
	// The manifest binds the planning inputs and seit.json itself (#70).
	const seitDigest = sha256(
		readFileChecked(path.join(dir, "seit.json"), "seit.json"),
	);
	actual.push(seitDigest);
	input_digests.push({
		path: path.relative(root, path.join(dir, "seit.json")),
		sha256: seitDigest,
	});
	const manifest_digest = sha256(actual.join("\n"));
	const recorded =
		implementation?.journey_settings?.planning_review?.candidate_digest;
	if (typeof recorded !== "string" || !recorded) {
		findings.push({
			code: "missing_candidate_digest",
			actual: manifest_digest,
		});
	} else if (recorded !== manifest_digest) {
		findings.push({
			code: "candidate_digest_mismatch",
			recorded,
			actual: manifest_digest,
		});
	}
	// #69: a specification Journey records an existing SDoc register at planning.
	const settings = implementation?.journey_settings || {};
	if (settings.journey_type === "specification") {
		const register = settings.requirement_register;
		if (
			typeof register !== "string" ||
			!register.endsWith(".sdoc") ||
			!fs.existsSync(path.resolve(root, register))
		) {
			findings.push({
				code: "missing_requirement_register",
				recorded: register ?? null,
			});
		}
	}
	return {
		manifest_digest,
		input_digests: findings.length ? undefined : input_digests,
		findings,
		finalPlanText,
		...(alignmentText === undefined ? {} : { alignmentText }),
	};
}

function verifyDigests(dir) {
	const { finalPlanText, ...digests } = verifyPackageDigests(dir);
	return digests;
}

const HISTORICAL_GATE = new Set([
	"HISTORICAL",
	"SUPERSEDED",
	"ARCHIVED",
	"COMPLETED",
	"RETIRED",
	"INACTIVE",
]);

function walk(node, visit) {
	if (Array.isArray(node)) {
		for (const item of node) walk(item, visit);
	} else if (node && typeof node === "object") {
		visit(node);
		for (const value of Object.values(node)) walk(value, visit);
	}
}

/** #121: duplicate active gate IDs, including numeric/named object keys. */
function checkDuplicateGates(root, findings = [], loc = "root") {
	walk(root, (node) => {
		const conds = node.entry_conditions;
		if (!conds) return;
		const items = Array.isArray(conds)
			? conds.map((item, i) => [String(i), item])
			: Object.entries(conds);
		const seen = new Map();
		for (const [key, item] of items) {
			if (!item || typeof item !== "object" || typeof item.id !== "string")
				continue;
			const status = String(
				item.status || item.state || "ACTIVE",
			).toUpperCase();
			if (HISTORICAL_GATE.has(status)) continue;
			const prev = seen.get(item.id);
			if (prev) {
				findings.push({
					code: "duplicate_active_gate_id",
					id: item.id,
					locations: [prev, loc + ".entry_conditions." + key],
				});
			} else {
				seen.set(item.id, loc + ".entry_conditions." + key);
			}
		}
	});
	return findings;
}

function sliceNodes(implementation) {
	const nodes = new Set();
	const waves = Array.isArray(implementation?.waves)
		? implementation.waves
		: [];
	for (const node of [implementation, ...waves]) {
		if (!Array.isArray(node?.slices)) continue;
		for (const slice of node.slices) {
			if (slice && typeof slice === "object" && !Array.isArray(slice))
				nodes.add(slice);
		}
	}
	return nodes;
}

function sliceIndex(nodes) {
	const byId = new Map();
	for (const node of nodes) {
		if (typeof node.id !== "string" || typeof node.role !== "string") continue;
		const list = byId.get(node.id) || [];
		list.push(node);
		byId.set(node.id, list);
	}
	return byId;
}

function receiptIds(root) {
	const ids = new Set();
	walk(root, (node) => {
		if (typeof node.completed_receipt === "string")
			ids.add(node.completed_receipt);
		if (typeof node.completed_receipt_id === "string")
			ids.add(node.completed_receipt_id);
		if (Array.isArray(node.completed_receipts)) {
			for (const item of node.completed_receipts) {
				if (typeof item === "string") ids.add(item);
				else if (item && typeof item.id === "string") ids.add(item.id);
			}
		}
	});
	return ids;
}

function stepRefs(node, isSlice = false) {
	const refs = [];
	const scalarKeys = isSlice
		? ["integration_step", "integration_step_id", "step_id", "step"]
		: ["integration_step", "integration_step_id"];
	for (const key of scalarKeys) {
		if (typeof node[key] === "string") refs.push(node[key]);
	}
	if (isSlice) {
		for (const key of ["requires", "integration_steps"]) {
			if (!Array.isArray(node[key])) continue;
			for (const item of node[key]) {
				if (typeof item === "string") refs.push(item);
				else if (item && typeof item.id === "string") refs.push(item.id);
			}
		}
	}
	return refs;
}

function semanticKey(node) {
	return [node.activity, node.kind, node.role, node.exit]
		.filter((v) => typeof v === "string")
		.join("|");
}

/**
 * #121/#577: referenced integration-step exits must map to one semantic slice or a preserved receipt.
 * Generic keys (`step`, `step_id`, `requires`, `integration_steps`) are scoped to slice nodes;
 * `integration_step` / `integration_step_id` also resolve on integration entry conditions.
 */
function checkIntegrationStepRefs(implementation, findings = []) {
	const nodes = sliceNodes(implementation);
	const slices = sliceIndex(nodes);
	const receipts = receiptIds(implementation);
	const refs = [...nodes].flatMap((slice) => stepRefs(slice, true));
	const waves = Array.isArray(implementation?.waves)
		? implementation.waves
		: [];
	for (const section of [
		implementation,
		implementation?.integration,
		...waves,
	]) {
		const conditions = section?.entry_conditions;
		if (conditions && typeof conditions === "object") {
			for (const row of Object.values(conditions)) {
				if (row && typeof row === "object") refs.push(...stepRefs(row));
			}
		}
	}
	for (const ref of refs) {
		if (receipts.has(ref)) continue;
		const hits = slices.get(ref) || [];
		const keys = new Set(hits.map(semanticKey));
		if (!hits.length || keys.size !== 1) {
			findings.push({
				code: "unresolved_integration_step",
				step: ref,
				matches: hits.length,
				colliding_semantics: keys.size > 1,
			});
		}
	}
	return findings;
}

/** #628: declared plan JSON artifacts whose frozen-hash maps freeze() inspects. */
function declaredFrozenHashArtifacts(dir, seit, implementation) {
	const declared = new Set([
		"implementation.json",
		"seit.json",
		"authority.json",
		"plan-integration.json",
	]);
	const root = repoRoot(dir);
	const base = path.resolve(dir);
	const addIfInDir = (rel) => {
		if (typeof rel !== "string" || !rel.endsWith(".json")) return;
		for (const candidate of [path.resolve(dir, rel), path.resolve(root, rel)]) {
			if (path.dirname(candidate) === base)
				declared.add(path.basename(candidate));
		}
	};
	for (const input of Array.isArray(seit?.source_baseline?.planning_inputs)
		? seit.source_baseline.planning_inputs
		: []) {
		addIfInDir(input?.path);
	}
	addIfInDir(
		implementation?.journey_settings?.planning_wave?.review_receipt?.path,
	);
	return declared;
}

/** #121: live frozen-content hashes must match the files they name. */
function checkFrozenHashes(dir, findings = [], declaredNames = null) {
	const root = repoRoot(dir);
	let names;
	try {
		names = fs.readdirSync(dir);
	} catch {
		return findings;
	}
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		// Existing plans may store live hash maps in sidecars without declaring them as inputs.
		const data = readJson(
			path.join(dir, name),
			name,
			declaredNames !== null && !declaredNames.has(name),
		);
		const maps = [];
		if (
			data?.source_file_hashes &&
			typeof data.source_file_hashes === "object"
		) {
			maps.push(data.source_file_hashes);
		}
		if (
			data?.plan_integration?.source_file_hashes &&
			typeof data.plan_integration.source_file_hashes === "object"
		) {
			maps.push(data.plan_integration.source_file_hashes);
		}
		walk(data, (node) => {
			if (node && typeof node.live_source_file_hashes === "object")
				maps.push(node.live_source_file_hashes);
		});
		for (const hashes of maps) {
			for (const [rel, recorded] of Object.entries(hashes)) {
				if (typeof recorded !== "string") continue;
				const candidates = [path.resolve(dir, rel), path.resolve(root, rel)];
				const file = candidates.find((p) => fs.existsSync(p));
				if (!file) {
					findings.push({ code: "frozen_hash_missing", path: rel, from: name });
					continue;
				}
				const actual = sha256(readFileChecked(file, rel));
				if (actual !== recorded) {
					findings.push({
						code: "frozen_hash_mismatch",
						path: rel,
						from: name,
						recorded,
						actual,
					});
				}
			}
		}
	}
	return findings;
}

/** DES-135.01: collect every repository-relative write_set entry. */
function collectWriteSet(node, out = []) {
	if (Array.isArray(node))
		node.forEach((item) => {
			collectWriteSet(item, out);
		});
	else if (node && typeof node === "object") {
		if (Array.isArray(node.write_set)) {
			for (const entry of node.write_set) {
				if (typeof entry === "string" && entry) out.push(entry);
			}
		}
		for (const value of Object.values(node)) collectWriteSet(value, out);
	}
	return out;
}

// Allow-listed only when the path genuinely lives under gate-evidence: a
// name merely containing the substring (notes-receipt.md,
// not-gate-evidence-live.md) still hides no live pin.
const PIN_ALLOW_PATH = /(?:^|\/)gate-evidence(?:[.\-_/]|$)/i;
const PIN_HISTORICAL =
	/"(status|state)"\s*:\s*"(HISTORICAL|SUPERSEDED|ARCHIVED|COMPLETED|RETIRED|INACTIVE)"|^\s*(status|state)\s*:\s*(HISTORICAL|SUPERSEDED|ARCHIVED|COMPLETED|RETIRED|INACTIVE)\b/im;
const PIN_PATTERN = /register_sha256\s*:\s*([0-9a-fA-F]{64})/g;
const DATED_RECEIPT_LINE = /^\d{4}-\d{2}-\d{2}\s+receipt\b/i;

/** DES-135.01 (Pin-hygiene): live pins across the repository write set match the recorded baseline. */
function checkLivePins(dir, findings = []) {
	const implementation = readJson(
		path.join(dir, "implementation.json"),
		"implementation.json",
	);
	if (!implementation) return findings;
	const authority = readJson(
		path.join(dir, "authority.json"),
		"authority.json",
	);
	// IE-F1: fail closed only when the package declares or requires a register
	// (specification journey or authority.json carrying a register entry);
	// packages with no register skip the live-pin baseline check cleanly.
	const requiresRegister =
		implementation?.journey_settings?.journey_type === "specification" ||
		(authority && authority.requirement_register != null);
	if (!requiresRegister) return findings;
	const recorded = authority?.requirement_register?.sha256;
	if (typeof recorded !== "string" || !/^[0-9a-f]{64}$/i.test(recorded)) {
		// Fail closed: without a recorded baseline no live pin can be verified.
		if (collectWriteSet(implementation).length) {
			findings.push({
				code: "missing_register_baseline",
				path: "authority.json",
				recorded: typeof recorded === "string" ? recorded : null,
			});
		}
		return findings;
	}
	const baseline = recorded.toLowerCase();
	const root = repoRoot(dir);
	const seen = new Set();
	for (const rel of collectWriteSet(implementation)) {
		if (seen.has(rel) || PIN_ALLOW_PATH.test(rel)) continue;
		seen.add(rel);
		const file = path.resolve(root, rel);
		if (file !== root && !file.startsWith(root + path.sep)) continue;
		let text;
		try {
			text = fs.readFileSync(file, "utf8");
		} catch {
			continue;
		}
		text.split("\n").forEach((line, index) => {
			if (DATED_RECEIPT_LINE.test(line)) return;
			// A HISTORICAL_GATE marker exempts only its own record line, never a
			// live pin on another line of the same file.
			if (PIN_HISTORICAL.test(line)) return;
			for (const match of line.matchAll(PIN_PATTERN)) {
				if (match[1].toLowerCase() !== baseline) {
					findings.push({
						code: "stale_register_pin",
						location: `${rel}:${index + 1}`,
						recorded: baseline,
						actual: match[1].toLowerCase(),
					});
				}
			}
		});
	}
	return findings;
}

/** #153: the owner projection carries content, not just source references. */
function checkManifestProjection(implementation, dir) {
	const manifest = implementation?.dod_manifest;
	// Older digest-only packages have no renderer input; validate supplied projections.
	if (manifest === undefined) return [];
	const object = (value) =>
		value !== null && typeof value === "object" && !Array.isArray(value);
	if (!object(manifest))
		return [
			{ code: "manifest_section_shape_invalid", section: "dod_manifest" },
		];
	const findings = [];
	const text = (value) =>
		typeof value === "string" &&
		value.trim() &&
		value.trim().toLowerCase() !== "unspecified";
	const content = (value) =>
		text(value) ||
		(Array.isArray(value)
			? value.some(content)
			: value &&
				typeof value === "object" &&
				Object.values(value).some(content));
	const rows = (value) =>
		Array.isArray(value)
			? value
			: value && typeof value === "object"
				? [value]
				: [];
	const sections = {};
	for (const section of [
		"requirements",
		"architecture",
		"tasks",
		"documentation",
		"models",
	]) {
		const value = manifest[section];
		sections[section] = [];
		if (value == null) continue;
		if (!Array.isArray(value) && !object(value)) {
			findings.push({ code: "manifest_section_shape_invalid", section });
			continue;
		}
		if (object(value) && value.not_applicable === true && text(value.reason)) {
			if (section === "documentation") sections[section] = [value];
			continue;
		}
		rows(value).forEach((row, index) => {
			if (!object(row)) {
				findings.push({
					code: "manifest_section_shape_invalid",
					section,
					index,
				});
				return;
			}
			if (
				["requirements", "architecture", "tasks"].includes(section) &&
				row.not_applicable === true
			) {
				findings.push({
					code: "manifest_row_not_applicable",
					section,
					id: row.id ?? null,
				});
			}
			sections[section].push(row);
		});
	}
	for (const row of sections.requirements) {
		if (!text(row?.statement))
			findings.push({
				code: "manifest_requirement_statement_missing",
				id: row?.id ?? null,
			});
	}
	for (const row of sections.architecture) {
		if (!text(row?.decision) && !text(row?.summary)) {
			findings.push({
				code: "manifest_architecture_summary_missing",
				id: row?.id ?? null,
			});
		}
	}
	const tasks = sections.tasks;
	walk(
		{ slices: implementation.slices, waves: implementation.waves },
		(node) => {
			if (!Array.isArray(node.slices)) return;
			for (const slice of node.slices) {
				if (!tasks.some((task) => task?.id === slice?.id)) {
					findings.push({
						code: "manifest_slice_task_missing",
						id: slice?.id ?? null,
					});
				}
			}
		},
	);
	for (const row of tasks) {
		for (const field of ["depends_on", "write_set"]) {
			if (Array.isArray(row[field]) && !row[field].every(text)) {
				findings.push({
					code: "manifest_task_field_invalid",
					id: row.id ?? null,
					field,
				});
			}
		}
		const fields = {
			role: text(row?.role),
			route:
				content(row?.route) ||
				content(row?.model_route) ||
				content(row?.effective_route),
			depends_on: Array.isArray(row?.depends_on) || text(row?.depends_on),
			write_set: Array.isArray(row?.write_set) || text(row?.write_set),
		};
		for (const [field, present] of Object.entries(fields)) {
			if (!present)
				findings.push({
					code: "manifest_task_field_missing",
					id: row?.id ?? null,
					field,
				});
		}
	}
	const documentation = sections.documentation;
	if (
		!documentation.some(
			(row) =>
				(row?.not_applicable === true && text(row.reason)) ||
				(text(row?.impact) && [row?.surface, row?.path, row?.id].some(text)),
		)
	) {
		findings.push({ code: "manifest_documentation_unspecified" });
	}
	for (const model of sections.models) {
		if (!["diagram-assisted", "sysml-v2"].includes(model?.mode)) continue;
		const views = model.view ? [model.view] : rows(model.views);
		const supplement = rows(manifest.closeout?.model_views).filter(
			(row) => row?.model_id === model.id,
		);
		let bound = [...views, ...supplement.map((row) => row.view)].some(
			(view) =>
				["svg", "png"].includes(view?.format) &&
				(text(view.path) || (view.format === "svg" && text(view.inline))),
		);
		const view = views[0] || supplement[0]?.view;
		let reason;
		if (view?.format === "mermaid") {
			try {
				const digest = views[0] ? model.digest : supplement[0].digest;
				loadVerifiedMermaidView(
					{ id: model.id, mode: model.mode, view, digest },
					dir,
				);
				bound = true;
			} catch (error) {
				bound = false;
				reason = error.code || "UNSAFE_ASSET";
			}
		}
		// N/A or deselection cannot override a selected modeling mode.
		if (model.not_applicable === true || model.selected === false || !bound) {
			findings.push({
				code: "manifest_model_view_missing",
				id: model.id ?? null,
				mode: model.mode,
				...(reason && { reason }),
			});
		}
	}
	return findings;
}

/**
 * #205: the one planning wave. A draft freeze (before any review) needs a
 * valid session declaration: exactly the profile-enabled specialist sessions
 * the task needs, possibly none. The final freeze that precedes the handoff
 * needs every declared session returned ready for the closing candidate,
 * deterministic closure, and the closing candidate equal to the frozen
 * manifest digest. Review evidence is required only at an owner-requested
 * boundary: `review_requested: false` records the owner's choice with zero
 * reviews, zero repairs, and no receipt; otherwise (true or omitted) exactly
 * one digest-pinned review, at most one repair, and its lineage are required.
 * The original pinned review record is evaluated without replacing its
 * sessions or reviewer identities; one explicit repair links that reviewed
 * candidate to closure.
 */
function checkWaveRecord(wave, context) {
	const { stage = "final", correctionId = null } = context;
	if (!wave || typeof wave !== "object" || Array.isArray(wave)) {
		return [
			{
				code: "planning_wave_missing",
				...(correctionId ? { correction_id: correctionId } : {}),
			},
		];
	}
	const sessions = planningSessionsVerdict({
		required_sessions: wave.required_sessions,
		sessions: [],
	});
	if (sessions?.reason === "planning_sessions_invalid") {
		return [
			{
				code: "planning_sessions_invalid",
				...(correctionId ? { correction_id: correctionId } : {}),
			},
		];
	}
	if (
		wave.review_requested !== undefined &&
		typeof wave.review_requested !== "boolean"
	) {
		return [
			{
				code: "planning_wave_review_request_invalid",
				recorded: wave.review_requested,
				...(correctionId ? { correction_id: correctionId } : {}),
			},
		];
	}
	const findings = [];
	const push = (finding) =>
		findings.push({
			...finding,
			...(correctionId ? { correction_id: correctionId } : {}),
			...(stage === "draft" ? { blocking: false } : {}),
		});
	try {
		checkWaveClosure(wave, context, push);
	} catch (error) {
		if (stage !== "draft") throw error;
		push({ code: "planning_wave_closure_unreadable" });
	}
	return findings;
}

function checkWaveClosure(
	wave,
	{ expectedDigest, isLatest, dir, inputDigests, correctionId = null },
	push,
) {
	if (!Array.isArray(wave.sessions)) {
		push({ code: "planning_wave_sessions_incomplete" });
	}
	if (
		!Number.isInteger(wave.repairs) ||
		wave.repairs < 0 ||
		wave.repairs > REVIEW_POLICY.aggregated_repairs_max
	) {
		push({
			code: "planning_wave_repair_limit",
			recorded: wave.repairs ?? null,
		});
	}
	if (wave.closure !== REVIEW_POLICY.post_repair_gate) {
		push({
			code: "planning_wave_closure_missing",
			recorded: wave.closure ?? null,
		});
	}
	if (isLatest) {
		if (!expectedDigest || wave.candidate_digest !== expectedDigest) {
			push({
				code: "planning_wave_candidate_mismatch",
				recorded: wave.candidate_digest ?? null,
				actual: expectedDigest,
			});
		}
	} else if (
		typeof wave.candidate_digest !== "string" ||
		!/^[0-9a-f]{64}$/.test(wave.candidate_digest)
	) {
		push({
			code: "planning_wave_candidate_mismatch",
			recorded: wave.candidate_digest ?? null,
			actual: expectedDigest,
		});
	}
	const closing = wave.closing_candidate;
	const closingMatches =
		sameCandidate(closing, closing) &&
		closing.candidate_digest === wave.candidate_digest;
	if (!closingMatches) {
		push({
			code: "planning_wave_candidate_mismatch",
			recorded: closing ?? null,
			actual: expectedDigest,
		});
	}
	if (wave.review_requested === false) {
		// Unrequested review is recorded, never dispatched or forged.
		if (wave.reviews !== 0)
			push({
				code: "planning_wave_review_count",
				recorded: wave.reviews ?? null,
			});
		if (wave.repairs !== 0)
			push({
				code: "planning_wave_repair_limit",
				recorded: wave.repairs ?? null,
			});
		if (wave.review_receipt !== undefined || wave.repair !== undefined) {
			push({
				code: "planning_wave_review_invalid",
				reason: "unrequested_review_evidence",
			});
		}
		if (closingMatches && Array.isArray(wave.sessions)) {
			const sessionVerdict = planningSessionsVerdict(
				wave,
				closing,
				isLatest ? inputDigests : wave.input_digests,
				{
					requireSnapshot:
						isLatest ||
						correctionId !== null ||
						wave.input_digests !== undefined ||
						Boolean(wave.edit_records?.length),
					dir,
					historical: !isLatest,
				},
			);
			if (sessionVerdict) {
				push({
					code:
						sessionVerdict.reason === "external_items_open"
							? "planning_wave_external_items_open"
							: "planning_wave_sessions_incomplete",
				});
			}
		}
		return;
	}
	if (wave.reviews !== REVIEW_POLICY.review_rounds) {
		push({
			code: "planning_wave_review_count",
			recorded: wave.reviews ?? null,
		});
	}
	const invalidReview = (reason) =>
		push({ code: "planning_wave_review_invalid", reason });
	const ref = wave.review_receipt;
	let review;
	if (
		!ref ||
		typeof ref.path !== "string" ||
		!ref.path ||
		!/^[0-9a-f]{64}$/.test(ref.sha256)
	) {
		invalidReview("receipt_missing");
	} else {
		try {
			const root = fs.realpathSync(dir);
			const file = fs.realpathSync(path.resolve(root, ref.path));
			if (path.isAbsolute(ref.path) || !file.startsWith(root + path.sep)) {
				invalidReview("receipt_path_invalid");
			} else {
				const bytes = withRegularFile(file, fs.readFileSync);
				if (sha256(bytes) !== ref.sha256)
					invalidReview("receipt_digest_mismatch");
				else review = JSON.parse(bytes);
			}
		} catch {
			invalidReview("receipt_unreadable");
		}
	}
	if (review) {
		const historical =
			!isLatest ||
			(wave.repairs === 1 &&
				sameCandidate(wave.repair?.from_candidate, review.candidate) &&
				sameCandidate(wave.repair?.to_candidate, wave.closing_candidate));
		let result;
		try {
			result = evaluatePlanningReview(
				{ ...review, plan_dir: dir },
				{ historical },
			);
		} catch {
			result = { outcome: "FAIL", reason: "receipt_invalid" };
		}
		if (result.outcome !== "PASS") invalidReview(result.reason);
		else if (
			correctionId === null
				? review.correction_id !== undefined
				: review.correction_id !== correctionId
		) {
			invalidReview("correction_id_mismatch");
		} else if (
			!review.receipts.every((receipt) =>
				["ACCEPT", "PASS", "REPAIR_REQUIRED"].includes(receipt.verdict),
			)
		) {
			invalidReview("reviewer_receipt_pending");
		}
		// Keep the original review and specialist provenance, even after repair.
		if (
			!isDeepStrictEqual(
				wave.required_sessions,
				review.planning_wave?.required_sessions,
			) ||
			!isDeepStrictEqual(wave.sessions, review.planning_wave?.sessions) ||
			!isDeepStrictEqual(
				wave.closing_returns ?? null,
				review.planning_wave?.closing_returns ?? null,
			) ||
			!isDeepStrictEqual(
				wave.external_closures ?? null,
				review.planning_wave?.external_closures ?? null,
			) ||
			!isDeepStrictEqual(
				wave.edit_records ?? null,
				review.planning_wave?.edit_records ?? null,
			)
		) {
			push({ code: "planning_wave_session_provenance_mismatch" });
		}
		const sessionVerdict = planningSessionsVerdict(
			wave,
			review.candidate,
			review.input_digests,
			{ dir, historical },
		);
		if (sessionVerdict) {
			push({
				code:
					sessionVerdict.reason === "external_items_open"
						? "planning_wave_external_items_open"
						: "planning_wave_sessions_incomplete",
			});
		}
		const repair = wave.repair;
		if (
			Number(review.aggregated_repairs || 0) !== 0 ||
			(Array.isArray(review.receipts) &&
				review.receipts.some(
					(receipt) => receipt?.verdict === "REPAIR_REQUIRED",
				) &&
				wave.repairs !== 1) ||
			(wave.repairs === 0
				? !sameCandidate(closing, review.candidate) || repair !== undefined
				: !sameCandidate(repair?.from_candidate, review.candidate) ||
					!sameCandidate(repair?.to_candidate, closing) ||
					repair?.deterministic_gate !== "PASS")
		) {
			push({ code: "planning_wave_repair_lineage_invalid" });
		}
	} else if (review !== undefined) {
		invalidReview("receipt_invalid");
	}
}

function checkPlanningWave(
	implementation,
	manifestDigest,
	stage = "final",
	dir,
	inputDigests,
) {
	const wave = implementation?.journey_settings?.planning_wave;
	const corrections = implementation?.journey_settings?.planning_corrections;
	if (corrections !== undefined && !Array.isArray(corrections)) {
		return [{ code: "planning_corrections_invalid" }];
	}
	const hasCorrections = Array.isArray(corrections) && corrections.length > 0;
	const findings = checkWaveRecord(wave, {
		expectedDigest: hasCorrections ? wave?.candidate_digest : manifestDigest,
		isLatest: !hasCorrections,
		stage,
		dir,
		inputDigests,
		correctionId: null,
	});
	if (!hasCorrections) return findings;
	const seenIds = new Set();
	let prevClosing = wave?.closing_candidate;
	for (let i = 0; i < corrections.length; i++) {
		const corr = corrections[i];
		const id =
			typeof corr?.correction_id === "string" &&
			corr.correction_id.trim().length > 0
				? corr.correction_id
				: null;
		if (
			!corr ||
			typeof corr !== "object" ||
			Array.isArray(corr) ||
			!id ||
			seenIds.has(id)
		) {
			findings.push({
				code: "planning_corrections_invalid",
				index: i,
				correction_id: id,
			});
			continue;
		}
		seenIds.add(id);
		if (
			stage === "final"
				? !sameCandidate(corr.from_candidate, prevClosing)
				: !sameCandidate(corr.from_candidate, corr.from_candidate)
		) {
			findings.push({
				code: "planning_correction_lineage_invalid",
				correction_id: id,
			});
		}
		const isLatest = i === corrections.length - 1;
		findings.push(
			...checkWaveRecord(corr, {
				expectedDigest: isLatest ? manifestDigest : corr.candidate_digest,
				isLatest,
				stage,
				dir,
				inputDigests,
				correctionId: id,
			}),
		);
		prevClosing = corr.closing_candidate;
	}
	return findings;
}

/**
 * #155: Integration and Test's Boundary/Data-Flow Contract,
 * copied into implementation.json from design.md and the System Catalog (no
 * sixth artifact). Either a not-applicable rationale, or flows with owned
 * source and sink, path, transformations, side effects, contract authority,
 * evidence basis, and failure/recovery; state machines with transitions,
 * illegal transitions, and a model binding; trust boundaries with their
 * enforcement point. Each names resolving SEIT rows. An unresolved gap blocks.
 */
function checkBoundaryContract(implementation, seit) {
	const contract = implementation?.boundary_contract;
	const text = (value) => typeof value === "string" && value.trim().length > 0;
	const list = (value) => Array.isArray(value) && value.every(text);
	const filled = (value) => list(value) && value.length > 0;
	if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
		return [{ code: "boundary_contract_missing" }];
	}
	const groups = ["flows", "state_machines", "trust_boundaries"];
	const findings = [];
	for (const gap of Array.isArray(contract.gaps) ? contract.gaps : []) {
		if (gap?.status !== "resolved")
			findings.push({ code: "boundary_gap_unresolved", id: gap?.id ?? null });
	}
	if (contract.not_applicable === true) {
		if (!text(contract.reason))
			findings.push({ code: "boundary_na_reason_missing" });
		if (
			groups.some((key) => Array.isArray(contract[key]) && contract[key].length)
		)
			findings.push({ code: "boundary_na_with_content" });
		return findings;
	}
	if (
		!groups.some((key) => Array.isArray(contract[key]) && contract[key].length)
	) {
		findings.push({ code: "boundary_contract_empty" });
	}
	const seitIds = new Set(
		(Array.isArray(seit?.proof_cases) ? seit.proof_cases : []).map(
			(row) => row?.id,
		),
	);
	const rows = (key) => (Array.isArray(contract[key]) ? contract[key] : []);
	const verified = (row, id) => {
		if (!filled(row.seit_rows))
			findings.push({ code: "boundary_unverified", id });
		else
			for (const ref of row.seit_rows) {
				if (!seitIds.has(ref))
					findings.push({
						code: "boundary_seit_row_unresolved",
						id,
						seit_row: ref,
					});
			}
	};
	for (const flow of rows("flows")) {
		const id = flow?.id ?? null;
		for (const end of ["source", "sink"]) {
			if (!text(flow?.[end]?.component) || !text(flow?.[end]?.owner)) {
				findings.push({ code: "boundary_flow_endpoint_missing", id, end });
			}
		}
		for (const field of ["path", "transformations", "side_effects"]) {
			if (!list(flow?.[field]))
				findings.push({ code: "boundary_flow_field_missing", id, field });
		}
		if (!filled(flow?.failure_recovery))
			findings.push({ code: "boundary_flow_failure_missing", id });
		if (!text(flow?.authority))
			findings.push({ code: "boundary_flow_authority_missing", id });
		if (!["observed", "proposed"].includes(flow?.evidence))
			findings.push({ code: "boundary_flow_evidence_invalid", id });
		verified(flow || {}, id);
	}
	for (const machine of rows("state_machines")) {
		const id = machine?.id ?? null;
		const transitions = Array.isArray(machine?.transitions)
			? machine.transitions
			: [];
		if (
			!transitions.length ||
			!transitions.every((t) =>
				["from", "event", "to"].every((key) => text(t?.[key])),
			)
		) {
			findings.push({ code: "boundary_state_transitions_missing", id });
		}
		const illegal = Array.isArray(machine?.illegal_transitions)
			? machine.illegal_transitions
			: [];
		if (
			!illegal.length ||
			!illegal.every((t) =>
				["from", "event", "handling"].every((key) => text(t?.[key])),
			)
		) {
			findings.push({ code: "boundary_state_illegal_missing", id });
		}
		if (!text(machine?.model) && !text(machine?.model_na_reason)) {
			findings.push({ code: "boundary_state_model_unbound", id });
		}
		verified(machine || {}, id);
	}
	for (const boundary of rows("trust_boundaries")) {
		const id = boundary?.id ?? null;
		if (!text(boundary?.crossing) || !text(boundary?.enforcement)) {
			findings.push({ code: "boundary_trust_enforcement_missing", id });
		}
		verified(boundary || {}, id);
	}
	return findings;
}

/** Final assembly must close the requirements-stage pending case bindings. */
function checkFinalRegister(
	dir,
	seit,
	implementation,
	{ finalPlanText, alignmentText },
) {
	const settings = implementation?.journey_settings || {};
	const authority = readJson(
		path.join(dir, "authority.json"),
		"authority.json",
	);
	if (
		settings.journey_type !== "specification" &&
		settings.requirement_register == null &&
		authority?.requirement_register == null
	)
		return [];
	const register =
		settings.requirement_register ?? authority?.requirement_register?.path;
	if (typeof register !== "string" || !register.endsWith(".sdoc"))
		return [{ code: "missing_requirement_register" }];
	const plans = planningInputs(seit, implementation).filter(
		(input) =>
			typeof input?.path === "string" &&
			(input.path.endsWith("-technical-plan.md") ||
				path.basename(input.path) === "plan.md"),
	);
	if (plans.length !== 1)
		return [{ code: "register_precheck_context_invalid", count: plans.length }];
	const isLatePlan = plans[0] === settings.final_technical_plan;
	if (isLatePlan && finalPlanText === undefined) return []; // Digest validation already named the unreadable input.
	const root = repoRoot(dir);
	const regAbs = path.resolve(root, register);
	const planAbs = path.resolve(root, plans[0].path);
	let result;
	try {
		result = checkRegisterFiles({
			registerPath: regAbs,
			planPath: planAbs,
			root,
			stage: "final",
			seitPath: path.join(dir, "seit.json"),
			technicalPlan: isLatePlan ? finalPlanText : undefined,
			decisionContext: alignmentText,
		});
	} catch (error) {
		const offending = error?.path === planAbs ? plans[0].path : register;
		throw withFilePath(error, offending);
	}
	return result.findings.map((finding) => ({
		code: "register_precheck_failed",
		...finding,
	}));
}

const DEFAULT_CONTROL_CATALOG_DIR = path.resolve(
	__dirname,
	"..",
	"catalog",
	"controls",
);

const isPlain = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const isNonEmptyStr = (value) =>
	typeof value === "string" && value.trim().length > 0;

/** #584: load reusable security control catalogue entries keyed by control ID. */
function loadControlCatalogue(catalogDir = DEFAULT_CONTROL_CATALOG_DIR) {
	const byId = new Map();
	if (!fs.existsSync(catalogDir)) return byId;
	const files = fs
		.readdirSync(catalogDir)
		.filter((name) => name.endsWith(".json"))
		.sort();
	for (const name of files) {
		const parsed = JSON.parse(
			fs.readFileSync(path.join(catalogDir, name), "utf8"),
		);
		const entries = Array.isArray(parsed?.controls)
			? parsed.controls
			: [parsed];
		for (const entry of entries) {
			if (isPlain(entry) && isNonEmptyStr(entry.id)) byId.set(entry.id, entry);
		}
	}
	return byId;
}

function matchesParameterType(value, type) {
	if (type === "string") return isNonEmptyStr(value);
	if (type === "integer") return Number.isInteger(value);
	if (type === "boolean") return typeof value === "boolean";
	if (type === "array") return Array.isArray(value) && value.length > 0;
	return false;
}

function resolveControlParameters(control, supplied) {
	const findings = [];
	const resolved = {};
	const specs = isPlain(control?.parameters) ? control.parameters : {};
	if (!isPlain(supplied)) {
		return {
			parameters: resolved,
			findings: [
				{ code: "control_parameters_invalid", control_id: control?.id ?? null },
			],
		};
	}
	for (const key of Object.keys(supplied)) {
		if (!Object.hasOwn(specs, key)) {
			findings.push({
				code: "unknown_control_parameter",
				control_id: control.id,
				parameter: key,
			});
		}
	}
	for (const [name, spec] of Object.entries(specs)) {
		const hasValue =
			Object.hasOwn(supplied, name) &&
			supplied[name] !== undefined &&
			supplied[name] !== null;
		if (!hasValue) {
			if (!spec?.required && spec?.default !== undefined)
				resolved[name] = spec.default;
			else
				findings.push({
					code: "control_parameter_missing",
					control_id: control.id,
					parameter: name,
				});
			continue;
		}
		const value = supplied[name];
		if (
			!matchesParameterType(value, spec?.type) ||
			(Array.isArray(spec?.enum) && !spec.enum.includes(value))
		) {
			findings.push({
				code: "control_parameter_invalid",
				control_id: control.id,
				parameter: name,
				expected_type: spec?.type ?? null,
			});
			continue;
		}
		resolved[name] = value;
	}
	return { parameters: resolved, findings };
}

function renderTemplateValue(node, params, unresolved) {
	if (typeof node === "string") {
		const rendered = node.replace(
			/\{\{([a-z][a-z0-9_]*)\}\}/g,
			(match, key) => {
				if (!Object.hasOwn(params, key)) {
					unresolved.push(key);
					return match;
				}
				const val = params[key];
				return Array.isArray(val) ? val.join(", ") : String(val);
			},
		);
		for (const extra of rendered.matchAll(/\{\{([^}]+)\}\}/g))
			unresolved.push(extra[1]);
		return rendered;
	}
	if (Array.isArray(node))
		return node.map((item) => renderTemplateValue(item, params, unresolved));
	if (isPlain(node)) {
		const out = {};
		for (const [key, val] of Object.entries(node))
			out[key] = renderTemplateValue(val, params, unresolved);
		return out;
	}
	return node;
}

/** #584: parameterize one catalogue control entry into a requirement and paired positive/negative cases. */
function parameterizeControl(control, selection) {
	const findings = [];
	if (!isPlain(control) || !isNonEmptyStr(control.id)) {
		return {
			ok: false,
			findings: [{ code: "invalid_control_entry" }],
			parameters: {},
			requirement: null,
			positive_case: null,
			negative_case: null,
		};
	}
	if (!isPlain(selection)) {
		return {
			ok: false,
			findings: [{ code: "invalid_control_selection", control_id: control.id }],
			parameters: {},
			requirement: null,
			positive_case: null,
			negative_case: null,
		};
	}
	if (!isNonEmptyStr(selection.requirement_id)) {
		findings.push({
			code: "control_requirement_id_missing",
			control_id: control.id,
		});
	}
	if (
		!isNonEmptyStr(selection.positive_case_id) ||
		!isNonEmptyStr(selection.negative_case_id)
	) {
		findings.push({ code: "control_case_id_missing", control_id: control.id });
	} else if (selection.positive_case_id === selection.negative_case_id) {
		findings.push({
			code: "control_case_ids_identical",
			control_id: control.id,
			case_id: selection.positive_case_id,
		});
	}
	const paramResult = resolveControlParameters(control, selection.parameters);
	findings.push(...paramResult.findings);
	const unresolved = [];
	const reqTpl = renderTemplateValue(
		control.requirement,
		paramResult.parameters,
		unresolved,
	);
	const posTpl = renderTemplateValue(
		control.positive_case,
		paramResult.parameters,
		unresolved,
	);
	const negTpl = renderTemplateValue(
		control.negative_case,
		paramResult.parameters,
		unresolved,
	);
	if (unresolved.length) {
		findings.push({
			code: "control_unresolved_placeholder",
			control_id: control.id,
			placeholders: [...new Set(unresolved)],
		});
	}
	const toCase = (caseId, tpl) => {
		if (!isPlain(tpl)) return null;
		const { id_suffix: _ignored, ...rest } = tpl;
		return { id: caseId, requirement_id: selection.requirement_id, ...rest };
	};
	const requirement = isPlain(reqTpl)
		? { uid: selection.requirement_id, ...reqTpl }
		: null;
	const positive_case = toCase(selection.positive_case_id, posTpl);
	const negative_case = toCase(selection.negative_case_id, negTpl);
	return {
		ok: findings.length === 0,
		findings,
		parameters: paramResult.parameters,
		requirement,
		positive_case,
		negative_case,
	};
}

/** #584: validate any declared `selected_controls` in implementation.json or seit.json against catalog/controls/. */
function checkSelectedControls(implementation, seit, { catalogDir } = {}) {
	const sources = [
		["implementation.json", implementation?.selected_controls],
		["seit.json", seit?.selected_controls],
	].filter(([, value]) => value !== undefined);
	if (!sources.length) return [];
	const catalogue = loadControlCatalogue(catalogDir);
	const proofCases = Array.isArray(seit?.proof_cases) ? seit.proof_cases : [];
	const seitCases = new Map(
		proofCases
			.filter((row) => isNonEmptyStr(row?.id))
			.map((row) => [row.id, row]),
	);
	const findings = [];
	for (const [source, list] of sources) {
		const seenReqIds = new Set();
		if (!Array.isArray(list)) {
			findings.push({ code: "selected_controls_invalid", source });
			continue;
		}
		for (const selection of list) {
			if (!isPlain(selection)) {
				findings.push({ code: "selected_control_invalid", source });
				continue;
			}
			const controlId = selection.control_id;
			if (!isNonEmptyStr(controlId) || !catalogue.has(controlId)) {
				findings.push({
					code: "unknown_control_id",
					source,
					control_id: controlId ?? null,
				});
				continue;
			}
			const control = catalogue.get(controlId);
			if (isNonEmptyStr(selection.requirement_id)) {
				if (seenReqIds.has(selection.requirement_id)) {
					findings.push({
						code: "duplicate_control_requirement_id",
						source,
						control_id: controlId,
						requirement_id: selection.requirement_id,
					});
				}
				seenReqIds.add(selection.requirement_id);
			}
			const rendered = parameterizeControl(control, selection);
			for (const f of rendered.findings) findings.push({ ...f, source });
			for (const caseId of [
				selection.positive_case_id,
				selection.negative_case_id,
			]) {
				if (!isNonEmptyStr(caseId)) continue;
				const proof = seitCases.get(caseId);
				if (!proof) {
					findings.push({
						code: "control_case_unresolved",
						source,
						control_id: controlId,
						case_id: caseId,
					});
				} else if (
					isNonEmptyStr(selection.requirement_id) &&
					proof.requirement_id !== selection.requirement_id
				) {
					findings.push({
						code: "control_case_requirement_mismatch",
						source,
						control_id: controlId,
						case_id: caseId,
						expected: selection.requirement_id,
						actual: proof.requirement_id ?? null,
					});
				}
			}
		}
	}
	return findings;
}

function pathsOverlap(a, b) {
	return (
		a === b ||
		(a.endsWith("/") && b.startsWith(a)) ||
		(b.endsWith("/") && a.startsWith(b))
	);
}

/** #608: flag ordering edges between slices that share no input or resource without refusing the freeze. */
function checkSerialChains(implementation) {
	const nodes = [...sliceNodes(implementation)];
	const byId = new Map();
	for (const node of nodes) {
		if (typeof node.id === "string" && node.id && !byId.has(node.id))
			byId.set(node.id, node);
	}
	const edges = [];
	const seenEdges = new Set();
	const addEdge = (from, to) => {
		if (
			typeof from !== "string" ||
			typeof to !== "string" ||
			!from ||
			!to ||
			from === to
		)
			return;
		const key = `${from}\0${to}`;
		if (seenEdges.has(key)) return;
		seenEdges.add(key);
		edges.push([from, to]);
	};
	for (const node of nodes) {
		if (typeof node.id !== "string" || !node.id) continue;
		for (const dep of Array.isArray(node.depends_on) ? node.depends_on : []) {
			addEdge(dep, node.id);
		}
	}
	for (const edge of Array.isArray(implementation?.dependencies)
		? implementation.dependencies
		: []) {
		addEdge(edge?.from, edge?.to);
	}
	const strList = (val) =>
		Array.isArray(val) ? val.filter((x) => typeof x === "string" && x) : [];
	const resSet = (slice) => {
		const out = new Set(strList(slice.resource_groups));
		if (typeof slice.resource === "string" && slice.resource)
			out.add(slice.resource);
		return out;
	};
	const declaresFlow = (slice) =>
		Array.isArray(slice.inputs) ||
		(typeof slice.resource === "string" && slice.resource.length > 0);
	const findings = [];
	for (const [fromId, toId] of edges) {
		const from = byId.get(fromId);
		const to = byId.get(toId);
		if (!from || !to) continue;
		if (!declaresFlow(from) || !declaresFlow(to)) continue;
		const fromInputs = strList(from.inputs);
		const toInputs = strList(to.inputs);
		const fromWrites = strList(from.write_set);
		const toWrites = strList(to.write_set);
		const sharesInput =
			toInputs.includes(fromId) ||
			toInputs.some((inp) =>
				fromInputs.some((other) => pathsOverlap(other, inp)),
			) ||
			toInputs.some((inp) => fromWrites.some((w) => pathsOverlap(w, inp)));
		const fromRes = resSet(from);
		const toRes = resSet(to);
		const sharesResource =
			[...toRes].some((r) => fromRes.has(r)) ||
			toWrites.some((w1) => fromWrites.some((w2) => pathsOverlap(w1, w2)));
		if (!sharesInput && !sharesResource) {
			findings.push({
				code: "false_serial_chain",
				from: fromId,
				to: toId,
				blocking: false,
				reason: `Ordering edge ${fromId} -> ${toId} shares no input or resource.`,
			});
		}
	}
	return findings;
}

const EXCHANGE_DIGEST = /^[0-9a-f]{64}$/i;
const EXCHANGE_TIME =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/;

function validExchangeRecord(record) {
	const validDigest = (value) =>
		typeof value === "string" && EXCHANGE_DIGEST.test(value);
	return (
		isPlain(record) &&
		[record.from, record.to, record.request_id, record.body_path].every(
			isNonEmptyStr,
		) &&
		typeof record.time === "string" &&
		EXCHANGE_TIME.test(record.time) &&
		Number.isFinite(Date.parse(record.time)) &&
		(record.reply_to === null || isNonEmptyStr(record.reply_to)) &&
		validDigest(record.body_sha256) &&
		typeof record.delivered === "boolean" &&
		(record.attempts === 1 ||
			record.attempts === 2 ||
			(record.attempts === 0 &&
				record.allowed === false &&
				!record.delivered)) &&
		typeof record.allowed === "boolean" &&
		isPlain(record.role_file_digests) &&
		Object.entries(record.role_file_digests).every(
			([role, files]) =>
				isNonEmptyStr(role) &&
				isPlain(files) &&
				Object.entries(files).every(
					([file, digest]) => isNonEmptyStr(file) && validDigest(digest),
				),
		)
	);
}

function withContainedFile(root, relativePath, read) {
	const inside = (file) => {
		const relative = path.relative(root, file);
		return (
			relative &&
			relative !== ".." &&
			!relative.startsWith(".." + path.sep) &&
			!path.isAbsolute(relative)
		);
	};
	const resolved = path.resolve(root, relativePath);
	if (path.isAbsolute(relativePath) || !inside(resolved)) {
		throw new Error("file path escapes its root");
	}
	const file = fs.realpathSync(resolved);
	if (!inside(file)) throw new Error("file symlink escapes its root");
	return withRegularFile(file, read);
}

function withRegularFile(file, read) {
	// Opening nonblocking prevents a named pipe from hanging a hook.
	const fd = fs.openSync(
		file,
		fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW,
	);
	try {
		if (!fs.fstatSync(fd).isFile())
			throw new Error("input must be a regular file");
		return read(fd);
	} finally {
		fs.closeSync(fd);
	}
}

function* exchangeLines(fd) {
	const chunk = Buffer.alloc(8192);
	const decoder = new StringDecoder("utf8");
	let remainder = "";
	while (true) {
		const bytes = fs.readSync(fd, chunk, 0, chunk.length, null);
		if (bytes <= 0) break;
		const lines = (remainder + decoder.write(chunk.subarray(0, bytes))).split(
			"\n",
		);
		remainder = lines.pop();
		yield* lines;
	}
	remainder += decoder.end();
	if (remainder) yield remainder;
}

function readLiveExchange(dir, wave, findings) {
	const summary = { wave, records: 0, undelivered: [], not_allowed: [] };
	const exchangePath = `live/${wave}/exchange.jsonl`;
	const malformed = (details = {}) =>
		findings.push({
			code: "live_exchange_malformed",
			path: exchangePath,
			...details,
		});
	const requestIds = new Set();
	try {
		if (
			!isNonEmptyStr(wave) ||
			/[\\/]/.test(wave) ||
			wave === "." ||
			wave === ".."
		) {
			malformed({ reason: "invalid_wave_id" });
			return summary;
		}
		const root = fs.realpathSync(dir);
		withContainedFile(root, exchangePath, (fd) => {
			let line = 0;
			for (const text of exchangeLines(fd)) {
				line += 1;
				let record;
				try {
					record = JSON.parse(text);
				} catch {
					malformed({ line });
					continue;
				}
				if (
					!validExchangeRecord(record) ||
					(record.reply_to !== null && !requestIds.has(record.reply_to))
				) {
					malformed({ line });
					continue;
				}
				if (record.reply_to === null) requestIds.add(record.request_id);
				summary.records += 1;
				if (!record.allowed) summary.not_allowed.push(record.request_id);
				else if (!record.delivered) summary.undelivered.push(record.request_id);
				let digest;
				try {
					digest = withContainedFile(root, record.body_path, (body) =>
						sha256(fs.readFileSync(body)),
					);
				} catch {
					// An unreadable or out-of-directory body cannot substantiate the recorded digest.
				}
				if (digest !== record.body_sha256.toLowerCase()) {
					findings.push({
						code: "live_exchange_body_digest_mismatch",
						path: exchangePath,
						line,
						request_id: record.request_id,
					});
				}
			}
		});
	} catch (error) {
		if (error.code === "ENOENT") summary.missing = true;
		else malformed({ reason: "exchange_unreadable" });
	}
	return summary;
}

function readLiveWave(dir, findings, implementation) {
	if (!isNonEmptyStr(dir)) return undefined;
	if (implementation === undefined) {
		try {
			implementation = withContainedFile(
				fs.realpathSync(dir),
				"implementation.json",
				(fd) => JSON.parse(fs.readFileSync(fd, "utf8")),
			);
		} catch {
			// Closeout's optional plan directory cannot establish live-wave opt-in without a readable plan.
			return undefined;
		}
	}
	if (implementation?.journey_settings?.live_wave !== "herdr") return undefined;
	const waves = Array.isArray(implementation.waves) ? implementation.waves : [];
	return {
		waves: waves.map((wave) => readLiveExchange(dir, wave?.id, findings)),
	};
}

function freeze(dir, { stage = "final" } = {}) {
	try {
		const seit = readJson(path.join(dir, "seit.json"), "seit.json");
		const implementation = readJson(
			path.join(dir, "implementation.json"),
			"implementation.json",
		);
		const digests = verifyPackageDigests(dir, { seit, implementation });
		const findings = [
			...(implementation
				? [
						...checkReviewRounds(implementation),
						...checkPlanningWave(
							implementation,
							digests.manifest_digest,
							stage,
							dir,
							digests.input_digests,
						),
						...(stage === "final"
							? checkFinalRegister(dir, seit, implementation, digests)
							: []),
						...checkBoundaryContract(implementation, seit),
						...checkSerialChains(implementation),
					]
				: []),
			...checkManifestProjection(implementation, dir),
			...checkRoles(seit, implementation),
			...checkWorkClass(implementation),
			...checkPlanningRoles(implementation),
			...checkDuplicateGates(implementation),
			...checkDuplicateGates(seit),
			...checkIntegrationStepRefs(implementation),
			...checkSelectedControls(implementation, seit),
			...checkFrozenHashes(
				dir,
				[],
				declaredFrozenHashArtifacts(dir, seit, implementation),
			),
			...checkLivePins(dir),
			...digests.findings,
		];
		const live_wave =
			stage === "final"
				? readLiveWave(dir, findings, implementation)
				: undefined;
		const blocking = findings.some((f) => f && f.blocking !== false);
		return {
			outcome: blocking ? "FAIL" : "PASS",
			stage,
			manifest_digest: digests.manifest_digest,
			findings,
			...(live_wave ? { live_wave } : {}),
		};
	} catch (error) {
		const rawPath = error?.filePath || error?.path;
		const filePath =
			typeof rawPath === "string" && rawPath
				? path.isAbsolute(rawPath)
					? path.relative(dir, rawPath) || path.basename(rawPath)
					: rawPath
				: undefined;
		return {
			outcome: "FAIL",
			stage,
			manifest_digest: null,
			findings: [
				{
					code: "planning_input_unreadable",
					...(filePath ? { path: filePath } : {}),
					reason: error.code || "INVALID_INPUT",
				},
			],
		};
	}
}

/** #190: CMD-* / PROC-* ids named in a wave's free-text exit criterion. */
const COMMAND_ID = /\b(?:CMD|PROC)-[A-Z0-9.-]*[A-Z0-9]/g;

function readyView(dir, state) {
	const implementation = JSON.parse(
		fs.readFileSync(path.join(dir, "implementation.json"), "utf8"),
	);
	const byId = new Map();
	for (const slice of sliceNodes(implementation)) {
		if (typeof slice.id !== "string" || !slice.id || byId.has(slice.id))
			continue;
		byId.set(slice.id, {
			...slice,
			depends_on: Array.isArray(slice.depends_on) ? [...slice.depends_on] : [],
		});
	}
	for (const edge of Array.isArray(implementation.dependencies)
		? implementation.dependencies
		: []) {
		if (byId.has(edge?.from) && byId.has(edge?.to)) {
			byId.get(edge.to).depends_on.push(edge.from);
		}
	}
	return evaluateReadySet({ ...state, slices: [...byId.values()] });
}

/**
 * #190: one wave's slices, write sets, and resolved commands, so a
 * Coordinator never re-derives the package layout. Slices come from
 * waves[].slice_ids (resolved against slices[]) or nested waves[].slices;
 * exit commands from waves[].exit_command_ids, else ids named in exit.
 */
function waveView(dir, waveId) {
	const implementation = readJson(path.join(dir, "implementation.json"));
	const seit = readJson(path.join(dir, "seit.json"));
	const procedures = new Map(
		(seit?.procedures_and_commands || []).map((p) => [p.id, p]),
	);
	const findings = [];
	const resolve = (step, ids) =>
		ids.flatMap((id) => {
			const p = procedures.get(id);
			if (!p) {
				findings.push({ code: "unknown_command_id", step, command_id: id });
				return [];
			}
			return [{ id, command: p.command ?? null, pass: p.pass ?? null }];
		});
	const wave = (implementation?.waves || []).find((w) => w?.id === waveId);
	if (!wave) {
		return {
			outcome: "FAIL",
			wave: null,
			slices: [],
			exit_commands: [],
			findings: [{ code: "wave_not_found", wave_id: waveId }],
		};
	}
	const top = new Map((implementation.slices || []).map((s) => [s?.id, s]));
	const members = [];
	for (const id of wave.slice_ids || []) {
		if (top.has(id)) members.push(top.get(id));
		else
			findings.push({
				code: "wave_slice_unresolved",
				wave_id: waveId,
				slice_id: id,
			});
	}
	for (const item of wave.slices || [])
		members.push(
			typeof item === "string" ? top.get(item) || { id: item } : item,
		);
	const slices = members.map((slice) => ({
		id: slice.id,
		role: slice.role ?? null,
		work_class: slice.work_class ?? null,
		depends_on: slice.depends_on ?? null,
		write_set: slice.write_set ?? [],
		...(Array.isArray(slice.inputs) ? { inputs: slice.inputs } : {}),
		...(typeof slice.resource === "string" && slice.resource
			? { resource: slice.resource }
			: {}),
		...(Array.isArray(slice.resource_groups)
			? { resource_groups: slice.resource_groups }
			: {}),
		commands: resolve(slice.id, [
			...(slice.command_ids || []),
			...(slice.post_step_command_ids || []),
		]),
	}));
	const exitIds = Array.isArray(wave.exit_command_ids)
		? wave.exit_command_ids
		: [...new Set(String(wave.exit || "").match(COMMAND_ID) || [])];
	const exit_commands = resolve(waveId, exitIds);
	const live_exchange =
		implementation.journey_settings?.live_wave === "herdr"
			? readLiveExchange(dir, waveId, findings)
			: undefined;
	return {
		outcome: findings.length ? "FAIL" : "PASS",
		wave: {
			id: wave.id,
			name: wave.name ?? null,
			entry: wave.entry ?? null,
			exit: wave.exit ?? null,
		},
		slices,
		exit_commands,
		findings,
		...(live_exchange ? { live_exchange } : {}),
	};
}

module.exports = {
	waveView,
	readLiveWave,
	readyView,
	checkManifestProjection,
	checkReviewRounds,
	checkPlanningWave,
	checkBoundaryContract,
	checkRoles,
	checkWorkClass,
	checkPlanningRoles,
	checkDuplicateGates,
	checkIntegrationStepRefs,
	checkFrozenHashes,
	checkLivePins,
	checkSerialChains,
	loadControlCatalogue,
	parameterizeControl,
	checkSelectedControls,
	verifyDigests,
	freeze,
};

if (require.main === module && process.argv[2] === "control") {
	let result;
	try {
		const selection = JSON.parse(fs.readFileSync(0, "utf8"));
		const control = loadControlCatalogue().get(selection?.control_id);
		if (control) {
			const rendered = parameterizeControl(control, selection);
			result = rendered.ok
				? {
						outcome: "PASS",
						requirement: rendered.requirement,
						positive_case: rendered.positive_case,
						negative_case: rendered.negative_case,
						findings: [],
					}
				: { outcome: "FAIL", findings: rendered.findings };
		} else {
			result = { outcome: "FAIL", findings: [{ code: "unknown_control_id" }] };
		}
	} catch {
		result = {
			outcome: "FAIL",
			findings: [{ code: "control_input_unreadable" }],
		};
	}
	process.stdout.write(JSON.stringify(result, null, 2) + "\n");
	process.exitCode = result.outcome === "PASS" ? 0 : 1;
} else if (
	require.main === module &&
	process.argv[2] === "ready" &&
	process.argv.length > 3
) {
	try {
		const state = JSON.parse(fs.readFileSync(0, "utf8"));
		const result = readyView(process.argv[3], state);
		process.stdout.write(JSON.stringify(result, null, 2) + "\n");
	} catch {
		process.stderr.write(
			"ready-set: unable to read the planning package or scheduling state\n",
		);
		process.exitCode = 1;
	}
} else if (require.main === module && process.argv[2] === "wave") {
	const [dir, waveId] = process.argv.slice(3);
	if (!dir || !waveId) {
		process.stderr.write(
			"usage: node hooks/plan-package.cjs wave <plan dir> <wave id>\n",
		);
		process.exit(2);
	}
	const result = waveView(dir, waveId);
	process.stdout.write(JSON.stringify(result, null, 2) + "\n");
	process.exit(result.outcome === "PASS" ? 0 : 1);
} else if (require.main === module) {
	const draft = process.argv[2] === "draft";
	const dir = process.argv[draft ? 3 : 2];
	if (!dir) {
		process.stderr.write(
			"usage: node hooks/plan-package.cjs [draft] <plan dir>\n",
		);
		process.exit(2);
	}
	const result = freeze(dir, { stage: draft ? "draft" : "final" });
	process.stdout.write(JSON.stringify(result, null, 2) + "\n");
	process.exit(result.outcome === "PASS" ? 0 : 1);
}
