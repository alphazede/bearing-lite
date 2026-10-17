"use strict";

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.trim().length > 0;
const count = v => Number.isSafeInteger(v) && v >= 0;
const digest = raw => crypto.createHash('sha256').update(raw).digest('hex');
const result = (outcome, reason) => ({ outcome, reason });
const gap = reason => result('NEEDS_MORE_EVIDENCE', reason);
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function local(root, relative) {
  if (!text(relative) || path.isAbsolute(relative)) throw Error('nonlocal_state_path');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || fs.realpathSync(file) !== file || !fs.statSync(file).isFile() || fs.statSync(file).nlink !== 1) throw Error('nonlocal_state_path');
  return file;
}
/** Visible root plan binding, including when the host reports a child working directory. */
function binding(cwd) {
  let root = fs.realpathSync(cwd);
  for (;;) {
    const plans = fs.readdirSync(root, { withFileTypes: true })
      .filter(e => e.isFile() && /\.(md|markdown)$/i.test(e.name)).map(e => e.name).sort();
    const found = [];
    let assurancePending = false;
    for (const name of plans) {
      const file = path.join(root, name);
      const raw = fs.readFileSync(file, 'utf8');
      // Explicit visible task state, not prompt or role-name heuristics.
      for (const task of raw.split(/^###\s*task_id:.*$/m).slice(1)) {
        const state = task.match(/^-\s*status:\s*(\S+)/m)?.[1];
        const required = task.match(/^-\s*required_assurance:\s*(.+)$/m)?.[1]?.trim();
        if (['EVIDENCE_READY', 'VALIDATING', 'REVIEWING', 'ACCEPTANCE'].includes(state) && required && !['none', '[]'].includes(required)) assurancePending = true;
      }
      for (const match of raw.matchAll(/^-\s*assurance_dispatch:\s*(.*)$/gm)) found.push(match[1]);
    }
    if (found.length) {
      if (found.length !== 1) throw Error('ambiguous_dispatch_binding');
      const b = JSON.parse(found[0]);
      if (!object(b) || !text(b.journey) || !/^[0-9a-f]{64}$/.test(b.declaration_sha256)) throw Error('invalid_dispatch_binding');
      const declaration_path = local(root, b.declaration_path);
      const raw = fs.readFileSync(declaration_path);
      if (digest(raw) !== b.declaration_sha256) throw Error('frozen_declaration_changed');
      const task_record_path = local(root, b.task_record_path);
      return { ...b, root, declaration_path, task_record_path, declaration: JSON.parse(raw) };
    }
    if (assurancePending) throw Error('required_dispatch_binding_missing');
    if (fs.existsSync(path.join(root, '.git')) || path.dirname(root) === root) return null;
    root = path.dirname(root);
  }
}
/** Existing authority envelope remains the trust source, never an event's approval flag. */
function authority(root, file, action, subject, scope, id, detail) {
  try {
    const a = read(local(root, path.relative(root, path.resolve(root, file))));
    return a.state === 'active' && a.effective === true && a.id === id &&
      a.granting_owner_decisions?.includes(id) && a.approval_receipt?.actor === 'owner' &&
      a.approval_receipt?.decision_id === id && a.allowed?.actions?.includes(action) &&
      a.allowed?.scope?.includes(scope) && !a.prohibited?.actions?.includes(action) && !a.prohibited?.scope?.includes(scope) &&
      a.subject?.journey === subject.journey && a.subject?.unit_id === subject.unit_id &&
      a.subject?.candidate === subject.candidate && Array.isArray(a.expiry_conditions) && a.expiry_conditions.length > 0 &&
      (!detail || JSON.stringify(a.subject[action]) === JSON.stringify(detail));
  } catch { return false; }
}
/** A bounded lock is transient synchronization; all authority and expenditure stay in the visible record. */
function update(b, fn) {
  const lock = b.task_record_path + '.lock';
  const deadline = Date.now() + 5000;
  let held = false;
  let tmp;
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; }
      catch (e) {
        if (e.code !== 'EEXIST' || Date.now() >= deadline) return gap('task_record_lock_unavailable');
        // Bounded cross-process lock backoff, not a launch retry or an allowance refund.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
    const record = read(b.task_record_path);
    const response = fn(record);
    if (response.outcome !== 'PASS') return response;
    tmp = path.join(path.dirname(b.task_record_path), `.${path.basename(b.task_record_path)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(record, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, b.task_record_path); tmp = null;
    const dir = fs.openSync(path.dirname(b.task_record_path), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    return response;
  } catch { return gap('task_record_unavailable'); }
  finally {
    if (tmp) fs.rmSync(tmp, { force: true });
    if (held) fs.rmdirSync(lock);
  }
}
function validatedBounds(record, unit, bounds, root) {
  if (!Array.isArray(record.amendments)) return null;
  let rounds = bounds.reviewer_rounds, repairs = bounds.repairs_max;
  const seen = new Set();
  for (const a of record.amendments) {
    if (!object(a) || !text(a.id) || seen.has(a.id) || !count(a.additional_rounds) || !count(a.additional_repairs) || !text(a.scope) || !text(a.candidate) || !Array.isArray(a.slot_ids) || !text(a.authority_sha256)) return null;
    if (!root || !authority(root, a.authority_path, 'assurance_budget_amendment', { journey: record.journey, unit_id: a.unit_id, candidate: a.candidate }, a.scope, a.id, { additional_rounds: a.additional_rounds, additional_repairs: a.additional_repairs, slot_ids: a.slot_ids })) return null;
    try { if (digest(fs.readFileSync(local(root, a.authority_path))) !== a.authority_sha256) return null; }
    catch { return null; }
    seen.add(a.id);
    if (a.unit_id === unit) { rounds += a.additional_rounds; repairs += a.additional_repairs; }
  }
  return { reviewer_rounds: rounds, repairs_max: repairs };
}
module.exports = { object, text, count, digest, result, gap, read, local, binding, authority, update, validatedBounds };
