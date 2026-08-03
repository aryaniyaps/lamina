#!/usr/bin/env node
import fs from 'node:fs';
import {
  buildCandidateRuntimeSnapshot,
} from '../../benchmarks/real-repository-oracle-v1/candidate-runtime-closure.mjs';
import {
  prepareCandidateSandbox,
  runCandidateSandbox,
} from '../../benchmarks/real-repository-oracle-v1/candidate-sandbox.mjs';
import { descendantRecords } from '../../scripts/safe-runner/processes.mjs';

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const runtime = buildCandidateRuntimeSnapshot({ snapshot_root: config.runtime_snapshot });
const authority = prepareCandidateSandbox({
  runtime_snapshot: runtime,
  adapter_root: config.adapter_root,
  adapter_entrypoint: config.adapter_entrypoint,
  public_input: config.public_input,
  repository: config.repository,
  output_file: config.output_file,
  timeout_ms: 60_000,
  git_dependent: false,
});
const running = runCandidateSandbox(authority);
const timer = setInterval(() => {
  if (descendantRecords(process.pid).length >= 2) {
    clearInterval(timer);
    process.stdout.write('READY\n');
  }
}, 10);
await running;
