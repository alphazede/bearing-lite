/** Real visible bindings for active-workflow tests; no production activation bypass. */
import { after } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dirs = [];
let fallback;
after(() => dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })));
export function withTask(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  if (!fallback) { fallback = mkdtempSync(path.join(tmpdir(), 'bearing-active-hook-')); dirs.push(fallback); writeFileSync(path.join(fallback, '.git'), 'owned test root'); }
  const cwd = input.cwd && path.resolve(input.cwd) !== process.cwd() ? input.cwd : fallback;
  const session_id = input.conversation_id || input.session_id || input.sessionId || 'active-test-session';
  const file = path.join(cwd, 'task-opt-in.md');
  const binding = `- bearing_session: ${JSON.stringify({ session_id, owner_requested: true, task_id: 'hook-test-task' })}\n`;
  const old = existsSync(file) ? readFileSync(file, 'utf8') : '# Active hook fixture\n- journey: hook-test\n### task_id: hook-test-task\n- status: IN_PROGRESS\n- assigned_role: Implementer\n- next_action: check hook behavior\n';
  if (!old.includes(binding)) writeFileSync(file, binding + old);
  return { ...input, cwd, ...(input.conversation_id || input.session_id || input.sessionId ? {} : { session_id }) };
}
export function boundHook(hook) {
  return { ...hook,
    ...(hook.evaluate ? { evaluate: input => hook.evaluate(withTask(input)) } : {}),
    ...(hook.handle ? { handle: (input, opts) => hook.handle(withTask(input), opts) } : {}),
  };
}
export function bindPlan(input) {
  if (!input || typeof input !== 'object' || !input.cwd) return input;
  const file = ['plan.md', 'PLAN.md'].map(name => path.join(input.cwd, name)).find(file => existsSync(file));
  if (!file) return input;
  const raw = readFileSync(file, 'utf8');
  const task_id = raw.match(/^###\s*task_id:\s*(\S+)/m)?.[1];
  if (!task_id) return input;
  const session_id = input.conversation_id || input.session_id || input.sessionId;
  const line = `- bearing_session: ${JSON.stringify({ owner_requested: true, session_id, task_id })}\n`;
  if (!raw.includes(line)) writeFileSync(file, line + raw);
  return input;
}
