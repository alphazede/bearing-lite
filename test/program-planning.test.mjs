/**
 * program-planning: milestone ladder, dependency-domain edges, bottom-up
 * estimation with a recorded basis, the notice protocol with corroboration,
 * and tier 1-7 replanning that preserves verified work. The shipped skill
 * text is the product interface; tables and the notice block are parsed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  PRIVATE_IDENTIFIER,
  ROOT,
  assertContracts,
  assertLinksTo,
  assertLocalLinksResolve,
  flat,
  markdownTable,
  readShipped,
} from "./skill-contract-fixture.mjs";

const PD_SKILL = "skills/planning-and-design/SKILL.md";
const PP_REF = "skills/planning-and-design/references/program-planning.md";

const LADDER = ["prototype", "vertical slice", "alpha", "beta", "complete", "demo recording"];

const NOTICE_KEYS = [
  "id",
  "root_key",
  "plan_rev",
  "class",
  "origin",
  "evidence",
  "affected",
  "urgency",
  "remedy",
  "decider",
  "continues",
  "corroborating",
  "status",
];
const NOTICE_CLASSES = [
  "MISSING_INFO",
  "UNVALIDATED_ASSUMPTION",
  "PREDICTED_RISK",
  "DEMONSTRATED_BLOCKER",
  "PLAN_DEFECT",
  "PRODUCT_DEFECT",
  "RESOURCE_CONTENTION",
  "SCOPE_CHANGE_REQUEST",
];
const NOTICE_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "EXPIRED_SUPERSEDED"];

/**
 * Top-level keys and their raw values from the fenced block holding `root_key`.
 * @param {string} text
 * @returns {Map<string, string>}
 */
