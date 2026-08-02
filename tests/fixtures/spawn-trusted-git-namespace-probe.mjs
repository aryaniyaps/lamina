#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnTrustedGit } from '../../scripts/safe-runner/git.mjs';

const expected = process.argv[2];
const encodedIdentity = process.env.LAMINA_SAFE_GIT_IDENTITY;
let sealedIdentity = null;
try { sealedIdentity = JSON.parse(Buffer.from(encodedIdentity || '', 'base64url').toString('utf8')); }
catch {}
const attempt = () => {
  try {
    const result = spawnTrustedGit('/', ['--version'], {
      encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      ok: result.status === 0,
      output: String(result.stdout || '').trim(),
      error: result.error?.message || null,
    };
  } catch (error) {
    return { ok: false, output: '', error: error.message, code: error.code || null };
  }
};

const first = attempt();
const sealConsumed = process.env.LAMINA_SAFE_GIT_IDENTITY === undefined;
const retry = attempt();
if (expected === 'valid') {
  assert.equal(first.ok, true);
  assert.equal(retry.ok, true);
  assert.match(first.output, /^git version /);
} else if (expected === 'missing') {
  assert.equal(first.ok, false);
  assert.equal(retry.ok, false);
  assert.equal(first.code, 'LAMINA_SAFE_GIT_IDENTITY');
  assert.equal(retry.code, 'LAMINA_SAFE_GIT_IDENTITY');
  assert.match(first.error, /required in a non-initial user namespace/);
  assert.match(retry.error, /previously failed validation/);
} else if (expected === 'invalid') {
  assert.equal(first.ok, false);
  assert.equal(retry.ok, false);
  assert.equal(first.code, 'LAMINA_SAFE_GIT_IDENTITY');
  assert.equal(retry.code, 'LAMINA_SAFE_GIT_IDENTITY');
  assert.match(retry.error, /previously failed validation/);
} else {
  throw new Error(`unknown namespace Git probe expectation: ${expected}`);
}
process.stdout.write(`${JSON.stringify({
  expected,
  first,
  retry,
  seal_consumed: sealConsumed,
  uid: typeof process.getuid === 'function' ? process.getuid() : null,
  uid_map: fs.readFileSync('/proc/self/uid_map', 'utf8').trim(),
  controller_git_uid: sealedIdentity?.uid ?? null,
  namespace_git_uid: sealedIdentity?.path
    ? Number(fs.lstatSync(sealedIdentity.path, { bigint: true }).uid) : null,
})}\n`);
