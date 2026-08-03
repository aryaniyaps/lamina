#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  isDelayedWindowsDeleteError, throwLifecycleErrors,
} from './test-util.mjs';

for (const code of ['EBUSY', 'ENOTEMPTY', 'EPERM']) {
  assert.equal(isDelayedWindowsDeleteError({ code }, 'win32'), true,
    `${code} is a documented delayed recursive-delete outcome on Windows`);
  assert.equal(isDelayedWindowsDeleteError({ code }, 'linux'), false,
    `${code} must remain fatal outside Windows cleanup`);
  assert.equal(isDelayedWindowsDeleteError({ code }, 'darwin'), false,
    `${code} must remain fatal outside Windows cleanup`);
}
for (const code of ['EACCES', 'ENOENT', 'EINVAL', undefined]) {
  assert.equal(isDelayedWindowsDeleteError({ code }, 'win32'), false,
    `${String(code)} is not an admitted delayed Windows directory removal`);
}

const primary = new Error('primary lifecycle failure');
assert.throws(() => throwLifecycleErrors(primary, [], 'focused lifecycle test'),
  (error) => error === primary,
  'primary lifecycle errors are never masked by delayed post-assertion cleanup policy');
const cleanup = Object.assign(new Error('cleanup failure'), { code: 'EPERM' });
assert.throws(() => throwLifecycleErrors(primary, [cleanup], 'focused lifecycle test'),
  (error) => error instanceof AggregateError
    && error.errors.includes(primary) && error.errors.includes(cleanup),
  'a primary failure and cleanup failure remain an aggregate lifecycle error');

console.log('test utility portability contracts passed');
