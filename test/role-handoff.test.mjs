/**
 * CMD-HANDOFF-01 / SEIT-HANDOFF-01
 * Role return envelope validation and rejection of incomplete/stale returns.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const closeout = require(path.join(ROOT, "hooks", "closeout.cjs"));

export const HANDOFF_FIELDS = closeout.HANDOFF_FIELDS;

/**
 * @typedef {{ code: string, message: string, field?: string }} HandoffDiagnostic
 * @typedef {{ ok: true, action: 'advance' } | { ok: false, action: 'reroute', diagnostics: HandoffDiagnostic[] }} HandoffVerdict
 */

/**
 * Validate a role return handoff against CONTRACT-HANDOFF-01.
 * @param {Record<string, unknown>} handoff
 * @param {{ expectedSubject?: string, expectedCandidate?: string, planCandidate?: string }} [ctx]
 * @returns {HandoffVerdict}
 */
export function validateHandoff(handoff, ctx = {}) {
	/** @type {HandoffDiagnostic[]} */
	const diagnostics = [];
	if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) {
		return {
			ok: false,
			action: "reroute",
			diagnostics: [
				{ code: "handoff_not_object", message: "handoff must be an object" },
			],
		};
	}
	for (const field of HANDOFF_FIELDS) {
		const value = handoff[field];
		if (value === undefined || value === null) {
			diagnostics.push({
				code: "missing_field",
				message: `required handoff field "${field}" is missing`,
				field,
			});
			continue;
		}
		if (typeof value === "string" && value.trim() === "") {
			diagnostics.push({
				code: "missing_field",
				message: `required handoff field "${field}" is empty`,
				field,
			});
			continue;
		}
		if (
			field === "verdict" &&
			(typeof value !== "string" || !closeout.VERDICT_VALUES.has(value.trim()))
		) {
			diagnostics.push({
				code: "invalid_verdict",
				message: `verdict ${JSON.stringify(value)} is not a closed role-return token`,
				field: "verdict",
			});
		}
	}
	const narrativeOnly =
		[
			"plan_ref",
			"role",
			"subject",
			"depends_on",
			"scope",
			"authority",
			"evidence",
			"next_action",
			"receiving_role",
		].some(
			(field) =>
				handoff[field] !== undefined &&
				handoff[field] !== null &&
				String(handoff[field]).trim() !== "",
		) &&
		HANDOFF_FIELDS.every((field) => {
			const value = handoff[field];
			return (
				value === undefined ||
				value === null ||
				(typeof value === "string" && value.trim() === "")
			);
		});
	if (narrativeOnly) {
		diagnostics.push({
			code: "narrative_only_handoff",
			message:
				"narrative-only handoffs are rejected; return the six-field compact receipt",
		});
	}

	if (ctx.expectedCandidate) {
		const provided =
			typeof handoff.candidate_ref === "string"
				? handoff.candidate_ref
				: ctx.planCandidate;
		if (provided !== ctx.expectedCandidate) {
			diagnostics.push({
				code: "candidate_mismatch",
				message: `candidate_ref "${String(provided)}" does not match expected "${ctx.expectedCandidate}"`,
				field: "candidate_ref",
			});
		}
	}
	if (diagnostics.length) {
		return { ok: false, action: "reroute", diagnostics };
	}
	return { ok: true, action: "advance" };
}

function validHandoff(overrides = {}) {
	return {
		verdict: "PASS",
		candidate_ref: "cand-abc",
		changed_paths: ["test/role-handoff.test.mjs"],
		tests: "node --test exit 0",
		findings: "none",
		blocker: "none",
		...overrides,
	};
}

