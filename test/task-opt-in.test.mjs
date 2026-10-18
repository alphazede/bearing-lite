/** Explicit current-task activation: ordinary/native sessions must be inert. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const activation = require('../hooks/activation.cjs');
const host = require('../hooks/com.anthropic.claude-code/host.cjs');
const lock = require('../hooks/orchestrator-write-lock.cjs');
const sync = require('../hooks/git-sync.cjs');
const te = require('../hooks/te-host.cjs');
const assurance = require('../hooks/assurance-dispatch.cjs');
function fixture(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'bearing-opt-in-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
function plan(cwd, { session_id = 'current', owner_requested = true, status = 'IN_PROGRESS', task_id = 'current-task' } = {}) {
  writeFileSync(path.join(cwd, 'plan.md'), `# Existing visible project plan\n- journey: example\n- bearing_session: ${JSON.stringify({ session_id, owner_requested, task_id })}\n### task_id: old\n- status: COMPLETE\n- assigned_role: Reviewer\n### task_id: current-task\n- status: ${status}\n- assigned_role: Implementer\n- next_action: finish current work\n- required_assurance: none\n`);
}
const event = cwd => ({ cwd, session_id: 'current', hook_event_name: 'SessionStart' });

test('ordinary activation and native SessionStart stay quiet without a request', t => {
  const cwd = fixture(t);
  assert.doesNotMatch(JSON.stringify(activation.evaluate({})), /Invoke|router manually/i);
  assert.deepEqual(host.handle(event(cwd)), {});
  const run = spawnSync(process.execPath, [path.join(ROOT, 'hooks/com.anthropic.claude-code/host.cjs')], { input: JSON.stringify(event(cwd)), encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.deepEqual(JSON.parse(run.stdout), {});
  assert.equal(lock.evaluate({ cwd, paths: ['docs/coe/example.md'] }).verdict, 'ALLOW');
});

test('old plans, roles, profiles and envelope flags do not request Bearing', t => {
  const cwd = fixture(t);
  writeFileSync(path.join(cwd, 'plan.md'), '# Old plan\n- journey: old\n### task_id: old\n- status: IN_PROGRESS\n- assigned_role: Reviewer\n');
  writeFileSync(path.join(cwd, 'profiles.json'), '{"roles":{"orchestrator":{"enabled":true}}}');
  assert.deepEqual(host.handle({ ...event(cwd), role: 'orchestrator', bearing_requested: true }), {});
  assert.equal(lock.evaluate({ ...event(cwd), role: 'orchestrator', paths: ['seit.json'] }).verdict, 'ALLOW');
});

for (const patch of [{ session_id: 'another-session' }, { owner_requested: false }, { status: 'COMPLETE' }, { status: 'CANCELLED' }, { task_id: 'missing' }]) {
  test(`stale/cross-session binding stays inactive: ${JSON.stringify(patch)}`, t => {
    const cwd = fixture(t); plan(cwd, patch);
    assert.deepEqual(host.handle(event(cwd)), {});
    assert.equal(lock.evaluate({ ...event(cwd), paths: ['docs/coe/example.md'] }).verdict, 'ALLOW');
    assert.deepEqual(sync.handle({ ...event(cwd), hook_event_name: 'Stop' }), {});
  });
}

test('explicit current task retains active ownership, correct task selection and stop re-entry', t => {
  const cwd = fixture(t); plan(cwd);
  assert.match(host.handle(event(cwd)).hookSpecificOutput.additionalContext, /context_ready/);
  assert.equal(lock.evaluate({ ...event(cwd), paths: ['seit.json'] }).verdict, 'DENY_DISPATCH');
  assert.equal(lock.evaluate({ ...event(cwd), role: 'test_engineer', paths: ['seit.json'] }).verdict, 'ALLOW');
  const native = input => lock.handle({ ...event(cwd), hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(cwd, 'seit.json') }, ...input }, { host: 'codex' });
  assert.equal(native({}).hookSpecificOutput.permissionDecision, 'deny');
  assert.notEqual(native({ role: 'test_engineer' }).hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(host.handle({ ...event(cwd), hook_event_name: 'Stop', stop_hook_active: true }), {});
  assert.deepEqual(sync.handle({ ...event(cwd), hook_event_name: 'Stop', stop_hook_active: true }), {});
  mkdirSync(path.join(cwd, 'child'));
  assert.equal(lock.evaluate({ ...event(path.join(cwd, 'child')), paths: ['../seit.json'] }).verdict, 'DENY_DISPATCH');
});

test('ordinary Stop neither fetches nor fast-forwards; current-task Stop still syncs', t => {
  const root = fixture(t);
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(root, 'init', '-q', '-b', 'main', 'origin');
  const origin = path.join(root, 'origin'), cwd = path.join(root, 'checkout');
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'one');
  git(root, 'clone', '-q', origin, cwd);
  const before = git(cwd, 'rev-parse', 'HEAD');
  git(origin, 'commit', '-q', '--allow-empty', '-m', 'two');
  assert.deepEqual(sync.handle({ ...event(cwd), hook_event_name: 'Stop' }), {});
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), before);
  assert.equal(git(cwd, 'rev-parse', 'origin/main'), before, 'ordinary Stop must not fetch');
  plan(cwd);
  assert.match(sync.handle({ ...event(cwd), hook_event_name: 'Stop' }).hookSpecificOutput.additionalContext, /fast-forwarded/);
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), git(origin, 'rev-parse', 'HEAD'));
});

test('standalone selected TE remains independent of Bearing opt-in', t => {
  const cwd = fixture(t);
  const out = te.handle({ ...event(cwd), hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'test/example.test.mjs' } }, { host: 'codex', selected: true });
  assert.match(JSON.stringify(out), /typed_capability_gap/);
});


test('old assurance labels alone cannot activate a barrier; current bound assurance still requires its declaration', t => {
  const cwd = fixture(t);
  const pending = '# Project plan\n### task_id: current-task\n- status: EVIDENCE_READY\n- required_assurance: Reviewer\n';
  writeFileSync(path.join(cwd, 'plan.md'), pending);
  const input = { ...event(cwd), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo ordinary' } };
  assert.equal(assurance.handle(input, 'codex').outcome, 'INACTIVE');
  writeFileSync(path.join(cwd, 'plan.md'), `- bearing_session: ${JSON.stringify({ session_id: 'current', task_id: 'current-task', owner_requested: true })}\n` + pending);
  assert.equal(assurance.handle(input, 'codex').outcome, 'NEEDS_MORE_EVIDENCE');
  assert.equal(assurance.toWire(assurance.handle(input, 'codex'), 'codex').hookSpecificOutput.permissionDecision, 'deny');
});
