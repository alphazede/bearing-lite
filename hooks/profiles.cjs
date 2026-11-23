"use strict";

/**
 * Profile catalog presence/migration classifier, read-only validator, and route freeze (DES-BDL-004/005).
 * Pure evaluator: never writes, never treats lineups.json as live configuration.
 * TDD Test Implementer and Product Implementer route checks do not invalidate catalog load.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PACKAGED_BYTES = '{"schema_version":1,"profiles":{}}';
const PACKAGED_CATALOG_PATH = path.resolve(__dirname, "..", "profiles.json");
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const CADENCE_VALUES = new Set(["slice", "phase", "lifecycle"]);
const SCRIBE_CADENCE_VALUES = new Set(["event", "phase", "lifecycle"]);
const STRATEGY_MODES = new Set(["single_implementer", "tdd"]);
const LIVE_WAVE_MODES = new Set(["herdr", "headless"]);
const DIRECT_ROLE_KEYS = new Set(["implementer", "test_implementer", "light_implementer", "coordinator"]);
const SESSIONED_PLANNING_ROLES = new Set(["mbse", "integration_test"]);
const ALLOWED_ROLE_KEYS = new Set([
  ...DIRECT_ROLE_KEYS,
  "reviewer",
  "scribe",
  ...SESSIONED_PLANNING_ROLES,
  "test_engineer",
  "integration_engineer",
]);

/**
 * Retired planning routes. Final planning/design is the Planning Orchestrator's
 * own procedure, so these keys have no runtime consumer. They need explicit
 * owner-requested migration (onboard-bearing) that removes only the key and
 * preserves every other configured role, model, fallback, and capability; the
 * route is never copied to another role or to the Orchestrator.
 */
