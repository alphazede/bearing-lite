#!/usr/bin/env node
/**
 * Render a Mermaid view into a manifest-safe SVG (issue #271).
 *
 *   node tools/render-mermaid-view.mjs <input.mmd> <output.svg>
 *
 * Uses a local Mermaid CLI (`mmdc`; `BEARING_MMDC` overrides the command and
 * `BEARING_MMDC_PUPPETEER_CONFIG` is passed as `-p` when set). No external
 * service and no new dependency: `mmdc` is an operator-installed tool.
 * Renders with `htmlLabels: false`, inlines the stylesheet's computed
 * presentation attributes onto each element, drops everything the DoD
 * Manifest SVG allowlist refuses, and validates the result with the
 * Manifest's own `sanitizeSvg` before writing. Writes nothing on failure.
 */
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
import { fileURLToPath } from "node:url";
import { sanitizeSvg, sha256Hex } from "./render-dod-manifest.mjs";

const ALLOWED_TAGS = new Set([
	"svg",
	"g",
	"path",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polyline",
	"polygon",
	"text",
	"tspan",
	"defs",
	"marker",
	"title",
	"desc",
	"use",
	"symbol",
	"clippath",
	"lineargradient",
	"radialgradient",
	"stop",
	"image",
	"mask",
	"pattern",
]);
const ALLOWED_ATTRS = new Set([
	"id",
	"class",
	"viewbox",
	"width",
	"height",
	"x",
	"y",
	"dx",
	"dy",
	"x1",
	"y1",
	"x2",
	"y2",
	"cx",
	"cy",
	"r",
	"rx",
	"ry",
	"d",
	"points",
	"fill",
	"stroke",
	"stroke-width",
	"stroke-linejoin",
	"stroke-linecap",
	"stroke-dasharray",
	"fill-opacity",
	"stroke-opacity",
	"opacity",
	"transform",
	"text-anchor",
	"font-family",
	"font-size",
	"font-weight",
	"xml:space",
	"xmlns",
	"role",
	"aria-labelledby",
	"aria-label",
	"aria-hidden",
	"preserveaspectratio",
	"markerwidth",
	"markerheight",
	"markerunits",
	"orient",
	"refx",
	"refy",
	"gradientunits",
	"offset",
	"stop-color",
	"stop-opacity",
	"clip-path",
	"mask",
	"display",
	"overflow",
	"vector-effect",
	"fill-rule",
	"clip-rule",
	"marker-end",
	"marker-start",
	"marker-mid",
	"dominant-baseline",
	"href",
	"xlink:href",
	"xmlns:xlink",
	"style",
]);
// CSS properties inlined as presentation attributes; a small rest go to the
// style attribute. Everything else (filter, animation, layout) is dropped:
// a dropped filter reference would hide its element, so it never survives.
const INLINE_ATTRS = new Set([
	"fill",
	"stroke",
	"stroke-width",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-dasharray",
	"fill-opacity",
	"stroke-opacity",
	"opacity",
	"font-family",
	"font-size",
	"font-weight",
	"text-anchor",
	"dominant-baseline",
	"rx",
	"ry",
	"stop-color",
	"stop-opacity",
	"fill-rule",
	"clip-rule",
	"display",
]);
const STYLE_PROPS = new Set([
	"font-style",
	"color",
	"letter-spacing",
	"stroke-dashoffset",
	"visibility",
]);

