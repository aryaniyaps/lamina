import fs from 'node:fs';

const MANAGED_SCHEMA = 'lamina.safe-runner-managed-descendant/v1';

function graphdCommand(command = '') {
  return /(?:^|\s)[^\s]*\/graph-runtime\/server\.mjs(?:\s|$)/.test(command)
    || /(?:^|\s)--graphd(?:\s|$)/.test(command);
}

export function registeredManagedGraphd(file, records = []) {
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
  const live = new Map(records.map((record) => [Number(record.pid), record]));
  const registered = [];
  for (const line of lines.slice(-64)) {
    let value;
    try { value = JSON.parse(line); } catch { continue; }
    const record = live.get(Number(value?.pid));
    if (value?.schema !== MANAGED_SCHEMA
      || value?.role !== 'graphd'
      || !record
      || String(value.start_ticks || '') !== String(record.start_ticks || '')
      || !graphdCommand(record.command)) continue;
    registered.push(record);
  }
  return registered;
}

export function classifyRemainingDescendants(file, records = [], ignoredPids = []) {
  const ignored = new Set(ignoredPids.map(Number));
  // A waited child can remain visible for a very short period as a zombie.
  // It owns no memory, cannot execute, and will be reaped by its parent; do not
  // misclassify that exit-state record as a live detached daemon.
  const remaining = records.filter((record) =>
    record.state !== 'Z' && !ignored.has(Number(record.pid)));
  if (remaining.length === 0) return { kind: 'empty', records: [], roots: [] };
  const roots = registeredManagedGraphd(file, remaining);
  if (roots.length === 0) return { kind: 'unmanaged', records: remaining, roots: [] };
  const managed = new Set(roots.map((record) => record.pid));
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of remaining) {
      if (!managed.has(record.pid) && managed.has(record.ppid)) {
        managed.add(record.pid);
        changed = true;
      }
    }
  }
  const unmanaged = remaining.filter((record) => !managed.has(record.pid));
  return unmanaged.length === 0
    ? { kind: 'managed_graphd', records: remaining, roots }
    : { kind: 'unmanaged', records: remaining, roots, unmanaged };
}
