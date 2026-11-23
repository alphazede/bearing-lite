/**
 * Issue #271: a diagram-assisted Mermaid view must reach the DoD Manifest as a
 * diagram through a documented, deterministic, local path, while the SVG
 * sanitizer keeps its refusals.
 *
 * Documented path under test (proposed CLI):
 *   node tools/render-mermaid-view.mjs <input.mmd> <output.svg>
 * It renders with a local Mermaid CLI (`mmdc`; `BEARING_MMDC` overrides the
 * command, `BEARING_MMDC_PUPPETEER_CONFIG` is passed as `-p` when set) and
 * writes a manifest-safe SVG. No external service.
 *
 * The real-renderer cases are opt-in: set BEARING_MMDC to a local mmdc.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	renderFile,
	sanitizeSvg,
	sha256Hex,
	TEMPLATE_VERSION,
} from "../tools/render-dod-manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = path.join(ROOT, "tools/render-mermaid-view.mjs");
const FIXTURES = path.join(ROOT, "test/fixtures/mermaid");
const MBSE_SKILL = path.join(ROOT, "skills/mbse/SKILL.md");
const MMDC = process.env.BEARING_MMDC || "";
const temps = [];
after(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
	const dir = mkdtempSync(path.join(tmpdir(), "mermaid-view-"));
	temps.push(dir);
	return dir;
}

const FLOWCHART =
	'flowchart LR\n    A["Plan"] --> B{"Review?"}\n    B -->|pass| C["Land"]\n    B -->|repair| A\n';
const STATE =
	"stateDiagram-v2\n    [*] --> Draft\n    Draft --> Review\n    Review --> Approved\n    Review --> Draft : repair\n    Approved --> [*]\n";

function runHelper(args, env = {}) {
	return spawnSync(process.execPath, [HELPER, ...args], {
		encoding: "utf8",
		cwd: ROOT,
		env: { ...process.env, ...env },
		timeout: 180000,
	});
}

/** Bind an SVG file as a diagram-assisted model view and render the Manifest. */
function renderBoundSvg(dir, rel) {
	const bytes = readFileSync(path.join(dir, rel));
	const doc = {
		dod_manifest: {
			template_version: TEMPLATE_VERSION,
			title: "Mermaid view fixture",
			output_name: "fixture-dod-manifest.html",
			closeout: {
				candidate: "pending",
				changed_paths: [],
				evidence: [],
				open_gaps: [],
				owner_acceptance: "pending",
			},
			models: [
				{
					id: "MODEL-MMD-001",
					mode: "diagram-assisted",
					source: rel.replace(/\.svg$/, ".mmd"),
					revision: "fixture",
					digest: `sha256:${sha256Hex(bytes)}`,
					viewpoint: "How does the fixture flow?",
					trace: "AC-271",
					limitations: "Fixture projection",
					render_status: "READY",
					required: true,
					selected: true,
					view: { format: "svg", path: rel, alt: "Fixture diagram" },
				},
			],
		},
	};
	const input = path.join(dir, "implementation.json");
	writeFileSync(input, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
	return renderFile(input).html;
}

const BLACK = /^(#000(000)?|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))$/i;

/** Fill colours of shape elements whose class matches, from attributes or style attributes. */
function shapeFills(svg, classPattern) {
	const fills = [];
	for (const m of svg.matchAll(
		/<(rect|polygon|path|circle|ellipse)\b([^>]*)>/gi,
	)) {
		const attrs = m[2];
		const cls = /\sclass="([^"]*)"/i.exec(attrs)?.[1] || "";
		if (!classPattern.test(cls)) continue;
		const style = /\sstyle="([^"]*)"/i.exec(attrs);
		const sfill = style && /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(style[1]);
		const attr = /\sfill="([^"]*)"/i.exec(attrs);
		// A style fill wins over the attribute; a shape with neither reports "" (renders black).
		fills.push((sfill?.[1] ?? attr?.[1] ?? "").trim());
	}
	return fills;
}