const RETIRED_PLANNING_ROUTE_KEYS = new Set(["plan_integrator", "planning_and_design"]);
const RETIRED_PLANNING_MIGRATION =
  "remove only the retired planning route after owner confirmation; preserve all other roles, models, fallbacks, and capability sections; never copy it to another role";
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
const REMOVED_PLANNING_ROLE_MESSAGES = Object.freeze({
  requirements_engineer:
    "roles.requirements_engineer is removed; use roles.mbse.sessions.planning instead",
  systems_modeler:
    "roles.systems_modeler is removed; use roles.mbse.sessions.planning instead",
  "test_engineer.planning":
    "roles.test_engineer.sessions.planning is removed; use roles.integration_test.sessions.planning instead (keep test_engineer.sessions.assurance)",
  "integration_engineer.planning":
    "roles.integration_engineer.sessions.planning is removed; use roles.integration_test.sessions.planning instead (keep integration_engineer.sessions.execution)",
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveHome(env) {
  const home = typeof env.HOME === "string" ? env.HOME.trim() : "";
  if (home && path.isAbsolute(home)) return home;
  const profile = typeof env.USERPROFILE === "string" ? env.USERPROFILE.trim() : "";
  if (profile && path.isAbsolute(profile)) return profile;
  return null;
}

function exists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function realpathSafe(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

function isPackagedCatalogAlias(targetPath) {
  if (!targetPath || !exists(PACKAGED_CATALOG_PATH)) return false;
  const pkgReal = realpathSafe(PACKAGED_CATALOG_PATH);
  if (exists(targetPath)) {
    return realpathSafe(targetPath) === pkgReal;
  }
  const parentReal = realpathSafe(path.dirname(targetPath));
  return path.join(parentReal, path.basename(targetPath)) === pkgReal;
}

/**
 * RFC 8259 recursive-descent JSON key uniqueness scanner.
 * Detects duplicate object keys before JSON.parse collapses them.
 * @param {string} rawText
 * @returns {{ ok: boolean, parseError: boolean, duplicates: string[] }}
 */
function findDuplicateJsonKeys(rawText) {
  if (typeof rawText !== "string") {
    return { ok: false, parseError: true, duplicates: [] };
  }
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
    const start = pos;
    pos++;
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
      if (ch < 0x20) throw new SyntaxError("Unescaped control char");
      pos++;
    }
    throw new SyntaxError("Unterminated string");
  }

  function parseNumber() {
    const rest = text.slice(pos);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
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
    if (pos >= len) throw new SyntaxError("Unexpected end of JSON");
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
    pos++; // '['
    skipWs();
    if (pos < len && text.charCodeAt(pos) === 0x5d) {
      pos++;
      return;
    }
    let idx = 0;
    while (true) {
      parseValue(`${jsonPath}[${idx}]`);
      idx++;
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
    pos++; // '{'
    skipWs();
    if (pos < len && text.charCodeAt(pos) === 0x7d) {
      pos++;
      return;
    }
    const seen = new Set();
    while (true) {
      skipWs();
      const key = parseString();
      if (seen.has(key)) {
        duplicates.push(`duplicate raw JSON key ${JSON.stringify(key)} at ${jsonPath}`);
      }
      seen.add(key);
      skipWs();
      if (text.charCodeAt(pos) !== 0x3a) throw new SyntaxError("Expected ':'");
      pos++;
      const childPath = jsonPath === "$" ? `$.${key}` : `${jsonPath}.${key}`;
      parseValue(childPath);
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
    if (pos !== len) {
      return { ok: false, parseError: true, duplicates: [] };
    }
    JSON.parse(text);
    return { ok: duplicates.length === 0, parseError: false, duplicates };
  } catch {
    return { ok: false, parseError: true, duplicates: [] };
  }
}

function findCaseCollisions(profiles) {
  const folded = new Map();
  const collisions = [];
  for (const name of Object.keys(profiles)) {
    const key = name.toLowerCase();
    const prior = folded.get(key);
    if (prior !== undefined && prior !== name) {
      collisions.push(`ASCII case-fold collision between ${JSON.stringify(prior)} and ${JSON.stringify(name)}`);
    } else {
      folded.set(key, name);
    }
  }
  return collisions;
}

function validateDefaultsObject(defaults, profiles) {
  if (!isPlainObject(defaults)) {
    return ["defaults must be an object"];
  }
  const errors = [];
  for (const [key, value] of Object.entries(defaults)) {
    if (key !== "planning" && key !== "implementation") {
      errors.push(`defaults.${key}: unknown property`);
      continue;
    }
    if (typeof value !== "string" || value.length === 0) {
      errors.push(`defaults.${key}: must be a non-empty string`);
      continue;
    }
    if (!Object.hasOwn(profiles, value)) {
      errors.push(`defaults.${key}: ${JSON.stringify(value)} does not resolve to an exact profile key`);
    }
  }
  return errors;
}

function retiredRoleKeys(profile) {
  if (!isPlainObject(profile) || !isPlainObject(profile.roles)) return [];
  return Object.keys(profile.roles).filter((key) => RETIRED_ROLE_KEYS.has(key));
}

function removedPlanningEntries(profile) {
  if (!isPlainObject(profile) || !isPlainObject(profile.roles)) return [];
  const roles = profile.roles;
  const found = [];
  for (const key of ["requirements_engineer", "systems_modeler"]) {
    if (Object.hasOwn(roles, key)) {
      found.push({ reason: `removed_role:${key}`, error: REMOVED_PLANNING_ROLE_MESSAGES[key] });
    }
  }
  for (const role of ["test_engineer", "integration_engineer"]) {
    const sessions =
      isPlainObject(roles[role]) && isPlainObject(roles[role].sessions)
        ? roles[role].sessions
        : null;
    if (sessions && Object.hasOwn(sessions, "planning")) {
      const key = `${role}.planning`;
      found.push({ reason: `removed_session:${key}`, error: REMOVED_PLANNING_ROLE_MESSAGES[key] });
    }
  }
  return found;
}

function identityComplete(primary) {
  return (
    isPlainObject(primary) &&
    typeof primary.harness === "string" &&
    primary.harness.length > 0 &&
    typeof primary.model === "string" &&
    primary.model.length > 0 &&
    typeof primary.reasoning === "string" &&
    primary.reasoning.length > 0
  );
}

function isClosedPlainObject(value, allowedKeys) {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isWellFormedFallback(entry) {
  return (
    isClosedPlainObject(entry, ["condition", "harness", "model", "reasoning"]) &&
    identityComplete(entry) &&
    typeof entry.condition === "string" &&
    entry.condition.length > 0
  );
}

function isWellFormedFellowFallback(entry) {
  return (
    isClosedPlainObject(entry, ["condition", "harness", "model", "reasoning"]) &&
    identityComplete(entry) &&
    (entry.condition === undefined || (typeof entry.condition === "string" && entry.condition.length > 0))
  );
}

function isWellFormedFellowRoute(fellow) {
  return (
    isClosedPlainObject(fellow, ["harness", "model", "reasoning", "ordered_fallbacks"]) &&
    identityComplete(fellow) &&
    Array.isArray(fellow.ordered_fallbacks) &&
    fellow.ordered_fallbacks.every(isWellFormedFellowFallback)
  );
}

/**
 * Checks whether a route entry is structurally valid:
 * - explicit fresh decline `{ enabled: false }` without primary/ordered_fallbacks is valid (R02)
 * - disabling an existing route preserves and validates primary/ordered_fallbacks when present
 * - enabled route requires complete primary and ordered_fallbacks array
 */
function isWellFormedRoute(route, allowedExtraKeys = []) {
  if (!isClosedPlainObject(route, ["enabled", "primary", "ordered_fallbacks", ...allowedExtraKeys])) {
    return false;
  }
  if (typeof route.enabled !== "boolean") return false;
  if (route.enabled === false) {
    if (route.primary !== undefined && !isClosedPlainObject(route.primary, ["harness", "model", "reasoning"])) {
      return false;
    }
    if (route.primary !== undefined && !identityComplete(route.primary)) return false;
    if (
      route.ordered_fallbacks !== undefined &&
      (!Array.isArray(route.ordered_fallbacks) || !route.ordered_fallbacks.every(isWellFormedFallback))
    ) {
      return false;
    }
    return true;
  }
  return (
    isClosedPlainObject(route.primary, ["harness", "model", "reasoning"]) &&
    identityComplete(route.primary) &&
    Array.isArray(route.ordered_fallbacks) &&
    route.ordered_fallbacks.every(isWellFormedFallback)
  );
}

/**
 * Presence and migration classifier (DES-BDL-004/005).
 * Never writes. Identifies presence, migration, and top-level/semantic blockers.
 * @param {object} [input]
 * @returns {{ outcome: string, reason: string, path?: string, error?: string, diagnostics?: object[] }}
 */
function evaluateCatalogState(input) {
  const env = (input && input.env) || process.env;
  const home = resolveHome(env);
  if (!home) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "home_unresolved" };
  }
  const dir = path.join(home, ".agents", "bearing-lite");
  const profilesPath = path.join(dir, "profiles.json");
  const lineupsPath = path.join(dir, "lineups.json");

  if (isPackagedCatalogAlias(profilesPath)) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "packaged_catalog_alias", path: profilesPath };
  }

  const hasLineups = exists(lineupsPath);
  const hasProfiles = exists(profilesPath);

  if (hasLineups) {
    return {
      outcome: "MIGRATION_REQUIRED",
      reason: "legacy_lineups_present",
      path: lineupsPath,
    };
  }
  if (!hasProfiles) {
    return { outcome: "no_named_profiles", reason: "missing_user_catalog", path: profilesPath };
  }

  let raw;
  try {
    raw = fs.readFileSync(profilesPath, "utf8");
  } catch {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "catalog_not_json", path: profilesPath };
  }

  const dupCheck = findDuplicateJsonKeys(raw);
  if (dupCheck.parseError) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "catalog_not_json", path: profilesPath };
  }
  if (dupCheck.duplicates.length) {
    return {
      outcome: "NEEDS_MORE_EVIDENCE",
      reason: "duplicate_raw_json_key",
      error: dupCheck.duplicates[0],
      duplicates: dupCheck.duplicates,
      path: profilesPath,
    };
  }

  const parsed = JSON.parse(raw);
  if (!isPlainObject(parsed)) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "catalog_not_json", path: profilesPath };
  }
  if ("lineups" in parsed) {
    return { outcome: "MIGRATION_REQUIRED", reason: "legacy_lineups_field", path: profilesPath };
  }
  if (!Number.isInteger(parsed.schema_version) || parsed.schema_version !== 1) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "invalid_schema_version", path: profilesPath };
  }
  const profiles = parsed.profiles;
  if (!isPlainObject(profiles)) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "profiles_not_object", path: profilesPath };
  }

  const collisions = findCaseCollisions(profiles);
  if (collisions.length) {
    return {
      outcome: "NEEDS_MORE_EVIDENCE",
      reason: "profile_name_collision",
      error: collisions[0],
      path: profilesPath,
    };
  }
  if (Object.hasOwn(parsed, "defaults")) {
    const defaultErrors = validateDefaultsObject(parsed.defaults, profiles);
    if (defaultErrors.length) {
      return {
        outcome: "NEEDS_MORE_EVIDENCE",
        reason: "dangling_default",
        error: defaultErrors[0],
        path: profilesPath,
      };
    }
  }
  if (Object.hasOwn(parsed, "fellow") && !isWellFormedFellowRoute(parsed.fellow)) {
    return {
      outcome: "NEEDS_MORE_EVIDENCE",
      reason: "malformed_fellow",
      path: profilesPath,
    };
  }

  const diagnostics = [];
  for (const name of Object.keys(profiles)) {
    if (!NAME_PATTERN.test(name)) {
      return { outcome: "NEEDS_MORE_EVIDENCE", reason: "invalid_profile_name", path: profilesPath };
    }
    const profile = profiles[name];
    if (isPlainObject(profile?.roles) && Object.hasOwn(profile.roles, "fellow")) {
      return { outcome: "MIGRATION_REQUIRED", reason: "catalog_fellow_migration", profile: name, path: profilesPath };
    }
    const retired = retiredRoleKeys(profile);
    const planning = retired.find((key) => RETIRED_PLANNING_ROUTE_KEYS.has(key));
    if (planning) {
      return {
        outcome: "MIGRATION_REQUIRED",
        reason: "retired_role:" + planning,
        profile: name,
        migration: RETIRED_PLANNING_MIGRATION,
        path: profilesPath,
      };
    }
    if (retired.length) {
      return {
        outcome: "NEEDS_MORE_EVIDENCE",
        reason: "retired_role:" + retired[0],
        path: profilesPath,
      };
    }
    const removed = removedPlanningEntries(profile);
    if (removed.length) {
      return {
        outcome: "NEEDS_MORE_EVIDENCE",
        reason: removed[0].reason,
        error: removed[0].error,
        profile: name,
        path: profilesPath,
      };
    }
    // B30-219 soft compatibility: a legacy Coordinator route never blocks the
    // catalog; it is reported once and otherwise ignored (F09, SM04 COMPATIBLE).
    if (isPlainObject(profile?.roles) && Object.hasOwn(profile.roles, "coordinator")) {
      diagnostics.push({ code: "retired_role_ignored", role: "coordinator", profile: name });
    }
  }
  const ready = { outcome: "READY", reason: "profiles_live", path: profilesPath };
  if (diagnostics.length) ready.diagnostics = diagnostics;
  return ready;
}

