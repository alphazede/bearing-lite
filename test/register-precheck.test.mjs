import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const root = new URL('./fixtures/register-precheck/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const evaluate = (name, plan = read('plan.md')) => require('../hooks/register-precheck.cjs').checkRegister({
  register: read(name), technicalPlan: plan, registerPath: name, planPath: 'plan.md',
  files: { 'evidence.txt': read('evidence.txt') },
});
test('passing register receipt covers all six classes', () => {
  const receipt = evaluate('valid.sdoc');
  assert.equal(receipt.outcome, 'PASS');
  assert.equal(receipt.covered_classes.length, 6);
  assert.deepEqual(receipt.findings, []);
});
for (const kind of ['verification', 'ears', 'glossary', 'reference', 'decision', 'citation']) {
  test(`${kind} negative fixture returns typed UID and location`, () => {
    const receipt = evaluate(`${kind}.sdoc`);
    assert.equal(receipt.outcome, 'FAIL');
    assert.ok(receipt.findings.some(f => f.class === kind && f.uid === 'REG-1' && new RegExp(`^${kind}\\.sdoc:\\d+$`).test(f.location)));
  });
}
test('missing verification method also fails', () => {
  const { checkRegister } = require('../hooks/register-precheck.cjs');
  const receipt = checkRegister({ register: read('valid.sdoc').replace('VERIFICATION_METHOD: test', 'VERIFICATION_METHOD:'), technicalPlan: read('plan.md'), files: { 'evidence.txt': read('evidence.txt') } });
  assert.ok(receipt.findings.some(f => f.class === 'verification' && f.uid === 'REG-1'));
});
test('decision mentions do not declare decisions; missing files fail closed', () => {
  assert.ok(evaluate('valid.sdoc', read('plan.md').replace('| DEC-1 | Report results. |', 'Mentions DEC-1 only.')).findings.some(f => f.class === 'decision'));
  const { checkRegister } = require('../hooks/register-precheck.cjs');
  assert.ok(checkRegister({ register: read('valid.sdoc'), technicalPlan: read('plan.md'), files: {} }).findings.some(f => f.class === 'citation'));
});
test('unresolved definition references and empty register fail closed', () => {
  const { checkRegister } = require('../hooks/register-precheck.cjs');
  assert.ok(checkRegister({ register: read('valid.sdoc').replace('VALUE: REG-2', 'VALUE: DEF-MISSING'), technicalPlan: read('plan.md'), files: { 'evidence.txt': read('evidence.txt') } }).findings.some(f => f.class === 'reference'));
  assert.equal(checkRegister({ register: '', technicalPlan: '' }).outcome, 'FAIL');
});
test('CLI emits JSON and exits nonzero on failing candidate', () => {
  const run = spawnSync(process.execPath, ['hooks/register-precheck.cjs', new URL('citation.sdoc', root).pathname, new URL('plan.md', root).pathname, root.pathname], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stdout).outcome, 'FAIL');
});

