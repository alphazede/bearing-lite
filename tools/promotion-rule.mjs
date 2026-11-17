#!/usr/bin/env node
// Pure DEC-07 promotion report. Reads replay receipts and writes nothing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REASON_ORDER = [
  "gate_regression",
  "seeded_defect_missed",
  "violation",
  "fresh_tokens_not_lower",
  "missing_evidence",
  "incomparable_workload",
  "unqualified_calibration",
];

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const asRuns = (value) => (Array.isArray(value) ? value : []);

function pairKey(run) {
  return `${String(run.task)}\0${String(run.repetition)}`;
}

function indexRuns(runs) {
  const map = new Map();
  let duplicate = false;
  for (const run of runs) {
    const key = pairKey(run);
    if (map.has(key)) duplicate = true;
    map.set(key, run);
  }
  return { map, duplicate };
}

function frozen(runs, field) {
  if (runs.length === 0) return false;
  const value = runs[0][field];
  return typeof value === "string" && value.length > 0 && runs.every((run) => run[field] === value);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function perSlice(run) {
  if (!finite(run.fresh_tokens) || !finite(run.integrated_slices) || run.integrated_slices <= 0) return null;
  return run.fresh_tokens / run.integrated_slices;
}

function add(sum, value) {
  return sum + (finite(value) ? value : 0);
}

function armStats(runs) {
  let errors = 0;
  let elapsed_ms = 0;
  let owner_asks = 0;
  const ratios = [];
  let complete = runs.length > 0;
  for (const run of runs) {
    errors = add(errors, run.errors);
    elapsed_ms = add(elapsed_ms, run.elapsed_ms);
    owner_asks = add(owner_asks, run.owner_asks);
    const ratio = perSlice(run);
    if (ratio === null) complete = false;
    else ratios.push(ratio);
  }
  return {
    runs: runs.length,
    median_fresh_tokens_per_integrated_slice: complete ? median(ratios) : null,
    errors,
    elapsed_ms,
    owner_asks,
    complete,
  };
}

function recordObject(value) {
  return value !== null && typeof value === "object" ? value : null;
}

function comparePairs(baseline, candidate, reasons) {
  const base = indexRuns(baseline);
  const cand = indexRuns(candidate);
  let gatesOk = baseline.length > 0 && candidate.length > 0 && !base.duplicate && !cand.duplicate;
  let seededOk = gatesOk;
  if (baseline.length === 0 || candidate.length === 0 || base.duplicate || cand.duplicate) {
    reasons.add("missing_evidence");
  }
  const samePairs = base.map.size === cand.map.size && [...base.map.keys()].every((key) => cand.map.has(key));
  if (gatesOk && !samePairs) {
    reasons.add("missing_evidence");
    gatesOk = false;
    seededOk = false;
  }
  for (const [key, baseRun] of base.map) {
    const candRun = cand.map.get(key);
    if (!candRun) continue;
    const baseGates = recordObject(baseRun.gates);
    const candGates = recordObject(candRun.gates);
    if (!baseGates || !candGates) {
      reasons.add("missing_evidence");
      gatesOk = false;
    } else {
      for (const name of Object.keys(baseGates)) {
        if (!hasOwn(candGates, name)) {
          reasons.add("missing_evidence");
          gatesOk = false;
        } else if (baseGates[name] === "PASS" && candGates[name] !== "PASS") {
          reasons.add("gate_regression");
          gatesOk = false;
        }
      }
    }
    const baseDefects = recordObject(baseRun.seeded_defects);
    const candDefects = recordObject(candRun.seeded_defects);
    if (!baseDefects || !candDefects) {
      reasons.add("missing_evidence");
      seededOk = false;
    } else {
      for (const name of Object.keys(baseDefects)) {
        if (!hasOwn(candDefects, name)) {
          reasons.add("missing_evidence");
          seededOk = false;
        } else if (baseDefects[name] === true && candDefects[name] !== true) {
          reasons.add("seeded_defect_missed");
          seededOk = false;
        }
      }
    }
  }
  return { gatesOk, seededOk };
}

function violationsOk(runs, reasons) {
  let ok = runs.length > 0;
  for (const run of runs) {
    const violations = recordObject(run.violations);
    if (!violations || !finite(violations.authority) || !finite(violations.write_set)) {
      reasons.add("missing_evidence");
      ok = false;
    } else if (violations.authority !== 0 || violations.write_set !== 0) {
      reasons.add("violation");
      ok = false;
    }
  }
  return ok;
}

function tokensOk(baseArm, candArm, reasons) {
  if (!baseArm.complete || !candArm.complete) {
    reasons.add("missing_evidence");
    return false;
  }
  if (!(candArm.median_fresh_tokens_per_integrated_slice < baseArm.median_fresh_tokens_per_integrated_slice)) {
    reasons.add("fresh_tokens_not_lower");
    return false;
  }
  return true;
}

function comparable(baseline, candidate, reasons) {
  if (baseline.length === 0 || candidate.length === 0) return;
  const sameWorkload = frozen(baseline, "workload_digest")
    && frozen(candidate, "workload_digest")
    && baseline[0].workload_digest === candidate[0].workload_digest;
  const frozenPackages = frozen(baseline, "package_digest") && frozen(candidate, "package_digest");
  if (!sameWorkload || !frozenPackages) reasons.add("incomparable_workload");
}

function requiredEvidence(runs, reasons) {
  for (const run of runs) {
    if (!Array.isArray(run.required_evidence)) continue;
    const evidence = recordObject(run.evidence) ?? {};
    for (const item of run.required_evidence) {
      if (item === "calibration") {
        const calibration = recordObject(evidence.calibration);
        if (!calibration) reasons.add("missing_evidence");
        else if (calibration.qualified !== true) reasons.add("unqualified_calibration");
      } else if (evidence[item] == null) {
        reasons.add("missing_evidence");
      }
    }
  }
}

function publishArm(arm) {
  return {
    runs: arm.runs,
    median_fresh_tokens_per_integrated_slice: arm.median_fresh_tokens_per_integrated_slice,
    errors: arm.errors,
    elapsed_ms: arm.elapsed_ms,
    owner_asks: arm.owner_asks,
  };
}

export function evaluatePromotion(input = {}) {
  const baseline = asRuns(input.baseline);
  const candidate = asRuns(input.candidate);
  const reasons = new Set();
  const pairs = comparePairs(baseline, candidate, reasons);
  const baseArm = armStats(baseline);
  const candArm = armStats(candidate);
  const terms = {
    gates_preserved: { satisfied: pairs.gatesOk },
    seeded_defects_found: { satisfied: pairs.seededOk },
    no_violations: { satisfied: violationsOk(candidate, reasons) },
    fresh_tokens_lower: { satisfied: tokensOk(baseArm, candArm, reasons) },
  };
  comparable(baseline, candidate, reasons);
  requiredEvidence(baseline, reasons);
  requiredEvidence(candidate, reasons);
  const decision = reasons.size === 0 ? "promote" : "no_promote";
  return {
    decision,
    reasons: REASON_ORDER.filter((code) => reasons.has(code)),
    terms,
    arms: { baseline: publishArm(baseArm), candidate: publishArm(candArm) },
    recommendation: decision === "promote" ? "adopt_candidate" : "keep_current_default",
  };
}

function loadDir(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const runs = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const full = path.join(dir, name);
    try {
      if (!statSync(full).isFile()) continue;
      runs.push(JSON.parse(readFileSync(full, "utf8")));
    } catch {
      return [];
    }
  }
  return runs;
}

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function reportFromArgv(argv) {
  const baselineDir = flag(argv, "--baseline");
  const candidateDir = flag(argv, "--candidate");
  return evaluatePromotion({
    baseline: baselineDir ? loadDir(baselineDir) : [],
    candidate: candidateDir ? loadDir(candidateDir) : [],
  });
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.stdout.write(`${JSON.stringify(reportFromArgv(process.argv.slice(2)))}\n`);
}