/**
 * Full read-only catalog validator covering raw JSON duplicate keys, canonical
 * path/alias checks, semantic checks, closed Bearing Lite schema structure,
 * optional lossless extension-path allowances, and per-profile strategy readiness.
 * @param {{ path?: string, raw?: string, env?: object, allowedExtensionPaths?: string[] }} [input]
 */
function validateCatalog(input) {
  const opts = input || {};
  const allowedExt = new Set(Array.isArray(opts.allowedExtensionPaths) ? opts.allowedExtensionPaths : []);
  const preservedExtensions = [];
  let targetPath = opts.path;

  if (!opts.raw && !targetPath) {
    const env = opts.env || process.env;
    const home = resolveHome(env);
    if (!home) {
      return {
        outcome: "INVALID",
        reason: "home_unresolved",
        catalog_valid: false,
        errors: ["HOME/USERPROFILE did not resolve to an absolute directory"],
        diagnostics: [],
        strategy_readiness: {},
        preserved_extensions: [],
      };
    }
    const dir = path.join(home, ".agents", "bearing-lite");
    const lineupsPath = path.join(dir, "lineups.json");
    targetPath = path.join(dir, "profiles.json");
    if (exists(lineupsPath)) {
      return {
        outcome: "MIGRATION_REQUIRED",
        reason: "legacy_lineups_present",
        catalog_valid: false,
        errors: [`legacy lineups.json exists at ${lineupsPath}`],
        diagnostics: [],
        strategy_readiness: {},
        preserved_extensions: [],
        path: lineupsPath,
      };
    }
    if (!exists(targetPath)) {
      return {
        outcome: "NO_NAMED_PROFILES",
        reason: "missing_user_catalog",
        catalog_valid: false,
        errors: [],
        diagnostics: [],
        strategy_readiness: {},
        preserved_extensions: [],
        path: targetPath,
      };
    }
  }

  if (targetPath && isPackagedCatalogAlias(targetPath)) {
    return {
      outcome: "INVALID",
      reason: "packaged_catalog_alias",
      catalog_valid: false,
      errors: ["refusing packaged catalog path or symlink alias"],
      diagnostics: [],
      strategy_readiness: {},
      preserved_extensions: [],
      path: targetPath,
    };
  }

  let raw = opts.raw;
  if (raw === undefined) {
    try {
      raw = fs.readFileSync(targetPath, "utf8");
    } catch (err) {
      return {
        outcome: "INVALID",
        reason: "read_failed",
        catalog_valid: false,
        errors: [err && err.message ? err.message : "unable to read catalog"],
        diagnostics: [],
        strategy_readiness: {},
        preserved_extensions: [],
        path: targetPath,
      };
    }
  }

  const dupCheck = findDuplicateJsonKeys(raw);
  if (dupCheck.parseError) {
    return {
      outcome: "INVALID",
      reason: "catalog_not_json",
      catalog_valid: false,
      errors: ["catalog is not valid JSON"],
      diagnostics: [],
      strategy_readiness: {},
      preserved_extensions: [],
      path: targetPath,
    };
  }
  if (dupCheck.duplicates.length) {
    return {
      outcome: "INVALID",
      reason: "duplicate_raw_json_key",
      catalog_valid: false,
      errors: dupCheck.duplicates,
      diagnostics: [],
      strategy_readiness: {},
      preserved_extensions: [],
      path: targetPath,
    };
  }

  const doc = JSON.parse(raw);
  if (!isPlainObject(doc)) {
    return {
      outcome: "INVALID",
      reason: "catalog_not_json",
      catalog_valid: false,
      errors: ["catalog root must be a JSON object"],
      diagnostics: [],
      strategy_readiness: {},
      preserved_extensions: [],
      path: targetPath,
    };
  }

  if (Object.hasOwn(doc, "lineups")) {
    return {
      outcome: "MIGRATION_REQUIRED",
      reason: "legacy_lineups_field",
      catalog_valid: false,
      errors: ["catalog uses retired live field 'lineups'"],
      diagnostics: [],
      strategy_readiness: {},
      preserved_extensions: [],
      path: targetPath,
    };
  }

  const errors = [];
  const diagnostics = [];
  const strategyReadiness = {};
  let migrationReason = null;

  for (const key of Object.keys(doc)) {
    if (!["schema_version", "profiles", "defaults", "fellow"].includes(key)) {
      if (allowedExt.has(`catalog.${key}`)) {
        preservedExtensions.push(`catalog.${key}`);
      } else {
        errors.push(`root: unknown property ${JSON.stringify(key)}`);
      }
    }
  }

  if (!Number.isInteger(doc.schema_version) || doc.schema_version !== 1) {
    errors.push("schema_version: must be integer 1");
  }
  if (!isPlainObject(doc.profiles)) {
    errors.push("profiles: must be an object");
  }

  if (Object.hasOwn(doc, "fellow") && !isWellFormedFellowRoute(doc.fellow)) {
    errors.push("fellow: invalid Bearing-level fellow route");
  }

  const profiles = isPlainObject(doc.profiles) ? doc.profiles : {};
  if (isPlainObject(doc.profiles)) {
    errors.push(...findCaseCollisions(profiles));
    if (Object.hasOwn(doc, "defaults")) {
      errors.push(...validateDefaultsObject(doc.defaults, profiles));
    }
    for (const [name, profile] of Object.entries(profiles)) {
      if (!NAME_PATTERN.test(name)) {
        errors.push(`profiles.${name}: invalid profile name`);
      }
      if (!isPlainObject(profile)) {
        errors.push(`profiles.${name}: must be an object`);
        continue;
      }
      validateProfileEntry(name, profile, errors, diagnostics, preservedExtensions, allowedExt, (reason) => {
        if (!migrationReason) migrationReason = reason;
      });
      strategyReadiness[name] = evaluateStrategyReadiness({ profile });
    }
  }

  if (migrationReason) {
    return {
      outcome: "MIGRATION_REQUIRED",
      reason: migrationReason,
      catalog_valid: false,
      errors,
      diagnostics,
      strategy_readiness: strategyReadiness,
      preserved_extensions: preservedExtensions,
      path: targetPath,
    };
  }

  const valid = errors.length === 0;
  return {
    outcome: valid ? "VALID" : "INVALID",
    reason: valid ? "profiles_valid" : "validation_failed",
    catalog_valid: valid,
    empty_catalog: valid && Object.keys(profiles).length === 0,
    errors,
    diagnostics,
    strategy_readiness: strategyReadiness,
    preserved_extensions: preservedExtensions,
    path: targetPath,
  };
}

