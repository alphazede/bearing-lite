#!/usr/bin/env node
// Opt-in journey profiler. Reads journey, event, receipt and host-usage
// metadata only. Session id, cwd and branch stay in the join and are dropped
// before any output. Codex thread_token_usage is cumulative; only per-call usage counts.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { ownerWaitMetrics } = require("../hooks/owner-stops.cjs");
const SCHEMA_PATH = fileURLToPath(new URL("../schemas/journey-profile.schema.json", import.meta.url));
const QUALIFIED = new Set(["claude-code", "codex"]);
const PUBLIC_ROLES = new Set([
  "coordinator", "fellow", "implementer", "integration-engineer", "light-implementer",
  "onboard-bearing", "orchestrator", "prompt", "reviewer", "scribe", "systems-modeler", "test-engineer",
]);
const PUBLIC_STAGES = new Set(["assurance", "implementation", "planning", "review"]);
const PUBLIC_REASONS = new Set([
  "attributed_usage_incomplete", "dispatch_times_not_recorded", "evaluated_decisions_not_supplied",
  "host_field_absent", "host_not_qualified", "negative_counter", "no_attributed_usage",
  "no_completed_journey", "no_events", "no_merged_slice", "non_positive", "owner_wait_not_tracked",
]);
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const num = (value) => ({ value });
const unavail = (reason) => ({ value: "unavailable", reason });
const text = (value) => (typeof value === "string" && value.length > 0 ? value : undefined);
const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

function parseUtc(value) {
  if (typeof value !== "string" || !UTC.test(value)) throw new Error("invalid_utc_timestamp");
  const parsed = Date.parse(value);
  const roundTrip = value.includes(".") ? value : value.replace("Z", ".000Z");
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== roundTrip) throw new Error("invalid_utc_timestamp");
  return parsed;
}

function timeOf(value) {
  try {
    return parseUtc(value);
  } catch {
    return undefined;
  }
}

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error("missing_argument");
    i += 1;
    (out[arg.slice(2)] ??= []).push(value);
  }
  return out;
}

function one(bag, name) {
  const values = bag[name];
  if (!values || values.length !== 1) throw new Error("missing_argument");
  return values[0];
}

function many(bag, name) {
  return bag[name] ?? [];
}

function readBytes(file) {
  try {
    return readFileSync(file);
  } catch {
    throw new Error("unreadable_input");
  }
}

function readJson(file) {
  try {
    return JSON.parse(readBytes(file).toString("utf8"));
  } catch (error) {
    if (error.message === "unreadable_input") throw error;
    throw new Error("malformed_input");
  }
}

function splitHost(spec) {
  const at = spec.indexOf("=");
  if (at <= 0 || at === spec.length - 1) throw new Error("invalid_host_log");
  return [spec.slice(0, at), spec.slice(at + 1)];
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function emit(dir, files) {
  // Write every body beside the destination, then replace. A failed replace puts the previous bytes back.
  mkdirSync(dir, { recursive: true });
  const names = Object.keys(files);
  const prior = new Map();
  const temps = [];
  try {
    for (const name of names) {
      const dest = path.join(dir, name);
      if (existsSync(dest)) prior.set(name, readFileSync(dest));
      const temp = path.join(dir, `.${name}.${process.pid}.tmp`);
      writeFileSync(temp, files[name]);
      temps.push(temp);
    }
    for (let index = 0; index < names.length; index += 1) renameSync(temps[index], path.join(dir, names[index]));
  } catch (error) {
    for (const temp of temps) {
      try { unlinkSync(temp); } catch { /* already moved, or the write never happened */ }
    }
    for (const name of names) {
      const dest = path.join(dir, name);
      if (!prior.has(name)) {
        try { unlinkSync(dest); } catch { /* absent, or not a file this run created */ }
        continue;
      }
      try { writeFileSync(dest, prior.get(name)); } catch { /* destination is not a replaceable file */ }
    }
    if (error && (error.code === "EISDIR" || error.code === "EACCES" || error.code === "EPERM" || error.code === "ERR_ACCESS_DENIED")) {
      throw new Error("output_replace_failed");
    }
    throw error;
  }
}

function schemaDocument() {
  return readJson(SCHEMA_PATH);
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) throw new Error("bad_schema");
  let node = root;
  for (const part of ref.slice(2).split("/")) node = node?.[part];
  if (!node || typeof node !== "object") throw new Error("bad_schema");
  return node;
}

