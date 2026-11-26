import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { unreviewedPlanningWave } from "./planning-contract-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixtures = path.join(root, "test/fixtures");
const visualFixtures = path.join(fixtures, "visual-manifest");
const oracle = JSON.parse(
	readFileSync(path.join(visualFixtures, "trace.json")),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const output = "visual.html";

function command(executable, args, options = {}) {
	const result = spawnSync(executable, args, {
		encoding: "utf8",
		timeout: 10_000,
		maxBuffer: 4 * 1024 * 1024,
		...options,
	});
	assert.ifError(result.error);
	return result;
}

function node(script, args, dir) {
	return command(process.execPath, [path.join(root, script), ...args], {
		cwd: dir,
	});
}

function parse(html) {
	const result = command(
		"python3",
		[path.join(visualFixtures, "inspect_html.py")],
		{ input: html },
	);
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}

function draft(dir, expected = "PASS") {
	const result = node("hooks/plan-package.cjs", ["draft", dir], dir);
	assert.equal(
		result.status,
		expected === "PASS" ? 0 : 1,
		result.stdout + result.stderr,
	);
	const receipt = JSON.parse(result.stdout);
	assert.equal(receipt.outcome, expected, result.stdout);
	return receipt;
}

function render(dir, { visual = true, check = false, name = output } = {}) {
	const args = ["implementation.json", "--out", name];
	if (visual) args.push("--visual");
	if (check) args.push("--check");
	return node("tools/render-dod-manifest.mjs", args, dir);
}

function rendered(dir, options) {
	const result = render(dir, options);
	assert.equal(
		result.status,
		0,
		`Renderer did not produce requested view: ${result.stderr}`,
	);
	const bytes = readFileSync(path.join(dir, options?.name ?? output));
	assert.ok(
		result.stdout.includes(`digest=sha256:${hash(bytes)}`),
		"Reported digest binds HTML bytes",
	);
	return bytes;
}

function snapshot(dir) {
	return Object.fromEntries(
		readdirSync(dir, { recursive: true, withFileTypes: true })
			.map((entry) => {
				const full = path.join(entry.parentPath, entry.name);
				return [
					path.relative(dir, full),
					entry.isDirectory() ? "directory" : hash(readFileSync(full)),
				];
			})
			.sort(([a], [b]) => a.localeCompare(b)),
	);
}

function savePlan(dir, plan, doc, seit) {
	const bytes = JSON.stringify(seit);
	const digest = hash(`${hash(plan)}\n${hash(bytes)}`);
	doc.journey_settings.planning_review = { candidate_digest: digest };
	doc.journey_settings.planning_wave = unreviewedPlanningWave(digest, []);
	doc.traceability.seit_proof_rows = seit.proof_cases.map(({ id }) => ({ id }));
	for (const slice of doc.slices) {
		slice.seit_proof_rows = seit.proof_cases
			.filter(({ requirement_id }) =>
				slice.requirement_ids.includes(requirement_id),
			)
			.map(({ id }) => id);
	}
	writeFileSync(path.join(dir, "seit.json"), bytes);
	writeFileSync(path.join(dir, "implementation.json"), JSON.stringify(doc));
}

function manifest(doc, seit, model) {
	return {
		...structuredClone(oracle.manifest),
		requirements: structuredClone(oracle.requirements),
		models: [
			{
				id: "MODEL-VIS",
				mode: "diagram-assisted",
				selected: true,
				required: true,
				render_status: "READY",
				digest: `sha256:${hash(model)}`,
				view: { format: "mermaid", path: "model.mmd" },
			},
		],
		tasks: doc.slices.map(({ id, role, write_set, depends_on }) => ({
			id,
			role,
			write_set,
			depends_on: depends_on ?? [],
			route: "implementation",
			status: "PLANNED",
		})),
		vv: seit.proof_cases.map(({ id, method, observable_evidence }) => ({
			id,
			method,
			evidence: observable_evidence,
			status: "PLANNED",
		})),
	};
}

function fixtureAccepted(t, dir, doc) {
	// Establish validity using the existing public entry points and parser.
	const freeze = draft(dir);
	const legacy = rendered(dir, { visual: false, name: "legacy.html" });
	const legacyPage = parse(legacy);
	assert.ok(
		legacyPage.text.includes(doc.dod_manifest.title),
		"Legacy render and parser read the fixture",
	);
	assert.ok(
		row(legacyPage, "AC-VIS-02").cells.includes(
			oracle.requirements[1].statement,
		),
	);
	checkCsp(legacyPage);
	rmSync(path.join(dir, "legacy.html"));
	t.diagnostic(
		`Fixture accepted: draft=${freeze.outcome}, legacy digest=${hash(legacy)}, inputs=${Object.keys(snapshot(dir)).join(", ")}`,
	);
	return freeze;
}

function fixture(t, customize = () => {}) {
	const dir = mkdtempSync(path.join(tmpdir(), "visual-manifest-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const { implementation: doc, seit } = JSON.parse(
		readFileSync(path.join(fixtures, "planning-repair-package.json")),
	);
	const plan = "# Sample planning record\n\nPreserve and report a sample.\n";
	const model = "flowchart LR\n  Record --> Result\n";
	writeFileSync(path.join(dir, ".git"), "fixture worktree marker\n");
	writeFileSync(path.join(dir, "plan.md"), plan);
	writeFileSync(path.join(dir, "model.mmd"), model);
	mkdirSync(path.join(dir, "evidence"));
	for (const row of oracle.cases)
		writeFileSync(
			path.join(dir, row.observable_evidence),
			`Sample evidence for ${row.id}\n`,
		);
	seit.source_baseline.planning_inputs = [
		{ path: "plan.md", sha256: hash(plan) },
	];
	const caseTemplate = seit.proof_cases[0];
	seit.proof_cases = oracle.cases.map((row) => ({
		...caseTemplate,
		...row,
		design_id: "DES-VIS",
	}));
	doc.source_baseline.revision = doc.source_baseline.candidate_revision;
	const first = doc.slices[0];
	first.requirement_ids = [oracle.requirements[0].id];
	first.design_ids = ["DES-VIS"];
	const second = {
		...first,
		id: "SYN-S2",
		requirement_ids: [oracle.requirements[1].id],
		inputs: [first.id],
		write_set: ["result.txt"],
		depends_on: [first.id],
	};
	doc.slices.push(second);
	doc.waves[0].slice_ids.push(second.id);
	doc.dependencies = [{ from: first.id, to: second.id }];
	doc.traceability.requirements = oracle.requirements.map(({ id }) => ({ id }));
	doc.traceability.contracts = [{ id: "DES-VIS" }];
	doc.dod_manifest = manifest(doc, seit, model);
	customize(doc, seit);
	const save = () => savePlan(dir, plan, doc, seit);
	save();
	return { dir, doc, seit, save, freeze: fixtureAccepted(t, dir, doc) };
}

function row(page, id) {
	const found = page.rows.filter(({ cells }) => cells[0] === id);
	assert.equal(found.length, 1, `Expected exactly one visible row for ${id}`);
	return found[0];
}

function assertTrace(page, dir, cases) {
	for (const requirement of oracle.requirements) {
		const req = row(page, requirement.id);
		const related = cases.filter(
			(item) => item.requirement_id === requirement.id,
		);
		assert.ok(
			req.cells.includes(requirement.statement),
			`Readable statement for ${requirement.id}`,
		);
		if (!related.length) assert.match(req.cells.join(" "), /untraced/i);
		for (const item of related) {
			const verification = row(page, item.id);
			assert.ok(
				req.links.some(
					(href) =>
						href.startsWith("#") &&
						verification.ids.includes(decodeURIComponent(href.slice(1))),
				),
				`${requirement.id} links to ${item.id}`,
			);
			assert.ok(
				[...req.links, ...verification.links].some((href) => {
					const link = new URL(href, pathToFileURL(path.join(dir, output)));
					return (
						link.protocol === "file:" &&
						fileURLToPath(link) === path.join(dir, item.observable_evidence)
					);
				}),
				`${item.id} links to its evidence file`,
			);
		}
		for (const unrelated of cases.filter(
			(item) => item.requirement_id !== requirement.id,
		)) {
			assert.ok(
				!req.links.some(
					(href) =>
						href.startsWith("#") &&
						row(page, unrelated.id).ids.includes(
							decodeURIComponent(href.slice(1)),
						),
				),
				`${requirement.id} must not link to ${unrelated.id}`,
			);
		}
	}
}

function assertVisibleState(page, dir, doc, freeze) {
	assert.ok(row(page, "DES-VIS").cells.includes("Record then report."));
	assert.ok(
		row(page, "ACCEPT-VIS").cells.includes("Sample is preserved and reported."),
	);
	assert.ok(row(page, "SYN-S1").cells.includes("PASS"));
	assert.ok(row(page, "SYN-S2").cells.includes("HOLD"));
	assert.ok(row(page, "SYN-S2").cells.includes("SYN-S1"));
	assert.ok(
		page.text.includes(doc.source_baseline.candidate_revision),
		"Candidate revision visible",
	);
	assert.ok(
		page.text.includes(freeze.manifest_digest),
		"Bound candidate digest visible",
	);
	assert.ok(
		page.text.includes(hash(readFileSync(path.join(dir, "model.mmd")))),
		"Bound model digest visible",
	);
}

function assertStaleModelRefusal(dir) {
	rmSync(path.join(dir, output));
	appendFileSync(path.join(dir, "model.mmd"), "\n  Result --> Archive\n");
	const rejected = render(dir);
	assert.notEqual(rejected.status, 0, "A stale model binding must not render");
	assert.match(rejected.stderr, /STALE_VIEW/);
	assert.equal(
		existsSync(path.join(dir, output)),
		false,
		"No partial HTML on render failure",
	);
}

test("BLX-VC-072 visual projection is deterministic, traced, bound, and read-only", (t) => {
	const { dir, doc, seit, save, freeze } = fixture(t);
	const before = snapshot(dir);
	const first = rendered(dir);
	assert.deepEqual(
		rendered(dir),
		first,
		"Identical source produces identical HTML bytes",
	);
	assert.deepEqual(
		rendered(dir, { check: true }),
		first,
		"Existing view check verifies visual bytes",
	);
	assert.deepEqual(
		snapshot(dir),
		{ ...before, [output]: hash(first) },
		"Only requested HTML may be written",
	);
	const page = parse(first);
	assertTrace(page, dir, oracle.cases);
	assertVisibleState(page, dir, doc, freeze);

	seit.proof_cases = seit.proof_cases.filter(({ id }) => id !== "SEIT-VIS-03");
	save(); // Deliberately leave the old DoD V&V rows in place; the SEIT is authoritative.
	const updatedInputs = snapshot(dir);
	const stale = render(dir, { check: true });
	assert.notEqual(
		stale.status,
		0,
		"A previously rendered view cannot verify changed SEIT state",
	);
	const updated = rendered(dir);
	assert.deepEqual(snapshot(dir), {
		...updatedInputs,
		[output]: hash(updated),
	});
	const changed = parse(updated);
	assertTrace(changed, dir, oracle.cases.slice(0, 2));
	assert.ok(
		!changed.rows.some(({ cells }) => cells[0] === "SEIT-VIS-03"),
		"Removed case must not survive as current verification",
	);
	assert.ok(!row(changed, "AC-VIS-02").cells.join(" ").includes("SEIT-VIS-03"));
	t.diagnostic(
		`Rendered bytes=${hash(first)}; source files=${Object.keys(before).join(", ")}`,
	);

	assertStaleModelRefusal(dir);
});

test("BLX-VC-073 visual output does not influence draft freeze", (t) => {
	const { dir, freeze } = fixture(t);
	assert.equal(existsSync(path.join(dir, output)), false);
	rendered(dir);
	assert.deepEqual(
		draft(dir),
		freeze,
		"Same accepted draft with and without HTML",
	);
	appendFileSync(path.join(dir, "plan.md"), "\nChanged after binding.\n");
	const refused = draft(dir, "FAIL");
	assert.ok(refused.findings.some(({ code }) => code === "digest_mismatch"));
	rmSync(path.join(dir, output));
	assert.deepEqual(
		draft(dir, "FAIL"),
		refused,
		"Visual manifest cannot make an invalid draft pass",
	);
	t.diagnostic(
		`Freeze digest=${freeze.manifest_digest}; valid and invalid receipts unchanged`,
	);
});

function cspDirectives(page) {
	const meta = page.elements.filter(
		({ tag, attrs }) =>
			tag === "meta" &&
			attrs["http-equiv"]?.toLowerCase() === "content-security-policy",
	);
	assert.equal(meta.length, 1, "One CSP meta element");
	const firstResource = page.elements.findIndex(({ tag }) =>
		["script", "style", "img", "link"].includes(tag),
	);
	assert.ok(
		firstResource < 0 || page.elements.indexOf(meta[0]) < firstResource,
		"CSP precedes content that loads resources",
	);
	const entries = meta[0].attrs.content
		.split(";")
		.map((part) => part.trim().split(/\s+/))
		.filter(([name]) => name)
		.map(([name, ...sources]) => [name.toLowerCase(), sources]);
	const directives = Object.fromEntries(entries);
	assert.equal(
		Object.keys(directives).length,
		entries.length,
		"No duplicate CSP directives",
	);
	assert.deepEqual(directives["default-src"], ["'none'"]);
	return directives;
}

function checkCsp(page) {
	const directives = cspDirectives(page);
	for (const [name, sources] of Object.entries(directives)) {
		if (
			!name.endsWith("-src") &&
			!name.startsWith("script-src-") &&
			!name.startsWith("style-src-")
		)
			continue;
		for (const source of sources) {
			const allowed =
				source === "'none'" ||
				(name.startsWith("script-src") &&
					/^'nonce-[A-Za-z0-9+/_=-]+'$/.test(source)) ||
				(name.startsWith("style-src") && source === "'unsafe-inline'") ||
				(["img-src", "font-src", "media-src"].includes(name) &&
					source === "data:");
			assert.ok(
				allowed,
				`CSP ${name} must not allow remote or non-nonce script sources: ${source}`,
			);
		}
	}
	const effectiveScriptPolicy =
		directives["script-src-elem"] ??
		directives["script-src"] ??
		directives["default-src"];
	for (const script of page.scripts) {
		assert.ok(
			!Object.hasOwn(script.attrs, "src"),
			"Only inline scripts or data blocks are allowed",
		);
		if (script.attrs.type === "application/json") {
			JSON.parse(script.text); // Data remains a complete JSON value in the HTML context.
		} else {
			assert.ok(
				script.attrs.nonce &&
					effectiveScriptPolicy.includes(`'nonce-${script.attrs.nonce}'`),
				"Executable inline script must match the CSP nonce",
			);
		}
	}
}

test("BLX-VC-074 visual output treats sample markup as data and allows no remote resources", (t) => {
	const ordinary = `Ordinary text & "quoted" 'words' <sample>`;
	const { dir } = fixture(t, (doc, seit) => {
		// Empty/inert markup examples are specimen text, never executed by this test.
		doc.dod_manifest.title = ordinary;
		doc.dod_manifest.bluf = "HTML reference: <script></script> and </script>";
		doc.dod_manifest.requirements[0].statement = `${ordinary}; <img src="https://assets.invalid/example.png" onerror="">`;
		seit.proof_cases[0].observable_evidence = "javascript:";
		seit.proof_cases[1].observable_evidence =
			"https://assets.invalid/example.png";
		seit.proof_cases[2].expected_result = "Closing tag reference: </script>";
	});
	const page = parse(rendered(dir));
	assert.ok(page.text.includes(ordinary), "Ordinary text remains readable");
	checkCsp(page);
	for (const { tag, attrs } of page.elements) {
		assert.ok(
			!["base", "iframe", "object", "embed"].includes(tag),
			`Unexpected resource-loading element: ${tag}`,
		);
		assert.ok(
			!(tag === "meta" && attrs["http-equiv"]?.toLowerCase() === "refresh"),
			"No automatic navigation",
		);
		for (const [name, value] of Object.entries(attrs)) {
			assert.ok(
				!name.startsWith("on") && name !== "srcdoc",
				`No active content attribute: ${name}`,
			);
			if (
				["src", "srcset", "poster", "background", "xlink:href"].includes(
					name,
				) ||
				(name === "href" && tag !== "a")
			) {
				assert.ok(
					value?.startsWith("data:") || value?.startsWith("#"),
					`Resource ${tag}.${name} is embedded, not fetched`,
				);
			}
			if (name === "href" && tag === "a") {
				assert.equal(
					new URL(value, pathToFileURL(path.join(dir, output))).protocol,
					"file:",
					"Only local evidence or fragment links",
				);
			}
		}
	}
});

test("visual evidence descriptions remain text and empty verification is explicit", (t) => {
	const { dir, seit, save } = fixture(t);
	const description = "Compare retained evidence with the expected value.";
	seit.proof_cases[0].observable_evidence = description;
	save();
	const page = parse(rendered(dir));
	assert.ok(page.text.includes(description));
	assert.ok(
		!page.elements.some(
			(e) =>
				e.tag === "a" &&
				decodeURIComponent(e.attrs.href || "").includes(description),
		),
	);
	seit.proof_cases = [];
	save();
	assert.ok(parse(rendered(dir)).text.includes("No verification cases"));
});

test("the optional visual renders dollar signs literally and preserves the default output", (t) => {
	const { dir, doc, save } = fixture(t);
	doc.dod_manifest.title = "Budget $$5";
	save();
	assert.ok(parse(rendered(dir)).text.includes("Budget $$5"));
	assert.ok(parse(rendered(dir, { visual: false })).text.includes("Budget $5"));
});

test("visual output preserves the canonical manifest when the destinations coincide", (t) => {
	const { dir, doc } = fixture(t);
	const original = rendered(dir, {
		visual: false,
		name: doc.dod_manifest.output_name,
	});
	const refused = render(dir, { name: doc.dod_manifest.output_name });
	assert.notEqual(refused.status, 0);
	assert.match(refused.stderr, /READ_ONLY/);
	assert.deepEqual(
		readFileSync(path.join(dir, doc.dod_manifest.output_name)),
		original,
	);
});
