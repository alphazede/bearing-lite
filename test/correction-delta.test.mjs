import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/correction-delta/round.json', import.meta.url)));
const evaluate = input => require('../hooks/correction-delta.cjs').evaluateCorrectionDelta(input);

test('delta with an unrequested change fails and lists extra UIDs', () => {
  const input = fixture();
  input.after[2].text = 'Unrequested correction.';
  const result = evaluate(input);
  assert.equal(result.verdict, 'VALIDATION_FAILED');
  assert.deepEqual(result.extra_uids, ['AC-1']);
  assert.deepEqual(result.closed_uids, []);
});

test('exact_text-only round closes without re-gating in any round', () => {
  for (const correction_rounds of [0, 1, 2]) {
    const result = evaluate({ ...fixture(), correction_rounds });
    assert.equal(result.verdict, 'DELTA_APPLIED');
    assert.deepEqual(result.closed_uids, ['REQ-1']);
    assert.deepEqual(result.regate_uids, []);
    assert.equal(result.correction_rounds, correction_rounds);
    assert.equal(result.receipt.delta, 'PASS');
    assert.equal(result.receipt.cross_references, 'PASS');
    assert.equal(result.receipt.lint.verdict, 'PASS');
    assert.equal(result.receipt.candidate_ref, 'candidate-162');
    assert.deepEqual(result.owner_gate_residuals, fixture().residuals);
  }
});

test('mixed round re-gates only requires_regate rows and spends one round', () => {
  const input = fixture();
  input.after[1].text = 'The receipt includes a unique identifier.';
  input.findings.push({ uid: 'REQ-2', finding_type: 'requires_regate' });
  const result = evaluate(input);
  assert.equal(result.verdict, 'REQUIRES_REGATE');
  assert.deepEqual(result.closed_uids, ['REQ-1']);
  assert.deepEqual(result.regate_uids, ['REQ-2']);
  assert.equal(result.correction_rounds, 1);
  input.correction_rounds = 2;
  assert.equal(evaluate(input).verdict, 'NEEDS_OWNER_DECISION');
  assert.equal(evaluate(input).correction_rounds, 2);
});

test('explicit null or wrong-typed context fails before closing or reserving a round', () => {
  const mixed = () => {
    const input = fixture();
    input.after[1].text = 'The receipt includes a unique identifier.';
    input.findings.push({ uid: 'REQ-2', finding_type: 'requires_regate' });
    return input;
  };
  for (const [field, value] of [
    ['correction_rounds', null], ['correction_rounds', '1'], ['correction_rounds', 1.5],
    ['known_uids', null], ['known_uids', 'REQ-1'], ['residuals', null], ['residuals', {}],
  ]) {
    const result = evaluate({ ...mixed(), [field]: value });
    assert.equal(result.verdict, 'VALIDATION_FAILED', `${field}=${JSON.stringify(value)}`);
    assert.deepEqual(result.findings, [{ code: 'invalid_context' }]);
    assert.deepEqual(result.closed_uids, []);
    assert.deepEqual(result.regate_uids, []);
    assert.equal(result.correction_rounds, 0);
    assert.equal(result.receipt, null);
  }
  const omitted = mixed();
  delete omitted.correction_rounds;
  delete omitted.residuals;
  const result = evaluate(omitted);
  assert.equal(result.verdict, 'REQUIRES_REGATE');
  assert.equal(result.correction_rounds, 1);
  assert.deepEqual(result.owner_gate_residuals, []);
});

test('exact_text rejects non-verbatim text and wording-external changes', () => {
  const input = fixture();
  input.after[0].text += ' Extra.';
  assert.equal(evaluate(input).verdict, 'VALIDATION_FAILED');
  input.after[0].text = input.findings[0].corrected_text;
  input.after[0].references = ['REQ-2'];
  assert.equal(evaluate(input).verdict, 'VALIDATION_FAILED');
});

test('mechanical closure needs candidate-bound lint and resolving cross-references', () => {
  const input = fixture();
  delete input.lint;
  assert.equal(evaluate(input).verdict, 'NEEDS_MORE_EVIDENCE');
  input.lint = { verdict: 'PASS', candidate_ref: 'old-candidate' };
  assert.equal(evaluate(input).verdict, 'NEEDS_MORE_EVIDENCE');
  input.lint = fixture().lint;
  input.before[2].references = input.after[2].references = ['REGISTER-1'];
  assert.equal(evaluate(input).verdict, 'VALIDATION_FAILED');
  input.known_uids = ['REGISTER-1'];
  assert.equal(evaluate(input).verdict, 'DELTA_APPLIED');
  input.lint.verdict = 'FAIL';
  assert.equal(evaluate(input).verdict, 'VALIDATION_FAILED');
});

test('delta requires changed UID equality and typed unique rows and findings', () => {
  const input = fixture();
  input.after = structuredClone(input.before);
  assert.deepEqual(evaluate(input).missing_uids, ['REQ-1']);
  for (const change of [
    x => { x.findings[0].finding_type = 'unknown'; },
    x => { x.after.push(x.after[0]); },
    x => { x.findings.push(x.findings[0]); },
    x => { delete x.after[0].references; },
    x => { x.correction_rounds = -1; },
  ]) {
    const invalid = fixture();
    change(invalid);
    assert.equal(evaluate(invalid).verdict, 'VALIDATION_FAILED');
  }
});

test('CLI emits the deterministic receipt and fails invalid input', () => {
  const cli = new URL('../hooks/correction-delta.cjs', import.meta.url);
  const result = spawnSync(process.execPath, [cli.pathname, new URL('./fixtures/correction-delta/round.json', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).verdict, 'DELTA_APPLIED');
  assert.equal(spawnSync(process.execPath, [cli.pathname], { encoding: 'utf8' }).status, 1);
});

test('matching named delta uses bounded correction procedure; unresolved intent reroutes', () => {
  const planning = readFileSync(new URL('../skills/planning-and-design/SKILL.md', import.meta.url), 'utf8');
  assert.match(planning, /named delta packet/); // Matching request: apply these named planning findings.
  assert.match(planning, /named findings only/);
  assert.match(planning, /references\/correction-loop\.md/);
  assert.match(planning, /unresolved material scope[\s\S]*REROUTE_SCOPE_DEFINITION/); // Non-match: decide unresolved scope.
  const router = readFileSync(new URL('../skills/bearing-lite/SKILL.md', import.meta.url), 'utf8');
  assert.match(router, /exact_text[\s\S]*without a re-gate/);
  assert.match(router, /mechanical verification receipt/);
  const report = readFileSync(new URL('../skills/requirements-engineer/references/gate-report.md', import.meta.url), 'utf8');
  assert.match(report, /finding_type/);
  assert.match(report, /exact_text/);
  assert.match(report, /requires_regate/);
});