function assertType(type, value) {
  const types = Array.isArray(type) ? type : [type];
  const ok = types.some((kind) => {
    if (kind === "null") return value === null;
    if (kind === "array") return Array.isArray(value);
    if (kind === "integer") return typeof value === "number" && Number.isInteger(value);
    if (kind === "number") return typeof value === "number" && Number.isFinite(value);
    if (kind === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
    return typeof value === kind;
  });
  if (!ok) throw new Error("schema_mismatch");
}

function checkSchema(schema, value, root) {
  if (schema.$ref) {
    checkSchema(resolveRef(root, schema.$ref), value, root);
    return;
  }
  if (schema.oneOf) {
    let matches = 0;
    for (const branch of schema.oneOf) {
      try {
        checkSchema(branch, value, root);
        matches += 1;
      } catch (error) {
        if (error.message === "bad_schema") throw error;
      }
    }
    if (matches !== 1) throw new Error("schema_mismatch");
  }
  if (Object.hasOwn(schema, "const") && value !== schema.const) throw new Error("schema_mismatch");
  if (schema.enum && !schema.enum.includes(value)) throw new Error("schema_mismatch");
  if (schema.type) assertType(schema.type, value);
  if (schema.exclusiveMinimum !== undefined && (typeof value !== "number" || !(value > schema.exclusiveMinimum))) {
    throw new Error("schema_mismatch");
  }
  if (schema.minimum !== undefined && (typeof value !== "number" || value < schema.minimum)) throw new Error("schema_mismatch");
  if (schema.minLength !== undefined && (typeof value !== "string" || value.length < schema.minLength)) {
    throw new Error("schema_mismatch");
  }
  if (schema.pattern !== undefined && (typeof value !== "string" || !new RegExp(schema.pattern).test(value))) {
    throw new Error("schema_mismatch");
  }
  if (schema.properties || schema.required || schema.additionalProperties !== undefined) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("schema_mismatch");
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new Error("schema_mismatch");
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(props, key)) checkSchema(props[key], item, root);
      else if (schema.additionalProperties === false) throw new Error("schema_mismatch");
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        checkSchema(schema.additionalProperties, item, root);
      }
    }
  }
  if (schema.type === "array" || schema.items) {
    if (!Array.isArray(value)) throw new Error("schema_mismatch");
    if (schema.items) for (const item of value) checkSchema(schema.items, item, root);
  }
}

function assertProfile(profile) {
  checkSchema(schemaDocument(), profile, schemaDocument());
}

function readJsonl(file, source, diagnostics) {
  const raw = readBytes(file).toString("utf8");
  const lines = raw.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const records = [];
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    try {
      const rec = JSON.parse(line);
      if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
        diagnostics.push({ source, record_index: index + 1, code: "malformed_json" });
        return;
      }
      records.push(rec);
    } catch {
      diagnostics.push({ source, record_index: index + 1, code: "malformed_json" });
    }
  });
  return records;
}

function presentNumber(usage, key) {
  if (!usage || typeof usage !== "object" || !Object.hasOwn(usage, key)) return undefined;
  return finite(usage[key]);
}

function claudeCalls(records) {
  const seen = new Set();
  const calls = [];
  for (const rec of records) {
    if (rec.type !== "assistant" || rec.message === null || typeof rec.message !== "object") continue;
    const usage = rec.message.usage;
    if (usage === null || typeof usage !== "object") continue;
    const id = text(rec.message.id);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const input = presentNumber(usage, "input_tokens");
    const cacheWrite = presentNumber(usage, "cache_creation_input_tokens");
    const output = presentNumber(usage, "output_tokens");
    calls.push({
      host_session_id: text(rec.sessionId),
      time: timeOf(rec.timestamp),
      cwd: text(rec.cwd),
      branch: text(rec.gitBranch),
      model: text(rec.message.model) ?? null,
      input_tokens: input,
      cache_write_tokens: cacheWrite,
      cache_read_tokens: presentNumber(usage, "cache_read_input_tokens"),
      output_tokens: output,
      fresh: [input, cacheWrite, output].every((part) => part !== undefined) ? input + cacheWrite + output : undefined,
      qualified: true,
    });
  }
  return calls;
}

