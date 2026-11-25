#!/usr/bin/env node
/**
 * Read-only profile catalog validator for Bearing Lite (works in both full-plugin
 * and standalone skills-only installs). Never writes files, never launches CLIs,
 * never stores credentials, and never treats the packaged catalog as user data.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_SCHEMA = path.resolve(
	HERE,
	"..",
	"references",
	"profiles.schema.json",
);
const REPO_SCHEMA = path.resolve(
	HERE,
	"..",
	"..",
	"..",
	"schemas",
	"profiles.schema.json",
);
const REPO_PACKAGED_CATALOG = path.resolve(
	HERE,
	"..",
	"..",
	"..",
	"profiles.json",
);

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const CADENCE_VALUES = new Set(["slice", "phase", "lifecycle"]);
const SCRIBE_CADENCE_VALUES = new Set(["event", "phase", "lifecycle"]);
const STRATEGY_MODES = new Set(["single_implementer", "tdd"]);
const LIVE_WAVE_MODES = new Set(["herdr", "headless"]);
const DIRECT_ROLE_KEYS = new Set([
	"implementer",
	"test_implementer",
	"light_implementer",
	"coordinator",
]);
const SESSIONED_PLANNING_ROLES = new Set(["mbse", "integration_test"]);
const ALLOWED_ROLE_KEYS = new Set([
	...DIRECT_ROLE_KEYS,
	"reviewer",
	"scribe",
	...SESSIONED_PLANNING_ROLES,
	"test_engineer",
	"integration_engineer",
]);
const RETIRED_PLANNING_ROUTE_KEYS = new Set([
	"plan_integrator",
	"planning_and_design",
]);
const RETIRED_ROLE_KEYS = new Set([
	...RETIRED_PLANNING_ROUTE_KEYS,
	"surveyor",
	"explorer",
	"crewmate",
	"navigator",
	"park_ranger",
	"park-ranger",
	"validator",
]);
const REMOVED_PLANNING_MESSAGES = Object.freeze({
	requirements_engineer:
		"roles.requirements_engineer is removed; use roles.mbse.sessions.planning instead",
	systems_modeler:
		"roles.systems_modeler is removed; use roles.mbse.sessions.planning instead",
	"test_engineer.planning":
		"roles.test_engineer.sessions.planning is removed; use roles.integration_test.sessions.planning instead (keep test_engineer.sessions.assurance)",
	"integration_engineer.planning":
		"roles.integration_engineer.sessions.planning is removed; use roles.integration_test.sessions.planning instead (keep integration_engineer.sessions.execution)",
});

function parseArgs(argv) {
	const opts = { allowExtensions: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--stdin") opts.stdin = true;
		else if (arg === "--catalog" && argv[i + 1]) opts.catalog = argv[++i];
		else if (arg === "--schema" && argv[i + 1]) opts.schema = argv[++i];
		else if (arg === "--extension-schema" && argv[i + 1])
			opts.extensionSchema = argv[++i];
		else if (arg === "--allow-extension" && argv[i + 1]) {
			opts.allowExtensions.push(
				...argv[++i]
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean),
			);
		}
	}
	return opts;
}

const isPlainObject = (v) =>
	v !== null && typeof v === "object" && !Array.isArray(v);
const isClosedPlainObject = (v, keys) =>
	isPlainObject(v) && Object.keys(v).every((k) => keys.includes(k));

function resolveHome(env) {
	const home = typeof env.HOME === "string" ? env.HOME.trim() : "";
	if (home && path.isAbsolute(home)) return home;
	const profile =
		typeof env.USERPROFILE === "string" ? env.USERPROFILE.trim() : "";
	if (profile && path.isAbsolute(profile)) return profile;
	return null;
}

function realpathSafe(file) {
	try {
		return fs.realpathSync(file);
	} catch {
		return path.resolve(file);
	}
}

function isPackagedAlias(targetPath) {
	if (!targetPath || !fs.existsSync(REPO_PACKAGED_CATALOG)) return false;
	const pkgReal = realpathSafe(REPO_PACKAGED_CATALOG);
	if (fs.existsSync(targetPath)) return realpathSafe(targetPath) === pkgReal;
	const parentReal = realpathSafe(path.dirname(targetPath));
	return path.join(parentReal, path.basename(targetPath)) === pkgReal;
}

function findDuplicateJsonKeys(rawText) {
	if (typeof rawText !== "string")
		return { ok: false, parseError: true, duplicates: [] };
	const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
	const len = text.length;
	let pos = 0;
	const duplicates = [];

	function skipWs() {
		while (pos < len) {
			const ch = text.charCodeAt(pos);
			if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) pos++;
			else break;
		}
	}
	function parseString() {
		if (text.charCodeAt(pos) !== 0x22) throw new SyntaxError("Expected string");
		const start = pos++;
		while (pos < len) {
			const ch = text.charCodeAt(pos);
			if (ch === 0x22) {
				pos++;
				return JSON.parse(text.slice(start, pos));
			}
			if (ch === 0x5c) {
				pos += 2;
				continue;
			}
			if (ch < 0x20) throw new SyntaxError("Control char");
			pos++;
		}
		throw new SyntaxError("Unterminated string");
	}
	function parseNumber() {
		const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
			text.slice(pos),
		);
		if (!match) throw new SyntaxError("Invalid number");
		pos += match[0].length;
	}
	function parseLiteral(lit) {
		if (text.startsWith(lit, pos)) {
			pos += lit.length;
			return;
		}
		throw new SyntaxError(`Expected ${lit}`);
	}
	function parseValue(jsonPath) {
		skipWs();
		if (pos >= len) throw new SyntaxError("Unexpected end");
		const ch = text.charCodeAt(pos);
		if (ch === 0x7b) return parseObject(jsonPath);
		if (ch === 0x5b) return parseArray(jsonPath);
		if (ch === 0x22) {
			parseString();
			return;
		}
		if (ch === 0x74) return parseLiteral("true");
		if (ch === 0x66) return parseLiteral("false");
		if (ch === 0x6e) return parseLiteral("null");
		if (ch === 0x2d || (ch >= 0x30 && ch <= 0x39)) return parseNumber();
		throw new SyntaxError("Unexpected token");
	}
	function parseArray(jsonPath) {
		pos++;
		skipWs();
		if (pos < len && text.charCodeAt(pos) === 0x5d) {
			pos++;
			return;
		}
		let idx = 0;
		while (true) {
			parseValue(`${jsonPath}[${idx++}]`);
			skipWs();
			if (pos < len && text.charCodeAt(pos) === 0x2c) {
				pos++;
				continue;
			}
			if (pos < len && text.charCodeAt(pos) === 0x5d) {
				pos++;
				return;
			}
			throw new SyntaxError("Expected ',' or ']'");
		}
	}
	function parseObject(jsonPath) {
		pos++;
		skipWs();
		if (pos < len && text.charCodeAt(pos) === 0x7d) {
			pos++;
			return;
		}
		const seen = new Set();
		while (true) {
			skipWs();
			const key = parseString();
			if (seen.has(key))
				duplicates.push(
					`duplicate raw JSON key ${JSON.stringify(key)} at ${jsonPath}`,
				);
			seen.add(key);
			skipWs();
			if (text.charCodeAt(pos) !== 0x3a) throw new SyntaxError("Expected ':'");
			pos++;
			parseValue(jsonPath === "$" ? `$.${key}` : `${jsonPath}.${key}`);
			skipWs();
			if (pos < len && text.charCodeAt(pos) === 0x2c) {
				pos++;
				continue;
			}
			if (pos < len && text.charCodeAt(pos) === 0x7d) {
				pos++;
				return;
			}
			throw new SyntaxError("Expected ',' or '}'");
		}
	}

	try {
		parseValue("$");
		skipWs();
		if (pos !== len) return { ok: false, parseError: true, duplicates: [] };
		JSON.parse(text);
		return { ok: duplicates.length === 0, parseError: false, duplicates };
	} catch {
		return { ok: false, parseError: true, duplicates: [] };
	}
}

const identityComplete = (p) =>
	isPlainObject(p) &&
	typeof p.harness === "string" &&
	p.harness.length > 0 &&
	typeof p.model === "string" &&
	p.model.length > 0 &&
	typeof p.reasoning === "string" &&
	p.reasoning.length > 0;

const isFallback = (e) =>
	isClosedPlainObject(e, ["condition", "harness", "model", "reasoning"]) &&
	identityComplete(e) &&
	typeof e.condition === "string" &&
	e.condition.length > 0;

const isFellowFallback = (e) =>
	isClosedPlainObject(e, ["condition", "harness", "model", "reasoning"]) &&
	identityComplete(e) &&
	(e.condition === undefined ||
		(typeof e.condition === "string" && e.condition.length > 0));

const isFellowRoute = (f) =>
	isClosedPlainObject(f, [
		"harness",
		"model",
		"reasoning",
		"ordered_fallbacks",
	]) &&
	identityComplete(f) &&
	Array.isArray(f.ordered_fallbacks) &&
	f.ordered_fallbacks.every(isFellowFallback);

function isValidRoute(route, extraKeys = []) {
	if (
		!isClosedPlainObject(route, [
			"enabled",
			"primary",
			"ordered_fallbacks",
			...extraKeys,
		])
	)
		return false;
	if (typeof route.enabled !== "boolean") return false;
	if (route.enabled === false) {
		if (
			route.primary !== undefined &&
			(!isClosedPlainObject(route.primary, ["harness", "model", "reasoning"]) ||
				!identityComplete(route.primary))
		) {
			return false;
		}
		if (
			route.ordered_fallbacks !== undefined &&
			(!Array.isArray(route.ordered_fallbacks) ||
				!route.ordered_fallbacks.every(isFallback))
		) {
			return false;
		}
		return true;
	}
	return (
		isClosedPlainObject(route.primary, ["harness", "model", "reasoning"]) &&
		identityComplete(route.primary) &&
		Array.isArray(route.ordered_fallbacks) &&
		route.ordered_fallbacks.every(isFallback)
	);
}

function strategyReadiness(profile) {
	const roles = isPlainObject(profile.roles) ? profile.roles : {};
	const mode =
		isPlainObject(profile.development_strategy) &&
		typeof profile.development_strategy.mode === "string"
			? profile.development_strategy.mode
			: "unspecified";
	const missingRoles = [];
	const disabledRoles = [];
	const malformedRoles = [];
	const checkRole = (key) => {
		const r = roles[key];
		if (r === undefined) {
			missingRoles.push(key);
			return false;
		}
		if (!isValidRoute(r)) {
			malformedRoles.push(key);
			return false;
		}
		if (r.enabled !== true) {
			disabledRoles.push(key);
			return false;
		}
		return true;
	};
	let implementationReady;
	if (mode === "tdd") {
		const hasTest = checkRole("test_implementer");
		const hasImpl = checkRole("implementer");
		implementationReady = hasTest && hasImpl;
	} else {
		const hasImpl = checkRole("implementer");
		const hasLight =
			roles.light_implementer !== undefined &&
			isValidRoute(roles.light_implementer) &&
			roles.light_implementer.enabled === true;
		implementationReady = hasImpl || hasLight;
	}
	return {
		outcome: implementationReady ? "READY" : "OWNER_DECISION_REQUIRED",
		mode,
		planning_ready: true,
		implementation_ready: implementationReady,
		missing_roles: missingRoles,
		disabled_roles: disabledRoles,
		malformed_roles: malformedRoles,
	};
}

function resolveSchemaPath(explicit) {
	if (explicit) return fs.existsSync(explicit) ? explicit : null;
	if (fs.existsSync(SKILL_SCHEMA)) return SKILL_SCHEMA;
	if (fs.existsSync(REPO_SCHEMA)) return REPO_SCHEMA;
	return null;
}

function loadAllowedExtensions(opts) {
	const allowed = new Set(opts.allowExtensions);
	if (opts.extensionSchema) {
		const raw = fs.readFileSync(opts.extensionSchema, "utf8");
		const parsed = JSON.parse(raw);
		if (
			!isPlainObject(parsed) ||
			!Number.isInteger(parsed.version) ||
			!Array.isArray(parsed.allowed_paths)
		) {
			throw new Error(
				"extension-schema must be an object with integer version and allowed_paths array",
			);
		}
		for (const p of parsed.allowed_paths) {
			if (typeof p === "string" && p.trim()) allowed.add(p.trim());
		}
	}
	return allowed;
}

function validate(opts) {
	const schemaPath = resolveSchemaPath(opts.schema);
	if (!schemaPath) {
		return {
			outcome: "INVALID",
			reason: "missing_schema",
			catalog_valid: false,
			route_test_status: "not_tested_by_validator",
			errors: [
				"matching profiles.schema.json not found in skill references or repo schemas/",
			],
			diagnostics: [],
			strategy_readiness: {},
			preserved_extensions: [],
		};
	}
	let schema;
	try {
		schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
	} catch (err) {
		return {
			outcome: "INVALID",
			reason: "invalid_schema",
			catalog_valid: false,
			route_test_status: "not_tested_by_validator",
			schema: schemaPath,
			errors: [`unreadable schema: ${err.message}`],
			diagnostics: [],
			strategy_readiness: {},
			preserved_extensions: [],
		};
	}
	if (
		!isPlainObject(schema) ||
		!String(schema.$id || "").endsWith("profiles.schema.json")
	) {
		return {
			outcome: "INVALID",
			reason: "schema_mismatch",
			catalog_valid: false,
			route_test_status: "not_tested_by_validator",
			schema: schemaPath,
			errors: ["schema $id does not end with profiles.schema.json"],
			diagnostics: [],
			strategy_readiness: {},
			preserved_extensions: [],
		};
	}

	let allowedExt;
	try {
		allowedExt = loadAllowedExtensions(opts);
	} catch (err) {
		return {
			outcome: "INVALID",
			reason: "invalid_extension_schema",
			catalog_valid: false,
			route_test_status: "not_tested_by_validator",
			schema: schemaPath,
			errors: [err.message],
			diagnostics: [],
			strategy_readiness: {},
			preserved_extensions: [],
		};
	}

	let targetPath = opts.catalog || null;
	if (!opts.stdin && !targetPath) {
		const home = resolveHome(process.env);
		if (!home) {
			return {
				outcome: "INVALID",
				reason: "home_unresolved",
				catalog_valid: false,
				route_test_status: "not_tested_by_validator",
				schema: schemaPath,
				errors: ["HOME/USERPROFILE did not resolve to an absolute path"],
				diagnostics: [],
				strategy_readiness: {},
				preserved_extensions: [],
			};
		}
		const dir = path.join(home, ".agents", "bearing-lite");
		const lineupsPath = path.join(dir, "lineups.json");
		targetPath = path.join(dir, "profiles.json");
		if (fs.existsSync(lineupsPath)) {
			return {
				outcome: "MIGRATION_REQUIRED",
				reason: "legacy_lineups_present",
				catalog_valid: false,
				route_test_status: "not_tested_by_validator",
				schema: schemaPath,
				path: lineupsPath,
				errors: [`legacy lineups.json exists at ${lineupsPath}`],
				diagnostics: [],
				strategy_readiness: {},
				preserved_extensions: [],
			};
		}
		if (!fs.existsSync(targetPath)) {
			return {
				outcome: "NO_NAMED_PROFILES",
				reason: "missing_user_catalog",
				catalog_valid: false,
				route_test_status: "not_tested_by_validator",
				schema: schemaPath,
				path: targetPath,
				errors: [],
				diagnostics: [],
				strategy_readiness: {},
				preserved_extensions: [],
			};
		}
	}

	if (targetPath && isPackagedAlias(targetPath)) {
		return {
			outcome: "INVALID",
			reason: "packaged_catalog_alias",
			catalog_valid: false,
			route_test_status: "not_tested_by_validator",
			schema: schemaPath,
			path: targetPath,
			errors: ["refusing packaged catalog path or symlink alias"],
			diagnostics: [],
			strategy_readiness: {},
			preserved_extensions: [],
		};
	}

	let raw;
	try {
		raw = opts.stdin
			? fs.readFileSync(0, "utf8")
			: fs.readFileSync(targetPath, "utf8");
	} catch (err) {
		return {
			outcome: "INVALID",
			reason: "read_failed",
			catalog_valid: false,
			route_test_status: "not_tested_by_validator",
			schema: schemaPath,
			path: targetPath,
			errors: [err.message],
			diagnostics: [],
			strategy_readiness: {},
			preserved_extensions: [],
		};
	}

	const dup = findDuplicateJsonKeys(raw);
	if (dup.parseError) {
		return {
			outcome: "INVALID",
			reason: "catalog_not_json",
			catalog_valid: false,
			route_test_status: "not_tested_by_validator",
			schema: schemaPath,
			path: targetPath,
			errors: ["catalog is not valid JSON"],
			diagnostics: [],
			strategy_readiness: {},
			preserved_extensions: [],
		};
	}
	if (dup.duplicates.length) {
		return {
			outcome: "INVALID",
			reason: "duplicate_raw_json_key",
			catalog_valid: false,
			route_test_status: "not_tested_by_validator",
			schema: schemaPath,
			path: targetPath,
			errors: dup.duplicates,
			diagnostics: [],
			strategy_readiness: {},
			preserved_extensions: [],
		};
	}

	const doc = JSON.parse(raw);
	if (!isPlainObject(doc)) {
		return {
			outcome: "INVALID",
			reason: "catalog_not_json",
			catalog_valid: false,
			route_test_status: "not_tested_by_validator",
			schema: schemaPath,
			path: targetPath,
			errors: ["catalog root must be a JSON object"],
			diagnostics: [],
			strategy_readiness: {},
			preserved_extensions: [],
		};
	}
	if (Object.hasOwn(doc, "lineups")) {
		return {
			outcome: "MIGRATION_REQUIRED",
			reason: "legacy_lineups_field",
			catalog_valid: false,
			route_test_status: "not_tested_by_validator",
			schema: schemaPath,
			path: targetPath,
			errors: ["catalog uses retired live field 'lineups'"],
			diagnostics: [],
			strategy_readiness: {},
			preserved_extensions: [],
		};
	}

	const errors = [];
	const diagnostics = [];
	const preservedExtensions = [];
	const readiness = {};
	let migrationReason = null;

	for (const key of Object.keys(doc)) {
		if (!["schema_version", "profiles", "defaults", "fellow"].includes(key)) {
			if (allowedExt.has(`catalog.${key}`))
				preservedExtensions.push(`catalog.${key}`);
			else errors.push(`root: unknown property ${JSON.stringify(key)}`);
		}
	}
	if (!Number.isInteger(doc.schema_version) || doc.schema_version !== 1) {
		errors.push("schema_version: must be integer 1");
	}
	if (!isPlainObject(doc.profiles)) {
		errors.push("profiles: must be an object");
	}
	if (Object.hasOwn(doc, "fellow") && !isFellowRoute(doc.fellow)) {
		errors.push("fellow: invalid Bearing-level fellow route");
	}

	const profiles = isPlainObject(doc.profiles) ? doc.profiles : {};
	if (isPlainObject(doc.profiles)) {
		const folded = new Map();
		for (const name of Object.keys(profiles)) {
			const lower = name.toLowerCase();
			const prior = folded.get(lower);
			if (prior !== undefined && prior !== name) {
				errors.push(
					`profiles: ASCII case-fold collision between ${JSON.stringify(prior)} and ${JSON.stringify(name)}`,
				);
			} else {
				folded.set(lower, name);
			}
			if (!NAME_PATTERN.test(name))
				errors.push(`profiles.${name}: invalid profile name`);
		}
		if (Object.hasOwn(doc, "defaults")) {
			if (!isPlainObject(doc.defaults)) {
				errors.push("defaults: must be an object");
			} else {
				for (const [k, v] of Object.entries(doc.defaults)) {
					if (k !== "planning" && k !== "implementation")
						errors.push(`defaults.${k}: unknown property`);
					else if (
						typeof v !== "string" ||
						!v.length ||
						!Object.hasOwn(profiles, v)
					) {
						errors.push(
							`defaults.${k}: does not resolve to an exact profile key`,
						);
					}
				}
			}
		}
		for (const [name, profile] of Object.entries(profiles)) {
			if (!isPlainObject(profile)) {
				errors.push(`profiles.${name}: must be an object`);
				continue;
			}
			const pfx = `profiles.${name}`;
			const allowedProfileKeys = [
				"roles",
				"development_strategy",
				"planning_to_implementation_clean_session",
				"concurrency",
				"holds",
				"deterministic_verification",
				"review",
				"assurance_repair",
				"reviewer_repair",
				"execution",
			];
			for (const k of Object.keys(profile)) {
				if (!allowedProfileKeys.includes(k)) {
					if (allowedExt.has(`profile.${k}`))
						preservedExtensions.push(`${pfx}.${k}`);
					else errors.push(`${pfx}: unknown property ${JSON.stringify(k)}`);
				}
			}
			if (!isPlainObject(profile.roles)) {
				errors.push(`${pfx}.roles: must be an object`);
			} else {
				for (const [rk, rv] of Object.entries(profile.roles)) {
					if (RETIRED_PLANNING_ROUTE_KEYS.has(rk)) {
						if (!migrationReason) migrationReason = `retired_role:${rk}`;
						errors.push(
							`${pfx}.roles.${rk}: retired planning route requires migration`,
						);
						continue;
					}
					if (rk === "fellow") {
						if (!migrationReason) migrationReason = "catalog_fellow_migration";
						errors.push(
							`${pfx}.roles.fellow: migrate to the catalog-level fellow after owner confirmation`,
						);
						continue;
					}
					if (RETIRED_ROLE_KEYS.has(rk)) {
						errors.push(`${pfx}.roles.${rk}: retired role key`);
						continue;
					}
					if (rk === "requirements_engineer" || rk === "systems_modeler") {
						errors.push(`${pfx}.roles.${rk}: ${REMOVED_PLANNING_MESSAGES[rk]}`);
						continue;
					}
					if (!ALLOWED_ROLE_KEYS.has(rk)) {
						if (allowedExt.has(`role.${rk}`))
							preservedExtensions.push(`${pfx}.roles.${rk}`);
						else errors.push(`${pfx}.roles.${rk}: unknown role key`);
						continue;
					}
					if (rk === "coordinator")
						diagnostics.push({
							code: "retired_role_ignored",
							role: "coordinator",
							profile: name,
						});
					if (DIRECT_ROLE_KEYS.has(rk)) {
						if (!isValidRoute(rv))
							errors.push(`${pfx}.roles.${rk}: invalid route`);
					} else if (rk === "reviewer") {
						if (
							!isValidRoute(rv, ["cadence"]) ||
							(rv?.cadence !== undefined && !CADENCE_VALUES.has(rv.cadence))
						) {
							errors.push(`${pfx}.roles.reviewer: invalid reviewer route`);
						}
					} else if (rk === "scribe") {
						if (
							!isValidRoute(rv, ["cadence"]) ||
							(rv?.cadence !== undefined &&
								!SCRIBE_CADENCE_VALUES.has(rv.cadence))
						) {
							errors.push(`${pfx}.roles.scribe: invalid scribe route`);
						}
					} else if (SESSIONED_PLANNING_ROLES.has(rk)) {
						if (
							!isClosedPlainObject(rv, ["sessions"]) ||
							!isClosedPlainObject(rv.sessions, ["planning"]) ||
							Object.keys(rv.sessions).length < 1 ||
							!isValidRoute(rv.sessions.planning)
						) {
							errors.push(`${pfx}.roles.${rk}: must define sessions.planning`);
						}
					} else if (rk === "test_engineer") {
						if (
							isPlainObject(rv?.sessions) &&
							Object.hasOwn(rv.sessions, "planning")
						) {
							errors.push(
								`${pfx}.roles.test_engineer.sessions.planning: ${REMOVED_PLANNING_MESSAGES["test_engineer.planning"]}`,
							);
						} else if (
							!isClosedPlainObject(rv, ["sessions"]) ||
							!isClosedPlainObject(rv.sessions, ["assurance"]) ||
							Object.keys(rv.sessions).length < 1 ||
							!isValidRoute(rv.sessions.assurance, ["cadence"]) ||
							(rv.sessions.assurance.cadence !== undefined &&
								!CADENCE_VALUES.has(rv.sessions.assurance.cadence))
						) {
							errors.push(
								`${pfx}.roles.test_engineer: must define sessions.assurance`,
							);
						}
					} else if (rk === "integration_engineer") {
						if (
							isPlainObject(rv?.sessions) &&
							Object.hasOwn(rv.sessions, "planning")
						) {
							errors.push(
								`${pfx}.roles.integration_engineer.sessions.planning: ${REMOVED_PLANNING_MESSAGES["integration_engineer.planning"]}`,
							);
						} else if (
							!isClosedPlainObject(rv, ["sessions"]) ||
							!isClosedPlainObject(rv.sessions, ["execution"]) ||
							Object.keys(rv.sessions).length < 1 ||
							!isValidRoute(rv.sessions.execution, ["cadence"]) ||
							(rv.sessions.execution.cadence !== undefined &&
								!CADENCE_VALUES.has(rv.sessions.execution.cadence))
						) {
							errors.push(
								`${pfx}.roles.integration_engineer: must define sessions.execution`,
							);
						}
					}
				}
			}
			if (Object.hasOwn(profile, "development_strategy")) {
				const ds = profile.development_strategy;
				if (
					!isClosedPlainObject(ds, ["mode"]) ||
					!STRATEGY_MODES.has(ds.mode)
				) {
					errors.push(
						`${pfx}.development_strategy: mode must be 'single_implementer' or 'tdd'`,
					);
				}
			}
			if (
				Object.hasOwn(profile, "planning_to_implementation_clean_session") &&
				typeof profile.planning_to_implementation_clean_session !== "boolean"
			) {
				errors.push(
					`${pfx}.planning_to_implementation_clean_session: must be boolean`,
				);
			}
			if (Object.hasOwn(profile, "concurrency")) {
				const c = profile.concurrency;
				const keys = [
					"dispatch_ready_independent_work",
					"preserve_order_for_dependencies_interfaces_write_overlap_and_shared_mutable_resources",
				];
				if (
					!isClosedPlainObject(c, keys) ||
					Object.values(c).some((v) => typeof v !== "boolean")
				) {
					errors.push(
						`${pfx}.concurrency: allows only the two concurrency booleans`,
					);
				}
			}
			if (Object.hasOwn(profile, "holds")) {
				if (!Array.isArray(profile.holds))
					errors.push(`${pfx}.holds: must be an array`);
				else {
					for (let i = 0; i < profile.holds.length; i++) {
						const h = profile.holds[i];
						if (
							!isPlainObject(h) ||
							typeof h.id !== "string" ||
							!h.id.length ||
							typeof h.effect !== "string" ||
							!h.effect.length
						) {
							errors.push(
								`${pfx}.holds[${i}]: must be an object with non-empty id and effect`,
							);
						}
					}
				}
			}
			if (Object.hasOwn(profile, "deterministic_verification")) {
				const dv = profile.deterministic_verification;
				if (!isClosedPlainObject(dv, ["additional_tools", "reverify"])) {
					errors.push(`${pfx}.deterministic_verification: unknown property`);
				} else {
					if (
						Object.hasOwn(dv, "reverify") &&
						(!isClosedPlainObject(dv.reverify, ["enabled"]) ||
							typeof dv.reverify.enabled !== "boolean")
					) {
						errors.push(
							`${pfx}.deterministic_verification.reverify: must define boolean enabled`,
						);
					}
					if (Object.hasOwn(dv, "additional_tools")) {
						if (!Array.isArray(dv.additional_tools))
							errors.push(
								`${pfx}.deterministic_verification.additional_tools: must be an array`,
							);
						else {
							for (let i = 0; i < dv.additional_tools.length; i++) {
								const t = dv.additional_tools[i];
								const nonEmpty = (v) => typeof v === "string" && /\S/.test(v);
								if (
									!isClosedPlainObject(t, [
										"name",
										"enabled",
										"command",
										"pass",
										"evidence",
									]) ||
									!nonEmpty(t.name) ||
									typeof t.enabled !== "boolean" ||
									["command", "pass", "evidence"].some(
										(key) =>
											(t.enabled === true || Object.hasOwn(t, key)) &&
											!nonEmpty(t[key]),
									)
								) {
									errors.push(
										`${pfx}.deterministic_verification.additional_tools[${i}]: invalid tool entry`,
									);
								}
							}
						}
					}
				}
			}
			if (Object.hasOwn(profile, "review")) {
				const rev = profile.review;
				if (!isPlainObject(rev))
					errors.push(`${pfx}.review: must be an object`);
				else {
					for (const k of Object.keys(rev)) {
						if (k === "coverage_assist") {
							const ca = rev.coverage_assist;
							if (
								!isClosedPlainObject(ca, ["enabled", "required"]) ||
								typeof ca.enabled !== "boolean" ||
								(ca.required !== undefined && typeof ca.required !== "boolean")
							) {
								errors.push(
									`${pfx}.review.coverage_assist: invalid coverage_assist object`,
								);
							}
						} else if (allowedExt.has(`profile.review.${k}`)) {
							preservedExtensions.push(`${pfx}.review.${k}`);
						} else {
							errors.push(
								`${pfx}.review: unknown property ${JSON.stringify(k)}`,
							);
						}
					}
				}
			}
			if (Object.hasOwn(profile, "assurance_repair")) {
				const ar = profile.assurance_repair;
				if (
					!isClosedPlainObject(ar, ["enabled"]) ||
					typeof ar.enabled !== "boolean"
				) {
					errors.push(`${pfx}.assurance_repair: must define boolean enabled`);
				}
			}
			if (Object.hasOwn(profile, "reviewer_repair")) {
				const rr = profile.reviewer_repair;
				if (
					!isClosedPlainObject(rr, ["enabled"]) ||
					typeof rr.enabled !== "boolean"
				) {
					errors.push(`${pfx}.reviewer_repair: must define boolean enabled`);
				}
			}
			if (Object.hasOwn(profile, "execution")) {
				const ex = profile.execution;
				if (
					!isClosedPlainObject(ex, ["live_wave"]) ||
					!LIVE_WAVE_MODES.has(ex.live_wave)
				) {
					errors.push(
						`${pfx}.execution.live_wave: must be 'herdr' or 'headless'`,
					);
				}
			}
			readiness[name] = strategyReadiness(profile);
		}
	}

	if (migrationReason) {
		return {
			outcome: "MIGRATION_REQUIRED",
			reason: migrationReason,
			catalog_valid: false,
			route_test_status: "not_tested_by_validator",
			schema: schemaPath,
			path: targetPath,
			errors,
			diagnostics,
			strategy_readiness: readiness,
			preserved_extensions: preservedExtensions,
		};
	}

	const valid = errors.length === 0;
	return {
		outcome: valid ? "VALID" : "INVALID",
		reason: valid ? "profiles_valid" : "validation_failed",
		catalog_valid: valid,
		empty_catalog: valid && Object.keys(profiles).length === 0,
		route_test_status: "not_tested_by_validator",
		schema: schemaPath,
		path: targetPath,
		errors,
		diagnostics,
		strategy_readiness: readiness,
		preserved_extensions: preservedExtensions,
	};
}

const result = validate(parseArgs(process.argv.slice(2)));
console.log(JSON.stringify(result, null, 2));
process.exit(result.catalog_valid ? 0 : 1);
