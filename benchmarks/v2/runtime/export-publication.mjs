#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { compileMatrix } from './compile-matrix.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(HERE, '..');
const ROOT = path.resolve(V2, '../..');
const output = process.argv[2];
if (!output) throw new Error('Usage: export-publication.mjs OUTPUT.json');
const release = JSON.parse(fs.readFileSync(path.join(V2, 'release.json'), 'utf8'));
if (release.status !== 'frozen') throw new Error('Publication export requires release.status = "frozen"');
for (const script of [['validate-corpus.mjs', '--publish'], ['validate-freeze.mjs']]) {
  const check = spawnSync(process.execPath, [path.join(HERE, script[0]), ...script.slice(1)], { cwd: ROOT, encoding: 'utf8' });
  if (check.status !== 0) throw new Error(check.stderr || check.stdout || `${script[0]} failed`);
}
const corpus = JSON.parse(fs.readFileSync(path.join(V2, 'corpus', 'manifest.json'), 'utf8'));
const cells = compileMatrix(release, corpus, { mode: 'publication' });
const frozen = JSON.parse(fs.readFileSync(path.join(V2, 'freeze.json'), 'utf8'));
const freezeBytes = fs.readFileSync(path.join(V2, 'freeze.json'));
fs.writeFileSync(path.resolve(output), `${JSON.stringify({ protocol_version: release.protocol_version, freeze_source_commit: frozen.source_commit, freeze_sha256: createHash('sha256').update(freezeBytes).digest('hex'), runtime_environment: frozen.runtime_environment, custody_protocol: 'benchmarks/v2/EXECUTION_CUSTODY.md', required_executor_attestations: ['recursive_package_hash_verified', 'assigned_brief_only', 'oracle_broker_only', 'no_golden_access', 'no_other_cell_access', 'clean_workspace', 'credential_only_runtime_home', 'environment_digest', 'raw_event_return'], cell_count: cells.length, cells }, null, 2)}\n`);
console.log(`Exported ${cells.length} externally isolated publication cells`);
