"use strict";

/**
 * Profile catalog presence and migration classifier (DES-BDL-004/005).
 * Pure evaluator: never writes, never treats lineups.json as live configuration.
 * TDD Test Implementer route checks do not invalidate catalog load.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PACKAGED_BYTES = '{"schema_version":1,"profiles":{}}';
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const RETIRED_ROLE_KEYS = new Set([
  "surveyor",
  "explorer",
  "crewmate",
  "navigator",
  "park_ranger",
  "park-ranger",
  "validator",
]);

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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function retiredRoleKeys(profile) {
  if (!isPlainObject(profile) || !isPlainObject(profile.roles)) return [];
  return Object.keys(profile.roles).filter((key) => RETIRED_ROLE_KEYS.has(key));
}

/**
 * @param {object} [input]
 * @returns {{ outcome: string, reason: string, path?: string }}
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

  const parsed = readJson(profilesPath);
  if (!isPlainObject(parsed)) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "catalog_not_json", path: profilesPath };
  }
  if ("lineups" in parsed) {
    return { outcome: "MIGRATION_REQUIRED", reason: "legacy_lineups_field", path: profilesPath };
  }
  const profiles = parsed.profiles;
  if (!isPlainObject(profiles)) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "profiles_not_object", path: profilesPath };
  }
  for (const name of Object.keys(profiles)) {
    if (!NAME_PATTERN.test(name)) {
      return { outcome: "NEEDS_MORE_EVIDENCE", reason: "invalid_profile_name", path: profilesPath };
    }
    const retired = retiredRoleKeys(profiles[name]);
    if (retired.length) {
      return {
        outcome: "NEEDS_MORE_EVIDENCE",
        reason: "retired_role:" + retired[0],
        path: profilesPath,
      };
    }
  }
  return { outcome: "READY", reason: "profiles_live", path: profilesPath };
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

function isWellFormedFallback(entry) {
  return (
    identityComplete(entry) &&
    typeof entry.condition === "string" &&
    entry.condition.length > 0
  );
}

function isWellFormedRoute(route) {
  return (
    isPlainObject(route) &&
    typeof route.enabled === "boolean" &&
    identityComplete(route.primary) &&
    Array.isArray(route.ordered_fallbacks) &&
    route.ordered_fallbacks.every(isWellFormedFallback)
  );
}

function failClosedTddRoute() {
  return { outcome: "OWNER_DECISION_REQUIRED", onboard: true };
}

/**
 * Classify Test Implementer use for select|freeze|dispatch|migrate.
 * Catalog load stays READY when a TDD profile omits the route.
 * @param {{ profile?: object, action?: string }} [input]
 * @returns {{ outcome: string, onboard?: boolean, used_test_implementer?: boolean }}
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
  const route = roles.test_implementer;
  if (route === undefined || !isWellFormedRoute(route) || route.enabled !== true) {
    return failClosedTddRoute();
  }
  return { outcome: "READY", used_test_implementer: true };
}

/**
 * Deep-copy selected routes and fallback order; bind a SHA-256 digest of that copy.
 * TDD missing/disabled/malformed Test Implementer fails closed with no snapshot or digest.
 * Digest is canonical JSON of selected entries with fallback order; excludes cadence, route, and authority.
 * @param {{ profile?: object }} [input]
 * @returns {{ snapshot: { roles: object }, digest: string } | { outcome: string, onboard: boolean }}
 */
function freezeSelectedRoutes(input) {
  const profile = (input && input.profile) || {};
  const classified = evaluateTddTestImplementerRoute({ profile, action: "freeze" });
  if (classified.outcome === "OWNER_DECISION_REQUIRED") {
    return failClosedTddRoute();
  }
  const roles = isPlainObject(profile.roles) ? deepCopy(profile.roles) : {};
  return {
    snapshot: { roles },
    digest: sha256Hex(digestMaterial(roles)),
  };
}

function packagedCatalogBytes() {
  return PACKAGED_BYTES;
}

module.exports = {
  evaluateCatalogState,
  evaluateTddTestImplementerRoute,
  freezeSelectedRoutes,
  packagedCatalogBytes,
  PACKAGED_BYTES,
};
