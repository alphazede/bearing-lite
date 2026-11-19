"use strict";

// Filter the frozen wave in order. Directory scopes compare against occupied paths.
const IN_FLIGHT = new Set(["RESERVED", "DISPATCHED", "CHECKING"]);
const OCCUPIES = new Set(["RESERVED", "DISPATCHED", "CHECKING", "HELD"]);

function deps(slice) {
  return Array.isArray(slice.depends_on) ? slice.depends_on : [];
}
function inputsOf(slice) {
  return Array.isArray(slice.inputs) ? slice.inputs.filter(entry => typeof entry === "string" && entry) : [];
}
function writes(slice) {
  return Array.isArray(slice.write_set) ? slice.write_set.filter(entry => typeof entry === "string" && entry) : [];
}
function resources(slice) {
  const groups = Array.isArray(slice.resource_groups)
    ? slice.resource_groups.filter(entry => typeof entry === "string" && entry)
    : [];
  return typeof slice.resource === "string" && slice.resource ? [slice.resource, ...groups] : groups;
}
function pathMatches(a, b) {
  if (a === b) return true;
  if (a.endsWith("/") && b.startsWith(a)) return true;
  if (b.endsWith("/") && a.startsWith(b)) return true;
  return false;
}
function occupy(index, slice) {
  for (const entry of writes(slice)) {
    if (entry.endsWith("/")) {
      if (!index.dirs.some(dir => dir.path === entry)) index.dirs.push({ path: entry, by: slice.id });
    } else if (!index.files.has(entry)) index.files.set(entry, slice.id);
  }
}
function conflict(index, slice) {
  for (const entry of writes(slice)) {
    if (entry.endsWith("/")) {
      for (const [file, by] of index.files) if (file.startsWith(entry)) return by;
      for (const dir of index.dirs) {
        if (entry.startsWith(dir.path) || dir.path.startsWith(entry)) return dir.by;
      }
    } else {
      if (index.files.has(entry)) return index.files.get(entry);
      for (const dir of index.dirs) if (entry.startsWith(dir.path)) return dir.by;
    }
  }
  return null;
}
function evaluate(input) {
  const slices = Array.isArray(input && input.slices) ? input.slices : [];
  const assignments = (input && input.assignments) || {};
  const pending = new Set((Array.isArray(input && input.pending) ? input.pending : []).map(item => item && item.slice));
  const busy = new Set(Array.isArray(input && input.busy_resources) ? input.busy_resources : []);
  const available = new Set(Array.isArray(input && input.available_inputs) ? input.available_inputs : []);
  const ids = new Set(slices.map(slice => slice.id));
  const index = { files: new Map(), dirs: [] };
  for (const slice of slices) {
    if (!OCCUPIES.has(assignments[slice.id])) continue;
    occupy(index, slice);
    for (const res of resources(slice)) busy.add(res);
  }
  const ready = [];
  const excluded = [];
  for (const slice of slices) {
    const state = assignments[slice.id];
    let cause = null;
    let by;
    if (state === "HELD") cause = "held";
    else if (IN_FLIGHT.has(state)) cause = "in-flight";
    else if (state === "COMPLETED") cause = "completed";
    else if (pending.has(slice.id)) cause = "pending";
    else {
      for (const dep of deps(slice)) {
        if (!ids.has(dep) && !Object.hasOwn(assignments, dep)) { cause = "missing dependency"; by = dep; break; }
        if (assignments[dep] !== "COMPLETED") { cause = "dependency"; by = dep; break; }
      }
      if (!cause) {
        for (const inp of inputsOf(slice)) {
          if (ids.has(inp) || Object.hasOwn(assignments, inp)) {
            if (assignments[inp] !== "COMPLETED") { cause = "input"; by = inp; break; }
            continue;
          }
          if (available.has(inp)) continue;
          const producers = slices.filter(other => other.id !== slice.id && writes(other).some(w => pathMatches(w, inp)));
          if (producers.length && producers.every(prod => assignments[prod.id] === "COMPLETED")) continue;
          cause = "input";
          by = inp;
          break;
        }
      }
      if (!cause) {
        for (const res of resources(slice)) if (busy.has(res)) { cause = "resource"; by = res; break; }
      }
      if (!cause) {
        by = conflict(index, slice);
        if (by) cause = "write overlap";
      }
    }
    if (cause) {
      const row = { slice: slice.id, cause };
      if (by) row.by = by;
      excluded.push(row);
    } else {
      ready.push(slice.id);
      occupy(index, slice);
      for (const res of resources(slice)) busy.add(res);
    }
  }
  return { ready, excluded };
}

module.exports = { evaluate };
