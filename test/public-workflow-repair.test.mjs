/** Frozen public-workflow regressions: real shipped instructions through their contract suites.
 * Resource group: none; every mutation owns and removes a fresh filesystem fixture.
 * This module is distinct because it verifies that the named instruction oracles reject known wrong product text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, assertLinksTo } from './skill-contract-fixture.mjs';

test('F01 link assertions accept portable and native Windows separators', () => {
  assertLinksTo('skills/test-engineer/SKILL.md', 'skills/test-engineer/references/formal-analysis.md');
  assertLinksTo('skills/test-engineer/SKILL.md', 'skills\\test-engineer\\references\\formal-analysis.md');
});

const mutants = [
  ['formal failure branches', 'skills/test-engineer/references/formal-analysis.md', 'formal-analysis.test.mjs',
    s => s.replace('For a code-level verifier, retain the failed check on that implementation.\n', '')
      .replace('For a separate model, detect the correspondence change, faithfully reflect\nthe broken implementation step in the model without changing the property,\nand retain the checker counterexample. ', ''), /failed check on implementation|model counterexample/],
  ['planning subsection scope', 'skills/planning-and-design/references/oopdsa-design.md', 'oopdsa-design-lens.test.mjs',
    s => s.slice(0, s.indexOf('1. **Requirements trace.**')) + s.slice(s.indexOf('A trivial plan')) + '\n'
      + s.slice(s.indexOf('1. **Requirements trace.**'), s.indexOf('A trivial plan')), /missing subsections/],
  ['typed-gap stopping', 'skills/requirements-engineer/references/quality-gate.md', 'requirements-corrections.test.mjs',
    s => s.replace('a typed gap\nprevents progress, or ', ''), /typed gap stops corrections/],
  ['publication routing', 'skills/requirements-engineer/references/quality-gate.md', 'requirements-corrections.test.mjs',
    s => s.replace('validate, review, or publish the register', 'validate, or review the register'), /publication typed-gap routing/],
  ['tier-local rebaseline', 'skills/planning-and-design/references/program-planning.md', 'program-planning.test.mjs',
    s => s.replace('1 local ruling;', '1 local ruling and rebaseline without owner approval;'), /tier 1 must not rebaseline/],
  ['storage prohibition polarity', 'skills/bearing-lite/references/storage-lifecycle.md', 'workflow-delivery.test.mjs',
    s => s.replace('Keep this bounded to assigned\npaths, never a whole-workspace purge.', 'Perform a whole-workspace purge.'), /bounded to assigned paths, no whole-workspace purge/],
  ['method substitution polarity', 'skills/coordinator/references/wave-operations.md', 'workflow-delivery.test.mjs',
    s => s.replace('never silently substituted\nwith another method', 'silently substituted\nwith another method'), /missing method must never substitute/],
];
for (const [name, source, suite, mutate, failure] of mutants) test(`F02 named oracle rejects ${name}`, t => {
  const root = mkdtempSync(path.join(tmpdir(), `workflow-contract-${process.pid}-${process.hrtime.bigint()}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['skills', 'schemas']) cpSync(path.join(ROOT, directory), path.join(root, directory), { recursive: true });
  mkdirSync(path.join(root, 'test'));
  for (const file of [suite, 'skill-contract-fixture.mjs']) cpSync(path.join(ROOT, 'test', file), path.join(root, 'test', file));
  const file = path.join(root, source), before = readFileSync(file, 'utf8'), after = mutate(before);
  assert.notEqual(after, before, `${name} must exercise the actual shipped instruction`);
  writeFileSync(file, after);
  const env = { ...process.env }; delete env.BEARING_ROLE; delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--test', `test/${suite}`], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 1, `${name}: the named contract must reject wrong instructions\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, failure, `${name}: failure must identify the intended obligation`);
});