describe("CMD-HANDOFF-01 role-handoff (SEIT-HANDOFF-01)", () => {
	it("closed verdict vocabulary is documented on the task template", () => {
		const template = readFileSync(
			path.join(ROOT, "skills/bearing-lite/templates/task.md"),
			"utf8",
		);
		assert.ok(closeout.VERDICT_VALUES.size > 0);
		for (const token of closeout.VERDICT_VALUES) {
			assert.match(template, new RegExp("`" + token + "`"), token);
		}
	});

	it("valid return requires the six-field compact receipt and may advance", () => {
		assert.deepEqual(
			[...HANDOFF_FIELDS],
			[
				"verdict",
				"candidate_ref",
				"changed_paths",
				"tests",
				"findings",
				"blocker",
			],
		);
		const handoff = validHandoff();
		for (const field of HANDOFF_FIELDS) {
			assert.ok(field in handoff, field);
		}
		const verdict = validateHandoff(handoff, {
			expectedCandidate: "cand-abc",
		});
		assert.equal(verdict.ok, true);
		if (verdict.ok) assert.equal(verdict.action, "advance");
	});

	it("closeout hook agrees on complete advisory handoff", () => {
		const handoff = validHandoff();
		const result = closeout.evaluate({
			handoff,
			required_assurance: "none",
			assurance_accepted: [],
			candidate_matched: true,
			blocker: "none",
		});
		assert.equal(result.hook_class, "closeout");
		assert.equal(result.outcome, "ADVISE");
	});

	it("prose task outcome cannot satisfy the compact receipt", () => {
		const intentAsOutcome = validateHandoff(
			validHandoff({
				outcome: "add S8 tests",
				verdict: undefined,
			}),
		);
		assert.equal(intentAsOutcome.ok, false);
		if (!intentAsOutcome.ok) {
			assert.equal(intentAsOutcome.action, "reroute");
			assert.ok(
				intentAsOutcome.diagnostics.some(
					(d) => d.code === "missing_field" && d.field === "verdict",
				),
			);
		}

		const intentAsVerdict = validateHandoff(
			validHandoff({ verdict: "add S8 tests" }),
		);
		assert.equal(intentAsVerdict.ok, false);
		if (!intentAsVerdict.ok) {
			assert.ok(
				intentAsVerdict.diagnostics.some((d) => d.code === "invalid_verdict"),
			);
		}

		const closed = closeout.evaluate({
			outcome: "add S8 tests",
			candidate_ref: "cand-abc",
			changed_paths: ["test/role-handoff.test.mjs"],
			tests: "ok",
			findings: "none",
			blocker: "none",
		});
		assert.equal(closed.reason, "handoff_incomplete:verdict");
		assert.notEqual(closed.reason, "handoff_complete");
	});

	it("negative: missing field reroutes with typed diagnostic (not silent advance)", () => {
		const handoff = validHandoff();
		delete handoff.findings;
		const verdict = validateHandoff(handoff);
		assert.equal(verdict.ok, false);
		if (!verdict.ok) {
			assert.equal(verdict.action, "reroute");
			assert.ok(
				verdict.diagnostics.some(
					(d) => d.code === "missing_field" && d.field === "findings",
				),
			);
		}
	});

	it("negative: narrative-only handoff rejects/reroutes", () => {
		const verdict = validateHandoff({
			plan_ref: "plan",
			role: "implementer",
			subject: "S8-packet-A",
			depends_on: [],
			scope: "test/",
			authority: "S8",
			evidence: "long narrative",
			next_action: "continue",
			receiving_role: "coordinator",
		});
		assert.equal(verdict.ok, false);
		if (!verdict.ok) {
			assert.equal(verdict.action, "reroute");
			assert.ok(
				verdict.diagnostics.some((d) => d.code === "narrative_only_handoff"),
			);
		}
	});

	it("negative: candidate mismatch rejects/reroutes", () => {
		const verdict = validateHandoff(
			validHandoff({ candidate_ref: "cand-stale" }),
			{
				expectedCandidate: "cand-abc",
			},
		);
		assert.equal(verdict.ok, false);
		if (!verdict.ok) {
			assert.equal(verdict.action, "reroute");
			assert.ok(
				verdict.diagnostics.some((d) => d.code === "candidate_mismatch"),
			);
		}
	});

	it("assurance sequence is Assurance Test Engineer, Reviewer, then Integration Engineer execution", () => {
		const taskState = readFileSync(
			path.join(ROOT, "skills/bearing-lite/references/task-state.md"),
			"utf8",
		);
		const routing = readFileSync(
			path.join(ROOT, "skills/bearing-lite/references/role-routing.mmd"),
			"utf8",
		);
		const template = readFileSync(
			path.join(ROOT, "skills/bearing-lite/templates/task.md"),
			"utf8",
		);
		assert.match(taskState, /Assurance Test Engineer/);
		assert.match(taskState, /Reviewer/);
		assert.match(taskState, /Integration Engineer execution/);
		assert.match(routing, /Assurance Test Engineer|Test Engineer/);
		assert.match(routing, /Reviewer/);
		assert.match(routing, /Integration Engineer execution/);
		assert.match(template, /Assurance Test Engineer|Test Engineer/);
		assert.match(template, /Reviewer/);
		assert.match(template, /Integration Engineer execution/);
		assert.doesNotMatch(template, /required_assurance:\s*\[Validator\]/);
	});

	it("Direct and Coordinator-wave bound exhaustion name candidate and count", () => {
		const router = readFileSync(
			path.join(ROOT, "skills/bearing-lite/SKILL.md"),
			"utf8",
		);
		const refs = path.join(ROOT, "skills/bearing-lite/references");
		// Retired Coordinator's escalation duty (D9) lives in the Implementation Orchestrator text.
		const implOrch = [
			path.join(ROOT, "skills/bearing-lite/SKILL.md"),
			...readdirSync(refs)
				.filter((n) => n.endsWith(".md"))
				.map((n) => path.join(refs, n)),
		]
			.map((f) => readFileSync(f, "utf8"))
			.join("\n");
		const assembly = readFileSync(
			path.join(ROOT, "skills/bearing-lite/references/planning-assembly.md"),
			"utf8",
		);
		const taskState = readFileSync(
			path.join(ROOT, "skills/bearing-lite/references/task-state.md"),
			"utf8",
		);
		assert.match(router, /references\/planning-assembly\.md/);
		assert.match(
			taskState,
			/parent controller is the Orchestrator on a direct packet/,
		);
		assert.match(
			assembly,
			/`OWNER_DECISION_REQUIRED` naming the candidate and count/,
		);
		assert.match(
			implOrch,
			/Failed repair\s+or scope drift returns to the Orchestrator/,
		);
		assert.doesNotMatch(
			router,
			/only when Navigator|requires Navigator to bound|inherited from Bearing's Navigator/i,
		);
	});

	it("closeout protected completion BLOCKs on candidate mismatch", () => {
		const result = closeout.evaluate({
			mode: "protected_completion",
			handoff: validHandoff(),
			required_assurance: [],
			assurance_accepted: [],
			candidate_matched: false,
			blocker: "none",
		});
		assert.equal(result.outcome, "BLOCK");
		assert.match(String(result.reason), /candidate_mismatch/);
	});
});