function noticeBlock(text) {
  const blocks = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const block = blocks.find((b) => /^root_key\s*:/m.test(b)) ?? "";
  /** @type {Map<string, string>} */
  const keys = new Map();
  for (const line of block.split(/\r?\n/)) {
    for (const m of line.matchAll(/(?:^|;\s*)([a-z_]+)\s*:\s*([^;#]*)/g)) keys.set(m[1], m[2].trim());
  }
  return keys;
}

describe("program-planning", () => {
  it("PP-01 the program-planning reference ships and final Planning and Design links it", () => {
    readShipped(PP_REF);
    assertLinksTo(PD_SKILL, PP_REF);
  });

  it("PP-02 planning stays plan-only and every acceptance item maps to work, evidence, or deferral", () => {
    const text = flat(readShipped(PP_REF));
    assertContracts(
      text,
      {
        "never write product code or change scope": /never write product code[^.]*change scope/,
        "issues or milestones need the owner's yes": /(issues|milestones)[^.]*without (the )?owner/,
        "missing input needs evidence, never invented": /missing input:? needs_(more_)?evidence\.? never invent|missing input[^.]*never invent/,
        "map every requirement and AC to a package, existing evidence, or owner deferral":
          /map every (req|requirement)[^.]*(ac|acceptance)[^.]*package, existing evidence,? or (an )?owner deferral/,
        "a silent spec gets MISSING_INFO": /silent spec[^.]*missing_info/,
      },
      PP_REF
    );
  });

  it("PP-03 the milestone ladder is ordered and each rung names what it proves and leaves unproven", () => {
    const raw = readShipped(PP_REF);
    const { headers, rows } = markdownTable(raw, /Proves/i);
    assert.ok(headers.length > 0, `${PP_REF} must carry a milestone ladder table with a Proves column`);
    const proves = headers.findIndex((h) => /^proves/.test(h));
    const unproven = headers.findIndex((h) => /unproven/.test(h));
    assert.ok(proves > 0 && unproven > 0, `ladder headers: ${JSON.stringify(headers)}`);
    const names = rows.map((r) => r[0].toLowerCase());
    assert.deepEqual(names, LADDER, `${PP_REF} ladder rungs must be ${LADDER.join(" → ")}`);
    for (const r of rows) {
      assert.ok(r[proves] && r[unproven], `rung ${r[0]} must state proves and leaves-unproven`);
    }
    const demo = rows.find((r) => r[0].toLowerCase() === "demo recording");
    assert.match(flat(demo[unproven]), /never verification evidence/);
    assertContracts(
      flat(raw),
      {
        "each milestone names its integration owner": /each milestone names its integration owner/,
        "each milestone ends with a verification gate": /ends? with a verification gate/,
        "a slice or recording never proves completion": /slice or (a )?recording never proves completion/,
      },
      PP_REF
    );
  });

  it("PP-04 dependency domains fix which edges are hard, promoted, or leveled", () => {
    const { headers, rows } = markdownTable(readShipped(PP_REF), /Domain/i);
    assert.ok(headers.length > 0, `${PP_REF} must carry a dependency-domain table`);
    const edge = headers.findIndex((h) => /^edge/.test(h));
    assert.ok(edge > 0, `domain headers: ${JSON.stringify(headers)}`);
    const byDomain = new Map(rows.map((r) => [r[0].toLowerCase(), r[edge].toLowerCase()]));
    assert.match(byDomain.get("interface") ?? "", /^hard/, "interface edges are hard");
    assert.match(byDomain.get("risk probe") ?? "", /soft[^|]*promoted to hard/, "risk probes are soft, promoted to hard");
    assert.match(byDomain.get("owner gate") ?? "", /^hard/, "owner gates are hard");
    assert.match(byDomain.get("resource") ?? "", /level/, "resources are leveled");
  });

  it("PP-05 the graph locks interfaces before fan-out and parallelizes only disjoint work", () => {
    const text = flat(readShipped(PP_REF));
    assertContracts(
      text,
      {
        "hard vs preferred edges": /hard vs\.? preferred edges|hard (and|or) preferred edges/,
        "interface task before fan-out": /interface task before fan-out/,
        "risk probes before bulk work": /risk probes? before bulk/,
        "one integration task closes each fan-out": /one integration task closes each fan-out/,
        "parallel only with baselined interface, disjoint write and lock sets, separate worktrees":
          /parallel only with a baselined interface, disjoint write and lock sets, separate worktrees/,
      },
      PP_REF
    );
  });

  it("PP-06 estimates are bottom-up O/M/P distributions with a recorded basis and P80 commitment", () => {
    const text = flat(readShipped(PP_REF));
    assertContracts(
      text,
      {
        "O/M/P per bucket": /o\/m\/p per bucket/,
        "bottom-up from the task's steps": /bottom-up from the task'?s steps/,
        "every non-done task records estimate_basis": /non-done task records estimate_basis/,
        "cold-start priors are assumptions": /cold[- ]start (priors are assumptions|\(assumption)/,
        "estimate is a distribution": /estimate is a distribution/,
        "appetite is the owner's ceiling": /appetite is the owner'?s ceiling/,
        "commitment is P80": /commitment is p80/,
        "never state confidence the forecast did not compute": /never state confidence the forecast did not compute/,
        "review/repair estimate is never zero": /review_repair[^.]*never zero/,
      },
      PP_REF
    );
  });

  it("PP-07 every package contract names its traced parents, edges, interfaces, writes, and verification", () => {
    const text = flat(readShipped(PP_REF));
    for (const field of ["parents", "deps", "writes", "consumes", "produces", "locks", "slots", "reviews_max", "hill"]) {
      assert.match(text, new RegExp(`\\b${field}\\b`), `${PP_REF} package contract must name ${field}`);
    }
    assertContracts(
      text,
      {
        "verification with expected red before and green after": /expected red before[^.]*expected green after/,
        "escalation names the notice class": /escalation[^.]*notice[^.]*class/,
        "states include paused and done with actual and reviews_used":
          /paused[^.]*done[^.]*(verified)?[^.]*actual[^.]*reviews_used/,
      },
      PP_REF
    );
  });

  it("PP-08 the notice schema carries dedupe key, plan revision, class, corroboration, and status", () => {
    const raw = readShipped(PP_REF);
    const keys = noticeBlock(raw);
    const missing = NOTICE_KEYS.filter((k) => !keys.has(k));
    assert.deepEqual(missing, [], `${PP_REF} notice block is missing keys: ${missing.join(", ")}`);
    const classes = keys.get("class") ?? "";
    for (const c of NOTICE_CLASSES) assert.ok(classes.includes(c), `notice class must include ${c}`);
    const statuses = keys.get("status") ?? "";
    for (const s of NOTICE_STATUSES) assert.ok(statuses.includes(s), `notice status must include ${s}`);
    assert.match(keys.get("decider") ?? "", /worker[^|]*\|\s*planner\s*\|\s*owner/);
  });

  it("PP-09 notices dedupe by root key, count corroboration, bind to plan_rev, and expire", () => {
    const text = flat(readShipped(PP_REF));
    assertContracts(
      text,
      {
        "dedupe by root key": /dedupe by root key/,
        "count corroboration": /count corroboration/,
        "bind to plan_rev": /bind to plan_rev/,
        "expire on state change": /expire on state change/,
        "a halt pauses only its subgraph": /halt pauses only its subgraph/,
        "execution evidence beats claims": /execution evidence beats claims/,
        "scope changes route to the owner": /scope[^.]*owner/,
      },
      PP_REF
    );
  });

  it("PP-10 replanning takes the smallest of seven ordered tiers, and only tier 7 rebaselines", () => {
    const text = flat(readShipped(PP_REF));
    assert.match(text, /smallest tier/, `${PP_REF} must take the smallest tier`);
    const tiers = [
      [1, /local ruling/],
      [2, /resequence/],
      [3, /split or merge unfinished/],
      [4, /recalibrate/],
      [5, /plan defect[^.;]*version the interface/],
      [6, /milestone replan/],
      [7, /rebaseline[^.;]*needs_owner_decision/],
    ];
    let from = text.search(/smallest tier/);
    for (const [n, re] of tiers) {
      const rest = text.slice(from);
      const marker = new RegExp(`(tier )?${n}[.):]? `).exec(rest);
      assert.ok(marker, `${PP_REF} must number tier ${n}`);
      const body = rest.slice(marker.index);
      const m = re.exec(body);
      assert.ok(m, `${PP_REF} tier ${n} must match ${re}`);
      from += marker.index + m.index;
    }
  });

  it("PP-11 replanning pauses only the forward subgraph and never reopens verified work", () => {
    const text = flat(readShipped(PP_REF));
    assertContracts(
      text,
      {
        "pause the forward subgraph; the rest continue": /pause[^.]*forward subgraph[^.]*rest continue/,
        "paused work is committed and checked": /paused work commits?[^.]*runs? its checks/,
        "split verified part from a delta inheriting only the remaining allowance":
          /verified part[^.]*delta inheriting only the remaining allowance/,
        "fresh allowance only from milestone reserve": /fresh allowance only from (the )?milestone reserve/,
        "never edit, re-estimate or restart done work unless a defect is shown":
          /never edit, re-estimate,? or restart done work unless a defect is shown/,
        "change how a criterion is met, never what it requires": /change how a criterion is met, never what it requires/,
        "new plan_rev for the replan": /new plan_rev/,
        "affected delegates are briefed fresh and echo plan_rev": /brief each affected delegate fresh[^.]*echoes? plan_rev/,
      },
      PP_REF
    );
  });

  it("PP-12 the reference resolves its links, ships any script it names, and stays public", () => {
    assertLocalLinksResolve(PP_REF);
    const raw = readShipped(PP_REF);
    assert.doesNotMatch(raw, PRIVATE_IDENTIFIER, PP_REF);
    for (const m of raw.matchAll(/\b((?:scripts|tools|hooks)\/[A-Za-z0-9_./-]+\.(?:py|cjs|mjs|js|sh))\b/g)) {
      const fromSkill = path.join(ROOT, "skills/planning-and-design", m[1]);
      const fromRoot = path.join(ROOT, m[1]);
      assert.ok(existsSync(fromSkill) || existsSync(fromRoot), `${PP_REF} names unshipped command ${m[1]}`);
    }
  });
});
