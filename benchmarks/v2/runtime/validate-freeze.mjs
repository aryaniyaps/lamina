#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FREEZE_GROUPS, hashTree, runtimeFingerprint } from './freeze-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const freezePath = path.join(ROOT, 'benchmarks', 'v2', 'freeze.json');
if (!fs.existsSync(freezePath)) throw new Error('Missing benchmarks/v2/freeze.json');
const frozen = JSON.parse(fs.readFileSync(freezePath, 'utf8'));
const errors = [];
for (const [name, paths] of Object.entries(FREEZE_GROUPS)) {
  const actual = hashTree(ROOT, paths);
  if (actual.sha256 !== frozen.hashes?.[name]?.sha256) errors.push(`${name}: frozen hash mismatch`);
}
if (JSON.stringify(runtimeFingerprint()) !== JSON.stringify(frozen.runtime_environment)) errors.push('runtime_environment: version or platform mismatch');
if (errors.length) throw new Error(errors.join('\n'));
console.log(`freeze valid for source commit ${frozen.source_commit}`);