describe("issue #271 documented Mermaid-to-SVG path", () => {
	it("the MBSE skill documents the Mermaid-to-SVG helper for diagram-assisted views", () => {
		const skill = readFileSync(MBSE_SKILL, "utf8");
		assert.match(skill, /<plugin root>\/tools\/render-mermaid-view\.mjs/);
	});

	it("is a packaged helper that fails closed and names mmdc when no local renderer is available", () => {
		assert.ok(existsSync(HELPER), "tools/render-mermaid-view.mjs exists");
		const dir = tempDir();
		const input = path.join(dir, "flow.mmd");
		const output = path.join(dir, "flow.svg");
		writeFileSync(input, FLOWCHART, "utf8");
		const res = runHelper([input, output], {
			BEARING_MMDC: path.join(dir, "no-such-mmdc"),
			PATH: dir,
		});
		assert.notEqual(res.status, 0, res.stdout + res.stderr);
		assert.match(res.stderr, /mmdc/);
		assert.equal(existsSync(output), false, "no partial SVG is written");
	});

	/** Run the helper twice, then prove the Manifest embeds its output unchanged with node colours. */
	function assertDocumentedPath(source, labels, env = {}) {
		const dir = tempDir();
		mkdirSync(path.join(dir, "views"));
		const mmd = path.join(dir, "views/model.mmd");
		writeFileSync(mmd, source, "utf8");
		const out = path.join(dir, "views/model.svg");
		const res = runHelper([mmd, out], env);
		assert.equal(res.status, 0, res.stdout + res.stderr);
		const first = readFileSync(out);

		// Deterministic: same input, same bytes.
		const again = path.join(dir, "views/again.svg");
		const res2 = runHelper([mmd, again], env);
		assert.equal(res2.status, 0, res2.stdout + res2.stderr);
		assert.equal(sha256Hex(readFileSync(again)), sha256Hex(first));

		const svg = first.toString("utf8");
		assert.doesNotMatch(svg, /<foreignObject|<script|javascript:/i);

		// Accepted unchanged: sanitizer and renderer take the helper output as is.
		assert.doesNotThrow(() => sanitizeSvg(svg));
		const html = renderBoundSvg(dir, "views/model.svg");
		const figure = html.split('id="view-model-mmd-001"')[1] || "";
		const graphic = figure.split("</svg>")[0];
		assert.match(graphic, /<svg /);
		for (const label of labels) assert.ok(graphic.includes(label), label);

		// No silent loss of colours: every Mermaid node shape keeps a non-black fill.
		const nodeFills = shapeFills(graphic, /label-container/);
		assert.ok(nodeFills.length > 0, "node shapes are present");
		assert.ok(
			nodeFills.every((f) => f && f.toLowerCase() !== "none" && !BLACK.test(f)),
			`node shapes lost their fill: ${JSON.stringify(nodeFills)}`,
		);
	}

	for (const [kind, source, labels] of [
		["flowchart", FLOWCHART, ["Plan", "Review?", "Land", "pass"]],
		["state diagram", STATE, ["Draft", "Review", "Approved", "repair"]],
	]) {
		it(
			`renders a Mermaid ${kind} with a real local mmdc into an SVG the Manifest embeds unchanged, with colours`,
			{
				skip: MMDC ? false : "opt-in: set BEARING_MMDC to a local mmdc",
				timeout: 240000,
			},
			() => assertDocumentedPath(source, labels),
		);
	}

	it("keeps marker references local when different flowcharts share one Manifest", {
		skip: !MMDC && "opt-in: set BEARING_MMDC to a local mmdc",
	}, () => {
		const dir = tempDir();
		const markerIds = [];
		for (const [index, lineColor] of ["#257550", "#943132"].entries()) {
			const input = path.join(dir, `flow-${index}.mmd`);
			const output = path.join(dir, `flow-${index}.svg`);
			writeFileSync(
				input,
				`---\nconfig:\n  theme: base\n  themeVariables:\n    lineColor: "${lineColor}"\n---\n${FLOWCHART}`,
			);
			const result = runHelper([input, output]);
			assert.equal(result.status, 0, result.stderr);
			const svg = readFileSync(output, "utf8");
			const marker = /marker-end="url\(#([^"]+)\)"/.exec(svg)?.[1];
			assert.ok(marker, "a directed edge has a marker");
			assert.ok(svg.includes(`<marker id="${marker}"`));
			assert.ok(svg.includes(`fill="${lineColor}"`));
			markerIds.push(marker);
		}
		assert.notEqual(...markerIds);
	});

	for (const [kind, name, labels] of [
		["flowchart", "flowchart", ["Plan", "Review?", "Land", "pass"]],
		["state diagram", "state", ["Draft", "Approved", "pass"]],
	]) {
		it(`turns pre-rendered mmdc ${kind} output into an SVG the Manifest embeds unchanged, with colours`, () => {
			const raw = path.join(FIXTURES, `${name}.mmdc.svg`);
			// The raw mmdc output is what the renderer refuses on its own.
			assert.throws(
				() => sanitizeSvg(readFileSync(raw, "utf8")),
				(err) => err.code === "UNSAFE_ASSET",
			);
			assertDocumentedPath(
				readFileSync(path.join(FIXTURES, `${name}.mmd`), "utf8"),
				labels,
				{
					BEARING_MMDC: path.join(FIXTURES, "fake-mmdc.mjs"),
					BEARING_MMDC_PUPPETEER_CONFIG: "",
					FAKE_MMDC_SVG: raw,
				},
			);
		});
	}
});

