/**
 * workflow-and-delivery-efficiency: method-skill routing inside packets,
 * one durable task graph, native completion events instead of polling, and
 * the worktree/artifact storage lifecycle through coherent landing.
 * The controller surface is the Orchestrator and Coordinator skills, their
 * references, and the role-loop index; the contract may live in any of them.
 */
import { describe, it } from "node:test";
import {
  assertContracts,
  assertLocalLinksResolve,
  flat,
  markdownIn,
  readIfShipped,
  readShipped,
} from "./skill-contract-fixture.mjs";

const ORCH_SKILL = "skills/bearing-lite/SKILL.md";
const COORD_SKILL = "skills/coordinator/SKILL.md";
const ROLE_LOOPS = "skills/prompt/references/role-loops.md";

/** Every shipped controller file the workflow contract may live in. */
function controllerFiles() {
  return [
    ORCH_SKILL,
    COORD_SKILL,
    ROLE_LOOPS,
    ...markdownIn("skills/bearing-lite/references"),
    ...markdownIn("skills/coordinator/references"),
  ];
}

const controllerSurface = () => flat(controllerFiles().map(readIfShipped).join("\n"));

describe("workflow-and-delivery-efficiency", () => {
  it("WD-01 packets name the applicable method skills, verified at receipt", () => {
    assertContracts(
      controllerSurface(),
      {
        "packets name applicable method skills": /applicable (method )?skill(s| names)[^.]*(packet|assignment)|(packet|assignment)[^.]*applicable (method )?skills/,
        "selection is verified at receipt": /(verify|verified|check)[^.]*(selection|skills)[^.]*at receipt|at receipt[^.]*verif/,
        "selected, loaded and performed are kept separate": /selected, loaded,? and performed/,
        "a missing skill or prerequisite is a visible gap, never substituted":
          /missing (method )?skills?[^.]*(visible|typed) gap|silently substitute another method/,
        "missing method must never substitute": /never silently substituted with another method/,
        "routing grants no fan-out, review, or publication authority":
          /routing (never )?grants? no[^.]*(fan-out|review)[^.]*publication|routing never grants[^.]*(fan-out|review)/,
      },
      "controller surface"
    );
  });

  it("WD-02 one authoritative task graph is kept durably and completed work is never redispatched", () => {
    assertContracts(
      controllerSurface(),
      {
        "one authoritative task graph": /one authoritative task graph/,
        "no parallel plan authority or second graph": /(no|do not create) (parallel plan authorit|second plan graph)/,
        "record identity, candidate, status, completed evidence and remaining work":
          /assignment identity, candidate, status, completed evidence,? and remaining work/,
        "never restart completed assignments after compaction or resume":
          /(do not|never)[^.]*(restart|redispatch|relaunch) completed (assignments|work)[^.]*(compact|resum|interrupt)|(do not|never)[^.]*redispatch completed work/,
      },
      "controller surface"
    );
  });

  it("WD-03 completion is consumed from native events once, without polling or timer loops", () => {
    for (const rel of [ORCH_SKILL, COORD_SKILL]) {
      assertContracts(
        flat(readShipped(rel)),
        {
          "native completion notifications": /native (response |completion )?notifications/,
          "consume each response once": /(consume each response once|read its result\/log once)/,
          "never poll logs, processes, status, or worktrees": /never poll logs, processes,/,
          "no timer or sleep loops": /tim(er|ers)[^.]*loops/,
          "unavailable events return WAITING_ON": /unavailable, return waiting_on/,
        },
        rel
      );
    }
    assertContracts(flat(readShipped(ROLE_LOOPS)), { "no loop authorizes polling": /no loop authorizes polling/ }, ROLE_LOOPS);
  });

  it("WD-04 storage maintenance runs at intake/resume, wave boundaries, and closeout", () => {
    assertContracts(
      controllerSurface(),
      {
        "intake/resume, wave boundaries and closeout": /intake\/resume, wave boundaries,? and closeout/,
        "track worktrees, temporary outputs and evidence": /worktree[^.]*temporary (build )?output[^.]*evidence/,
        "owner, size and remove/retain/unresolved disposition": /owner, size,? and remove\/retain\/unresolved disposition/,
        "verify merge proof, local contents and live references before removal":
          /merge proof[^.]*local contents[^.]*(live )?references/,
        "preserve required evidence and dirty or unmerged work": /preserve required evidence and dirty or unmerged work/,
        "report reclaimed space and retention holds": /reclaimed space[^.]*retention holds?/,
        "a merged PR alone does not complete storage closeout": /merged pr alone does not complete (storage )?closeout|merge alone does not prove cleanup/,
        "bounded to assigned paths, no whole-workspace purge": /keep this bounded to assigned paths, never a whole-workspace purge/,
      },
      "controller surface"
    );
  });

  it("WD-05 a wave hands retained storage to the Orchestrator and deletes nothing it does not own", () => {
    assertContracts(
      controllerSurface(),
      {
        "retain integration inputs until the Orchestrator accepts the handoff":
          /retain integration inputs until the orchestrator accepts (the )?handoff/,
        "each retained path has an owner, reason and release event": /retained path[^.]*owner, (a )?reason,? and (a )?release event/,
        "never remove another wave's files": /(do not|never) remove another wave'?s files/,
        "child COMPLETE is not permission to delete integration evidence":
          /(not|never)[^.]*complete[^.]*permission to delete integration evidence|complete[^.]*not[^.]*permission to delete integration evidence/,
      },
      "controller surface"
    );
  });

  it("WD-06 work lands as coherent outcomes and orchestration ends at verified delivery", () => {
    assertContracts(
      controllerSurface(),
      {
        "prefer coherent outcomes over tiny handoffs": /prefer coherent outcomes over tiny handoffs/,
        "orchestration does not end at worker handoff or a draft PR":
          /does not end at (a )?worker handoff or a draft pr/,
        "clean merged resources after resolving live references": /clean merged resources after resolving live references/,
      },
      "controller surface"
    );
  });

  it("WD-07 every controller file resolves its local links", () => {
    for (const rel of controllerFiles()) assertLocalLinksResolve(rel);
  });
});
