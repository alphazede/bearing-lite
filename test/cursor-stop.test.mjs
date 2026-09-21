/**
 * Cursor stop wire: advice is context; a follow-up is only a continue request.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { project } = createRequire(import.meta.url)(path.join(ROOT, "hooks/cursor-stop.cjs"));

describe("cursor stop wire", () => {
  it("keeps stop advice as additional_context", () => {
    assert.deepEqual(
      project({
        hookSpecificOutput: {
          hookEventName: "Stop",
          additionalContext: "Bearing Lite closeout: ADVISE",
        },
      }),
      { additional_context: "Bearing Lite closeout: ADVISE" }
    );
  });

  it("sends followup_message only when the hook asks to continue", () => {
    assert.deepEqual(
      project({
        decision: "block",
        reason: "still running",
        hookSpecificOutput: { hookEventName: "Stop", additionalContext: "still running" },
      }),
      { followup_message: "still running" }
    );
  });

  it("keeps continue:false as context", () => {
    assert.deepEqual(
      project({
        continue: false,
        stopReason: "gate failed",
        hookSpecificOutput: { hookEventName: "Stop" },
      }),
      { additional_context: "gate failed" }
    );
  });

  it("leaves session advice unchanged", () => {
    const body = {
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "hi" },
    };
    assert.equal(project(body), body);
  });

  it("projects host.cjs stop stdout when --host=cursor", () => {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, "hooks/com.anthropic.claude-code/host.cjs"), "--host=cursor"],
      {
        input: JSON.stringify({ hook_event_name: "Stop", cwd: ROOT }),
        encoding: "utf8",
      }
    );
    const parsed = JSON.parse(out);
    assert.equal(parsed.followup_message, undefined);
    assert.equal(parsed.hookSpecificOutput, undefined);
    if (parsed.additional_context) {
      assert.match(parsed.additional_context, /ADVISE|closeout|UNAVAILABLE/);
    }
  });
});
