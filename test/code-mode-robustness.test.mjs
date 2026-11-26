// Observable effects and durable receipts, not private scheduler state.

import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
	configure,
	controlMode,
	dispatchInput,
	effects,
	evidence,
	evidenceBytes,
	failure,
	fixture,
	json,
	parseOutcome,
	processAlive,
	program,
	put,
	readyInput,
	release,
	request,
	run,
	sandboxSkip,
	start,
	transitionInput,
	waitFor,
	workspaceDigest,
} from "./fixtures/code-mode/fixture.mjs";

// Tests that start a real sandboxed routine skip where the runtime reports
// its sandbox unavailable.
const sandbox = await sandboxSkip();

const dispatch = (id, packet = id, generation = 1) =>
	request(id, "dispatch", dispatchInput(packet), generation);
const complete = (out) =>
	assert.equal(out.status, "COMPLETE", JSON.stringify(out));
const waiting = (out) => {
	assert.equal(out.status, "WAITING_ON", JSON.stringify(out));
	assert.ok(
		["lock_busy", "stale_state", "in_progress"].includes(out.error?.code),
		JSON.stringify(out),
	);
};

test("BLX-VC-050: competing updates commit once at the original state generation", async (t) => {
	const f = fixture(t);
	controlMode(f, "first", { hold: "before", advance_generation: true });
	const first = start(f, dispatch("first"));
	await waitFor(f, "first.ready", first);
	const second = await run(f, dispatch("second"));
	waiting(second);
	assert.deepEqual(
		effects(f),
		[],
		"conflicting effect began before lock release",
	);
	release(f, "first");
	complete(parseOutcome(await first.result));
	assert.deepEqual(effects(f), ["first"]);
	assert.equal(json(f.journey).state_generation, 2);
	assert.deepEqual(json(f.journey).unrelated, { keep: "unchanged" });
	waiting(await run(f, dispatch("old-generation", "second", 1)));
	assert.deepEqual(effects(f), ["first"]);
});

test("BLX-VC-051: SIGTERM during routine returns cancelled without partial state", async (t) => {
	const f = fixture(t);
	controlMode(f, "cancel", { hold: "before" });
	const before = workspaceDigest(f);
	const active = start(f, dispatch("cancel"));
	await waitFor(f, "cancel.ready", active);
	const { pid } = json(path.join(f.control, "cancel.ready"));
	assert.ok(active.child.kill("SIGTERM"));
	const cancelled = parseOutcome(await active.result);
	failure(cancelled, "cancelled");
	assert.equal(
		processAlive(pid),
		false,
		"cancelled request left its owned launcher alive",
	);
	assert.equal(workspaceDigest(f), before);
	assert.deepEqual(effects(f), []);
	// A new request can acquire the released lock after cancellation.
	complete(await run(f, dispatch("after-cancel")));
	assert.deepEqual(effects(f), ["after-cancel"]);
});

test("BLX-VC-052: duplicate key sees in-progress status then replays the recorded outcome", async (t) => {
	const f = fixture(t);
	controlMode(f, "once", { hold: "before" });
	const req = dispatch("once");
	const active = start(f, req);
	await waitFor(f, "once.ready", active);
	waiting(await run(f, req));
	assert.deepEqual(effects(f), []);
	release(f, "once");
	const first = parseOutcome(await active.result);
	complete(first);
	assert.deepEqual(effects(f), ["once"]);
	const replay = await run(f, req);
	assert.deepEqual(replay, first);
	assert.deepEqual(effects(f), ["once"]);
	for (const ref of replay.evidence_refs) evidenceBytes(f, ref);
});

