import fs from 'node:fs';
import path from 'node:path';

function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function appendJsonLine(file, value) {
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function attemptKey(record) {
  return `${record.id}\u0000${record.attempt}`;
}

export function reconcileAbandonedAttempts(resultsRoot, selectedCellIds, now = () => new Date().toISOString()) {
  const ledgerPath = path.join(resultsRoot, 'attempt-ledger.jsonl');
  const records = readJsonLines(ledgerPath);
  const selected = new Set(selectedCellIds);
  const terminal = new Set(records.filter((record) => ['completed', 'failed'].includes(record.event)).map(attemptKey));
  const starts = records.filter((record) => record.event === 'started' && selected.has(record.id) && !terminal.has(attemptKey(record)));
  const recovered = [];

  for (const start of starts) {
    const status = {
      ...start,
      status: 'failed',
      ended_at: now(),
      error: 'Recovered abandoned attempt: the previous matrix process ended without a terminal ledger event',
      recovery_reason: 'abandoned_started_event',
    };
    delete status.event;
    appendJsonLine(ledgerPath, { ...status, event: 'failed' });
    appendJsonLine(path.join(resultsRoot, 'failure-ledger.jsonl'), status);

    const statusPath = path.join(resultsRoot, 'cells', start.id, 'result.json');
    const existing = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, 'utf8')) : null;
    if (!existing || Number(existing.attempt || 0) <= Number(start.attempt || 0)) {
      fs.mkdirSync(path.dirname(statusPath), { recursive: true });
      fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
    }
    recovered.push(status);
  }
  return recovered;
}