function codexCalls(records) {
  let cwd;
  let branch;
  let model = null;
  const calls = [];
  for (const rec of records) {
    const payload = rec.payload !== null && typeof rec.payload === "object" ? rec.payload : null;
    if (rec.type === "session_meta" && payload) {
      cwd = text(payload.cwd) ?? cwd;
      branch = payload.git !== null && typeof payload.git === "object" ? text(payload.git.branch) ?? branch : branch;
      continue;
    }
    if (rec.type === "turn_context" && payload) {
      model = text(payload.model) ?? model;
      cwd = text(payload.cwd) ?? cwd;
      continue;
    }
    if (rec.type !== "token_usage_record" || !payload) continue;
    const usage = payload.usage !== null && typeof payload.usage === "object" ? payload.usage : null;
    if (!usage) continue;
    const input = presentNumber(usage, "input_tokens");
    const cached = presentNumber(usage, "cached_input_tokens");
    const cacheWrite = presentNumber(usage, "cache_write_input_tokens");
    const output = presentNumber(usage, "output_tokens");
    const fresh = [input, cached, cacheWrite, output].every((part) => part !== undefined) && input >= cached
      ? input - cached + cacheWrite + output
      : undefined;
    calls.push({
      host_session_id: text(payload.session_id),
      time: timeOf(rec.timestamp),
      cwd,
      branch,
      model,
      cache_read_tokens: cached,
      fresh,
      qualified: true,
    });
  }
  return calls;
}

function unqualifiedCalls(records) {
  return records.map((rec) => ({
    host_session_id: text(rec.sessionId) ?? text(rec.session_id),
    time: timeOf(rec.timestamp),
    cwd: text(rec.cwd),
    branch: text(rec.gitBranch) ?? text(rec.branch),
    model: text(rec.model) ?? null,
    qualified: false,
  }));
}

function hostCalls(harness, records) {
  if (harness === "claude-code") return claudeCalls(records);
  if (harness === "codex") return codexCalls(records);
  return unqualifiedCalls(records);
}

function projectEvent(rec) {
  const unit = rec.unit !== null && typeof rec.unit === "object" ? rec.unit : {};
  const transition = rec.transition !== null && typeof rec.transition === "object" ? rec.transition : {};
  return {
    journey: text(rec.journey),
    occurred_at: text(rec.occurred_at),
    slice: text(unit.slice),
    kind: text(transition.kind),
    verdict: text(transition.verdict),
  };
}

function projectReceipt(rec) {
  const by = rec.produced_by !== null && typeof rec.produced_by === "object" ? rec.produced_by : {};
  return {
    session: text(by.session),
    role: text(by.role) ?? null,
    stage: text(rec.stage) ?? null,
    candidate_revision: text(rec.candidate_revision),
  };
}

function leasesOf(docs, asOf) {
  const endDefault = parseUtc(asOf);
  return docs.map((doc) => {
    const lease = doc.checkout_lease !== null && typeof doc.checkout_lease === "object" ? doc.checkout_lease : {};
    const journey = doc.journey !== null && typeof doc.journey === "object" ? doc.journey : {};
    return {
      journey: text(journey.id),
      status: text(journey.status),
      checkout: text(lease.checkout),
      branch: text(lease.branch),
      candidate_revision: text(lease.candidate_revision),
      start: timeOf(lease.acquired_at),
      end: timeOf(lease.released_at) ?? endDefault,
    };
  });
}