// F4 repair: stage-aware precheck. The Requirements Engineer runs the
// requirements stage against the confirmed Alignment/Scope context before SEIT
// exists; final assembly still requires every case binding.
const { checkRegister, seitCaseIdsOf } = require('../hooks/register-precheck.cjs');
const unbound = () => read('valid.sdoc').replace('VERIFICATION_CASE: SEIT-1\n', '');
const workspaceContext = [
  '# Workspace Environment: example',
  '## Confirmed Scope and Decisions',
  '| ID | Decision | Type |',
  '| --- | --- | --- |',
  '| DEC-1 | Report results. | expected_outcome |',
  '### Quantity definitions',
  '| Name | Formula | Population | Units | Source |',
  '| --- | --- | --- | --- | --- |',
  '| `tier_probability` | wins / outcomes | decided outcomes | share | contract |',
  '',
].join('\n');
const stageCheck = (stage, register = unbound(), extra = {}) => checkRegister({
  register, technicalPlan: workspaceContext, registerPath: 'draft.sdoc', planPath: 'workspace.md',
  files: { 'evidence.txt': read('evidence.txt') }, stage, ...extra,
});
test('requirements stage records a Test Engineer-owned pending case binding instead of requiring an invented ID', () => {
  const receipt = stageCheck('requirements');
  assert.equal(receipt.outcome, 'PASS', JSON.stringify(receipt.findings));
  assert.equal(receipt.stage, 'requirements');
  assert.deepEqual(receipt.pending_bindings.map(p => [p.uid, p.binding, p.owner, p.blocks]), [['REG-1', 'verification_case', 'test_engineer', 'final_assembly']]);
});
test('requirements stage still requires a verification method and every other quality class', () => {
  const noMethod = stageCheck('requirements', unbound().replace('VERIFICATION_METHOD: test', 'VERIFICATION_METHOD:'));
  assert.ok(noMethod.findings.some(f => f.class === 'verification' && f.uid === 'REG-1'));
  assert.equal(noMethod.outcome, 'FAIL');
  const noEars = stageCheck('requirements', unbound().replace('When requested, the system shall report', 'Report'));
  assert.ok(noEars.findings.some(f => f.class === 'ears'));
  const noDecision = checkRegister({ register: unbound(), technicalPlan: workspaceContext.replace('| DEC-1 |', '| NOTE |'), files: { 'evidence.txt': read('evidence.txt') }, stage: 'requirements' });
  assert.ok(noDecision.findings.some(f => f.class === 'decision'));
  const noGlossary = checkRegister({ register: unbound(), technicalPlan: workspaceContext.split('### Quantity definitions')[0], files: { 'evidence.txt': read('evidence.txt') }, stage: 'requirements' });
  assert.ok(noGlossary.findings.some(f => f.class === 'glossary'));
});
test('the confirmed Alignment/Scope quantity table satisfies the early glossary without a draft technical plan', () => {
  assert.deepEqual(stageCheck('requirements', read('valid.sdoc')).findings, []);
});
test('final assembly blocks on a pending binding and resolves case IDs against SEIT', () => {
  const final = stageCheck('final');
  assert.equal(final.outcome, 'FAIL');
  assert.ok(final.findings.some(f => f.class === 'verification' && f.uid === 'REG-1'));
  assert.deepEqual(stageCheck('final', unbound(), {}).pending_bindings, []);
  const seit = { proof_cases: [{ id: 'SEIT-1' }, { id: 'SEIT-2' }] };
  assert.equal(stageCheck('final', read('valid.sdoc'), { seitCaseIds: seitCaseIdsOf(seit) }).outcome, 'PASS');
  const missing = stageCheck('final', read('valid.sdoc'), { seitCaseIds: ['SEIT-1'] });
  assert.ok(missing.findings.some(f => f.class === 'verification' && /SEIT-2/.test(f.message)));
  // Default stage is final: the strict gate is never weakened by omission.
  assert.equal(checkRegister({ register: unbound(), technicalPlan: workspaceContext, files: { 'evidence.txt': read('evidence.txt') } }).outcome, 'FAIL');
});
test('CLI stage flags: requirements exits 0 with pending bindings; invalid use exits 2', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'precheck-stage-'));
  try {
    writeFileSync(path.join(dir, 'draft.sdoc'), unbound());
    writeFileSync(path.join(dir, 'workspace.md'), workspaceContext);
    writeFileSync(path.join(dir, 'evidence.txt'), read('evidence.txt'));
    writeFileSync(path.join(dir, 'seit.json'), JSON.stringify({ proof_cases: [{ id: 'SEIT-2' }] }));
    const cli = (...args) => spawnSync(process.execPath, ['hooks/register-precheck.cjs', ...args], { encoding: 'utf8' });
    const early = cli('--stage', 'requirements', path.join(dir, 'draft.sdoc'), path.join(dir, 'workspace.md'), dir);
    assert.equal(early.status, 0, early.stdout);
    assert.equal(JSON.parse(early.stdout).pending_bindings.length, 1);
    const final = cli('--seit', path.join(dir, 'seit.json'), path.join(dir, 'draft.sdoc'), path.join(dir, 'workspace.md'), dir);
    assert.equal(final.status, 1);
    assert.equal(cli('--stage', 'draft', path.join(dir, 'draft.sdoc'), path.join(dir, 'workspace.md')).status, 2);
    assert.equal(cli('--stage', 'requirements', '--seit', path.join(dir, 'seit.json'), path.join(dir, 'draft.sdoc'), path.join(dir, 'workspace.md')).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