function validateProfileEntry(name, profile, errors, diagnostics, preservedExtensions, allowedExt, onMigration) {
  const prefix = `profiles.${name}`;
  const allowedProfileKeys = [
    "roles",
    "development_strategy",
    "planning_to_implementation_clean_session",
    "concurrency",
    "holds",
    "deterministic_verification",
    "review",
    "assurance_repair",
    "execution",
  ];
  for (const key of Object.keys(profile)) {
    if (!allowedProfileKeys.includes(key)) {
      if (allowedExt.has(`profile.${key}`)) {
        preservedExtensions.push(`${prefix}.${key}`);
      } else {
        errors.push(`${prefix}: unknown property ${JSON.stringify(key)}`);
      }
    }
  }

  if (!isPlainObject(profile.roles)) {
    errors.push(`${prefix}.roles: must be an object`);
  } else {
    for (const [roleKey, roleVal] of Object.entries(profile.roles)) {
      if (RETIRED_PLANNING_ROUTE_KEYS.has(roleKey)) {
        onMigration(`retired_role:${roleKey}`);
        errors.push(`${prefix}.roles.${roleKey}: retired planning route requires migration`);
        continue;
      }
      if (roleKey === "fellow") {
        onMigration("catalog_fellow_migration");
        errors.push(`${prefix}.roles.fellow: migrate to the catalog-level fellow after owner confirmation`);
        continue;
      }
      if (RETIRED_ROLE_KEYS.has(roleKey)) {
        errors.push(`${prefix}.roles.${roleKey}: retired role key`);
        continue;
      }
      if (roleKey === "requirements_engineer" || roleKey === "systems_modeler") {
        errors.push(`${prefix}.roles.${roleKey}: ${REMOVED_PLANNING_ROLE_MESSAGES[roleKey]}`);
        continue;
      }
      if (!ALLOWED_ROLE_KEYS.has(roleKey)) {
        if (allowedExt.has(`role.${roleKey}`)) {
          preservedExtensions.push(`${prefix}.roles.${roleKey}`);
        } else {
          errors.push(`${prefix}.roles.${roleKey}: unknown role key`);
        }
        continue;
      }
      if (roleKey === "coordinator") {
        diagnostics.push({ code: "retired_role_ignored", role: "coordinator", profile: name });
      }
      if (DIRECT_ROLE_KEYS.has(roleKey)) {
        if (!isWellFormedRoute(roleVal)) {
          errors.push(`${prefix}.roles.${roleKey}: invalid route`);
        }
      } else if (roleKey === "reviewer") {
        if (
          !isWellFormedRoute(roleVal, ["cadence"]) ||
          (roleVal?.cadence !== undefined && !CADENCE_VALUES.has(roleVal.cadence))
        ) {
          errors.push(`${prefix}.roles.reviewer: invalid reviewer route`);
        }
      } else if (roleKey === "scribe") {
        if (
          !isWellFormedRoute(roleVal, ["cadence"]) ||
          (roleVal?.cadence !== undefined && !SCRIBE_CADENCE_VALUES.has(roleVal.cadence))
        ) {
          errors.push(`${prefix}.roles.scribe: invalid scribe route`);
        }
      } else if (SESSIONED_PLANNING_ROLES.has(roleKey)) {
        if (
          !isClosedPlainObject(roleVal, ["sessions"]) ||
          !isClosedPlainObject(roleVal.sessions, ["planning"]) ||
          Object.keys(roleVal.sessions).length < 1 ||
          !isWellFormedRoute(roleVal.sessions.planning)
        ) {
          errors.push(`${prefix}.roles.${roleKey}: must define sessions.planning`);
        }
      } else if (roleKey === "test_engineer") {
        if (isPlainObject(roleVal?.sessions) && Object.hasOwn(roleVal.sessions, "planning")) {
          errors.push(`${prefix}.roles.test_engineer.sessions.planning: ${REMOVED_PLANNING_ROLE_MESSAGES["test_engineer.planning"]}`);
        } else if (
          !isClosedPlainObject(roleVal, ["sessions"]) ||
          !isClosedPlainObject(roleVal.sessions, ["assurance"]) ||
          Object.keys(roleVal.sessions).length < 1 ||
          !isWellFormedRoute(roleVal.sessions.assurance, ["cadence"]) ||
          (roleVal.sessions.assurance.cadence !== undefined &&
            !CADENCE_VALUES.has(roleVal.sessions.assurance.cadence))
        ) {
          errors.push(`${prefix}.roles.test_engineer: must define sessions.assurance`);
        }
      } else if (roleKey === "integration_engineer") {
        if (isPlainObject(roleVal?.sessions) && Object.hasOwn(roleVal.sessions, "planning")) {
          errors.push(
            `${prefix}.roles.integration_engineer.sessions.planning: ${REMOVED_PLANNING_ROLE_MESSAGES["integration_engineer.planning"]}`
          );
        } else if (
          !isClosedPlainObject(roleVal, ["sessions"]) ||
          !isClosedPlainObject(roleVal.sessions, ["execution"]) ||
          Object.keys(roleVal.sessions).length < 1 ||
          !isWellFormedRoute(roleVal.sessions.execution, ["cadence"]) ||
          (roleVal.sessions.execution.cadence !== undefined &&
            !CADENCE_VALUES.has(roleVal.sessions.execution.cadence))
        ) {
          errors.push(`${prefix}.roles.integration_engineer: must define sessions.execution`);
        }
      }
    }
  }

  if (Object.hasOwn(profile, "development_strategy")) {
    const ds = profile.development_strategy;
    if (!isClosedPlainObject(ds, ["mode"]) || !STRATEGY_MODES.has(ds.mode)) {
      errors.push(`${prefix}.development_strategy: mode must be 'single_implementer' or 'tdd'`);
    }
  }
  if (
    Object.hasOwn(profile, "planning_to_implementation_clean_session") &&
    typeof profile.planning_to_implementation_clean_session !== "boolean"
  ) {
    errors.push(`${prefix}.planning_to_implementation_clean_session: must be boolean`);
  }
  if (Object.hasOwn(profile, "concurrency")) {
    const c = profile.concurrency;
    const keys = [
      "dispatch_ready_independent_work",
      "preserve_order_for_dependencies_interfaces_write_overlap_and_shared_mutable_resources",
    ];
    if (!isClosedPlainObject(c, keys) || Object.values(c).some((v) => typeof v !== "boolean")) {
      errors.push(`${prefix}.concurrency: allows only the two concurrency booleans`);
    }
  }
  if (Object.hasOwn(profile, "holds")) {
    if (!Array.isArray(profile.holds)) {
      errors.push(`${prefix}.holds: must be an array`);
    } else {
      for (let i = 0; i < profile.holds.length; i++) {
        const h = profile.holds[i];
        if (!isPlainObject(h) || typeof h.id !== "string" || !h.id.length || typeof h.effect !== "string" || !h.effect.length) {
          errors.push(`${prefix}.holds[${i}]: must be an object with non-empty id and effect`);
        }
      }
    }
  }
  if (Object.hasOwn(profile, "deterministic_verification")) {
    const dv = profile.deterministic_verification;
    if (!isClosedPlainObject(dv, ["additional_tools", "reverify"])) {
      errors.push(`${prefix}.deterministic_verification: unknown property`);
    } else {
      if (Object.hasOwn(dv, "reverify")) {
        if (!isClosedPlainObject(dv.reverify, ["enabled"]) || typeof dv.reverify.enabled !== "boolean") {
          errors.push(`${prefix}.deterministic_verification.reverify: must define boolean enabled`);
        }
      }
      if (Object.hasOwn(dv, "additional_tools")) {
        if (!Array.isArray(dv.additional_tools)) {
          errors.push(`${prefix}.deterministic_verification.additional_tools: must be an array`);
        } else {
          for (let i = 0; i < dv.additional_tools.length; i++) {
            const tool = dv.additional_tools[i];
            const nonEmpty = (v) => typeof v === "string" && /\S/.test(v);
            if (!isClosedPlainObject(tool, ["name", "enabled", "command", "pass", "evidence"]) ||
                !nonEmpty(tool.name) || typeof tool.enabled !== "boolean") {
              errors.push(`${prefix}.deterministic_verification.additional_tools[${i}]: invalid entry`);
            } else if (
              ["command", "pass", "evidence"].some((key) =>
                (tool.enabled === true || Object.hasOwn(tool, key)) && !nonEmpty(tool[key]))
            ) {
              errors.push(
                `${prefix}.deterministic_verification.additional_tools[${i}]: command, pass, and evidence must be non-blank strings when present or enabled`
              );
            }
          }
        }
      }
    }
  }
  if (Object.hasOwn(profile, "review")) {
    const rev = profile.review;
    if (!isPlainObject(rev)) {
      errors.push(`${prefix}.review: must be an object`);
    } else {
      for (const key of Object.keys(rev)) {
        if (key === "coverage_assist") {
          const ca = rev.coverage_assist;
          if (
            !isClosedPlainObject(ca, ["enabled", "required"]) ||
            typeof ca.enabled !== "boolean" ||
            (ca.required !== undefined && typeof ca.required !== "boolean")
          ) {
            errors.push(`${prefix}.review.coverage_assist: invalid coverage_assist object`);
          }
        } else if (allowedExt.has(`profile.review.${key}`)) {
          preservedExtensions.push(`${prefix}.review.${key}`);
        } else {
          errors.push(`${prefix}.review: unknown property ${JSON.stringify(key)}`);
        }
      }
    }
  }
  if (Object.hasOwn(profile, "assurance_repair")) {
    const ar = profile.assurance_repair;
    if (!isClosedPlainObject(ar, ["enabled"]) || typeof ar.enabled !== "boolean") {
      errors.push(`${prefix}.assurance_repair: must define boolean enabled`);
    }
  }
  if (Object.hasOwn(profile, "execution")) {
    const ex = profile.execution;
    if (!isClosedPlainObject(ex, ["live_wave"]) || !LIVE_WAVE_MODES.has(ex.live_wave)) {
      errors.push(`${prefix}.execution.live_wave: must be 'herdr' or 'headless'`);
    }
  }
}

