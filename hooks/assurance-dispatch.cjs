#!/usr/bin/env node
"use strict";

// Mandatory PreToolUse barrier for explicitly bound assurance; ordinary work has no binding.
const fs = require('node:fs');
const path = require('node:path');
const store = require('./assurance-budget-store.cjs');
const budget = require('./assurance-budget.cjs');
const { object, text, count, result, gap } = store;
const HOST_SUPPORT = Object.freeze({
  'claude-code': { executable: true, test_status: 'component_replay' },
  codex: { executable: true, test_status: 'native_qualification_required' },
  cursor: { executable: true, test_status: 'component_replay' },
  copilot: { executable: true, test_status: 'component_replay' },
  agy: { executable: false, test_status: 'skills_only' },
  pi: { executable: false, test_status: 'skills_only' },
  deepcode: { executable: false, test_status: 'skills_only' },
});
const SAFE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'List', 'read_file', 'list_dir', 'view_image', 'request_user_input', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'apply_patch']);
const KINDS = new Set(['review', 'repair', 'deterministic', 'qualification']);
const CLOSED = new Set(['PASS', 'REPAIR_REQUIRED', 'FAIL']);
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (object(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const signature = slot => stable({ tool_name: slot.tool_name, tool_input: slot.tool_input });
function slotsFor(b) {
  const slots = b.declaration.journey_settings?.assurance_dispatch?.slots;
  if (!Array.isArray(slots) || !slots.length) throw Error('dispatch_slots_missing');
  const ids = new Set(), signatures = new Set();
  for (const s of slots) {
    const unitKind = budget.canonicalUnit(b.declaration, s?.unit_id, s?.unit_kind);
    if (!object(s) || !text(s.id) || ids.has(s.id) || !KINDS.has(s.kind) || !text(s.group) ||
        !text(s.scope) || !text(s.candidate) || !text(s.tool_name) || !object(s.tool_input) ||
        !unitKind || s.unit_id === 'planning' || signatures.has(signature(s))) throw Error('dispatch_slots_invalid');
    ids.add(s.id); signatures.add(signature(s));
  }
  for (const s of slots) {
    const group = slots.filter(other => other.group === s.group);
    if (group.some(other => other.kind !== s.kind || other.unit_id !== s.unit_id || other.candidate !== s.candidate || other.scope !== s.scope)) throw Error('dispatch_group_invalid');
    if (s.kind !== 'review' && group.length !== 1) throw Error('dispatch_group_invalid');
    if (s.inline_repair !== undefined && typeof s.inline_repair !== 'boolean') throw Error('dispatch_slots_invalid');
    if (s.inline_repair && (s.kind !== 'review' || group.length !== 1)) throw Error('dispatch_group_invalid');
  }
  return slots;
}
function validateRecord(b, record, slots) {
  if (!object(record) || record.journey !== b.journey || !Array.isArray(record.units) ||
      !Array.isArray(record.dispatch_log) || !Array.isArray(record.amendments)) return gap('invalid_task_record');
  const frozenId = b.declaration.journey_settings?.lifecycle_id || b.declaration.lifecycle_id;
  if (!text(frozenId) || frozenId !== b.journey) return gap('declaration_journey_mismatch');
  if (record.dispatch_declaration_sha256 && record.dispatch_declaration_sha256 !== b.declaration_sha256) return gap('dispatch_declaration_mismatch');
  if (record.dispatch_declaration_sha256 && !Array.isArray(record.dispatch_baseline)) return gap('dispatch_baseline_missing');
  const keys = new Set();
  for (const u of record.units) {
    const id = u?.unit_id || u?.assurance_unit;
    const kind = budget.canonicalUnit(b.declaration, id, u?.unit_kind);
    if (!object(u) || !kind || !count(u.assurance_rounds) || !count(u.assurance_repairs) || keys.has(id)) return gap('invalid_assurance_units');
    keys.add(id);
  }
  const seen = new Set();
  for (const entry of record.dispatch_log) {
    const s = slots.find(s => s.id === entry?.slot_id);
    if (!s || seen.has(s.id) || entry.unit_id !== s.unit_id || entry.candidate !== s.candidate ||
        entry.group !== s.group || entry.kind !== s.kind || entry.scope !== s.scope ||
        entry.launch_sha256 !== store.digest(signature(s)) || !text(entry.reserved_at)) return gap('invalid_dispatch_log');
    seen.add(s.id);
  }
  for (const u of record.units) {
    const logs = record.dispatch_log.filter(e => e.unit_id === (u.unit_id || u.assurance_unit));
    for (const [kind, field] of [['review', 'assurance_rounds'], ['repair', 'assurance_repairs']]) {
      const baseline = record.dispatch_baseline?.find(base => base.unit_id === (u.unit_id || u.assurance_unit));
      if (record.dispatch_baseline && (!baseline || !count(baseline[field]))) return gap('dispatch_baseline_invalid');
      if ((baseline?.[field] || 0) + new Set(logs.filter(e => e.kind === kind || (kind === 'repair' && slots.find(s => s.id === e.slot_id)?.inline_repair)).map(e => e.group)).size > u[field]) return gap('assurance_counter_reset');
    }
  }
  for (const a of record.amendments) {
    const root = path.dirname(b.task_record_path);
    if (!store.validatedBounds(record, a?.unit_id, { reviewer_rounds: 1, repairs_max: 1 }, root)) return gap('invalid_assurance_amendment');
  }
  return null;
}
function baseline(record) {
  if (!record.dispatch_baseline) record.dispatch_baseline = record.units.map(u => ({ unit_id: u.unit_id || u.assurance_unit, assurance_rounds: u.assurance_rounds, assurance_repairs: u.assurance_repairs }));
}
function reviewMembers(record, slots, first) {
  const amendment = record.amendments.find(a => a.slot_ids.includes(first.slot_id));
  return slots.filter(s => s.kind === 'review' && s.group === first.group && (!amendment || amendment.slot_ids.includes(s.id)));
}
function consume(b, slot, slots) {
  return store.update(b, record => {
    const invalid = validateRecord(b, record, slots);
    if (invalid) return invalid;
    const u = record.units.find(u => (u.unit_id || u.assurance_unit) === slot.unit_id);
    if (!u) return gap('assurance_unit_record_missing');
    baseline(record);
    const logs = record.dispatch_log.filter(e => e.unit_id === slot.unit_id);
    if (logs.some(e => e.slot_id === slot.id)) return result('HALT', 'dispatch_slot_already_reserved');
    const bounds = store.validatedBounds(record, slot.unit_id, { reviewer_rounds: 1, repairs_max: 1 }, path.dirname(b.task_record_path));
    if (!bounds) return gap('invalid_assurance_amendment');
    const amendment = record.amendments.find(a => a.slot_ids.includes(slot.id));
    if (amendment && (amendment.candidate !== slot.candidate || amendment.scope !== slot.scope)) return result('OWNER_DECISION_REQUIRED', 'amendment_scope_mismatch');
    if (slot.kind === 'review') {
      const sameRound = logs.find(e => e.kind === 'review' && e.group === slot.group);
      if (sameRound) {
        if (!reviewMembers(record, slots, sameRound).some(s => s.id === slot.id)) return result('OWNER_DECISION_REQUIRED', 'amendment_scope_mismatch');
        if (logs.some(e => e.kind === 'repair' || e.kind === 'deterministic')) return result('HALT', 'round_already_closed');
        if (u.assurance_rounds > bounds.reviewer_rounds) return result('HALT', 'assurance_round_limit');
      } else {
        const evaluated = budget.evaluateAssuranceBudget({
          journey: b.journey, assurance_unit: slot.unit_id,
          unit_kind: budget.canonicalUnit(b.declaration, slot.unit_id, slot.unit_kind),
          declaration_path: b.declaration_path, task_record_path: b.task_record_path,
          role: 'reviewer', cadence: b.declaration.journey_settings?.assurance_cadence?.reviewer, receipts: u.receipts,
        });
        if (evaluated.outcome !== 'PASS') return evaluated;
        if (u.assurance_rounds >= 1 && !amendment) return result('HALT', 'assurance_round_limit');
        if (u.assurance_rounds >= bounds.reviewer_rounds) return result('HALT', 'assurance_round_limit');
        if (slot.inline_repair) {
          if (u.assurance_repairs >= bounds.repairs_max) return result('HALT', 'assurance_repair_limit');
          u.assurance_repairs++;
        }
        u.assurance_rounds++;
      }
    } else if (slot.kind === 'repair') {
      if (u.assurance_repairs >= bounds.repairs_max || (u.assurance_repairs >= 1 && !amendment)) return result('HALT', 'assurance_repair_limit');
      const reviews = logs.filter(e => e.kind === 'review');
      const groups = new Set(reviews.map(e => e.group));
      if (reviews.some(e => ['OWNER_DECISION_REQUIRED', 'CONTRACT_FAILURE'].includes(e.result))) return result('OWNER_DECISION_REQUIRED', 'aggregate_review_owner_decision_required');
      const approved = [...groups].flatMap(group => reviewMembers(record, slots, reviews.find(e => e.group === group)));
      if (!reviews.length || reviews.some(e => !CLOSED.has(e.result)) || !reviews.some(e => e.result === 'REPAIR_REQUIRED') ||
          approved.some(s => !reviews.some(e => e.slot_id === s.id))) return gap('aggregate_review_incomplete');
      u.assurance_repairs++;
    } else if (slot.kind === 'deterministic') {
      const repairs = logs.filter(e => e.kind === 'repair' || slots.find(s => s.id === e.slot_id)?.inline_repair);
      if (!u.assurance_repairs || !repairs.length || repairs.some(e => e.result !== 'PASS')) return gap('repair_incomplete');
    } else {
      const a = b.declaration.journey_settings.assurance_dispatch.authorities?.find(a => a.id === slot.authority_id);
      const subject = { journey: b.journey, unit_id: slot.unit_id, candidate: slot.candidate };
      if (!text(slot.subject) || !a || !store.authority(b.root, a.path, 'assurance_qualification', subject, slot.scope, a.id, { subject: slot.subject, launch_sha256: store.digest(signature(slot)) })) return result('OWNER_DECISION_REQUIRED', 'qualification_authority_missing');
      try { if (store.digest(fs.readFileSync(store.local(b.root, a.path))) !== a.sha256) return gap('qualification_authority_changed'); }
      catch { return gap('qualification_authority_unavailable'); }
    }
    const reviews = record.dispatch_log.filter(e => e.kind === 'review' && e.candidate === slot.candidate);
    const pendingReviews = slot.inline_repair && reviews.some(first =>
      reviewMembers(record, slots, first).some(member => !reviews.some(e => e.slot_id === member.id && CLOSED.has(e.result))));
    record.dispatch_declaration_sha256 = b.declaration_sha256;
    record.dispatch_log.push({ slot_id: slot.id, kind: slot.kind, group: slot.group, unit_id: slot.unit_id,
      candidate: slot.candidate, scope: slot.scope, launch_sha256: store.digest(signature(slot)), reserved_at: new Date().toISOString(), result: 'RESERVED' });
    if (pendingReviews) return { ...result('PASS', 'dispatch_reserved'),
      advisory: 'Bearing Lite scheduling advisory: other reviews of this candidate are incomplete. Keep review and OCR read-only; wait for all declared review members and aggregate their results before repair.' };
    return result('PASS', 'dispatch_reserved');
  });
}
function amend(cwd, a) {
  try {
    const b = store.binding(cwd);
    if (!b) return gap('dispatch_binding_missing');
    const slots = slotsFor(b);
    if (!object(a) || !text(a.id) || !count(a.additional_rounds) || !count(a.additional_repairs) ||
        a.additional_rounds + a.additional_repairs < 1 || !Array.isArray(a.slot_ids) || !a.slot_ids.length ||
        new Set(a.slot_ids).size !== a.slot_ids.length || !text(a.scope) || !text(a.candidate)) return result('OWNER_DECISION_REQUIRED', 'bounded_amendment_required');
    const subject = { journey: b.journey, unit_id: a.unit_id, candidate: a.candidate };
    if (!store.authority(b.root, a.authority_path, 'assurance_budget_amendment', subject, a.scope, a.id, { additional_rounds: a.additional_rounds, additional_repairs: a.additional_repairs, slot_ids: a.slot_ids })) return result('OWNER_DECISION_REQUIRED', 'amendment_authority_missing');
    const selected = a.slot_ids.map(id => slots.find(s => s.id === id));
    if (selected.some(s => !s || s.unit_id !== a.unit_id || s.scope !== a.scope || s.candidate !== a.candidate || !['review', 'repair'].includes(s.kind))) return result('OWNER_DECISION_REQUIRED', 'amendment_scope_mismatch');
    if (new Set(selected.filter(s => s.kind === 'review').map(s => s.group)).size !== a.additional_rounds || selected.filter(s => s.kind === 'repair' || s.inline_repair).length !== a.additional_repairs) return result('OWNER_DECISION_REQUIRED', 'amendment_allowance_mismatch');
    return store.update(b, record => {
      const invalid = validateRecord(b, record, slots); if (invalid) return invalid;
      if (record.amendments.some(old => old.id === a.id || old.slot_ids.some(id => a.slot_ids.includes(id))) || record.dispatch_log.some(e => a.slot_ids.includes(e.slot_id))) return result('HALT', 'amendment_already_used');
      const relative = path.relative(path.dirname(b.task_record_path), path.resolve(b.root, a.authority_path));
      baseline(record);
      record.dispatch_declaration_sha256 = b.declaration_sha256;
      record.amendments.push({ id: a.id, unit_id: a.unit_id, scope: a.scope, candidate: a.candidate,
        additional_rounds: a.additional_rounds, additional_repairs: a.additional_repairs,
        slot_ids: a.slot_ids, authority_path: relative, authority_sha256: store.digest(fs.readFileSync(path.resolve(b.root, a.authority_path))), recorded_at: new Date().toISOString() });
      return result('PASS', 'bounded_amendment_recorded');
    });
  } catch { return gap('amendment_state_unavailable'); }
}
function handle(input, host = 'claude-code') {
  try {
    if (typeof input === 'string') input = JSON.parse(input);
    if (!object(input)) return gap('host_input_invalid');
    const event = String(input.hook_event_name || input.hookEventName || input.event || '').replace(/[_-]/g, '').toLowerCase();
    if (!['pretooluse', 'beforeshellexecution'].includes(event)) return result('INACTIVE', 'unmapped_host_event');
    const tool_name = input.tool_name || input.toolName || (event === 'beforeshellexecution' ? 'Bash' : '');
    const tool_input = input.tool_input || input.toolInput || (event === 'beforeshellexecution' ? { command: input.command } : {});
    if (SAFE_TOOLS.has(tool_name)) return result('INACTIVE', 'read_or_owner_channel');
    const b = store.binding(input.cwd || input.workspaceRoot || process.cwd(), input);
    if (!b) return result('INACTIVE', 'ordinary_unbound_work');
    if (!HOST_SUPPORT[host]?.executable) return gap('host_enforcement_unavailable');
    if (host === 'cursor' && event === 'pretooluse' && ['Bash', 'Shell'].includes(tool_name)) return result('INACTIVE', 'cursor_shell_checked_before_execution');
    const slots = slotsFor(b);
    const slot = slots.find(s => signature(s) === signature({ tool_name, tool_input }));
    if (!slot) return result('OWNER_DECISION_REQUIRED', 'undeclared_bound_launch');
    return consume(b, slot, slots);
  } catch { return gap('dispatch_state_unavailable'); }
}
function toWire(r, host) {
  if (!HOST_SUPPORT[host]?.executable) return {};
  if (r.outcome === 'PASS' && r.advisory) {
    if (host === 'cursor') return { permission: 'allow', user_message: r.advisory, agent_message: r.advisory };
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: r.advisory } };
  }
  if (['PASS', 'INACTIVE'].includes(r.outcome) || r.reason === 'host_enforcement_unavailable') return host === 'cursor' ? { permission: 'allow' } : {};
  const reason = `Bearing Lite assurance dispatch: ${r.outcome}: ${r.reason}`;
  if (host === 'cursor') return { permission: 'deny', user_message: reason, agent_message: reason };
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
}
function main() {
  const host = process.argv.find(a => a.startsWith('--host='))?.slice(7) || 'claude-code';
  let r;
  try {
    const raw = fs.readFileSync(0, 'utf8');
    r = process.argv.includes('--amend') ? amend(process.cwd(), JSON.parse(raw)) : handle(raw, host);
  } catch { r = gap('host_input_unavailable'); }
  process.stderr.write(JSON.stringify(r) + '\n');
  process.stdout.write(JSON.stringify(toWire(r, host)) + '\n');
}
module.exports = { HOST_SUPPORT, handle, toWire, amend };
if (require.main === module) main();
