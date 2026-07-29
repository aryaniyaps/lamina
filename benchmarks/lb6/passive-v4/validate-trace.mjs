#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const REQUIRED = [
  'ordinary_request_received',
  'implementation_packet_prepared',
  'work_map_checked',
  'source_edit_started',
  'work_verified',
];
const UI = ['functional', 'visual', 'responsive', 'accessibility'];

export function validatePassiveTrace(trace) {
  const errors = [];
  if (trace.schema !== 'lamina.passive-trace/v4') errors.push('invalid trace schema');
  const events = Array.isArray(trace.events) ? trace.events : [];
  const types = events.map((item) => item.type);
  for (const type of REQUIRED) if (!types.includes(type)) errors.push(`missing event ${type}`);
  const checked = types.indexOf('work_map_checked');
  const edited = types.indexOf('source_edit_started');
  if (edited !== -1 && (checked === -1 || edited < checked)) errors.push('source edit occurred before WorkMap check');
  if ((trace.messages || []).some((message) => /(?:run|invoke) \/lamina-(?:design|verify)/i.test(message))) {
    errors.push('normal flow recommended an explicit phase skill');
  }
  const packet = events.find((item) => item.type === 'implementation_packet_prepared');
  const mapped = events.find((item) => item.type === 'work_map_checked');
  const obligations = new Set(packet?.obligation_ids || []);
  const mappedIds = new Set(mapped?.obligation_ids || []);
  for (const id of obligations) if (!mappedIds.has(id)) errors.push(`unmapped obligation ${id}`);
  if (trace.ui === true) {
    const audits = new Set(events.filter((item) => item.type === 'ui_audit_passed').map((item) => item.audit_kind));
    for (const kind of UI) if (!audits.has(kind)) errors.push(`missing UI audit ${kind}`);
  }
  const verified = events.find((item) => item.type === 'work_verified');
  if (verified && errors.length) errors.push('work_verified emitted for an invalid trace');
  return { valid: errors.length === 0, errors };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: validate-trace.mjs TRACE.json');
  const result = validatePassiveTrace(JSON.parse(fs.readFileSync(file, 'utf8')));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
