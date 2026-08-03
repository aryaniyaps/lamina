#!/usr/bin/env node
import {
  buildCandidateRuntimeSnapshot,
} from '../../benchmarks/real-repository-oracle-v1/candidate-runtime-closure.mjs';

const snapshotRoot = process.argv[2];
process.stdout.write('READY\n');
await new Promise((resolve) => process.stdin.once('data', resolve));
const snapshot = buildCandidateRuntimeSnapshot({ snapshot_root: snapshotRoot });
process.stdout.write(`${JSON.stringify({
  authority: snapshot.builder_identities.node.authority,
  pid: snapshot.builder_identities.node.pid,
  source_ino: snapshot.builder_identities.node.stable.ino,
  source_digest: snapshot.builder_identities.node.digest,
  sealed_digest: snapshot.records.find((record) => record.name === 'node').sha256,
})}\n`);
