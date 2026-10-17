/** #209/#210: real hook CLI/filesystem claims; provider substitute is an owner-requested local sentinel.
 * Resource group: none; unique owned temp roots, no ports/services or provider calls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const budget = require('../hooks/assurance-budget.cjs');
const hook = path.join(ROOT, 'hooks/assurance-dispatch.cjs');
const json = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
function fixture(t, { parallel = false, qualification = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), `bearing-dispatch-${process.pid}-${process.hrtime.bigint()}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sentinel = path.join(dir, 'provider-sentinel.cjs');
  writeFileSync(sentinel, "require('node:fs').appendFileSync(process.argv[2], 'started\\n');\n");
  const launch = id => ({ tool_name: 'Bash', tool_input: { command: `node '${sentinel}' '${path.join(dir, id + '.marker')}'` } });
  const slot = (id, kind = 'review', group = id) => ({ id, kind, group, unit_id: 'W1', candidate: 'candidate-a', scope: 'issue-209', ...launch(id) });
  const slots = [slot('review-a', 'review', 'round-1'), slot('excess'), slot('repair', 'repair'), slot('repair-extra', 'repair'), slot('close', 'deterministic')];
  if (parallel) slots.push(slot('review-b', 'review', 'round-1'));
  if (qualification) slots.push({ ...slot('qualify', 'qualification'), authority_id: 'qualification-1', subject: 'native hook sentinel' });
  const declaration = { waves: [{ id: 'W1' }], journey_settings: { lifecycle_id: 'J', assurance_dispatch: { slots } } };
  const record = { journey: 'J', units: [{ unit_kind: 'wave', unit_id: 'W1', assurance_rounds: 0, assurance_repairs: 0, receipts: [{ kind: 'gate_chain', unit_id: 'W1', verdict: 'PASS' }] }], dispatch_log: [], amendments: [] };
  const declaration_path = path.join(dir, 'implementation.json');
  const task_record_path = path.join(dir, 'task-record.json');
  json(declaration_path, declaration); json(task_record_path, record);
  const bind = () => writeFileSync(path.join(dir, 'plan.md'), `# Visible task plan\n- assurance_dispatch: ${JSON.stringify({ declaration_path: 'implementation.json', declaration_sha256: hash(declaration_path), task_record_path: 'task-record.json', journey: 'J' })}\n`);
  bind();
  return { dir, declaration, record, declaration_path, task_record_path, slots, bind,
    read: () => JSON.parse(readFileSync(task_record_path)), save: () => json(task_record_path, record),
    request: { declaration_path, task_record_path, journey: 'J', assurance_unit: 'W1', unit_kind: 'wave' } };
}
function envelope(f, id, extra = {}) {
  const slot = f.slots.find(s => s.id === id);
  return { hook_event_name: 'PreToolUse', cwd: f.dir, ...slot, ...extra };
}
function run(f, input, host = 'claude-code') {
  if (host === 'cursor' && input.tool_name === 'Bash') input = { ...input, hook_event_name: 'beforeShellExecution' };
  const r = spawnSync(process.execPath, [hook, `--host=${host}`], { cwd: f.dir, input: JSON.stringify(input), encoding: 'utf8', timeout: 15000 });
  assert.equal(r.error, undefined); assert.equal(r.status, 0, r.stderr);
  return { wire: JSON.parse(r.stdout), detail: JSON.parse(r.stderr) };
}
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v !== null && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const denied = r => r.wire.hookSpecificOutput?.permissionDecision === 'deny' || r.wire.permission === 'deny' || r.wire.permissionDecision === 'deny';
function launch(f, id, host) {
  const r = run(f, envelope(f, id), host);
  if (!denied(r)) {
    const p = spawnSync('/bin/sh', ['-c', f.slots.find(s => s.id === id).tool_input.command], { cwd: f.dir, timeout: 15000 });
    assert.equal(p.status, 0);
  }
  return r;
}
function concurrent(f, id) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hook], { cwd: f.dir, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('claim deadline; ' + err)); }, 15000);
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ wire: JSON.parse(out), detail: JSON.parse(err) }) : reject(Error(`${code}: ${err}`)); });
    child.stdin.end(JSON.stringify(envelope(f, id)));
  });
}
test('209 empty/corrupt required records never mean spent zero', t => {
  const f = fixture(t);
  for (const bad of [{}, { journey: 'J' }, { journey: 'J', units: null }]) {
    json(f.task_record_path, bad);
    assert.equal(budget.evaluateAssuranceBudget(f.request).outcome, 'NEEDS_MORE_EVIDENCE');
  }
});
test('209 canonical wave kind defeats phase alias against a spent record', t => {
  const f = fixture(t); f.record.units[0].assurance_rounds = 1; f.save();
  assert.equal(budget.evaluateAssuranceBudget({ ...f.request, unit_kind: 'phase' }).outcome, 'HALT');
});
for (const host of ['claude-code', 'codex', 'cursor', 'copilot']) test(`209 ${host} bound allow/deny sentinel through registered CLI (component replay)`, t => {
  const f = fixture(t);
  assert.equal(denied(launch(f, 'review-a', host)), false);
  assert.equal(existsSync(path.join(f.dir, 'review-a.marker')), true);
  assert.equal(denied(launch(f, 'excess', host)), true);
  assert.equal(existsSync(path.join(f.dir, 'excess.marker')), false);
  assert.equal(f.read().units[0].assurance_rounds, 1);
});
test('209 mandatory registration covers every tool including native agent dispatch', () => {
  for (const [file, events] of [['hooks/hooks.json', ['PreToolUse']], ['hooks/com.cursor/hooks.json', ['preToolUse', 'beforeShellExecution']], ['com.github.copilot/hooks/hooks.json', ['PreToolUse']]]) {
    const m = JSON.parse(readFileSync(path.join(ROOT, file)));
    for (const event of events) {
      const registrations = m.hooks[event].filter(e => JSON.stringify(e).includes('assurance-dispatch.cjs'));
      assert.equal(registrations.length, 1, `${file}:${event}`);
      assert.ok(!registrations[0].matcher || registrations[0].matcher === '*');
    }
  }
});
test('209 two simultaneous first launches consume one slot once', async t => {
  const f = fixture(t);
  const results = await Promise.all([concurrent(f, 'review-a'), concurrent(f, 'review-a')]);
  assert.equal(results.filter(r => !denied(r)).length, 1);
  assert.equal(f.read().units[0].assurance_rounds, 1);
  assert.equal(f.read().dispatch_log.length, 1);
});
test('209 authorized fixed parallel group is one round; no join, retry or candidate reset', async t => {
  const f = fixture(t, { parallel: true });
  const results = await Promise.all([concurrent(f, 'review-a'), concurrent(f, 'review-b')]);
  assert.equal(results.filter(r => !denied(r)).length, 2);
  assert.equal(f.read().units[0].assurance_rounds, 1);
  for (const id of ['review-a', 'review-b', 'excess']) assert.equal(denied(run(f, envelope(f, id))), true);
  for (const extra of [{ candidate: 'b' }, { model: 'b', harness: 'b', session_id: 'new', resumed: true }, { kind: 'qualification', role: 'unrelated', activity: 'status' }, { unit_kind: 'phase' }]) {
    assert.equal(denied(run(f, envelope(f, 'review-a', extra))), true);
  }
});
test('209 missing/invalid state, renamed packets and asserted authority deny before launch', t => {
  for (const bad of ['missing', '{}', '{broken', JSON.stringify({ journey: 'OTHER', units: [] })]) {
    const f = fixture(t);
    if (bad === 'missing') rmSync(f.task_record_path); else writeFileSync(f.task_record_path, bad);
    assert.equal(denied(launch(f, 'review-a')), true, bad);
  }
  const f = fixture(t);
  const forged = envelope(f, 'review-a', { tool_input: { command: 'echo renamed' }, owner_approved: true, qualification: true });
  assert.equal(denied(run(f, forged)), true);
  f.declaration.waves[0].name = 'changed frozen bytes'; json(f.declaration_path, f.declaration);
  assert.equal(denied(run(f, envelope(f, 'review-a'))), true);
});
test('209 record counter reset and pending transport do not reopen a launch', t => {
  const f = fixture(t); assert.equal(denied(run(f, envelope(f, 'review-a'))), false);
  const record = f.read(); record.units[0].assurance_rounds = 0; json(f.task_record_path, record);
  assert.equal(denied(run(f, envelope(f, 'excess'))), true);
  record.units[0].assurance_rounds = 1; record.dispatch_log[0].result = 'not_run'; json(f.task_record_path, record);
  assert.equal(denied(run(f, envelope(f, 'review-a'))), true);
  assert.equal(denied(run(f, envelope(f, 'repair'))), true);
});
test('209 repair once and deterministic closure never start another general review', t => {
  const f = fixture(t);
  assert.equal(denied(run(f, envelope(f, 'review-a'))), false);
  let record = f.read(); record.dispatch_log[0].result = 'REPAIR_REQUIRED'; json(f.task_record_path, record);
  assert.equal(denied(run(f, envelope(f, 'repair'))), false);
  assert.equal(denied(run(f, envelope(f, 'repair-extra'))), true);
  record = f.read(); record.dispatch_log[1].result = 'PASS'; json(f.task_record_path, record);
  assert.equal(denied(launch(f, 'close')), false);
  record = f.read(); record.dispatch_log[2].result = 'PASS'; record.units[0].deterministic_gate = 'PASS'; json(f.task_record_path, record);
  assert.equal(denied(launch(f, 'excess')), true);
  assert.equal(existsSync(path.join(f.dir, 'excess.marker')), false);
  assert.equal(record.units[0].assurance_rounds, 1); assert.equal(record.units[0].assurance_repairs, 1);
});
test('209 unbound ordinary work stays open; unsupported host is typed, never enforced', t => {
  const f = fixture(t); rmSync(path.join(f.dir, 'plan.md'));
  assert.deepEqual(run(f, envelope(f, 'review-a')).wire, {});
  f.bind(); const result = run(f, envelope(f, 'review-a'), 'pi');
  assert.equal(result.detail.outcome, 'NEEDS_MORE_EVIDENCE'); assert.equal(result.detail.reason, 'host_enforcement_unavailable');
});
// Amendment and qualification authority use the existing visible authority envelope; tool flags grant nothing.
function authority(f, action, id) {
  const p = path.join(f.dir, id + '.json');
  json(p, { id, state: 'active', effective: true, granting_owner_decisions: [id], approval_receipt: { actor: 'owner', decision_id: id }, allowed: { actions: [action], scope: ['issue-209'], paths: [] }, subject: { journey: 'J', unit_id: 'W1', candidate: 'candidate-a', [action]: action === 'assurance_budget_amendment' ? { additional_rounds: 1, additional_repairs: 0, slot_ids: ['excess'] } : { subject: 'native hook sentinel', launch_sha256: createHash('sha256').update(stable({ tool_name: f.slots.find(s => s.id === 'qualify').tool_name, tool_input: f.slots.find(s => s.id === 'qualify').tool_input })).digest('hex') } }, expiry_conditions: ['scope_change'], prohibited: { actions: [], scope: [], paths: [] } });
  return p;
}
test('209 bounded amendment appends exact additional allowance without erasing expenditure', t => {
  const f = fixture(t); run(f, envelope(f, 'review-a'));
  const a = { id: 'amend-1', unit_id: 'W1', scope: 'issue-209', candidate: 'candidate-a', additional_rounds: 1, additional_repairs: 0, slot_ids: ['excess'], authority_path: authority(f, 'assurance_budget_amendment', 'amend-1') };
  const dispatch = require('../hooks/assurance-dispatch.cjs');
  assert.equal(dispatch.amend(f.dir, { ...a, authority_path: 'missing', owner_approved: true }).outcome, 'OWNER_DECISION_REQUIRED');
  assert.equal(dispatch.amend(f.dir, { ...a, additional_rounds: 100 }).outcome, 'OWNER_DECISION_REQUIRED');
  const authorityRecord = JSON.parse(readFileSync(a.authority_path));
  authorityRecord.prohibited.scope = ['issue-209']; json(a.authority_path, authorityRecord);
  assert.equal(dispatch.amend(f.dir, a).outcome, 'OWNER_DECISION_REQUIRED');
  authorityRecord.prohibited.scope = []; json(a.authority_path, authorityRecord);
  assert.equal(dispatch.amend(f.dir, a).outcome, 'PASS');
  assert.equal(f.read().units[0].assurance_rounds, 1);
  assert.equal(denied(run(f, envelope(f, 'excess'))), false);
  assert.equal(f.read().units[0].assurance_rounds, 2);
  assert.equal(f.read().amendments.length, 1);
  assert.notEqual(dispatch.amend(f.dir, a).outcome, 'PASS');
});
test('209 qualification needs bounded frozen subject and recorded owner authority, never a payload flag', t => {
  const f = fixture(t, { qualification: true });
  assert.equal(denied(run(f, envelope(f, 'qualify', { owner_approved: true }))), true);
  const a = authority(f, 'assurance_qualification', 'qualification-1');
  f.declaration.journey_settings.assurance_dispatch.authorities = [{ id: 'qualification-1', path: path.basename(a), sha256: hash(a) }];
  json(f.declaration_path, f.declaration); f.bind();
  assert.equal(denied(run(f, envelope(f, 'qualify'))), false);
  assert.equal(denied(run(f, envelope(f, 'qualify'))), true);
  assert.equal(f.read().units[0].assurance_rounds, 0);
});

test('209 documented Cursor shell envelope consumes once after generic pretool; status and writes stay available', t => {
  const f = fixture(t);
  const dispatch = require('../hooks/assurance-dispatch.cjs');
  const generic = { hook_event_name: 'preToolUse', cwd: f.dir, tool_name: 'Shell', tool_input: { command: f.slots[0].tool_input.command, working_directory: f.dir }, tool_use_id: 'owned-call' };
  assert.equal(dispatch.handle(generic, 'cursor').outcome, 'INACTIVE');
  assert.equal(f.read().units[0].assurance_rounds, 0);
  const shell = { hook_event_name: 'beforeShellExecution', cwd: f.dir, command: f.slots[0].tool_input.command, sandbox: false };
  assert.equal(dispatch.handle(shell, 'cursor').outcome, 'PASS');
  assert.equal(dispatch.handle(shell, 'cursor').outcome, 'HALT');
  for (const tool_name of ['Read', 'Write', 'Edit', 'request_user_input']) assert.equal(dispatch.handle({ ...generic, tool_name }, 'cursor').outcome, 'INACTIVE');
});
test('209 arbitrary native agent launch has no keyword or activity escape', t => {
  const f = fixture(t);
  for (const tool_name of ['Task', 'Agent', 'spawn_agent', 'mcp__provider__launch']) {
    const r = run(f, { ...envelope(f, 'review-a'), tool_name, tool_input: { prompt: 'qualification status', role: 'implementer', owner_approved: true } });
    assert.equal(denied(r), true, tool_name);
    assert.equal(f.read().dispatch_log.length, 0);
  }
});
test('209 fixed parallel group rejects cross-candidate or cross-unit membership', t => {
  for (const change of [{ candidate: 'candidate-b' }, { unit_id: 'W2' }]) {
    const f = fixture(t, { parallel: true });
    Object.assign(f.slots.find(s => s.id === 'review-b'), change);
    f.declaration.waves.push({ id: 'W2' }); json(f.declaration_path, f.declaration); f.bind();
    assert.equal(denied(run(f, envelope(f, 'review-a'))), true);
    assert.equal(f.read().dispatch_log.length, 0);
  }
});
test('209 crash-held lock refuses without launch or implicit refund', t => {
  const f = fixture(t); mkdirSync(f.task_record_path + '.lock');
  const r = run(f, envelope(f, 'review-a'));
  assert.equal(denied(r), true); assert.equal(r.detail.reason, 'task_record_lock_unavailable');
  assert.equal(f.read().dispatch_log.length, 0);
});
test('209 adoption preserves previous expenditure through an exact amendment', t => {
  const f = fixture(t);
  f.record.units[0].assurance_rounds = 1; f.save();
  const a = { id: 'amend-1', unit_id: 'W1', scope: 'issue-209', candidate: 'candidate-a', additional_rounds: 1, additional_repairs: 0, slot_ids: ['excess'], authority_path: authority(f, 'assurance_budget_amendment', 'amend-1') };
  const dispatch = require('../hooks/assurance-dispatch.cjs');
  assert.equal(dispatch.amend(f.dir, a).outcome, 'PASS');
  assert.equal(denied(run(f, envelope(f, 'excess'))), false);
  const record = f.read(); assert.equal(record.dispatch_baseline[0].assurance_rounds, 1);
  record.units[0].assurance_rounds = 1; json(f.task_record_path, record);
  assert.equal(denied(run(f, envelope(f, 'review-a'))), true);
});
test('209 required visible assurance state without binding refuses executable dispatch but keeps recovery tools open', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.dir, 'plan.md'), '# Visible task plan\n### task_id: assurance\n- status: EVIDENCE_READY\n- required_assurance: Reviewer\n');
  assert.equal(denied(run(f, envelope(f, 'review-a'))), true);
  for (const tool_name of ['Read', 'Edit', 'request_user_input']) assert.equal(denied(run(f, envelope(f, 'review-a', { tool_name }))), false);
});

for (const peer of ['PASS', 'OWNER_DECISION_REQUIRED', 'CONTRACT_FAILURE', 'not_run', 'RESERVED']) test(`209 repair F01 aggregate repair honors peer ${peer}`, t => {
  const f = fixture(t, { parallel: true });
  assert.equal(denied(run(f, envelope(f, 'review-a'))), false);
  assert.equal(denied(run(f, envelope(f, 'review-b'))), false);
  const record = f.read();
  record.dispatch_log[0].result = 'REPAIR_REQUIRED'; record.dispatch_log[1].result = peer;
  json(f.task_record_path, record);
  const r = launch(f, 'repair');
  assert.equal(denied(r), peer !== 'PASS');
  assert.equal(existsSync(path.join(f.dir, 'repair.marker')), peer === 'PASS');
  assert.equal(f.read().units[0].assurance_repairs, peer === 'PASS' ? 1 : 0);
  if (['OWNER_DECISION_REQUIRED', 'CONTRACT_FAILURE'].includes(peer)) assert.equal(r.detail.outcome, 'OWNER_DECISION_REQUIRED');
});

for (const bytes of [256 * 1024 - 1, 256 * 1024, 256 * 1024 + 1, 288240]) test(`209 repair F02 spent binding survives a ${bytes}-byte plan`, t => {
  const f = fixture(t);
  f.record.units[0].assurance_rounds = 1; f.save();
  const plan = path.join(f.dir, 'plan.md'), original = readFileSync(plan, 'utf8');
  writeFileSync(plan, original + '\n'.repeat(bytes - Buffer.byteLength(original)));
  const r = launch(f, 'review-a');
  assert.equal(denied(r), true);
  assert.equal(r.detail.reason, 'assurance_round_limit');
  assert.equal(existsSync(path.join(f.dir, 'review-a.marker')), false);
  assert.equal(f.read().units[0].assurance_rounds, 1);
});

test('209 repair F02 large required task without binding denies while large ordinary work stays open', t => {
  for (const required of [true, false]) {
    const f = fixture(t);
    const plan = required ? '### task_id: assurance\n- status: EVIDENCE_READY\n- required_assurance: Reviewer\n' : '# Ordinary work\n';
    writeFileSync(path.join(f.dir, 'plan.md'), plan + '\n'.repeat(288240));
    const r = launch(f, 'review-a');
    assert.equal(denied(r), required);
    assert.equal(existsSync(path.join(f.dir, 'review-a.marker')), !required);
    for (const tool_name of ['Read', 'Edit', 'request_user_input']) assert.equal(denied(run(f, envelope(f, 'review-a', { tool_name }))), false);
  }
});

for (const fullGroup of [false, true]) test(`209 repair F03 ${fullGroup ? 'full' : 'narrow'} amendment preserves exact parallel membership`, t => {
  const f = fixture(t, { parallel: true });
  f.record.units[0].assurance_rounds = 1; f.save();
  const slot_ids = fullGroup ? ['review-a', 'review-b'] : ['review-a'];
  const a = { id: 'amend-1', unit_id: 'W1', scope: 'issue-209', candidate: 'candidate-a', additional_rounds: 1, additional_repairs: 0, slot_ids, authority_path: authority(f, 'assurance_budget_amendment', 'amend-1') };
  const owner = JSON.parse(readFileSync(a.authority_path));
  owner.subject.assurance_budget_amendment = { additional_rounds: 1, additional_repairs: 0, slot_ids };
  json(a.authority_path, owner);
  const dispatch = require('../hooks/assurance-dispatch.cjs');
  assert.equal(dispatch.amend(f.dir, a).outcome, 'PASS');
  assert.equal(denied(launch(f, 'review-a')), false);
  assert.equal(denied(launch(f, 'review-b')), !fullGroup);
  assert.equal(existsSync(path.join(f.dir, 'review-b.marker')), fullGroup);
  assert.equal(denied(run(f, envelope(f, 'review-a'))), true);
  assert.equal(f.read().units[0].assurance_rounds, 2);
  assert.equal(f.read().dispatch_baseline[0].assurance_rounds, 1);
  assert.deepEqual(f.read().amendments[0].slot_ids, slot_ids);
  const record = f.read();
  record.dispatch_log.find(e => e.slot_id === 'review-a').result = 'REPAIR_REQUIRED';
  json(f.task_record_path, record);
  if (fullGroup) {
    assert.equal(denied(run(f, envelope(f, 'repair'))), true);
    record.dispatch_log.find(e => e.slot_id === 'review-b').result = 'PASS';
    json(f.task_record_path, record);
  }
  assert.equal(denied(launch(f, 'repair')), false);
  assert.equal(f.read().units[0].assurance_repairs, 1);
});

test('209 repair F04 both pinned hosted native commands include discovery and launch sentinel', () => {
  for (const file of ['.github/workflows/bearing-quality.yml', '.github/workflows/bearing-publish.yml']) {
    const workflow = readFileSync(path.join(ROOT, file), 'utf8');
    const native = workflow.split('\n').find(line => line.trim().startsWith('node --test test/native/codex-hook-discovery.test.mjs'));
    assert.ok(native, `${file} must retain native discovery`);
    assert.ok(native.includes('test/native/assurance-dispatch.test.mjs'), `${file} must run the native launch sentinel`);
    assert.match(workflow, /@openai\/codex@0\.162\.1/);
    assert.match(workflow, /test "\$\("\$BEARING_CODEX_BIN" --version\)" = "codex-cli 0\.162\.1"/);
  }
});