describe("issue #271 renderer reports what to fix and never drops colours silently", () => {
	// Minimal shapes of Mermaid's default (htmlLabels on) output.
	const svgWith = (inner, attrs = "") =>
		`<svg id="my-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"${attrs}>${inner}</svg>`;

	it("names foreignObject as the element to fix in a Mermaid HTML-label SVG", () => {
		assert.throws(
			() =>
				sanitizeSvg(
					svgWith(
						'<g class="label"><foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">Plan</div></foreignObject></g>',
					),
				),
			(err) => {
				assert.equal(err.code, "UNSAFE_ASSET");
				assert.match(err.message, /foreignObject/);
				assert.doesNotMatch(
					err.message,
					/script/i,
					"the report names the offending element, not a list of candidates",
				);
				return true;
			},
		);
	});

	it("names the Mermaid attributes the allowlist refuses", () => {
		for (const attr of [
			'aria-roledescription="flowchart-v2"',
			'aria-describedby="d"',
			'data-id="A"',
		]) {
			const name = attr.split("=")[0];
			assert.throws(
				() => sanitizeSvg(svgWith('<rect width="1" height="1" />', ` ${attr}`)),
				(err) => err.code === "UNSAFE_ASSET" && err.message.includes(name),
				name,
			);
		}
	});

	it("names the at-rule when a Mermaid stylesheet carries @keyframes", () => {
		assert.throws(
			() =>
				sanitizeSvg(
					svgWith(
						'<style>#my-svg .node rect{fill:#ECECFF;}@keyframes dash{to{stroke-dashoffset:0;}}</style><g class="node"><rect width="1" height="1" /></g>',
					),
				),
			(err) => {
				assert.equal(err.code, "UNSAFE_ASSET");
				assert.match(err.message, /@keyframes/);
				return true;
			},
		);
	});

	it("does not accept an SVG-root id-scoped stylesheet whose colour rules can no longer match", () => {
		// Mermaid scopes colours under the root <svg> id. Scoping such a selector as a
		// descendant of the root's own scope class turns every shape black.
		const svg = svgWith(
			'<style>#my-svg .node rect{fill:#ECECFF;stroke:#9370DB;}</style><g class="node"><rect width="4" height="4" /></g>',
		);
		let out;
		try {
			out = sanitizeSvg(svg);
		} catch (err) {
			assert.equal(err.code, "UNSAFE_ASSET");
			assert.match(
				err.message,
				/#my-svg/,
				"the report names the selector to fix",
			);
			return;
		}
		const scope = /class="(dod-svg-[0-9a-f]+)"/.exec(out)?.[1];
		assert.ok(scope, out);
		assert.doesNotMatch(
			out,
			new RegExp(`\\.${scope}\\s+#my-svg\\b`),
			`colour rule silently dead: ${out}`,
		);
		assert.ok(
			out.includes(`:where(.${scope}, .${scope} *)`),
			"the subject of a rewritten selector must stay within its SVG",
		);
	});
});

describe("issue #271 sanitizer refusals stay intact", () => {
	const refuse = (svg, label) =>
		assert.throws(
			() => sanitizeSvg(svg),
			(err) => err.code === "UNSAFE_ASSET",
			label,
		);
	const NS = 'xmlns="http://www.w3.org/2000/svg"';

	it("refuses scripts, foreignObject, event handlers, external URLs and unsafe CSS", () => {
		refuse(`<svg ${NS}><script>alert(1)</script></svg>`, "script");
		refuse(
			`<svg ${NS}><foreignObject width="1" height="1"><div>x</div></foreignObject></svg>`,
			"foreignObject",
		);
		refuse(
			`<svg ${NS}><rect onload="alert(1)" width="1" height="1" /></svg>`,
			"event handler",
		);
		refuse(
			`<svg ${NS}><use href="https://example.invalid/a.svg#x" /></svg>`,
			"external href",
		);
		refuse(
			`<svg ${NS}><image href="https://example.invalid/a.png" width="1" height="1" /></svg>`,
			"external image",
		);
		refuse(
			`<svg ${NS}><rect fill="url(https://example.invalid/p)" width="1" height="1" /></svg>`,
			"external url() attribute",
		);
		refuse(
			`<svg ${NS}><style>@import "https://example.invalid/x.css";</style></svg>`,
			"@import",
		);
		refuse(
			`<svg ${NS}><style>rect{fill:url(https://example.invalid/p)}</style><rect width="1" height="1" /></svg>`,
			"external url() in stylesheet",
		);
		refuse(
			`<svg ${NS}><style>@font-face{font-family:x;src:url(https://example.invalid/f.woff)}</style></svg>`,
			"@font-face",
		);
	});
});
