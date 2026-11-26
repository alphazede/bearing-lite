// Defensive sandbox checks use only owned files, synthetic values, finite load
// and a listener on an OS-selected loopback port.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { connect, createServer } from "node:net";
import path from "node:path";
import { test } from "node:test";
import {
	controlMode,
	dispatchInput,
	evidence,
	evidenceBytes,
	failure,
	fixture,
	parseOutcome,
	probeSandboxHost,
	program,
	readyInput,
	release,
	request,
	run,
	sandboxSkip,
	start,
	waitFor,
	workspaceDigest,
} from "./fixtures/code-mode/fixture.mjs";

// Tests that start a real sandboxed routine skip only when host prerequisites
// are unavailable outside the runtime.
const sandbox = await sandboxSkip();

test("BLX-VC-044: host sandbox probe reports skip reason when prerequisites are unavailable", () => {
	const skipped = probeSandboxHost({ PATH: "" });
	assert.equal(typeof skipped, "string");
	assert.match(skipped, /^routine sandbox unavailable on this host: /);
});

async function allowed(f, id = "allowed-sibling") {
	const out = await run(f, request(id, "ready-set", readyInput));
	assert.equal(out.status, "COMPLETE", JSON.stringify(out));
	assert.deepEqual(JSON.parse(evidence(f, out, "call", "ready-set")).ready, [
		"B",
		"C",
	]);
}

test("BLX-VC-041: known but excluded capability cannot run; allowlisted sibling can", async (t) => {
	const f = fixture(t, { allowed_capabilities: ["ready-set"] });
	const before = workspaceDigest(f);
	const denied = await run(
		f,
		request("not-allowed", "dispatch", {
			role: "implementer",
			packet: "sample",
			write_set: ["state/effects.log"],
		}),
	);
	failure(denied, "capability_denied");
	assert.equal(workspaceDigest(f), before);
	assert.ok(!existsSync(path.join(f.control, "dispatch.log")));
	await allowed(f);
});