for (const [packet, stage] of [
	["step-3", "before"],
	["step-2", "after"],
]) {
	test(
		"BLX-VC-053: resume after interruption " +
			stage +
			" confirmation of " +
			packet,
		async (t) => {
			if (sandbox) return t.skip(sandbox);
			const f = fixture(t);
			controlMode(f, packet, { hold: stage });
			const code =
				["step-1", "step-2", "step-3", "step-4"]
					.map(
						(name) =>
							'await call("dispatch", ' +
							JSON.stringify(dispatchInput(name)) +
							");",
					)
					.join("\n") + "\nreturn { finished: true };";
			const req = program("four-effects", code);
			const active = start(f, req);
			await waitFor(f, packet + ".ready", active);
			const marker = json(path.join(f.control, packet + ".ready"));
			assert.equal(marker.stage, stage);
			assert.deepEqual(effects(f), ["step-1", "step-2"]);
			// The fixture's external receipt, not the runtime journal, proves the
			// second effect happened even if the caller never received confirmation.
			assert.equal(
				json(path.join(f.evidenceDir, "launch-step-2.json")).packet,
				"step-2",
			);
			const exited = once(active.child, "exit");
			assert.ok(active.child.kill("SIGKILL"));
			await exited;
			release(f, packet, true);
			const killed = await active.result;
			assert.equal(killed.signal, "SIGKILL");
			const pending = () =>
				existsSync(path.join(f.control, packet + ".ready")) &&
				processAlive(marker.pid);
			const deadline = Date.now() + 5000;
			while (pending() && Date.now() < deadline) await delay(25);
			assert.equal(
				pending(),
				false,
				"interrupted fixture launcher did not finish",
			);
			controlMode(f, packet, {});
			const resumed = await run(f, req);
			complete(resumed);
			assert.deepEqual(effects(f), ["step-1", "step-2", "step-3", "step-4"]);
			assert.deepEqual(JSON.parse(evidence(f, resumed, "result")), {
				finished: true,
			});
			assert.deepEqual(await run(f, req), resumed);
			assert.deepEqual(effects(f), ["step-1", "step-2", "step-3", "step-4"]);
		},
	);
}

test("BLX-VC-054: partial parallel result reports succeeded and failed calls, not COMPLETE", async (t) => {
	const f = fixture(t);
	const out = await run(
		f,
		request("partial-parallel", "parallel", {
			calls: [
				{ capability: "ready-set", input: readyInput },
				{
					capability: "evidence",
					input: { path: "missing.json", sha256: "0".repeat(64) },
				},
				{ capability: "lifecycle-state", input: transitionInput },
			],
		}),
	);
	assert.notEqual(out.status, "COMPLETE", JSON.stringify(out));
	assert.ok(Array.isArray(out.calls));
	const status = Object.fromEntries(
		out.calls.map((entry) => [entry.capability, entry.status]),
	);
	assert.deepEqual(status, {
		"ready-set": "COMPLETE",
		evidence: "WAITING_ON",
		"lifecycle-state": "COMPLETE",
	});
	assert.equal(
		out.calls.find((entry) => entry.capability === "evidence").error.code,
		"evidence_ref_invalid",
	);
	assert.deepEqual(JSON.parse(evidence(f, out, "call", "ready-set")).ready, [
		"B",
		"C",
	]);
	assert.equal(
		JSON.parse(evidence(f, out, "call", "lifecycle-state")).outcome,
		"ADVISE",
	);
	assert.deepEqual(effects(f), []);
});

async function waitForReadEvidence(f, active) {
	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) {
		for (const entry of readdirSync(f.evidenceDir, {
			recursive: true,
			withFileTypes: true,
		})) {
			if (!entry.isFile()) continue;
			let value;
			try {
				value = json(path.join(entry.parentPath, entry.name));
			} catch {
				continue;
			}
			if (value?.generation === 1) return;
		}
		if (active.child.exitCode !== null || active.child.signalCode !== null) {
			assert.fail(
				"routine exited before read evidence: " +
					JSON.stringify(await active.result),
			);
		}
		await delay(25);
	}
	assert.fail(
		"no public generation-read evidence under the bounded readiness deadline",
	);
}

test("BLX-VC-055: generation changes after read; stale request cannot write", async (t) => {
	if (sandbox) return t.skip(sandbox);
	const f = fixture(t);
	const req = program(
		"stale-request",
		`
    const first = await call("lifecycle-state", { read: "generation" });
    const deadline = Date.now() + 22000;
    let changed = false;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const current = await call("lifecycle-state", { read: "generation" });
      if (current.generation !== first.generation) { changed = true; break; }
    }
    if (!changed) return { noChangeObserved: true };
    return await call("dispatch", ${JSON.stringify(dispatchInput("stale-effect"))});
  `,
	);
	const active = start(f, req);
	await waitForReadEvidence(f, active);
	const current = json(f.journey);
	current.state_generation = 2;
	put(f.journey, current);
	const stale = parseOutcome(await active.result);
	waiting(stale);
	assert.deepEqual(effects(f), []);
	assert.deepEqual(json(f.journey), current);
	complete(await run(f, dispatch("fresh-request", "fresh-effect", 2)));
	assert.deepEqual(effects(f), ["fresh-effect"]);
});

