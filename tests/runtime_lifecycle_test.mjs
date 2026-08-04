#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  RUNTIME_IDENTITY_SCHEMA,
  assertCompatibleRuntimeIdentity,
  finalizeRuntimeCommand,
  readRuntimeIdentity,
  releaseGraphdAfterCommand,
  releaseRuntimeBetweenPhases,
  shouldReleaseGraphdAfterCommand,
  writeRuntimeIdentity,
} from '../packages/cli/lib/runtime-lifecycle.mjs';
import { runtimePaths } from '../packages/cli/lib/graph-runtime/util.mjs';
import { GRAPH_PROTOCOL_VERSION } from '../packages/cli/lib/graph-runtime/constants.mjs';
import { CLI_VERSION } from '../packages/cli/lib/runtime-identity.mjs';
import { removeTemporaryTree } from './test-util.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-runtime-lifecycle-'));
execFileSync('git', ['init', '-b', 'main'], { cwd: root });
execFileSync('git', ['config', 'user.email', 'test@lamina.invalid'], { cwd: root });
execFileSync('git', ['config', 'user.name', 'Lamina Test'], { cwd: root });
fs.writeFileSync(path.join(root, 'README.md'), '# lifecycle\n');
execFileSync('git', ['add', 'README.md'], { cwd: root });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root });
const paths = runtimePaths(root);
fs.mkdirSync(paths.runtime_dir, { recursive: true, mode: 0o700 });

assert.equal(assertCompatibleRuntimeIdentity(root).reason, 'greenfield');
fs.writeFileSync(paths.database, 'stub\n', { mode: 0o600 });
assert.equal(assertCompatibleRuntimeIdentity(root).upgraded, true);

const identity = writeRuntimeIdentity(root);
assert.equal(identity.schema, RUNTIME_IDENTITY_SCHEMA);
assert.equal(identity.cli_version, CLI_VERSION);
assert.equal(identity.protocol_version, GRAPH_PROTOCOL_VERSION);
assert.deepEqual(readRuntimeIdentity(root), identity);
assert.equal(assertCompatibleRuntimeIdentity(root).compatible, true);

const previous = process.env.LAMINA_RUNTIME_BOUNDED_TOPOLOGY;
process.env.LAMINA_RUNTIME_BOUNDED_TOPOLOGY = '1';
assert.equal(shouldReleaseGraphdAfterCommand({ persistGraphd: false }), true);
assert.equal(shouldReleaseGraphdAfterCommand({ persistGraphd: true }), false);
process.env.LAMINA_RUNTIME_BOUNDED_TOPOLOGY = '0';
assert.equal(shouldReleaseGraphdAfterCommand({ persistGraphd: false }), false);
if (previous === undefined) delete process.env.LAMINA_RUNTIME_BOUNDED_TOPOLOGY;
else process.env.LAMINA_RUNTIME_BOUNDED_TOPOLOGY = previous;

const incompatible = {
  schema: RUNTIME_IDENTITY_SCHEMA,
  layout_version: 99,
  cli_version: CLI_VERSION,
  protocol_version: GRAPH_PROTOCOL_VERSION,
};
fs.writeFileSync(runtimePaths(root).runtime_dir + '/runtime-identity.json', `${JSON.stringify(incompatible)}\n`);
assert.throws(
  () => assertCompatibleRuntimeIdentity(root),
  (error) => error.code === 'LAMINA_RUNTIME_INCOMPATIBLE',
);

const released = await releaseGraphdAfterCommand(root, { persistGraphd: false });
assert.equal(released.released, false);
assert.equal(released.reason, 'absent');

const absent = await releaseGraphdAfterCommand(root, { persistGraphd: false });
assert.equal(absent.released, false);
assert.equal(absent.reason, 'absent');

const finalized = await finalizeRuntimeCommand(root);
assert.equal(finalized.graphd.released, false);
assert.equal(finalized.graphd.reason, 'absent');

const betweenPhases = await releaseRuntimeBetweenPhases(root);
assert.equal(betweenPhases.released, true);
assert.equal(betweenPhases.reason, 'absent');

const kept = await releaseGraphdAfterCommand(root, { persistGraphd: true });
assert.equal(kept.released, false);
assert.equal(kept.reason, 'persist_graphd');

removeTemporaryTree(root);
process.stdout.write('runtime lifecycle tests passed\n');
