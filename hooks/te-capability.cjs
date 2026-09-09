"use strict";

/**
 * Test Engineering capability resolver (SEIT-EMV-017, SEIT-EMV-036).
 *
 * Bearing Lite ships no Test Engineering evaluator and no Test Engineering
 * method content. This module only answers one question: is the
 * `test-engineering` capability active for this workspace, and if so, is the
 * real evaluator loadable at its capability path?
 *
 * Activation is `selected OR required`.
 *   - neither      -> INACTIVE. Not a failure; the class simply does not run.
 *   - active, gone -> TYPED_GAP. Never silent success, never invented policy.
 *   - active, here -> ACTIVE, with the loaded evaluator module.
 *
 * `invented` is always `false`: this resolver never substitutes a local
 * decision for the evaluator's.
 */

const fs = require("node:fs");
const path = require("node:path");

const CAPABILITY = "test-engineering";
const STATUSES = Object.freeze(["INACTIVE", "ACTIVE", "TYPED_GAP"]);
/** Capability path, relative to the workspace root. */
const EVALUATOR_RELATIVE_PATH = path.join(
  "skills",
  CAPABILITY,
  "hooks",
  "te-evaluator.cjs"
);

/**
 * @param {unknown} workspaceRoot
 * @returns {string}
 */
function evaluatorPath(workspaceRoot) {
  const root =
    typeof workspaceRoot === "string" && workspaceRoot.trim()
      ? workspaceRoot.trim()
      : process.cwd();
  return path.resolve(root, EVALUATOR_RELATIVE_PATH);
}

/**
 * Load the evaluator at the capability path. Absence, a load failure, or a
 * module that does not implement the evaluator contract are all the same
 * observable: the capability is unavailable.
 * @param {unknown} workspaceRoot
 * @returns {{ evaluateTestWrite: Function, evaluateCompletion: Function } | null}
 */
function loadEvaluator(workspaceRoot) {
  const target = evaluatorPath(workspaceRoot);
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  let mod;
  try {
    mod = require(target);
  } catch {
    return null;
  }
  if (
    !mod ||
    typeof mod.evaluateTestWrite !== "function" ||
    typeof mod.evaluateCompletion !== "function"
  ) {
    return null;
  }
  return mod;
}

/**
 * Resolve the `test-engineering` capability for one workspace.
 * @param {{ workspaceRoot?: string, selected?: boolean, required?: boolean }} [input]
 */
function resolve(input) {
  const opts = input !== null && typeof input === "object" ? input : {};
  const selected = opts.selected === true;
  const required = opts.required === true;
  const base = {
    capability: CAPABILITY,
    selected,
    required,
    invented: false,
  };

  if (!selected && !required) {
    return {
      ...base,
      active: false,
      status: "INACTIVE",
      evaluator: null,
      code: "capability_inactive",
      message:
        `capability "${CAPABILITY}" is neither selected nor required; ` +
        "the class does not run and this is not a failure",
    };
  }

  const evaluator = loadEvaluator(opts.workspaceRoot);
  if (!evaluator) {
    return {
      ...base,
      active: true,
      status: "TYPED_GAP",
      evaluator: null,
      code: "typed_capability_gap",
      message:
        `selected or required capability "${CAPABILITY}" is unavailable: ` +
        `no loadable evaluator at ${EVALUATOR_RELATIVE_PATH}`,
      recovery:
        "install the test-engineering method capability in this workspace, " +
        "or clear the selected/required activation for this task",
    };
  }

  return {
    ...base,
    active: true,
    status: "ACTIVE",
    evaluator,
  };
}

module.exports = {
  CAPABILITY,
  STATUSES,
  EVALUATOR_RELATIVE_PATH,
  evaluatorPath,
  loadEvaluator,
  resolve,
};
