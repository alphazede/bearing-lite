'use strict';

const CLASSES = ['verification', 'ears', 'glossary', 'reference', 'decision', 'citation'];

// Parse only requirement fields, including multiline text and relation VALUEs.
function parseRegister(text) {
  const rows = [];
  let row, field, multiline = false;
  text.split(/\r?\n/).forEach((line, index) => {
    if (multiline) {
      if (line.trim() === '<<<') multiline = false;
      else field.value += '\n' + line;
      return;
    }
    if (line.trim() === '[REQUIREMENT]') {
      row = { line: index + 1, fields: [] };
      rows.push(row);
    } else if (line.trim() === '[/REQUIREMENT]') row = null;
    else if (row) {
      const match = line.match(/^([A-Z][A-Z0-9_-]*):\s*(.*)$/);
      if (match) {
        field = { name: match[1], value: match[2] === '>>>' ? '' : match[2], line: index + 1 };
        row.fields.push(field);
        multiline = match[2] === '>>>';
      }
    }
  });
  return rows;
}

function checkRegister({ register, technicalPlan, registerPath = 'register.sdoc', planPath = 'technical-plan.md', files = {} }) {
  const findings = [];
  const add = (kind, uid, file, line, message) => findings.push({ class: kind, uid, location: `${file}:${line}`, message });
  const rows = parseRegister(register);
  const uidOf = row => row.fields.find(f => f.name === 'UID')?.value.trim() || '<missing>';
  const uids = new Set(rows.map(uidOf));
  const decisions = new Set(), definitions = new Set(), terms = new Set();
  let glossary = false;
  const planLines = technicalPlan.split(/\r?\n/);
  planLines.forEach(line => {
    if (/^#{1,6}\s/.test(line)) glossary = /^#{1,6}\s+(Glossary|Quantity[- ]definitions)\b/i.test(line);
    const declaration = line.match(/^(?:#{1,6}\s+|\|\s*)`?((?:DEC|DEF|GLOSS)-[A-Z0-9.-]+)\b/);
    if (declaration) (declaration[1].startsWith('DEC-') ? decisions : definitions).add(declaration[1]);
    if (glossary && /^\|/.test(line)) {
      const cells = line.split('|').slice(1, -1).map(cell => cell.trim().replace(/^`|`$/g, ''));
      if (cells.length > 1 && cells[1] && !/^(name|term|quantity|id|[- :]+)$/i.test(cells[0])) {
        terms.add(cells[0]);
        if (/^(DEF|GLOSS)-/.test(cells[0]) && cells[1]) terms.add(cells[1]);
      }
    }
  });
  const references = (text, uid, file, line) => {
    for (const match of text.matchAll(/\[\[([^\]]+)\]\]|\b(?:UID|DEFINITION|DEF):\s*([A-Z][A-Z0-9.-]*)|\b((?:DEF|GLOSS)-[A-Z0-9.-]+)\b/g)) {
      const id = match[1] || match[2] || match[3];
      if (!uids.has(id) && !definitions.has(id)) add('reference', uid, file, line, `Unresolved reference: ${id}`);
    }
  };
  const citations = (text, uid, file, line) => {
    for (const match of text.matchAll(/(?:^|[\s`(])((?:[\w.-]+\/)*[\w.-]+\.[\w.-]+):(\d+)\b/g)) {
      const source = files[match[1]], number = Number(match[2]);
      const count = typeof source === 'string' ? source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0) : 0;
      if (!number || number > count) add('citation', uid, file, line, `Missing file or out-of-range citation: ${match[1]}:${number}`);
    }
  };
  if (!rows.length) add('reference', '<register>', registerPath, 1, 'No requirement rows');
  for (const row of rows) {
    const uid = uidOf(row);
    if (uid === '<missing>') add('reference', uid, registerPath, row.line, 'Missing UID');
    const fields = names => row.fields.filter(f => names.includes(f.name));
    const method = fields(['VERIFICATION_METHOD']).some(f => /\b(test|inspection|analysis|demonstration|evaluation)\b/i.test(f.value));
    const cases = fields(['VERIFICATION_CASE', 'VERIFICATION_CASES', 'VERIFICATION_CASE_ID', 'VERIFICATION']).some(f => /\b(?:SEIT|VC|CASE|TEST)-[A-Z0-9.-]+\b/.test(f.value));
    if (!method || !cases) add('verification', uid, registerPath, row.line, 'Require verification method and bound case ID');
    const statement = fields(['STATEMENT'])[0];
    if (!statement || !/\b(When|While|Where|shall)\b|\bIf\b[\s\S]*\bthen\b/i.test(statement.value)) add('ears', uid, registerPath, statement?.line || row.line, 'Statement lacks EARS keyword');
    if (!row.fields.some(f => f.name !== 'UID' && [...f.value.matchAll(/\bDEC-[A-Z0-9.-]+\b/g)].some(m => decisions.has(m[0])))) add('decision', uid, registerPath, row.line, 'No trace to a recorded decision');
    for (const field of row.fields) {
      if (field.name === 'UID') continue;
      if (field.name === 'VALUE' || /^(?:UID_REF|DEFINITION_REF|REFERENCES)$/.test(field.name)) {
        for (const id of field.value.trim().split(/[\s,;]+/).filter(Boolean)) {
          if (!uids.has(id) && !definitions.has(id)) add('reference', uid, registerPath, field.line, `Unresolved reference: ${id}`);
        }
      }
      references(field.value, uid, registerPath, field.line);
      citations(field.value, uid, registerPath, field.line);
      if (['STATEMENT', 'RATIONALE', 'TERMS'].includes(field.name)) {
        for (const match of field.value.matchAll(/`([^`]+)`|\bTERM:\s*([\w.-]+)/g)) {
          const term = match[1] || match[2];
          if (/^(?:DEC|DEF|GLOSS|SEIT|VC|CASE|TEST)-/.test(term) || /:\d+$/.test(term)) continue;
          if (!terms.has(term)) add('glossary', uid, registerPath, field.line, `Undefined glossary term: ${term}`);
        }
      }
    }
  }
  planLines.forEach((line, index) => {
    const uid = [...uids].find(id => line.includes(id)) || '<plan>';
    // Declaration cells are not references; check the remaining text.
    const body = line.replace(/^(?:#{1,6}\s+|\|\s*)`?(?:DEF|GLOSS)-[A-Z0-9.-]+`?/, '');
    references(body, uid, planPath, index + 1);
    citations(line, uid, planPath, index + 1);
  });
  return { outcome: findings.length ? 'FAIL' : 'PASS', candidate_ref: { register: registerPath, technical_plan: planPath }, covered_classes: CLASSES.slice(), findings };
}

module.exports = { parseRegister, checkRegister };

if (require.main === module) {
  const fs = require('node:fs'), path = require('node:path');
  const [registerPath, planPath, root = process.cwd()] = process.argv.slice(2);
  if (!registerPath || !planPath) {
    process.stderr.write('usage: node hooks/register-precheck.cjs <register.sdoc> <technical-plan.md> [repository root]\n');
    process.exit(2);
  }
  try {
    const register = fs.readFileSync(registerPath, 'utf8'), technicalPlan = fs.readFileSync(planPath, 'utf8');
    const files = {};
    for (const match of (register + '\n' + technicalPlan).matchAll(/(?:^|[\s`(])((?:[\w.-]+\/)*[\w.-]+\.[\w.-]+):\d+\b/g)) {
      const target = path.resolve(root, match[1]);
      if (path.relative(path.resolve(root), target).startsWith('..')) continue;
      try { files[match[1]] = fs.readFileSync(target, 'utf8'); } catch { /* Missing citation is a finding. */ }
    }
    const result = checkRegister({ register, technicalPlan, registerPath, planPath, files });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.outcome === 'PASS' ? 0 : 1;
  } catch (error) {
    process.stdout.write(JSON.stringify({ outcome: 'FAIL', covered_classes: [], findings: [{ class: 'input', uid: '<register>', location: registerPath + ':1', message: error.code || 'Unreadable input' }] }) + '\n');
    process.exitCode = 1;
  }
}
