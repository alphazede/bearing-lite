"use strict";

/**
 * Profile catalog presence and migration classifier (DES-BDL-004/005).
 * Pure evaluator: never writes, never treats lineups.json as live configuration.
 */

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

function packagedCatalogBytes() {
  return PACKAGED_BYTES;
}

module.exports = {
  evaluateCatalogState,
  packagedCatalogBytes,
  PACKAGED_BYTES,
};