describe("Alphazedehq#594 planning handoff requires final freeze receipt", () => {
	for (const [label, fields, outcome, reason] of [
		[
			"pending planning review",
			{ planning_review: {} },
			"REROUTE",
			/planning_review:NEEDS_MORE_EVIDENCE/,
		],
		[
			"pending assurance",
			{ required_assurance: ["reviewer"] },
			"ADVISE",
			/^assurance_pending:reviewer$/,
		],
		[
			"protected completion",
			{ protected_completion: true, required_assurance: ["reviewer"] },
			"BLOCK",
			/^protected_completion_invalid:.*assurance:reviewer/,
		],
		[
			"incomplete role return",
			{ handoff: { verdict: "READY" } },
			"ADVISE",
			/^handoff_incomplete:/,
		],
	]) {
		it(`preserves ${label} during a handoff check`, () => {
			const result = closeout.evaluate({
				mode: "handoff",
				handoff: validHandoff({ verdict: "READY" }),
				final_freeze_receipt: {
					stage: "final",
					outcome: "PASS",
					manifest_digest: "a".repeat(64),
					findings: [],
				},
				...fields,
			});
			assert.equal(result.outcome, outcome, result.reason);
			assert.match(result.reason, reason);
		});
	}

	it("closeout handoff path refuses a handoff without a valid final freeze receipt and accepts a final PASS receipt", () => {
		const missing = closeout.evaluate({
			mode: "handoff",
			handoff: validHandoff({ verdict: "READY" }),
		});
		assert.equal(missing.outcome, "REROUTE");
		assert.match(
			missing.reason,
			/^handoff_refused:final_freeze_receipt_missing/,
		);
		assert.match(
			missing.recovery,
			/node <plugin root>\/hooks\/plan-package\.cjs <plan dir>/,
		);

		const draftOnly = closeout.evaluate({
			mode: "handoff",
			handoff: validHandoff({ verdict: "READY" }),
			final_freeze_receipt: {
				outcome: "PASS",
				stage: "draft",
				manifest_digest: "a".repeat(64),
				findings: [],
			},
		});
		assert.equal(draftOnly.outcome, "REROUTE");
		assert.match(
			draftOnly.reason,
			/^handoff_refused:final_freeze_receipt_invalid/,
		);

		const draftText = closeout.evaluate({
			mode: "handoff",
			handoff: validHandoff({ verdict: "READY" }),
			final_freeze_receipt: "plan-package.cjs draft PASS",
		});
		assert.equal(draftText.outcome, "REROUTE");
		assert.match(
			draftText.reason,
			/^handoff_refused:final_freeze_receipt_invalid/,
		);

		const valid = closeout.evaluate({
			mode: "handoff",
			handoff: validHandoff({ verdict: "READY" }),
			final_freeze_receipt: {
				outcome: "PASS",
				stage: "final",
				manifest_digest: "a".repeat(64),
				findings: [],
			},
			manifest_delivery: {
				path: "plan-dod-manifest.html",
				sha256: "b".repeat(64),
				opened_in: "Chrome",
				delivered_at: "2026-11-26T00:00:00Z",
			},
		});
		assert.equal(valid.outcome, "ADVISE");
		assert.equal(valid.reason, "handoff_complete");
	});

	for (const [label, final_freeze_receipt] of [
		["a receipt note", "Receipt to come"],
		[
			"a nonzero exit code",
			{
				stage: "final",
				outcome: "PASS",
				manifest_digest: "a".repeat(64),
				exit_code: 1,
			},
		],
	]) {
		it(`refuses ${label} as final freeze evidence`, () => {
			const result = closeout.evaluate({
				mode: "handoff",
				final_freeze_receipt,
			});
			assert.equal(result.outcome, "REROUTE");
			assert.equal(
				result.reason,
				"handoff_refused:final_freeze_receipt_invalid",
			);
		});
	}

	it("handoff template records final_freeze_receipt and Implementation Orchestrator intake returns to planning when absent", () => {
		const templatePath = path.join(
			ROOT,
			"skills/bearing-lite/templates/handoff.md",
		);
		const handoffTpl = readFileSync(templatePath, "utf8");
		const router = readFileSync(
			path.join(ROOT, "skills/bearing-lite/SKILL.md"),
			"utf8",
		).replace(/\s+/g, " ");
		const assembly = readFileSync(
			path.join(ROOT, "skills/bearing-lite/references/planning-assembly.md"),
			"utf8",
		).replace(/\s+/g, " ");
		assert.match(handoffTpl, /final_freeze_receipt/);
		assert.match(handoffTpl, /stage:\s*final/i);
		assert.match(router, /templates\/handoff\.md/);
		assert.match(
			router,
			/Implementation:[\s\S]{0,400}final_freeze_receipt[\s\S]{0,200}return to planning/i,
		);
		assert.match(
			assembly,
			/Implementation order after the handoff[\s\S]{0,400}final_freeze_receipt[\s\S]{0,200}return(?:ing)? to planning/i,
		);
	});

	it("RC6-7 a completed planning handoff template satisfies closeout", () => {
		const template = readFileSync(
			path.join(ROOT, "skills/bearing-lite/templates/handoff.md"),
			"utf8",
		);
		const sample = template.match(/```markdown\n([\s\S]*?)\n```/)[1];
		const handoff = Object.fromEntries(
			[...sample.matchAll(/^- (\w+): (.+)$/gm)].map(([, field, value]) => [
				field,
				value,
			]),
		);
		const receipt = closeout.evaluate({
			mode: "handoff",
			handoff,
			final_freeze_receipt: {
				outcome: "PASS",
				stage: "final",
				manifest_digest: "a".repeat(64),
			},
			manifest_delivery: {
				path: "plan-dod-manifest.html",
				sha256: "b".repeat(64),
				opened_in: "Chrome",
				delivered_at: "2026-11-26T00:00:00Z",
			},
		});
		assert.equal(receipt.reason, "handoff_complete");
	});

	it("handoff template settles target-host transport, approval authority, and local landing (#614)", () => {
		const handoffTpl = readFileSync(
			path.join(ROOT, "skills/bearing-lite/templates/handoff.md"),
			"utf8",
		).replace(/\s+/g, " ");
		assert.match(
			handoffTpl,
			/exact candidate and its (?:proof|evidence).*(?:travel|deliver).*target host/i,
		);
		assert.match(
			handoffTpl,
			/who may approve.*transport.*owner or (?:explicit |recorded )?delegate.*authority\.json/i,
		);
		assert.match(
			handoffTpl,
			/(?:land locally|local landing).*(?:host gate cannot run|host gate is unavailable)/i,
		);
	});
});