const DIGEST_EXCLUDED_KEYS = new Set(["cadence", "route", "authority"]);

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys.map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") +
    "}"
  );
}

function digestMaterial(value) {
  if (Array.isArray(value)) {
    return value.map(digestMaterial);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const out = {};
  for (const key of Object.keys(value)) {
    if (DIGEST_EXCLUDED_KEYS.has(key)) continue;
    out[key] = digestMaterial(value[key]);
  }
  return out;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function failClosedTddRoute(missingRole) {
  const out = { outcome: "OWNER_DECISION_REQUIRED", onboard: true };
  if (missingRole) out.missing_role = missingRole;
  return out;
}

/**
 * Classify TDD author routes for select|freeze|dispatch|migrate.
 * Catalog load stays READY when a TDD profile omits either route.
 * Verifies BOTH roles.test_implementer AND roles.implementer (R12).
 * @param {{ profile?: object, action?: string }} [input]
 * @returns {{ outcome: string, onboard?: boolean, used_test_implementer?: boolean, missing_role?: string }}
 */
function evaluateTddTestImplementerRoute(input) {
  const profile = (input && input.profile) || {};
  const mode =
    isPlainObject(profile.development_strategy) &&
    typeof profile.development_strategy.mode === "string"
      ? profile.development_strategy.mode
      : "";
  if (mode !== "tdd") {
    return { outcome: "READY", used_test_implementer: false };
  }
  const roles = isPlainObject(profile.roles) ? profile.roles : {};
  const testRoute = roles.test_implementer;
  if (testRoute === undefined || !isWellFormedRoute(testRoute) || testRoute.enabled !== true) {
    return failClosedTddRoute("test_implementer");
  }
  const productRoute = roles.implementer;
  if (productRoute === undefined || !isWellFormedRoute(productRoute) || productRoute.enabled !== true) {
    return failClosedTddRoute("implementer");
  }
  return { outcome: "READY", used_test_implementer: true };
}

/**
 * Distinguish catalog validity from strategy dispatch readiness (R12).
 * @param {{ profile?: object }} [input]
 */
function evaluateStrategyReadiness(input) {
  const profile = (input && input.profile) || {};
  const roles = isPlainObject(profile.roles) ? profile.roles : {};
  const mode =
    isPlainObject(profile.development_strategy) &&
    typeof profile.development_strategy.mode === "string"
      ? profile.development_strategy.mode
      : "unspecified";
  const missingRoles = [];
  const disabledRoles = [];
  const malformedRoles = [];

  const checkRequiredRole = (key) => {
    const route = roles[key];
    if (route === undefined) {
      missingRoles.push(key);
      return false;
    }
    if (!isWellFormedRoute(route)) {
      malformedRoles.push(key);
      return false;
    }
    if (route.enabled !== true) {
      disabledRoles.push(key);
      return false;
    }
    return true;
  };

  let implementationReady;
  if (mode === "tdd") {
    const hasTest = checkRequiredRole("test_implementer");
    const hasImpl = checkRequiredRole("implementer");
    implementationReady = hasTest && hasImpl;
  } else {
    const hasImpl = checkRequiredRole("implementer");
    const hasLight =
      roles.light_implementer !== undefined &&
      isWellFormedRoute(roles.light_implementer) &&
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

/**
 * Deep-copy selected routes, capabilities, fallback order, and optional catalog Fellow; bind a SHA-256 digest of that copy.
 * Also returns separate non-digest `lifecycle_settings` and `settings_digest` (R10) for fields outside the route digest.
 * TDD missing/disabled/malformed Test Implementer or Product Implementer fails closed with no snapshot or digest (R12).
 * Digest is canonical JSON of selected entries with fallback order; excludes cadence, route, and authority.
 * @param {{ profile?: object | string, catalog?: object, fellow?: object, selection_source?: string, allowedExtensionPaths?: string[] }} [input]
 * @returns {{ snapshot: object, digest: string, lifecycle_settings: object, settings_digest: string } | { outcome: string, onboard: boolean, missing_role?: string }}
 */
function freezeSelectedRoutes(input) {
  const catalog = isPlainObject(input && input.catalog) ? input.catalog : null;
  const selection = input?.profile;
  if (typeof selection === "string") {
    if (!isPlainObject(catalog?.profiles) || !Object.hasOwn(catalog.profiles, selection)) {
      return { outcome: "OWNER_DECISION_REQUIRED", onboard: true, reason: "named_profile_not_found" };
    }
    const validation = validateCatalog({
      raw: JSON.stringify(catalog),
      allowedExtensionPaths: input.allowedExtensionPaths,
    });
    if (!validation.catalog_valid) {
      return {
        outcome: "OWNER_DECISION_REQUIRED", onboard: true, reason: validation.reason, error: validation.errors[0],
      };
    }
  }
  const profile = typeof selection === "string" ? catalog.profiles[selection] : isPlainObject(selection) ? selection : {};
  if (isPlainObject(profile.roles) && Object.hasOwn(profile.roles, "fellow")) {
    return { outcome: "OWNER_DECISION_REQUIRED", onboard: true, reason: "catalog_fellow_migration" };
  }
  const removed = removedPlanningEntries(profile);
  if (removed.length) {
    return {
      outcome: "OWNER_DECISION_REQUIRED",
      onboard: true,
      reason: removed[0].reason,
      error: removed[0].error,
    };
  }
  const classified = evaluateTddTestImplementerRoute({ profile, action: "freeze" });
  if (classified.outcome === "OWNER_DECISION_REQUIRED") {
    return classified;
  }
  const roles = isPlainObject(profile.roles) ? deepCopy(profile.roles) : {};
  const snapshot = { roles };
  const material = { ...roles };
  const fellow = catalog ? catalog.fellow : input?.fellow;
  if (fellow !== undefined) {
    if (!isWellFormedFellowRoute(fellow)) {
      return { outcome: "OWNER_DECISION_REQUIRED", onboard: true, reason: "malformed_fellow" };
    }
    snapshot.fellow = deepCopy(fellow);
    material.fellow = snapshot.fellow;
  }
  if (isPlainObject(profile.review)) {
    snapshot.review = deepCopy(profile.review);
    material.review = snapshot.review;
  }
  if (isPlainObject(profile.deterministic_verification)) {
    snapshot.deterministic_verification = deepCopy(profile.deterministic_verification);
    material.deterministic_verification = snapshot.deterministic_verification;
  }
  if (isPlainObject(profile.assurance_repair)) {
    snapshot.assurance_repair = deepCopy(profile.assurance_repair);
    material.assurance_repair = snapshot.assurance_repair;
  }
  if (Array.isArray(profile.holds)) {
    snapshot.holds = deepCopy(profile.holds);
    material.holds = snapshot.holds;
  }
  if (isPlainObject(profile.execution)) {
    snapshot.execution = deepCopy(profile.execution);
    material.execution = snapshot.execution;
  }

  // Separate task-setting binding outside the route digest (R10).
  const lifecycle_settings = {};
  if (isPlainObject(profile.development_strategy)) {
    lifecycle_settings.development_strategy = deepCopy(profile.development_strategy);
  }
  if (typeof profile.planning_to_implementation_clean_session === "boolean") {
    lifecycle_settings.planning_to_implementation_clean_session =
      profile.planning_to_implementation_clean_session;
  }
  if (isPlainObject(profile.concurrency)) {
    lifecycle_settings.concurrency = deepCopy(profile.concurrency);
  }
  if (typeof (input && input.selection_source) === "string" && input.selection_source.length > 0) {
    lifecycle_settings.selection_source = input.selection_source;
  }

  return {
    snapshot,
    digest: sha256Hex(digestMaterial(material)),
    lifecycle_settings,
    settings_digest: sha256Hex(lifecycle_settings),
  };
}

/**
 * Removal-readiness check (B30-219, SM04.X2): an active journey whose frozen
 * snapshot still enables the Coordinator holds retirement until it runs on a
 * pinned runtime or is explicitly handed over. Never rewrites journey records.
 * @param {{ journeys?: object[] }} [input]
 * @returns {{ outcome: string, journeys: { id: *, required: string }[] }}
 */
function evaluateCoordinatorRetirement(input) {
  const journeys = input && Array.isArray(input.journeys) ? input.journeys : [];
  const held = [];
  for (const entry of journeys) {
    if (!isPlainObject(entry) || !isPlainObject(entry.journey)) continue;
    const status = entry.journey.status;
    if (status === "complete" || status === "closed" || status === "cancelled") continue;
    const snapshot =
      isPlainObject(entry.profile_selection) && isPlainObject(entry.profile_selection.snapshot)
        ? entry.profile_selection.snapshot
        : {};
    const roles = isPlainObject(snapshot.roles) ? snapshot.roles : {};
    const coordinator = roles.coordinator;
    if (isPlainObject(coordinator) && coordinator.enabled === true) {
      held.push({ id: entry.journey.id, required: "pinned_runtime_or_handover" });
    }
  }
  return held.length
    ? { outcome: "LEGACY_JOURNEY_ACTIVE", journeys: held }
    : { outcome: "READY", journeys: [] };
}

function packagedCatalogBytes() {
  return PACKAGED_BYTES;
}

module.exports = {
  evaluateCatalogState,
  evaluateCoordinatorRetirement,
  evaluateStrategyReadiness,
  evaluateTddTestImplementerRoute,
  findDuplicateJsonKeys,
  freezeSelectedRoutes,
  packagedCatalogBytes,
  validateCatalog,
  PACKAGED_BYTES,
  RETIRED_PLANNING_ROUTE_KEYS,
};