function escAttr(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXmlText(value) {
	return value.replace(/&([^&;]+);|&/g, (_reference, entity) => {
		if (Object.hasOwn(XML_ENTITIES, entity)) return XML_ENTITIES[entity];
		const number = /^#(?:(\d+)|[xX]([0-9a-fA-F]+))$/.exec(entity ?? "");
		if (number) {
			const code = number[1]
				? Number.parseInt(number[1], 10)
				: Number.parseInt(number[2], 16);
			if (
				code === 9 ||
				code === 10 ||
				code === 13 ||
				(code >= 0x20 && code <= 0xd7ff) ||
				(code >= 0xe000 && code <= 0xfffd) ||
				(code >= 0x10000 && code <= 0x10ffff)
			) {
				return String.fromCodePoint(code);
			}
		}
		throw new Error("Malformed or unsupported XML reference in mmdc output.");
	});
}

function safeCssValue(value) {
	const v = String(value);
	if (/javascript:|expression\s*\(|[<]/i.test(v)) return false;
	for (const m of v.matchAll(/url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) {
		if (!m[2].trim().startsWith("#")) return false;
	}
	return true;
}

function parseDecls(body) {
	const decls = [];
	for (const part of String(body).split(";")) {
		const idx = part.indexOf(":");
		if (idx < 1) continue;
		const prop = part.slice(0, idx).trim().toLowerCase();
		let value = part.slice(idx + 1).trim();
		if (!/^[a-z-]+$/.test(prop) || !value) continue;
		const important = /!important\s*$/i.test(value);
		value = value.replace(/!important\s*$/i, "").trim();
		decls.push({ prop, value, important });
	}
	return decls;
}

function splitTopLevel(text, sep) {
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (ch === "[" || ch === "(") depth += 1;
		else if (ch === "]" || ch === ")") depth -= 1;
		else if (ch === sep && depth === 0) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(text.slice(start));
	return parts;
}

function parseCompound(text) {
	const comp = { tag: null, id: null, classes: [], attrs: [], nots: [] };
	let rest = text.trim();
	const tagM = /^(\*|[A-Za-z][\w-]*)/.exec(rest);
	if (tagM) {
		comp.tag = tagM[1] === "*" ? null : tagM[1].toLowerCase();
		rest = rest.slice(tagM[0].length);
	}
	while (rest) {
		let m = /^\.([\w-]+)/.exec(rest);
		if (m) comp.classes.push(m[1]);
		if (!m) {
			m = /^#([\w-]+)/.exec(rest);
			if (m) comp.id = m[1];
		}
		if (!m) {
			m =
				/^\[\s*([\w:.-]+)\s*(?:(~=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/.exec(
					rest,
				);
			if (m) {
				comp.attrs.push({
					name: m[1].toLowerCase(),
					op: m[2] || null,
					value: (m[3] ?? m[4] ?? m[5] ?? "").trim(),
				});
			}
		}
		if (!m) {
			m = /^:not\(([^()]*)\)/.exec(rest);
			if (m) {
				const inner = parseCompound(m[1]);
				if (!inner) return null;
				comp.nots.push(inner);
			}
		}
		if (!m) return null;
		rest = rest.slice(m[0].length);
	}
	return comp;
}

function parseSelector(text) {
	const parts = [];
	let depth = 0;
	let current = "";
	let combinator = null;
	const flush = () => {
		const t = current.trim();
		current = "";
		if (!t) return true;
		const comp = parseCompound(t);
		if (!comp) return false;
		parts.push({ comp, combinator: parts.length ? combinator || " " : null });
		combinator = null;
		return true;
	};
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (ch === "[" || ch === "(") depth += 1;
		else if (ch === "]" || ch === ")") depth -= 1;
		if (depth === 0 && (ch === ">" || ch === "+" || ch === "~")) {
			if (!flush()) return null;
			if (ch !== ">") return null;
			combinator = ">";
			continue;
		}
		if (depth === 0 && /\s/.test(ch)) {
			if (current.trim() && !flush()) return null;
			continue;
		}
		current += ch;
	}
	if (!flush() || parts.length === 0) return null;
	return parts;
}

function specificity(parts) {
	let ids = 0;
	let classes = 0;
	let tags = 0;
	for (const { comp } of parts) {
		if (comp.id) ids += 1;
		classes += comp.classes.length + comp.attrs.length + comp.nots.length;
		if (comp.tag) tags += 1;
	}
	return [ids, classes, tags];
}

function parseCssRules(css, rules) {
	const s = String(css).replace(/\/\*[\s\S]*?\*\//g, "");
	let i = 0;
	const skipBlock = (open) => {
		let depth = 0;
		for (let j = open; j < s.length; j += 1) {
			if (s[j] === "{") depth += 1;
			else if (s[j] === "}") {
				depth -= 1;
				if (depth === 0) return j + 1;
			}
		}
		return s.length;
	};
	while (i < s.length) {
		while (i < s.length && /\s/.test(s[i])) i += 1;
		if (i >= s.length) break;
		if (s[i] === "@") {
			const brace = s.indexOf("{", i);
			const semi = s.indexOf(";", i);
			if (semi >= 0 && (brace < 0 || semi < brace)) i = semi + 1;
			else if (brace >= 0) i = skipBlock(brace);
			else break;
			continue;
		}
		const brace = s.indexOf("{", i);
		if (brace < 0) break;
		const end = skipBlock(brace);
		const decls = parseDecls(s.slice(brace + 1, end - 1));
		if (decls.length) {
			for (const sel of splitTopLevel(s.slice(i, brace), ",")) {
				const parts = parseSelector(sel);
				if (parts)
					rules.push({
						parts,
						spec: specificity(parts),
						decls,
						order: rules.length,
					});
			}
		}
		i = end;
	}
}

function matchesCompound(comp, el) {
	if (comp.tag && comp.tag !== el.tag) return false;
	if (comp.id && comp.id !== el.id) return false;
	for (const c of comp.classes) if (!el.classes.has(c)) return false;
	for (const a of comp.attrs) {
		const v = el.attrs.get(a.name);
		if (v === undefined) return false;
		if (a.op === "=" && v !== a.value) return false;
		if (a.op === "~=" && !v.split(/\s+/).includes(a.value)) return false;
	}
	for (const n of comp.nots) if (matchesCompound(n, el)) return false;
	return true;
}

function matchesSelector(parts, el, ancestors) {
	if (!matchesCompound(parts.at(-1).comp, el)) return false;
	let ai = ancestors.length - 1;
	for (let k = parts.length - 2; k >= 0; k -= 1) {
		if (parts[k + 1].combinator === ">") {
			if (ai < 0 || !matchesCompound(parts[k].comp, ancestors[ai]))
				return false;
			ai -= 1;
		} else {
			let found = false;
			while (ai >= 0) {
				if (matchesCompound(parts[k].comp, ancestors[ai])) {
					found = true;
					ai -= 1;
					break;
				}
				ai -= 1;
			}
			if (!found) return false;
		}
	}
	return true;
}

function computedDecls(rules, el, ancestors) {
	const matched = [];
	for (const rule of rules) {
		if (matchesSelector(rule.parts, el, ancestors)) {
			for (const d of rule.decls)
				matched.push({ ...d, spec: rule.spec, order: rule.order });
		}
	}
	matched.sort(
		(a, b) =>
			Number(a.important) - Number(b.important) ||
			a.spec[0] - b.spec[0] ||
			a.spec[1] - b.spec[1] ||
			a.spec[2] - b.spec[2] ||
			a.order - b.order,
	);
	const out = new Map();
	for (const d of matched) out.set(d.prop, d);
	return out;
}

function parseAttrList(raw) {
	const attrs = [];
	const input = raw.trim();
	const attribute =
		/\s*([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')(?=\s|$)/gy;
	let i = 0;
	while (i < input.length) {
		const match = attribute.exec(input);
		if (!match) throw new Error("Malformed SVG attribute in mmdc output.");
		attrs.push([match[1], decodeXmlText(match[2] ?? match[3])]);
		i = attribute.lastIndex;
	}
	return attrs;
}

function* svgTokens(input) {
	let i = 0;
	while (i < input.length) {
		const lt = input.indexOf("<", i);
		if (lt < 0) {
			yield { type: "text", value: input.slice(i) };
			break;
		}
		if (lt > i) yield { type: "text", value: input.slice(i, lt) };
		if (input.startsWith("<!--", lt)) {
			const end = input.indexOf("-->", lt + 4);
			if (end < 0) throw new Error("Unterminated SVG comment in mmdc output.");
			i = end + 3;
			continue;
		}
		const xmlDeclaration = lt === 0 && /^<\?xml\s[^<>?]*\?>/.exec(input);
		if (xmlDeclaration) {
			i = xmlDeclaration[0].length;
			continue;
		}
		const endM = /^<\/([A-Za-z][\w:-]*)\s*>/.exec(input.slice(lt));
		if (endM) {
			i = lt + endM[0].length;
			yield { type: "end", rawName: endM[1] };
			continue;
		}
		const tagM = /^<([A-Za-z][\w:-]*)(?=[\s/>])/.exec(input.slice(lt));
		if (!tagM) throw new Error("Malformed SVG markup in mmdc output.");
		const rawName = tagM[1];
		const name = rawName.toLowerCase();
		let q = lt + tagM[0].length;
		let quote = null;
		while (q < input.length) {
			const ch = input[q];
			if (quote) {
				if (ch === quote) quote = null;
			} else if (ch === '"' || ch === "'") quote = ch;
			else if (ch === ">") break;
			q += 1;
		}
		if (q === input.length)
			throw new Error("Unterminated SVG tag in mmdc output.");
		const inside = input.slice(lt + tagM[0].length, q);
		const selfClosing = /\/\s*$/.test(inside);
		i = q + 1;
		if (name === "style") {
			if (selfClosing) continue;
			const close = input.indexOf("<", i);
			const end = close >= 0 && /^<\/style\s*>/i.exec(input.slice(close));
			if (!end) throw new Error("Unterminated SVG style in mmdc output.");
			yield { type: "style", value: input.slice(i, close) };
			i = close + end[0].length;
			continue;
		}
		yield { type: "start", rawName, name, inside, selfClosing };
	}
}

/** Turn raw `mmdc` SVG into an SVG the Manifest sanitizer accepts unchanged. */
export function toManifestSafeSvg(raw) {
	if (/<script/i.test(raw))
		throw new Error("mmdc output contains a script element.");
	if (/<foreignobject/i.test(raw)) {
		throw new Error(
			"mmdc output contains a foreignObject element; htmlLabels must stay disabled.",
		);
	}
	// Read each stylesheet separately. Removing nodes never changes how the SVG is tokenized.
	const tokens = [...svgTokens(String(raw).replace(/^\uFEFF/, ""))];
	const rules = [];
	for (const token of tokens) {
		if (token.type === "style")
			parseCssRules(decodeXmlText(token.value), rules);
	}
	const out = [];
	const stack = [];
	let skipDepth = 0;
	for (const token of tokens) {
		if (token.type === "style") continue;
		if (token.type === "text") {
			if (!skipDepth) out.push(escAttr(decodeXmlText(token.value)));
			continue;
		}
		if (token.type === "end") {
			if (skipDepth) skipDepth -= 1;
			else if (!stack.pop()?.unwrap) out.push(`</${token.rawName}>`);
			continue;
		}
		const { rawName, name, inside, selfClosing } = token;
		if (skipDepth) {
			if (!selfClosing) skipDepth += 1;
			continue;
		}
		if (!ALLOWED_TAGS.has(name)) {
			// Unwrap links, drop other foreign subtrees (filters, shadows).
			if (name === "a") {
				if (!selfClosing)
					stack.push({
						tag: name,
						unwrap: true,
						classes: new Set(),
						attrs: new Map(),
					});
			} else if (!selfClosing) skipDepth = 1;
			continue;
		}
		const attrList = parseAttrList(inside.replace(/\/\s*$/, ""));
		const el = {
			tag: name,
			id: attrList.find(([k]) => k.toLowerCase() === "id")?.[1] || "",
			classes: new Set(
				(attrList.find(([k]) => k.toLowerCase() === "class")?.[1] || "")
					.split(/\s+/)
					.filter(Boolean),
			),
			attrs: new Map(attrList.map(([k, v]) => [k.toLowerCase(), v])),
		};
		const styleMap = new Map();
		const kept = [];
		for (const [attrName, value] of attrList) {
			const lower = attrName.toLowerCase();
			if (lower === "font-style") {
				styleMap.set("font-style", value);
				continue;
			}
			if (!ALLOWED_ATTRS.has(lower)) continue;
			if (lower === "style") {
				for (const d of parseDecls(value)) {
					if (d.prop !== "filter" && safeCssValue(d.value))
						styleMap.set(d.prop, d.value);
				}
				continue;
			}
			if (
				(lower === "href" || lower === "xlink:href") &&
				name !== "image" &&
				!value.trim().startsWith("#")
			)
				continue;
			kept.push([attrName, value]);
		}
		for (const [prop, d] of computedDecls(rules, el, stack)) {
			if (!safeCssValue(d.value)) continue;
			if (INLINE_ATTRS.has(prop)) {
				if (styleMap.has(prop)) {
					if (!d.important) continue;
					styleMap.delete(prop);
				}
				const existing = kept.findIndex(([k]) => k.toLowerCase() === prop);
				if (existing >= 0) kept[existing] = [prop, d.value];
				else kept.push([prop, d.value]);
			} else if (
				STYLE_PROPS.has(prop) &&
				(!styleMap.has(prop) || d.important)
			) {
				styleMap.set(prop, d.value);
			}
		}
		let attrHtml = "";
		for (const [k, v] of kept) attrHtml += ` ${k}="${escAttr(v)}"`;
		if (styleMap.size) {
			const style = [...styleMap].map(([k, v]) => `${k}: ${v}`).join("; ");
			attrHtml += ` style="${escAttr(style)}"`;
		}
		out.push(
			selfClosing ? `<${rawName}${attrHtml}/>` : `<${rawName}${attrHtml}>`,
		);
		if (!selfClosing) stack.push(el);
	}
	return out.join("");
}

function main(argv) {
	if (argv.length !== 2) {
		process.stderr.write(
			"usage: node tools/render-mermaid-view.mjs <input.mmd> <output.svg>\n",
		);
		return 2;
	}
	const [input, output] = argv.map((p) => path.resolve(p));
	if (!existsSync(input)) throw new Error(`input not found: ${argv[0]}`);
	const mmdc = process.env.BEARING_MMDC || "mmdc";
	const tmp = mkdtempSync(path.join(tmpdir(), "render-mermaid-view-"));
	try {
		const source = readFileSync(input);
		const svgId = `mermaid-${sha256Hex(source).slice(0, 16)}`;
		const stagedInput = path.join(tmp, `input${path.extname(input)}`);
		writeFileSync(stagedInput, source);
		const config = path.join(tmp, "mermaid-config.json");
		// Top-level htmlLabels is the effective switch in current mmdc;
		// flowchart.htmlLabels alone still emits foreignObject labels.
		writeFileSync(
			config,
			`${JSON.stringify({ theme: "default", deterministicIds: true, htmlLabels: false, flowchart: { htmlLabels: false } })}\n`,
			"utf8",
		);
		const rendered = path.join(tmp, "view.svg");
		const args = [
			"-i",
			stagedInput,
			"-o",
			rendered,
			"--svgId",
			svgId,
			"-c",
			config,
			"-b",
			"transparent",
		];
		if (process.env.BEARING_MMDC_PUPPETEER_CONFIG)
			args.push("-p", process.env.BEARING_MMDC_PUPPETEER_CONFIG);
		const res = spawnSync(mmdc, args, { encoding: "utf8", timeout: 300000 });
		if (res.error) {
			throw new Error(
				`mmdc could not be run (${mmdc}): ${res.error.message}. Install @mermaid-js/mermaid-cli locally or set BEARING_MMDC to a local mmdc.`,
			);
		}
		if (res.status !== 0) {
			throw new Error(
				`mmdc failed with exit ${res.status}: ${(res.stderr || res.stdout || "").trim().slice(-2000)}`,
			);
		}
		const svg = toManifestSafeSvg(readFileSync(rendered, "utf8"));
		sanitizeSvg(svg);
		mkdirSync(path.dirname(output), { recursive: true });
		writeFileSync(output, svg.endsWith("\n") ? svg : `${svg}\n`, "utf8");
		return 0;
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

const isMain =
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(`render-mermaid-view: ${err?.message || err}\n`);
		process.exitCode = 1;
	}
}