test("BLX-VC-109: independent effects overlap; conflicting effects serialize on the named lock", async (t) => {
	const a = fixture(t);
	const b = fixture(t);
	controlMode(a, "left", { hold: "before" });
	controlMode(b, "right", { hold: "before" });
	const left = start(a, dispatch("left"));
	const right = start(b, dispatch("right"));
	// A serial implementation cannot reach both independent readiness points.
	await Promise.all([
		waitFor(a, "left.ready", left),
		waitFor(b, "right.ready", right),
	]);
	release(a, "left");
	release(b, "right");
	for (const outcome of await Promise.all([left.result, right.result]))
		complete(parseOutcome(outcome));
	assert.deepEqual(effects(a), ["left"]);
	assert.deepEqual(effects(b), ["right"]);

	const f = fixture(t);
	controlMode(f, "locked-first", { hold: "before" });
	const first = start(f, dispatch("locked-first"));
	await waitFor(f, "locked-first.ready", first);
	waiting(await run(f, dispatch("competing", "locked-second")));
	assert.deepEqual(effects(f), []);
	release(f, "locked-first");
	complete(parseOutcome(await first.result));
	complete(await run(f, dispatch("retry", "locked-second")));
	assert.deepEqual(effects(f), ["locked-first", "locked-second"]);
});

test("BLX-VC-110: denial never invokes the direct path, even if configured", async (t) => {
	const f = fixture(t, {
		code_mode: false,
		allowed_capabilities: ["ready-set"],
		allowed_direct: ["ready-set", "dispatch"],
	});
	const direct = await run(f, dispatch("direct-sibling"));
	complete(direct);
	assert.equal(direct.mode, "direct");
	assert.deepEqual(effects(f), ["direct-sibling"]);
	const marker = path.join(f.control, "direct.log");
	assert.equal(readFileSync(marker, "utf8"), "dispatch\n");
	configure(f, { code_mode: true });
	const before = workspaceDigest(f);
	failure(await run(f, dispatch("denied")), "capability_denied");
	assert.deepEqual(effects(f), ["direct-sibling"]);
	assert.equal(workspaceDigest(f), before);
	assert.equal(readFileSync(marker, "utf8"), "dispatch\n");
});

test("BLX-VC-110: partial effect is reported with receipt and is never directly replayed", async (t) => {
	const f = fixture(t, { allowed_direct: ["ready-set", "dispatch"] });
	controlMode(f, "partial", { partial: true });
	const out = await run(f, dispatch("partial"));
	failure(out, "partial_effect");
	assert.deepEqual(effects(f), ["partial"]);
	const ref = JSON.parse(evidence(f, out, "call", "dispatch")).receipt;
	assert.equal(JSON.parse(evidenceBytes(f, ref)).packet, "partial");
	assert.ok(!existsSync(path.join(f.control, "direct.log")));
	assert.equal(
		readFileSync(path.join(f.workspace, "state/effects.log"), "utf8"),
		"partial\n",
	);
});

test("BLX-VC-053: F2b preserves an uncertain reconciliation without another dispatch", async (t) => {
	const f = fixture(t);
	controlMode(f, "once", { hold: "after", reconcile_unknown: true });
	const req = dispatch("once");
	const active = start(f, req);
	await waitFor(f, "once.ready", active);
	assert.deepEqual(effects(f), ["once"]);
	const exited = once(active.child, "exit");
	active.child.kill("SIGKILL");
	await exited;
	release(f, "once");
	await active.result;
	failure(await run(f, req), "partial_effect");
	failure(
		await run(f, { ...req, request_id: "second-observation" }),
		"partial_effect",
	);
	assert.deepEqual(effects(f), ["once"]);
	assert.deepEqual(
		readFileSync(path.join(f.control, "dispatch.log"), "utf8")
			.trim()
			.split("\n"),
		["once", "once"],
		"one dispatch and one reconciliation",
	);
});

test("a completed request key remains bound to the original operation", async (t) => {
	const f = fixture(t);
	const req = request("same-key", "ready-set", readyInput);
	const first = await run(f, req);
	complete(first);
	failure(
		await run(f, { ...req, input: { slices: [] } }),
		"idempotency_conflict",
	);
	assert.deepEqual(await run(f, req), first);
});

test("a missing packet grant cannot start a configured launcher", async (t) => {
	const f = fixture(t);
	configure(f, { grant_path: undefined, grant_sha256: undefined });
	failure(await run(f, dispatch("once")), "grant_mismatch");
	assert.deepEqual(effects(f), []);
	assert.equal(existsSync(path.join(f.control, "dispatch.log")), false);
});
