export function registeredManagedGraphd(registrations = [], records = []) {
  const live = new Map(records.map((record) => [Number(record.pid), record]));
  const registered = [];
  for (const value of registrations.slice(-64)) {
    const record = live.get(Number(value?.pid));
    if (value?.role !== 'graphd'
      || !record
      || String(value.start_ticks || '') !== String(record.start_ticks || '')) continue;
    registered.push({
      ...record,
      managed_socket: value.socket,
      managed_lock: value.lock,
      managed_operation_lock: value.operation_lock,
    });
  }
  return registered;
}

export function classifyRemainingDescendants(registrations, records = [], ignoredPids = []) {
  const ignored = new Set(ignoredPids.map(Number));
  // A waited child can remain visible for a very short period as a zombie.
  // It owns no memory, cannot execute, and will be reaped by its parent; do not
  // misclassify that exit-state record as a live detached daemon.
  const remaining = records.filter((record) =>
    record.state !== 'Z' && !ignored.has(Number(record.pid)));
  if (remaining.length === 0) return { kind: 'empty', records: [], roots: [] };
  const roots = registeredManagedGraphd(registrations, remaining);
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
