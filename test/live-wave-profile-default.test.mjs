/**
 * bearing-lite#270: profile-level default execution mode (live wave).
 *
 * Contract under test (public entry points only):
 * - schemas/profiles.schema.json and the catalog validators accept an optional
 *   profile `execution.live_wave` of "herdr" or "headless"; omission is today's
 *   catalog.
 * - hooks/profiles.cjs freezeSelectedRoutes copies `execution` into the
 *   snapshot and binds it in the configuration digest.
 * - implementation.json carries the frozen value at
 *   `profile_freeze.snapshot.execution.live_wave`. Final freeze
 *   (`node hooks/plan-package.cjs <dir>`) requires `journey_settings.live_wave`
 *   to equal it (absent plan value = headless), unless
 *   `journey_settings.live_wave_owner_amendment` records
 *   `{ from: <frozen mode>, to: <plan mode>, owner_decision: <non-empty> }`.
 *   A mismatch without that record is the blocking finding
 *   `live_wave_profile_mismatch`.
 * - The wave view (`node hooks/plan-package.cjs wave <dir> <wave>`) is an
 *   offline read-only inspection: it keeps the plan's mode and makes no
 *   transport-availability claim, inside or outside a Herdr pane. Whole-wave
 *   unavailability is the private launcher's typed failure; the public
 *   live-wave reference documents it as a typed gap, never silent headless.
 * - onboard-bearing asks for the default when creating or editing a profile.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { planningContract } from "./planning-contract-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const profilesHook = require(path.join(ROOT, "hooks/profiles.cjs"));
const HOOK = path.join(ROOT, "hooks/plan-package.cjs");
const VALIDATOR = path.join(
	ROOT,
	"skills/onboard-bearing/scripts/validate-profiles.mjs",
);
const ONBOARD = path.join(ROOT, "skills/onboard-bearing/references");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const MODES = ["herdr", "headless"];

function profile(execution) {
	const route = (h) => ({
		enabled: true,
		primary: {
			harness: `harness-${h}`,
			model: `model-${h}`,
			reasoning: `reasoning-${h}`,
		},
		ordered_fallbacks: [],
	});
	return {
		roles: { implementer: route("a"), reviewer: route("b") },
		...(execution === undefined ? {} : { execution }),
	};
}
const catalogRaw = (execution) =>
	JSON.stringify({ schema_version: 1, profiles: { Work: profile(execution) } });

function cliValidate(raw) {
	const r = spawnSync(process.execPath, [VALIDATOR, "--stdin"], {
		input: raw,
		encoding: "utf8",
		timeout: 15_000,
	});
	return {
		status: r.status,
		json: JSON.parse(r.stdout || "null"),
		stdout: r.stdout,
	};
}

describe("#270 profile schema accepts an optional execution mode", () => {
	it("declares execution.live_wave as an optional herdr/headless enum on the closed profile object", () => {
		const schema = JSON.parse(
			readFileSync(path.join(ROOT, "schemas/profiles.schema.json"), "utf8"),
		);
		const text = JSON.stringify(schema);
		// Find the profile object: the closed object that owns `roles`.
		let profileDef;
		(function walk(node) {
			if (!node || typeof node !== "object" || profileDef) return;
			if (node.properties?.roles && node.properties?.development_strategy)
				profileDef = node;
			else Object.values(node).forEach(walk);
		})(schema);
		assert.ok(profileDef, `profile object found in ${text.length}-byte schema`);
		const execution = profileDef.properties.execution;
		assert.ok(execution, "profile.execution is declared");
		assert.equal(execution.additionalProperties, false);
		assert.deepEqual(execution.properties?.live_wave?.enum, MODES);
		assert.ok(
			!(profileDef.required || []).includes("execution"),
			"execution stays optional",
		);
	});

	for (const [label, execution] of [
		["absent", undefined],
		["herdr", { live_wave: "herdr" }],
		["headless", { live_wave: "headless" }],
	]) {
		it(`hook and onboarding validators accept execution ${label}`, () => {
			const raw = catalogRaw(execution);
			const hook = profilesHook.validateCatalog({ raw });
			assert.equal(hook.catalog_valid, true, JSON.stringify(hook.errors));
			const cli = cliValidate(raw);
			assert.equal(cli.status, 0, cli.stdout);
			assert.equal(cli.json.catalog_valid, true, cli.stdout);
		});
	}

	for (const [label, execution] of [
		["an unknown mode", { live_wave: "tmux" }],
		["an unknown execution key", { live_wave: "herdr", pane: "x" }],
	]) {
		it(`hook and onboarding validators refuse ${label}`, () => {
			const raw = catalogRaw(execution);
			assert.equal(profilesHook.validateCatalog({ raw }).catalog_valid, false);
			const cli = cliValidate(raw);
			assert.equal(cli.status, 1, cli.stdout);
			assert.equal(cli.json.catalog_valid, false);
		});
	}
});

describe("#270 freeze copies the execution mode and binds it in the digest", () => {
	it("field absent: snapshot carries no execution; declaring a mode changes the digest", () => {
		const frozen = profilesHook.freezeSelectedRoutes({ profile: profile() });
		assert.equal(frozen.snapshot.execution, undefined);
		const withMode = profilesHook.freezeSelectedRoutes({
			profile: profile({ live_wave: "headless" }),
		});
		assert.notEqual(
			withMode.digest,
			frozen.digest,
			"declaring a mode changes the digest",
		);
	});

	for (const mode of MODES) {
		it(`${mode}: snapshot deep-copies execution from the named catalog profile`, () => {
			const catalog = JSON.parse(catalogRaw({ live_wave: mode }));
			const frozen = profilesHook.freezeSelectedRoutes({
				profile: "Work",
				catalog,
			});
			assert.ok(frozen.snapshot, JSON.stringify(frozen));
			assert.deepEqual(frozen.snapshot.execution, { live_wave: mode });
			catalog.profiles.Work.execution.live_wave =
				mode === "herdr" ? "headless" : "herdr";
			assert.equal(
				frozen.snapshot.execution.live_wave,
				mode,
				"isolated from later catalog edits",
			);
		});
	}

	it("herdr and headless freeze to different configuration digests", () => {
		const [h, l] = MODES.map(
			(m) =>
				profilesHook.freezeSelectedRoutes({
					profile: profile({ live_wave: m }),
				}).digest,
		);
		assert.notEqual(h, l);
	});
});

function plan(t, { frozen, planMode, amendment } = {}) {
	const repo = mkdtempSync(path.join(os.tmpdir(), "bl270-"));
	t.after(() => rmSync(repo, { recursive: true, force: true }));
	const dir = path.join(repo, "docs/plans/x");
	mkdirSync(path.join(repo, ".git"), { recursive: true });
	mkdirSync(dir, { recursive: true });
	const planMd = "# plan\n";
	const designMd = "# design\n";
	writeFileSync(path.join(dir, "plan.md"), planMd);
	writeFileSync(path.join(dir, "design.md"), designMd);
	writeFileSync(
		path.join(dir, "seit.json"),
		JSON.stringify({
			source_baseline: {
				planning_inputs: [
					{ path: "docs/plans/x/plan.md", sha256: sha(planMd) },
					{ path: "docs/plans/x/design.md", sha256: sha(designMd) },
				],
			},
			procedures_and_commands: [],
		}),
	);
	const manifest = sha(
		[
			sha(planMd),
			sha(designMd),
			sha(readFileSync(path.join(dir, "seit.json"))),
		].join("\n"),
	);
	const contract = planningContract(manifest, {
		dir,
		units: ["W1"],
		kind: "wave",
	});
	writeFileSync(
		path.join(dir, "implementation.json"),
		JSON.stringify({
			boundary_contract: contract.boundary_contract,
			profile_freeze: {
				state: "frozen",
				snapshot:
					frozen === undefined ? {} : { execution: { live_wave: frozen } },
			},
			journey_settings: {
				planning_review: { candidate_digest: manifest },
				...contract.journey_settings,
				...(planMode ? { live_wave: planMode } : {}),
				...(amendment ? { live_wave_owner_amendment: amendment } : {}),
			},
			waves: [{ id: "W1", slice_ids: [], exit_command_ids: [] }],
			slices: [],
		}),
	);
	return dir;
}

function run(args, env = {}) {
	const { HERDR_ENV, ...base } = process.env;
	const res = spawnSync(process.execPath, args, {
		cwd: ROOT,
		encoding: "utf8",
		timeout: 30_000,
		env: { ...base, ...env },
	});
	return {
		status: res.status,
		out: JSON.parse(res.stdout),
		stdout: res.stdout,
	};
}
const mismatch = (out) =>
	out.findings.filter((f) => f.code === "live_wave_profile_mismatch");

describe("#270 Planning and Design sets journey_settings.live_wave from the frozen snapshot", () => {
	it("the planning assembly procedure copies the mode from the frozen profile", () => {
		const assembly = readFileSync(
			path.join(ROOT, "skills/bearing-lite/references/planning-assembly.md"),
			"utf8",
		);
		assert.match(
			assembly,
			/Copy\s+`profile_freeze\.snapshot\.execution\.live_wave` into\s+`journey_settings\.live_wave`/,
		);
	});

	it("implementation schema accepts headless as an explicit plan value", () => {
		const schema = JSON.parse(
			readFileSync(
				path.join(ROOT, "schemas/implementation.schema.json"),
				"utf8",
			),
		);
		assert.deepEqual(
			schema.properties.journey_settings.properties.live_wave.enum,
			MODES,
		);
	});

	for (const [label, opts] of [
		["field absent in profile and plan", {}],
		["herdr frozen, herdr planned", { frozen: "herdr", planMode: "herdr" }],
		["headless frozen, plan omits (headless)", { frozen: "headless" }],
		[
			"headless frozen, headless planned",
			{ frozen: "headless", planMode: "headless" },
		],
	]) {
		it(`final freeze passes when the plan matches: ${label}`, (t) => {
			const { status, out, stdout } = run([HOOK, plan(t, opts)]);
			assert.deepEqual(mismatch(out), [], stdout);
			assert.equal(out.outcome, "PASS", stdout);
			assert.equal(status, 0, stdout);
		});
	}

	for (const [label, opts] of [
		[
			"herdr frozen, plan omits live_wave (silent headless)",
			{ frozen: "herdr" },
		],
		[
			"herdr frozen, headless planned",
			{ frozen: "herdr", planMode: "headless" },
		],
		[
			"headless frozen, herdr planned",
			{ frozen: "headless", planMode: "herdr" },
		],
		[
			"amendment whose from does not match the frozen mode",
			{
				frozen: "herdr",
				planMode: "headless",
				amendment: { from: "headless", to: "headless", owner_decision: "OD-1" },
			},
		],
		[
			"amendment without an owner decision",
			{
				frozen: "herdr",
				planMode: "headless",
				amendment: { from: "herdr", to: "headless", owner_decision: "" },
			},
		],
	]) {
		it(`final freeze names live_wave_profile_mismatch: ${label}`, (t) => {
			const { status, out, stdout } = run([HOOK, plan(t, opts)]);
			assert.equal(mismatch(out).length, 1, stdout);
			assert.notEqual(out.outcome, "PASS", stdout);
			assert.notEqual(status, 0, stdout);
		});
	}

	for (const [from, to] of [
		["herdr", "headless"],
		["headless", "herdr"],
	]) {
		it(`plan override ${from} -> ${to} passes with a recorded owner amendment`, (t) => {
			const dir = plan(t, {
				frozen: from,
				planMode: to,
				amendment: { from, to, owner_decision: "OD-270-1" },
			});
			const { status, out, stdout } = run([HOOK, dir]);
			assert.deepEqual(mismatch(out), [], stdout);
			assert.equal(out.outcome, "PASS", stdout);
			assert.equal(status, 0, stdout);
		});
	}
});

describe("#270 wave view is a read-only plan inspection with no availability claim", () => {
	// The wave view runs offline and outside a Herdr pane; the private launcher
	// can start a new Herdr server with HERDR_ENV unset, and a stale flag proves
	// nothing. Transport availability is the launcher's typed failure, not this view's.
	const unavailable = (out) =>
		out.findings.filter((f) => f.code === "live_wave_unavailable");

	for (const [label, opts] of [
		["legacy live plan (no frozen mode)", { planMode: "herdr" }],
		["frozen live plan", { frozen: "herdr", planMode: "herdr" }],
		["frozen headless plan", { frozen: "headless", planMode: "headless" }],
		["field absent", {}],
	]) {
		it(`${label}: inspects outside a Herdr pane without an availability finding`, (t) => {
			const dir = plan(t, opts);
			const outside = run([HOOK, "wave", dir, "W1"]);
			assert.deepEqual(unavailable(outside.out), [], outside.stdout);
			assert.equal(outside.out.outcome, "PASS", outside.stdout);
			assert.equal(outside.status, 0, outside.stdout);
			// No silent mode swap: a live plan keeps its live exchange view.
			assert.equal(
				Boolean(outside.out.live_exchange),
				opts.planMode === "herdr",
				outside.stdout,
			);
			// A pane flag changes nothing: the view makes no availability claim.
			const inside = run([HOOK, "wave", dir, "W1"], { HERDR_ENV: "1" });
			assert.deepEqual(inside.out, outside.out);
			assert.equal(inside.status, outside.status);
		});
	}

	it("live-wave reference assigns whole-wave unavailability to the launcher as a typed gap", () => {
		const doc = readFileSync(
			path.join(ROOT, "skills/bearing-lite/references/live-wave.md"),
			"utf8",
		);
		assert.doesNotMatch(doc, /wave view reports the typed gap/i);
		assert.doesNotMatch(doc, /HERDR_ENV/);
		assert.match(
			doc,
			/launcher[^.]*unavailable[^.]*typed gap|typed gap[^.]*launcher/is,
		);
	});

	it("#272 live-wave reference describes pane placement in the orchestrator's tab", () => {
		const doc = readFileSync(
			path.join(ROOT, "skills/bearing-lite/references/live-wave.md"),
			"utf8",
		);
		assert.match(doc, /opens role panes in the orchestrator's own tab/);
		assert.match(doc, /without\s+taking focus/);
		assert.match(doc, /reports the live wave as unavailable/);
		assert.doesNotMatch(doc, /creates a tab on the first launch/);
	});
});

describe("#270 onboard-bearing asks for the default execution mode", () => {
	const read = (f) => readFileSync(path.join(ONBOARD, f), "utf8");

	it("the main onboarding checklist includes the optional execution mode", () => {
		const skill = readFileSync(path.join(ONBOARD, "../SKILL.md"), "utf8");
		assert.match(skill, /Default execution mode \(`execution\.live_wave`\)/);
	});

	it("Full setup walks the execution mode", () => {
		const full =
			read("welcome.md").split("| Full setup |")[1]?.split("\n")[0] ?? "";
		assert.match(full, /execution\.live_wave/);
	});

	it("guided first profile asks for herdr or headless with no preselected value", () => {
		const step3 =
			read("guided-first-profile.md")
				.split(/^## Step 3/m)[1]
				?.split(/^## Step 4/m)[0] ?? "";
		assert.match(step3, /execution\.live_wave/);
		assert.match(step3, /herdr/);
		assert.match(step3, /headless/);
	});

	it("profile edits name execution.live_wave as an editable field", () => {
		const contract = read("catalog-contract.md");
		assert.match(contract, /execution\.live_wave/);
	});
});