function attribute(call, leases, receipts) {
  const bound = [];
  for (const receipt of receipts) {
    if (!receipt.session || receipt.session !== call.host_session_id) continue;
    for (const lease of leases) {
      if (lease.candidate_revision && lease.candidate_revision === receipt.candidate_revision) {
        bound.push({ journey: lease.journey, role: receipt.role, stage: receipt.stage });
      }
    }
  }
  const unique = [];
  for (const item of bound) {
    if (!unique.some((other) => other.journey === item.journey && other.role === item.role && other.stage === item.stage)) {
      unique.push(item);
    }
  }
  if (unique.length === 1) return { attribution: "bound", journey: unique[0].journey, role: unique[0].role, stage: unique[0].stage };
  if (unique.length > 1) return { attribution: "unattributed", journey: null, role: null, stage: null };
  const inferred = leases.filter((lease) => call.cwd && call.branch && call.time !== undefined
    && lease.checkout === call.cwd && lease.branch === call.branch
    && lease.start !== undefined && call.time >= lease.start && call.time <= lease.end);
  if (inferred.length === 1) return { attribution: "inferred", journey: inferred[0].journey, role: null, stage: null };
  return { attribution: "unattributed", journey: null, role: null, stage: null };
}

function sumField(calls, key) {
  let total = 0;
  for (const call of calls) {
    if (typeof call[key] !== "number") return unavail("host_field_absent");
    total += call[key];
  }
  return total >= 0 ? num(total) : unavail("negative_counter");
}

function usageRows(calls, harness) {
  const groups = new Map();
  for (const call of calls) {
    const key = JSON.stringify([call.attribution, call.journey, call.role, call.stage, call.model]);
    const group = groups.get(key) ?? { ...call, calls: [] };
    group.calls.push(call);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const qualified = QUALIFIED.has(harness) && group.calls.every((call) => call.qualified);
    return {
      journey: group.journey,
      attribution: group.attribution,
      role: group.role,
      stage: group.stage,
      model: group.model,
      harness,
      metrics: qualified
        ? {
          model_calls: num(group.calls.length),
          fresh_tokens: sumField(group.calls, "fresh"),
          cache_read_tokens: sumField(group.calls, "cache_read_tokens"),
        }
        : {
          model_calls: unavail("host_not_qualified"),
          fresh_tokens: unavail("host_not_qualified"),
          cache_read_tokens: unavail("host_not_qualified"),
        },
    };
  });
}

function metricNumber(metric) {
  return typeof metric?.value === "number" ? metric.value : undefined;
}

function journeyMetrics(doc, events, asOf) {
  const id = text(doc.journey?.id);
  const mine = events.filter((event) => event.journey === id);
  const times = mine.map((event) => timeOf(event.occurred_at)).filter((time) => time !== undefined);
  const span = times.length ? (Math.max(...times) - Math.min(...times)) / 1000 : 0;
  const elapsed = span > 0 ? num(span) : unavail("no_events");
  const wait = ownerWaitMetrics(doc, asOf);
  const ownerWait = wait.status === "unavailable" || !(wait.blocked_ms > 0) ? unavail(wait.reason ?? "non_positive") : num(wait.blocked_ms / 1000);
  return {
    journey: id,
    metrics: {
      elapsed_time: elapsed,
      owner_wait_time: ownerWait,
      agent_idle_time: unavail("dispatch_times_not_recorded"),
    },
  };
}

function cohortOf(rows, docs, events) {
  const ids = new Set(docs.map((doc) => text(doc.journey?.id)).filter(Boolean));
  let fresh = 0;
  let incomplete = false;
  for (const row of rows) {
    if (row.attribution === "unattributed" || !ids.has(row.journey)) continue;
    const value = metricNumber(row.metrics.fresh_tokens);
    if (value === undefined) incomplete = true;
    else fresh += value;
  }
  const completed = docs.filter((doc) => doc.journey?.status === "complete").length;
  const merged = new Set(events
    .filter((event) => ids.has(event.journey) && event.kind === "merge" && event.verdict === "PASS" && event.slice)
    .map((event) => JSON.stringify([event.journey, event.slice]))).size;
  const ratio = (denominator, reason) => {
    if (denominator <= 0) return unavail(reason);
    if (incomplete || !(fresh > 0)) return unavail(incomplete ? "attributed_usage_incomplete" : "no_attributed_usage");
    return num(fresh / denominator);
  };
  return {
    tokens_per_integrated_slice: ratio(merged, "no_merged_slice"),
    tokens_per_completed_journey: ratio(completed, "no_completed_journey"),
  };
}

