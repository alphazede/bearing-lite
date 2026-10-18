"use strict";

// Current-task opt-in lives in the existing visible project plan, never global config.
const fs = require("node:fs");
const path = require("node:path");
const text = value => typeof value === "string" && value.trim() ? value.trim() : null;
const session = input => text(input?.conversation_id) || text(input?.session_id) || text(input?.sessionId);
const STATES = new Set(["PROPOSED", "READY", "WAITING_ON", "IN_PROGRESS", "EVIDENCE_READY", "VALIDATING", "REVIEWING", "ACCEPTANCE", "CORRECTION_REQUIRED", "OWNER_DECISION_REQUIRED"]);

/** Match the native session to an explicitly requested, nonterminal task. No writes. */
function binding(input) {
  const identity = session(input);
  if (!identity) return null;
  try {
    let root = fs.realpathSync(text(input.cwd) || text(input.workspaceRoot) || process.cwd());
    for (;;) {
      const matches = [];
      const files = fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isFile() && /\.(md|markdown)$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of files) {
        const file = path.join(root, entry.name);
        const raw = fs.readFileSync(file, "utf8");
        for (const line of raw.matchAll(/^-\s*bearing_session:\s*(.+)$/gm)) {
          let selected;
          try { selected = JSON.parse(line[1]); } catch { continue; }
          if (selected?.owner_requested !== true || selected.session_id !== identity || !text(selected.task_id)) continue;
          const tasks = raw.split(/^###\s*task_id:\s*(\S+)\s*$/m);
          for (let i = 1; i < tasks.length; i += 2) {
            if (tasks[i] !== selected.task_id) continue;
            const task = { task_id: tasks[i] };
            for (const field of tasks[i + 1].matchAll(/^-\s*([a-z_]+):\s*(.*)$/gm)) task[field[1]] = field[2].trim();
            if (STATES.has(task.status)) matches.push({ root, file, raw, task });
          }
        }
      }
      if (matches.length) return matches.length === 1 ? matches[0] : null;
      if (fs.existsSync(path.join(root, ".git")) || path.dirname(root) === root) return null;
      root = path.dirname(root);
    }
  } catch { return null; }
}
module.exports = { binding, session };
