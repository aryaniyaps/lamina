#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LANDLOCK_CANDIDATE_CANARY_MIN_FD,
  LANDLOCK_CANDIDATE_REPOSITORY_ALIAS,
  LANDLOCK_CANDIDATE_REPOSITORY_FD,
  SECCOMP_DENIED_SYSCALL_CLASSES,
  landlockCandidateArguments,
  landlockCandidateDescriptorLayout,
} from '../scripts/safe-runner/landlock-candidate-launcher.mjs';

assert.equal(LANDLOCK_CANDIDATE_CANARY_MIN_FD, 1025);
assert.equal(LANDLOCK_CANDIDATE_REPOSITORY_FD, 7);
assert.equal(LANDLOCK_CANDIDATE_REPOSITORY_ALIAS, '/proc/self/fd/7');
assert.deepEqual(landlockCandidateDescriptorLayout(3), {
  launcher: 3,
  node: 4,
  adapter: 5,
  input: 6,
  repository: 7,
  output: 8,
  scratch: 9,
  configuration: 10,
  runtimes: [11, 12, 13],
  candidate_argv: [
    '/proc/self/fd/4', '/proc/self/fd/5', '/proc/self/fd/6',
    '/proc/self/fd/7', '/proc/self/fd/8', '/proc/self/fd/9',
  ],
  repository_alias: '/proc/self/fd/7',
});
assert.deepEqual(landlockCandidateArguments(), [
  '/proc/self/fd/4', '/proc/self/fd/5', '/proc/self/fd/6',
  '/proc/self/fd/7', '/proc/self/fd/8', '/proc/self/fd/9',
]);
assert.equal(landlockCandidateArguments().some((value) => value.includes('/tmp/')), false);
assert.throws(() => landlockCandidateDescriptorLayout(-1), /runtime closure/);
assert.throws(() => landlockCandidateDescriptorLayout(33), /runtime closure/);
assert.deepEqual(SECCOMP_DENIED_SYSCALL_CLASSES.network_creation,
  ['socket', 'socketpair']);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(
  root, 'benchmarks/real-repository-oracle-v1/landlock-candidate-launcher.c',
), 'utf8');
assert.match(source, /fcntl\(scratch_fd, F_DUPFD, CANARY_MIN_FD\)/);
assert.match(source, /lamina-fd-seal-canary\/v1:%d\\n/);
assert.match(source, /__NR_close_range, CONFIGURATION_FD, UINT_MAX, 0/);
assert.match(source, /fcntl\(canary_fd, F_GETFD\) != -1 \|\| errno != EBADF/);
assert.match(source, /setrlimit\(RLIMIT_NOFILE, &original_nofile\)/);

console.log('real repository oracle shared Landlock launcher contracts passed');