test("BLX-VC-042: ordinary TCP connection is unavailable in the isolated network", async (t) => {
	if (sandbox) return t.skip(sandbox);
	const f = fixture(t);
	let connections = 0;
	const server = createServer((socket) => {
		connections++;
		socket.end();
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(() => new Promise((resolve) => server.close(resolve)));
	const { port } = server.address();

	// Positive oracle: the owned endpoint really is reachable outside the sandbox.
	const client = connect(port, "127.0.0.1");
	const closed = once(client, "close");
	await once(client, "connect");
	client.end();
	await closed;
	assert.equal(connections, 1);
	const before = workspaceDigest(f);
	const out = await run(
		f,
		program(
			"network",
			`
    const net = require("node:net");
    const connect = (host, port) => new Promise(resolve => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => { socket.destroy(); resolve("connected"); });
      socket.once("error", error => { socket.destroy(); resolve(error.code); });
      socket.setTimeout(1000, () => { socket.destroy(); resolve("timeout"); });
    });
    return {
      loopback: await connect("127.0.0.1", ${port}),
      documentationAddress: await connect("203.0.113.1", 80)
    };
  `,
		),
	);
	// 203.0.113.1 is a documentation-only address, not a third-party service.
	assert.equal(out.status, "COMPLETE", JSON.stringify(out));
	const result = JSON.parse(evidence(f, out, "result"));
	for (const code of [result.loopback, result.documentationAddress]) {
		assert.ok(
			[
				"ENETUNREACH",
				"EHOSTUNREACH",
				"ECONNREFUSED",
				"EACCES",
				"EPERM",
			].includes(code),
			code,
		);
	}
	assert.equal(connections, 1, "the sandbox reached the owned listener");
	assert.equal(workspaceDigest(f), before);
	await allowed(f);
});

test("BLX-VC-043: synthetic ambient variables and synthetic home file are inaccessible", async (t) => {
	if (sandbox) return t.skip(sandbox);
	const f = fixture(t);
	const marker = path.join(f.home, "owned-marker.txt");
	writeFileSync(marker, "synthetic-not-a-credential");
	const before = workspaceDigest(f);
	const out = await run(
		f,
		program(
			"ambient",
			`
    const fs = require("node:fs");
    let markerReadable;
    try { fs.readFileSync(${JSON.stringify(marker)}); markerReadable = true; }
    catch { markerReadable = false; }
    return {
      inheritedGhToken: Object.hasOwn(process.env, "GH_TOKEN"),
      inheritedAnthropicKey: Object.hasOwn(process.env, "ANTHROPIC_API_KEY"),
      inheritedHome: process.env.HOME === ${JSON.stringify(f.home)},
      markerReadable
    };
  `,
		),
		{
			extraEnv: {
				GH_TOKEN: "synthetic-gh-value",
				ANTHROPIC_API_KEY: "synthetic-api-value",
			},
		},
	);
	assert.equal(out.status, "COMPLETE", JSON.stringify(out));
	assert.deepEqual(JSON.parse(evidence(f, out, "result")), {
		inheritedGhToken: false,
		inheritedAnthropicKey: false,
		inheritedHome: false,
		markerReadable: false,
	});
	assert.equal(readFileSync(marker, "utf8"), "synthetic-not-a-credential");
	assert.equal(workspaceDigest(f), before);
	await allowed(f);
});

function sandboxScopeUnit(parentPid) {
	for (const entry of readdirSync("/proc")) {
		if (!/^\d+$/.test(entry)) continue;
		try {
			const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
			const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
			if (Number(fields[1]) !== parentPid) continue;
			const group = readFileSync(`/proc/${entry}/cgroup`, "utf8")
				.split("\n")
				.find((line) => line.startsWith("0::"))
				?.slice(3);
			const unit = group?.split("/").at(-1);
			if (group && /^run-.*\.scope$/.test(unit)) return { group, unit };
		} catch {}
	}
	return null;
}

for (const [limit, limits, code] of [
	[
		"cpu",
		{ cpu_seconds: 1, wall_ms: 20000 },
		"const start = process.cpuUsage(); let used; do { used=process.cpuUsage(start); } while (used.user + used.system < 2500000); return true;",
	],
	[
		"memory",
		{ memory_bytes: 256 * 1024 * 1024, wall_ms: 10000 },
		"const sample = Buffer.alloc(300 * 1024 * 1024, 1); return sample.length;",
	],
	[
		"wall",
		{ wall_ms: 4000 },
		"await new Promise(resolve => setTimeout(resolve, 8000)); return true;",
	],
]) {
	test(
		"BLX-VC-044: " +
			limit +
			" limit terminates finite test work without state effects",
		async (t) => {
			if (sandbox) return t.skip(sandbox);
			const f = fixture(t, { limits });
			await allowed(f);
			const before = workspaceDigest(f);
			if (limit === "memory") {
				controlMode(f, "sample", { hold: "before" });
				const active = start(
					f,
					program(
						"scope-placement",
						`await call("dispatch", ${JSON.stringify(dispatchInput("sample"))}); return true;`,
					),
				);
				try {
					await waitFor(f, "sample.ready", active);
					const scope = sandboxScopeUnit(active.child.pid);
					assert.ok(scope, "expected active systemd scope for sandbox child");
					assert.ok(
						!scope.group.includes("/app.slice/"),
						`scope must sit outside app.slice: ${scope.group}`,
					);
					assert.ok(
						scope.group.includes("/background.slice/"),
						`scope must sit under background.slice: ${scope.group}`,
					);
					const props = execFileSync(
						"systemctl",
						[
							"--user",
							"show",
							scope.unit,
							"-p",
							"Slice",
							"-p",
							"OOMPolicy",
							"--no-pager",
						],
						{ encoding: "utf8" },
					);
					assert.match(props, /^Slice=background\.slice$/m);
					assert.match(props, /^OOMPolicy=continue$/m);
				} finally {
					release(f, "sample", true);
				}
				failure(parseOutcome(await active.result), "cancelled");
				assert.equal(workspaceDigest(f), before);
			}
			const out = await run(f, program("over-" + limit, code));
			failure(out, "resource_limit");
			assert.equal(out.status, "WAITING_ON");
			assert.deepEqual(out.blockers, ["resource_limit"]);
			assert.equal(out.error.limit, limit, JSON.stringify(out));
			assert.equal(workspaceDigest(f), before);
		},
	);
}

test("BLX-VC-044: pre-ready memory limit kill reports resource_limit while setup refusal reports sandbox_unavailable", async (t) => {
	if (sandbox) return t.skip(sandbox);
	const oomFixture = fixture(t, {
		limits: { memory_bytes: 8 * 1024 * 1024, wall_ms: 10000 },
	});
	const oomBefore = workspaceDigest(oomFixture);
	const oomOut = await run(oomFixture, program("pre-ready-memory", "return true;"));
	failure(oomOut, "resource_limit");
	assert.equal(oomOut.status, "WAITING_ON");
	assert.deepEqual(oomOut.blockers, ["resource_limit"]);
	assert.equal(oomOut.error.limit, "memory", JSON.stringify(oomOut));
	assert.equal(workspaceDigest(oomFixture), oomBefore);

	const refusalFixture = fixture(t);
	const refusalBefore = workspaceDigest(refusalFixture);
	const binDir = path.join(refusalFixture.root, "bin");
	mkdirSync(binDir);
	for (const tool of ["flock", "systemd-run", "prlimit"]) {
		const found = (process.env.PATH ?? "/usr/bin:/bin")
			.split(path.delimiter)
			.map((dir) => path.join(dir, tool))
			.find((candidate) => existsSync(candidate));
		assert.ok(found, `expected ${tool} on PATH`);
		symlinkSync(found, path.join(binDir, tool));
	}
	const refused = await run(
		refusalFixture,
		program("missing-bwrap", "return true;"),
		{ extraEnv: { PATH: binDir } },
	);
	failure(refused, "sandbox_unavailable");
	assert.equal(refused.status, "WAITING_ON");
	assert.deepEqual(refused.blockers, ["sandbox_unavailable"]);
	assert.equal(workspaceDigest(refusalFixture), refusalBefore);
});

test("BLX-VC-044: child process and worker creation are denied for harmless local workloads", async (t) => {
	if (sandbox) return t.skip(sandbox);
	const f = fixture(t);
	const before = workspaceDigest(f);
	const out = await run(
		f,
		program(
			"process-scope",
			`
    let childAllowed = false;
    try {
      const child = require("node:child_process").spawnSync(process.execPath, ["--version"], { timeout: 1000 });
      childAllowed = child.status === 0;
    } catch {}
    const workerAllowed = await new Promise(resolve => {
      try {
        const worker = new (require("node:worker_threads").Worker)("0", { eval: true });
        worker.once("online", async () => { await worker.terminate(); resolve(true); });
        worker.once("error", () => resolve(false));
      } catch { resolve(false); }
    });
    return { childAllowed, workerAllowed };
  `,
		),
	);
	assert.equal(out.status, "COMPLETE", JSON.stringify(out));
	assert.deepEqual(JSON.parse(evidence(f, out, "result")), {
		childAllowed: false,
		workerAllowed: false,
	});
	assert.equal(workspaceDigest(f), before);
	await allowed(f);
});

test("BLX-VC-044: scratch capacity and open-file limits contain bounded local workloads", async (t) => {
	if (sandbox) return t.skip(sandbox);
	const f = fixture(t);
	const before = workspaceDigest(f);
	const scratchRoot = JSON.stringify(f.root);
	const scratch = await run(
		f,
		program(
			"scratch-capacity",
			`
    const fs = require("node:fs");
    const root = ${scratchRoot};
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(root + "/small-example.txt", "small");
    try { fs.writeFileSync(root + "/large-example.txt", Buffer.alloc(17 * 1024 * 1024)); }
    catch (error) { return { error: error.code }; }
    return { written: true };
  `,
		),
	);
	if (scratch.status === "COMPLETE") {
		assert.deepEqual(JSON.parse(evidence(f, scratch, "result")), {
			error: "ENOSPC",
		});
	} else {
		failure(scratch, "resource_limit");
		assert.equal(scratch.error.limit, "scratch");
	}
	const descriptors = await run(
		f,
		program(
			"file-descriptors",
			`
    const fs = require("node:fs");
    const root = ${scratchRoot};
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(root + "/open-example.txt", "small");
    const opened = [];
    let errorCode = null;
    try {
      for (let index = 0; index < 65; index++) opened.push(fs.openSync(root + "/open-example.txt", "r"));
    } catch (error) { errorCode = error.code; }
    finally { for (const fd of opened) fs.closeSync(fd); }
    return { opened: opened.length, errorCode };
  `,
		),
	);
	if (descriptors.status === "COMPLETE") {
		const result = JSON.parse(evidence(f, descriptors, "result"));
		assert.equal(result.errorCode, "EMFILE");
		assert.ok(result.opened > 0 && result.opened < 65);
	} else {
		failure(descriptors, "resource_limit");
		assert.equal(descriptors.error.limit, "file_descriptors");
	}
	assert.equal(workspaceDigest(f), before);
	await allowed(f);
});

test("BLX-VC-045: scratch write works; outside write cannot alter the owned sentinel", async (t) => {
	if (sandbox) return t.skip(sandbox);
	const f = fixture(t);
	const sentinel = path.join(f.workspace, "state", "sentinel.txt");
	writeFileSync(sentinel, "original");
	const before = workspaceDigest(f);
	const out = await run(
		f,
		program(
			"file-scope",
			`
    const fs = require("node:fs");
    const root = ${JSON.stringify(f.root)};
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(root + "/owned-example.txt", "within scratch");
    let denied;
    try { fs.writeFileSync(${JSON.stringify(sentinel)}, "outside scratch"); denied = false; }
    catch { denied = true; }
    return { scratch: fs.readFileSync(root + "/owned-example.txt", "utf8"), denied };
  `,
		),
	);
	assert.equal(out.status, "COMPLETE", JSON.stringify(out));
	assert.deepEqual(JSON.parse(evidence(f, out, "result")), {
		scratch: "within scratch",
		denied: true,
	});
	assert.equal(readFileSync(sentinel, "utf8"), "original");
	assert.equal(workspaceDigest(f), before);
	await allowed(f);
});

test("BLX-VC-108: limit measures combined output, retains bounded hashed evidence and permits below-bound output", async (t) => {
	if (sandbox) return t.skip(sandbox);
	const limit = 64 * 1024;
	const f = fixture(t, { limits: { output_bytes: limit } });
	const before = workspaceDigest(f);
	const within = await run(
		f,
		program(
			"within-output",
			`
    console.log("sample:" + "A".repeat(60 * 1024));
    return { ok: true };
  `,
		),
	);
	assert.equal(within.status, "COMPLETE", JSON.stringify(within));
	assert.ok(evidence(f, within, "diagnostic").includes("sample:"));
	assert.deepEqual(JSON.parse(evidence(f, within, "result")), { ok: true });

	// Both streams fit individually, but together exceed the limit.
	const over = await run(
		f,
		program(
			"over-output",
			`
    console.log("sample:" + "B".repeat(36 * 1024));
    console.error("sample:" + "C".repeat(36 * 1024));
    return { ok: true };
  `,
		),
	);
	failure(over, "output_limit");
	assert.ok(!JSON.stringify(over).includes("sample:"));
	const refs = over.evidence_refs.filter((ref) => ref.kind === "diagnostic");
	assert.ok(refs.length, "limit outcome retained no diagnostic evidence");
	const retained = refs.reduce(
		(total, ref) => total + evidenceBytes(f, ref).length,
		0,
	);
	assert.ok(
		retained > 0 && retained <= limit,
		"retained evidence exceeds bound",
	);
	assert.ok(
		refs.some(
			(ref) => ref.truncated === true && ref.observed_bytes > ref.bytes,
		),
	);
	for (const ref of refs) assert.equal(ref.bytes, evidenceBytes(f, ref).length);
	assert.equal(workspaceDigest(f), before);
});

test("a routine result above its byte limit stays out of the evidence store", async (t) => {
	if (sandbox) return t.skip(sandbox);
	const f = fixture(t, { limits: { output_bytes: 4096 } });
	const out = await run(
		f,
		program("text-result", 'return "sample".repeat(1000);'),
	);
	failure(out, "output_limit");
	assert.ok(!out.evidence_refs.some((ref) => ref.kind === "result"));
	await allowed(f);
});
