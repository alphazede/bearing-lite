"use strict";

// The test embeds a scenario in a fresh executable; this process never contacts a remote service.
const scenario = {};
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

function insideScratch(file) {
	const base = fs.realpathSync(scenario.scratchRoot);
	const relative = path.relative(base, fs.realpathSync(file));
	assert.ok(
		relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative),
		"Fixture may access only its scratch files",
	);
}

function invocation() {
	const [command, ...args] = process.argv.slice(2);
	assert.equal(command, "annotate");
	for (const flag of [
		"--gate",
		"--json",
		"--require-approval",
		"--render-html",
	])
		assert.ok(args.includes(flag), flag);
	assert.ok(!args.includes("--hook"));
	assert.ok(!args.includes("--tailscale"));
	const resultIndex = args.indexOf("--result-file");
	assert.ok(resultIndex >= 0);
	const resultFile = path.resolve(args[resultIndex + 1]);
	insideScratch(path.dirname(resultFile));
	assert.ok(!fs.existsSync(resultFile), "Fresh result file required");
	const files = args
		.filter((arg, index) => !arg.startsWith("--") && index !== resultIndex + 1)
		.map((file) => path.resolve(file));
	for (const file of files) insideScratch(file);
	return { files, resultFile };
}

function checkBundle(files) {
	for (const name of scenario.bundle ?? []) {
		const target = files.find((file) => path.basename(file) === name);
		assert.ok(
			target && fs.statSync(target).isFile(),
			`Missing displayed file: ${name}`,
		);
		if (scenario.displayDigests)
			assert.equal(
				createHash("sha256").update(fs.readFileSync(target)).digest("hex"),
				scenario.displayDigests[name],
				`Displayed bytes: ${name}`,
			);
		if (scenario.sourceDir)
			assert.notEqual(
				path.dirname(target),
				scenario.sourceDir,
				"Display snapshot, not source",
			);
		if (scenario.parentNetworkNamespace)
			assert.throws(
				() => fs.accessSync(target, fs.constants.W_OK),
				"Displayed snapshot must be read-only",
			);
	}
	if (scenario.diff) {
		const diff = files.find(
			(file) => path.basename(file) === "revision-diff.md",
		);
		assert.ok(diff, "Revision comparison must be displayed");
		const bytes = fs.readFileSync(diff, "utf8");
		for (const text of scenario.diff.include)
			assert.ok(bytes.includes(text), text);
		for (const text of scenario.diff.exclude)
			assert.ok(!bytes.includes(text), text);
	}
}

function checkEnvironment() {
	for (const [key, value] of Object.entries(scenario.environment ?? {}))
		assert.equal(process.env[key], value, key);
	if (scenario.parentNetworkNamespace) {
		assert.notEqual(
			fs.readlinkSync("/proc/self/ns/net"),
			scenario.parentNetworkNamespace,
			"Process is not isolated",
		);
		assert.ok(
			Object.values(os.networkInterfaces())
				.flat()
				.every(({ internal }) => internal),
			"Only loopback interfaces are available",
		);
	}
}

function waitForRelease(resultFile) {
	const marker = `${resultFile}.fixture-release`;
	return new Promise((resolve, reject) => {
		const watcher = fs.watch(path.dirname(marker), () => {
			if (!fs.existsSync(marker)) return;
			watcher.close();
			clearTimeout(deadline);
			fs.unlinkSync(marker);
			resolve();
		});
		const deadline = setTimeout(() => {
			watcher.close();
			reject(new Error("Fixture decision was not released"));
		}, 15_000);
		// The marker is only a test handshake in the disposable result directory.
		console.error(`Fixture release file ${JSON.stringify(marker)}`);
	});
}

async function serve(resultFile) {
	const server = http.createServer((req, res) => {
		// Local simulations only: never implement a share or upload operation.
		if (req.url === "/share")
			return res
				.writeHead(process.env.PLANNOTATOR_SHARE === "disabled" ? 403 : 200)
				.end();
		if (req.url === "/inbox/upload")
			return res
				.writeHead(process.env.PLANNOTATOR_INBOX_CONNECT === "0" ? 403 : 200)
				.end();
		if (req.url !== "/") return res.writeHead(404).end();
		res.end("Sample review");
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	try {
		const { address, port } = server.address();
		assert.equal(address, "127.0.0.1");
		const url = `http://${address}:${port}/`;
		if (scenario.parentNetworkNamespace) {
			for (const endpoint of ["share", "inbox/upload"]) {
				const response = await fetch(new URL(endpoint, url), {
					method: "POST",
				});
				assert.equal(response.status, 403, endpoint);
			}
		}
		console.error(`Review ready at ${url}`);
		if (scenario.linkedEvidence) {
			const bytes = await new Promise((resolve, reject) => {
				http
					.get(
						{
							socketPath: path.join(process.env.TMPDIR, "s"),
							path: "/api/html-assets/0000000000000000/design.md",
						},
						(res) => {
							let body = "";
							res.setEncoding("utf8");
							res.on("data", (part) => {
								body += part;
							});
							res.on("end", () => resolve(body));
						},
					)
					.on("error", reject);
			});
			assert.equal(
				bytes,
				scenario.linkedEvidence,
				"The local projection reaches its cited evidence",
			);
		}
		if (scenario.hold) await waitForRelease(resultFile);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

function formatFeedback(files) {
	const groups = new Map();
	for (const { file, line, selection, body } of scenario.annotations ?? []) {
		const target =
			files.find((candidate) => path.basename(candidate) === file) ?? file;
		const entries = groups.get(target) ?? [];
		entries.push(
			`### ${entries.length + 1}. (line ${line}) Feedback on: "${selection}"\n> ${body}\n\n`,
		);
		groups.set(target, entries);
	}
	// Mirror the pinned bundle's numbered headings and quoted comment bodies.
	return groups.size
		? `# File Feedback\n\n${[...groups].map(([target, entries]) => `## ${target}\n\n${entries.join("")}`).join("")}---\n`
		: "";
}

async function main() {
	const { files, resultFile } = invocation();
	checkBundle(files);
	checkEnvironment();
	await serve(resultFile);
	if (scenario.disconnect) {
		process.kill(process.pid, "SIGTERM");
		return;
	}
	const feedback = formatFeedback(files);
	const decision = scenario.decision ?? "approved";
	const result = { decision, ...(feedback ? { feedback } : {}) };
	const partial = `${resultFile}.tmp`;
	fs.writeFileSync(partial, JSON.stringify(result), { flag: "wx" });
	fs.renameSync(partial, resultFile);
	console.log(
		JSON.stringify({
			...result,
			...(feedback ? { annotationCount: scenario.annotations.length } : {}),
			target: files,
		}),
	);
	process.exitCode = decision === "approved" ? 0 : 1;
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 2;
});
