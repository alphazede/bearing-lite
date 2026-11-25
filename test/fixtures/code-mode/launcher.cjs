"use strict";

// Stand-in for the trusted external launcher boundary, limited to an append
// in a test-owned ledger and a durable JSON receipt. No agent is started.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const [mode, control, workspace, evidenceDir] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const get = file => JSON.parse(fs.readFileSync(file, "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const blocked = code => ({ status: "WAITING_ON", error: { code } });

function put(file, value) {
  const temp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value));
  fs.renameSync(temp, file);
}

async function pause(packet, stage) {
  const releaseFile = path.join(control, packet + ".release");
  const readyFile = path.join(control, packet + ".ready");
  put(readyFile, { stage, pid: process.pid });
  const deadline = Date.now() + 25000;
  while (!fs.existsSync(releaseFile)) {
    if (Date.now() >= deadline) throw new Error("fixture release not received");
    await delay(25);
  }
  const { cancel } = get(releaseFile);
  fs.rmSync(releaseFile);
  fs.rmSync(readyFile);
  return cancel;
}

function verified(request) {
  return typeof request.packet === "string" && /^[a-z0-9-]+$/.test(request.packet) &&
    request.role === "implementer" &&
    JSON.stringify(request.write_set) === '["state/effects.log"]' &&
    request.binding_path === path.join(workspace, "binding.json") &&
    request.binding_sha256 === sha(fs.readFileSync(request.binding_path));
}

function applyEffect(request, receiptPath, settings) {
  const { packet, role, binding_sha256 } = request;
  fs.appendFileSync(path.join(workspace, "state/effects.log"), packet + "\n");
  put(receiptPath, { packet, role, binding_sha256 });
  if (settings.advance_generation) {
    const journeyPath = path.join(workspace, "journey.json");
    const journey = get(journeyPath);
    journey.state_generation++;
    put(journeyPath, journey);
  }
}

async function launch(request) {
  // An external invocation receipt makes refusal-before-launch observable.
  fs.appendFileSync(path.join(control, "dispatch.log"), String(request.packet) + "\n");
  if (!verified(request)) return blocked("policy_denied");
  const { packet, operation = "dispatch" } = request;
  const receiptPath = path.join(evidenceDir, "launch-" + packet + ".json");
  const ref = () => ({ path: path.basename(receiptPath), sha256: sha(fs.readFileSync(receiptPath)) });
  if (operation === "reconcile") {
    return fs.existsSync(receiptPath) ? { status: "COMPLETE", receipt: ref() } : { status: "NOT_STARTED" };
  }
  if (operation !== "dispatch") return blocked("policy_denied");

  const controlFile = path.join(control, packet + ".json");
  const settings = fs.existsSync(controlFile) ? get(controlFile) : {};
  if (settings.invalid_output) return { status: 17 };
  if (settings.invalid_ref) {
    return { status: "COMPLETE", receipt: {
      path: "../unrelated.json", sha256: sha(fs.readFileSync(path.join(evidenceDir, "../unrelated.json"))),
    } };
  }
  if (settings.hold === "before" && await pause(packet, "before")) return blocked("cancelled");
  applyEffect(request, receiptPath, settings);
  if (settings.hold === "after") await pause(packet, "after");
  if (settings.partial) return { ...blocked("partial_effect"), receipt: ref() };
  return { status: "COMPLETE", receipt: ref(), ...(settings.message ? { message: settings.message } : {}) };
}

async function main() {
  if (mode === "dispatch") return launch(input);
  if (mode !== "direct") return blocked("policy_denied");
  fs.appendFileSync(path.join(control, "direct.log"), input.capability + "\n");
  if (input.capability === "ready-set") return require("../../../hooks/ready-set.cjs").evaluate(input.input);
  if (input.capability === "legacy-status") return { available: true };
  if (input.capability === "dispatch") {
    return launch({ ...input.input, binding_path: input.binding_path, binding_sha256: input.binding_sha256 });
  }
  return blocked("policy_denied");
}

main().then(value => process.stdout.write(JSON.stringify(value) + "\n")).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