function sortUsage(rows) {
  const order = { bound: 0, inferred: 1, unattributed: 2 };
  return rows.sort((a, b) => order[a.attribution] - order[b.attribution]
    || String(a.journey).localeCompare(String(b.journey))
    || String(a.role).localeCompare(String(b.role))
    || String(a.stage).localeCompare(String(b.stage))
    || a.harness.localeCompare(b.harness)
    || String(a.model).localeCompare(String(b.model)));
}

function renderReport(profile) {
  const metricText = (metrics) => Object.entries(metrics)
    .map(([key, metric]) => (metric.value === "unavailable" ? `${key} unavailable (${metric.reason})` : `${key} ${metric.value}`))
    .join(", ");
  const counts = { bound: 0, inferred: 0, unattributed: 0 };
  for (const row of profile.usage) counts[row.attribution]++;
  const labels = Object.entries(counts).map(([label, count]) => `${label} ${count}`).join(", ");
  const lines = ["# Journey profile", "", "Inferred attribution is an inference.", `Attribution rows: ${labels}.`, "", "## Usage"];
  for (const row of profile.usage) {
    lines.push(`- ${row.attribution} ${row.journey ?? "none"} ${row.role ?? "none"} ${row.stage ?? "none"} ${row.harness} ${row.model ?? "none"} ${metricText(row.metrics)}`);
  }
  lines.push("", "## Journeys");
  for (const journey of profile.journeys) lines.push(`- ${journey.journey} ${metricText(journey.metrics)}`);
  lines.push("", "## Cohort", metricText(profile.cohort), "", "## Owner ask rate", metricText({ owner_ask_rate: profile.owner_ask_rate }));
  lines.push("", "## Host coverage");
  for (const [name, host] of Object.entries(profile.hosts)) {
    lines.push(`- ${name} ${host.status}${host.reason ? ` ${host.reason}` : ""}`);
  }
  if (profile.diagnostics.length) {
    lines.push("", "## Diagnostics");
    for (const item of profile.diagnostics) lines.push(`- ${item.source} ${item.record_index} ${item.code}`);
  }
  return `${lines.join("\n")}\n`;
}

function profileCmd(bag) {
  const asOf = one(bag, "as-of");
  parseUtc(asOf);
  const journeyFiles = many(bag, "journey");
  const journeyDocs = journeyFiles.map(readJson);
  const tracked = journeyDocs.filter((doc) => doc.profiler_tracking === true);
  if (tracked.length === 0) return;
  const out = one(bag, "out");
  const eventFiles = many(bag, "events");
  const receiptFiles = many(bag, "receipt");
  const hostSpecs = many(bag, "host-log").map(splitHost);
  const diagnostics = [];
  const events = eventFiles.flatMap((file, index) => readJsonl(file, `events-${index + 1}`, diagnostics).map(projectEvent));
  const receipts = receiptFiles.flatMap((file) => {
    const doc = readJson(file);
    return [projectReceipt(doc)];
  });
  const leases = leasesOf(tracked, asOf);
  const hosts = {};
  const usage = [];
  hostSpecs.forEach(([harness, file], index) => {
    const calls = hostCalls(harness, readJsonl(file, `log-${index + 1}`, diagnostics)).map((call) => ({
      ...call,
      ...attribute(call, leases, receipts),
    }));
    usage.push(...usageRows(calls, harness));
    hosts[harness] = QUALIFIED.has(harness) ? { status: "qualified" } : { status: "unavailable", reason: "host_not_qualified" };
  });
  const inputs = [...journeyFiles, ...eventFiles, ...receiptFiles, ...hostSpecs.map(([, file]) => file)]
    .map((file) => ({ sha256: createHash("sha256").update(readBytes(file)).digest("hex") }));
  diagnostics.sort((a, b) => a.source.localeCompare(b.source) || a.record_index - b.record_index);
  const profile = {
    inputs,
    hosts,
    usage: sortUsage(usage),
    journeys: tracked
      .map((doc) => journeyMetrics(doc, events, asOf))
      .sort((a, b) => a.journey.localeCompare(b.journey)),
    cohort: cohortOf(usage, tracked, events),
    owner_ask_rate: unavail("evaluated_decisions_not_supplied"),
    diagnostics,
  };
  assertProfile(profile);
  const body = `${canonicalize(profile)}\n`;
  emit(out, { "profile.json": body, "report.md": renderReport(profile) });
}

