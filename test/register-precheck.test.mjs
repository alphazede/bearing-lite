import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
test('dispatch contract blocks failed prechecks without correction rounds', () => {
  const router = readFileSync(new URL('../skills/bearing-lite/SKILL.md', import.meta.url), 'utf8');
  const skill = readFileSync(new URL('../skills/requirements-engineer/SKILL.md', import.meta.url), 'utf8');
  assert.match(router, /register-precheck/);
  assert.match(router, /without.*correction round/);
  assert.match(skill, /passing.*pre-check receipt/);
  assert.match(skill, /Never re-report.*covered/);
});
test('Requirements Engineer matching and non-matching request retain activation boundaries', () => {
  const skill = readFileSync(new URL('../skills/requirements-engineer/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /quality-gate verdict before the integrated owner review/); // gate this draft register
  assert.match(skill, /Non-match:.*implementation wave/); // implement a runtime change
});
