"use strict";

// Topological filter over a frozen wave of at most 128 slices. O(V+E) plus one pass over write-set entries.
const IN_FLIGHT = new Set(["RESERVED", "DISPATCHED", "CHECKING"]);
const OCCUPIES = new Set(["RESERVED", "DISPATCHED", "CHECKING", "HELD"]);

function deps(slice) {
  return Array.isArray(slice.depends_on) ? slice.depends_on : [];
}
function writes(slice) {
  return Array.isArray(slice.write_set) ? slice.write_set.filter(entry => typeof entry === "string" && entry) : [];
}
function groups(slice) {
  return Array.isArray(slice.resource_groups) ? slice.resource_groups : [];
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
        if (dir.path !== entry && (entry.startsWith(dir.path) || dir.path.startsWith(entry))) return dir.by;
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
  const ids = new Set(slices.map(slice => slice.id));
  const index = { files: new Map(), dirs: [] };
  for (const slice of slices) if (OCCUPIES.has(assignments[slice.id])) occupy(index, slice);
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
        if (!ids.has(dep)) { cause = "missing dependency"; by = dep; break; }
        if (assignments[dep] !== "COMPLETED") { cause = "dependency"; by = dep; break; }
      }
      if (!cause) {
        for (const group of groups(slice)) if (busy.has(group)) { cause = "resource"; by = group; break; }
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
    }
  }
  return { ready, excluded };
}

module.exports = { evaluate };