describe("alphazede/bearing-lite#285 planning handoff requires delivered DoD Manifest", () => {
	const sha256 = (data) => createHash("sha256").update(data).digest("hex");
	const finalReceipt = {
		outcome: "PASS",
		stage: "final",
		manifest_digest: "a".repeat(64),
		findings: [],
	};

	function manifestFixture(t) {
		const repo = mkdtempSync(path.join(tmpdir(), "bl-285-manifest-"));
		t.after(() => rmSync(repo, { recursive: true, force: true }));
		const planDir = path.join(repo, "docs/plans/example");
		mkdirSync(path.join(repo, ".git"), { recursive: true });
		mkdirSync(planDir, { recursive: true });
		const html = "<!doctype html><title>Example DoD Manifest</title>\n";
		const manifestName = "example-dod-manifest.html";
		writeFileSync(path.join(planDir, manifestName), html);
		writeFileSync(
			path.join(planDir, "implementation.json"),
			JSON.stringify({ dod_manifest: { output_name: manifestName } }),
		);
		return {
			planDir,
			manifestPath: "docs/plans/example/example-dod-manifest.html",
			manifestSha256: sha256(html),
		};
	}

	function journeyWithApproval(manifestDelivery) {
		return {
			schema_version: "1",
			journey: {
				id: "J-285",
				title: "Manifest delivery test",
				status: "planning",
				planning_repository: "example/bearing-lite",
			},
			decisions: [
				{
					id: "DEC-285-APPROVAL",
					status: "confirmed",
					decision: "Owner approved planning package.",
					...(manifestDelivery !== undefined
						? { manifest_delivery: manifestDelivery }
						: {}),
				},
			],
			history: {
				decisions: [{ id: "DEC-285-APPROVAL" }],
			},
			open_decisions: [],
			planning_receipts: [],
			profile_selection: {},
		};
	}

	it("missing delivery refused", (t) => {
		const { planDir } = manifestFixture(t);
		const res = closeout.evaluate({
			mode: "handoff",
			plan_dir: planDir,
			handoff: validHandoff({ verdict: "READY" }),
			final_freeze_receipt: finalReceipt,
			journey: journeyWithApproval(undefined),
		});
		assert.equal(res.outcome, "REROUTE");
		assert.equal(res.reason, "handoff_refused:manifest_not_delivered");
	});

	it("mismatched SHA-256 refused", (t) => {
		const { planDir, manifestPath } = manifestFixture(t);
		const res = closeout.evaluate({
			mode: "handoff",
			plan_dir: planDir,
			handoff: validHandoff({ verdict: "READY" }),
			final_freeze_receipt: finalReceipt,
			journey: journeyWithApproval({
				path: manifestPath,
				sha256: "0".repeat(64),
				opened_in: "Chrome",
				delivered_at: "2026-11-26T00:00:00Z",
			}),
		});
		assert.equal(res.outcome, "REROUTE");
		assert.equal(res.reason, "handoff_refused:manifest_not_delivered");
	});

	it("matching delivery accepted", (t) => {
		const { planDir, manifestPath, manifestSha256 } = manifestFixture(t);
		const res = closeout.evaluate({
			mode: "handoff",
			plan_dir: planDir,
			handoff: validHandoff({ verdict: "READY" }),
			final_freeze_receipt: finalReceipt,
			journey: journeyWithApproval({
				path: manifestPath,
				sha256: manifestSha256,
				opened_in: "Chrome",
				delivered_at: "2026-11-26T00:00:00Z",
			}),
		});
		assert.equal(res.outcome, "ADVISE");
		assert.equal(res.reason, "handoff_complete");
	});

	it("requires delivery on the current integrated confirmation, not an earlier receipt or a handoff copy", async (t) => {
		const { planDir, manifestPath, manifestSha256 } = manifestFixture(t);
		const delivery = { path: manifestPath, sha256: manifestSha256 };
		const approval = (id, manifest_delivery) => ({
			id,
			record_type: "owner_stop",
			class: "E",
			status: "answered",
			manifest_delivery,
		});
		for (const [label, decisions, copy, expected] of [
			["missing from confirmation", [approval("DEC-NEW")], delivery, "REROUTE"],
			[
				"earlier approval only",
				[approval("DEC-OLD", delivery), approval("DEC-NEW")],
				undefined,
				"REROUTE",
			],
			[
				"copy differs from confirmation",
				[approval("DEC-NEW", { ...delivery, sha256: "0".repeat(64) })],
				delivery,
				"REROUTE",
			],
			[
				"matching current confirmation",
				[approval("DEC-OLD"), approval("DEC-NEW", delivery)],
				delivery,
				"ADVISE",
			],
		]) {
			await t.test(label, () => {
				const journey = journeyWithApproval(undefined);
				journey.decisions = decisions;
				journey.history.decisions = decisions.map(({ id }) => ({ id }));
				const res = closeout.evaluate({
					mode: "handoff",
					plan_dir: planDir,
					handoff: {
						...validHandoff({ verdict: "READY" }),
						manifest_delivery: copy,
					},
					final_freeze_receipt: finalReceipt,
					journey,
				});
				assert.equal(res.outcome, expected);
				assert.equal(
					res.reason,
					expected === "REROUTE"
						? "handoff_refused:manifest_not_delivered"
						: "handoff_complete",
				);
			});
		}
	});

	it("skills and handoff template require Manifest browser display and delivery before approval (#285)", () => {
		const pdStep6 =
			readFileSync(
				path.join(ROOT, "skills/planning-and-design/SKILL.md"),
				"utf8",
			).match(/^6\. [\s\S]*?(?=\n## Return and recovery)/m)?.[0] ?? "";
		const assembly = readFileSync(
			path.join(ROOT, "skills/bearing-lite/references/planning-assembly.md"),
			"utf8",
		);
		const assemblyStep5 =
			assembly.match(
				/^5\. \*\*Owner confirmation and handoff:\*\*[\s\S]*?(?=\n\nSkip inactive roles)/m,
			)?.[0] ?? "";
		const router = readFileSync(
			path.join(ROOT, "skills/bearing-lite/SKILL.md"),
			"utf8",
		);
		const routerStep3 =
			router.match(
				/^3\. \*\*Planning:\*\*[\s\S]*?(?=\n4\. \*\*Implementation:\*\*)/m,
			)?.[0] ?? "";
		const handoffTpl = readFileSync(
			path.join(ROOT, "skills/bearing-lite/templates/handoff.md"),
			"utf8",
		);

		for (const [label, text] of [
			["planning-and-design step 6", pdStep6],
			["planning-assembly step 5", assemblyStep5],
			["bearing-lite step 3", routerStep3],
		]) {
			assert.match(text, /Chrome/i, `${label} names Chrome`);
			assert.match(text, /file-delivery/i, `${label} names file-delivery`);
			assert.match(text, /manifest_not_delivered/, `${label} names typed gap`);
			assert.match(
				text.replace(/\s+/g, " "),
				/if either browser display or file delivery fails/i,
				`${label} holds approval until both deliveries succeed`,
			);
		}
		assert.match(pdStep6, /name.*manifest.*path|manifest path/i);
		assert.match(assemblyStep5, /name.*manifest.*path|manifest path/i);
		assert.match(handoffTpl, /manifest_delivery:/);
		assert.match(handoffTpl, /sha256:/);
	});
});
