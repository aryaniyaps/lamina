#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPilotPreflight } from '../lib/pilot-preflight.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const staticOnly = process.argv.includes('--static-only');
const result = runPilotPreflight({ root: ROOT, skipLiveProbes: staticOnly });
const reportPath = path.join(ROOT, 'benchmarks/lb6/reports/latest.json');

for (const gate of result.report.gates) {
  const suffix = gate.reason ? `: ${gate.reason}` : '';
  console.log(`[${gate.status}] ${gate.name}${suffix}`);
}

console.log(`\nPreflight report: ${reportPath}`);
if (result.personaFailureRecord) {
  console.log('Persona provenance failure record: benchmarks/lb6/reports/persona-provenance-gate-failure.json');
}
console.log(`Acceptance: ${result.report.acceptancePassed ? 'PASSED' : 'FAILED'}`);
console.log(`Ticket criteria: ${result.report.ticketStatus}`);

if (!result.report.acceptancePassed) {
  const blocked = result.report.gates.filter((gate) => gate.status === 'blocked');
  const failed = result.report.gates.filter((gate) => gate.status === 'failed');
  if (failed.length) {
    console.log('\nFailed gates:');
    for (const gate of failed) {
      console.log(`- ${gate.name}: ${gate.reason}`);
    }
  }
  if (blocked.length) {
    console.log('\nBlocked gates (informational unless blocking acceptance):');
    for (const gate of blocked) {
      console.log(`- ${gate.name}: ${gate.reason}`);
    }
  }
}

process.exit(result.exitCode);