function orchestratorMetrics(calls, harness) {
  if (harness !== "claude-code") {
    return {
      model_calls: unavail("host_not_qualified"),
      input_tokens: unavail("host_not_qualified"),
      cache_write_tokens: unavail("host_not_qualified"),
      cache_read_tokens: unavail("host_not_qualified"),
      output_tokens: unavail("host_not_qualified"),
    };
  }
  return {
    model_calls: num(calls.length),
    input_tokens: sumField(calls, "input_tokens"),
    cache_write_tokens: sumField(calls, "cache_write_tokens"),
    cache_read_tokens: sumField(calls, "cache_read_tokens"),
    output_tokens: sumField(calls, "output_tokens"),
  };
}

function stageCmd(bag) {
  const doc = readJson(one(bag, "journey"));
  if (doc.profiler_tracking !== true) return;
  const at = one(bag, "at");
  const end = parseUtc(at);
  const session = one(bag, "session");
  const [harness, file] = splitHost(one(bag, "host-log"));
  const record = one(bag, "record");
  const stage = one(bag, "stage");
  const calls = hostCalls(harness, readJsonl(file, "log-1", []));
  let existing = { stage_boundaries: [] };
  let previous = null;
  if (existsSync(record)) {
    existing = readJson(record);
    if (!Array.isArray(existing.stage_boundaries)) throw new Error("invalid_record");
    const last = existing.stage_boundaries.at(-1);
    if (last && typeof last.at === "string") previous = timeOf(last.at);
  }
  const chosen = calls.filter((call) => call.host_session_id === session && call.time !== undefined
    && (previous === null || call.time > previous) && call.time <= end);
  existing.stage_boundaries.push({ stage, at, orchestrator: orchestratorMetrics(chosen, harness) });
  writeFileSync(record, `${canonicalize(existing)}\n`);
}

function publicReason(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(publicReason);
    return;
  }
  if (typeof value.reason === "string" && !PUBLIC_REASONS.has(value.reason)) throw new Error("unsafe_projection");
  Object.values(value).forEach(publicReason);
}

function exportCmd(bag) {
  const profile = readJson(one(bag, "profile"));
  assertProfile(profile);
  const journeyIds = [...new Set(profile.journeys.map((row) => row.journey))].sort();
  const aliases = new Map(journeyIds.map((id, index) => [id, `journey-${index + 1}`]));
  const participation = [];
  for (const row of profile.usage) {
    if (typeof row.role !== "string") continue;
    if (!PUBLIC_ROLES.has(row.role) || (row.stage !== null && !PUBLIC_STAGES.has(row.stage))) throw new Error("unsafe_projection");
    participation.push({ role: row.role, stage: row.stage, attribution: row.attribution, journey: aliases.get(row.journey) ?? null });
  }
  const staged = {
    participation,
    journeys: profile.journeys.map((row) => ({ journey: aliases.get(row.journey), metrics: row.metrics })),
    cohort: profile.cohort,
    owner_ask_rate: profile.owner_ask_rate,
  };
  publicReason(staged);
  const out = one(bag, "out");
  const body = `${canonicalize(staged)}\n`;
  emit(out, { "export.json": body });
  process.stdout.write(`${JSON.stringify({ sha256: createHash("sha256").update(body).digest("hex") })}\n`);
}

function validateCmd(bag) {
  const file = bag._[0];
  if (!file) throw new Error("missing_argument");
  assertProfile(readJson(file));
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const bag = flags(rest);
  if (command === "profile") return profileCmd(bag);
  if (command === "stage-boundary") return stageCmd(bag);
  if (command === "export") return exportCmd(bag);
  if (command === "validate") return validateCmd(bag);
  throw new Error("unknown_command");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  console.error(/^[a-z0-9_]+$/.test(message) ? message : "profiler_failed");
  process.exitCode = 1;
}
