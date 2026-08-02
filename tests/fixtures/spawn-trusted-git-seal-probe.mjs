#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnTrustedGit, trustedGitIdentity } from '../../scripts/safe-runner/git.mjs';

const mode = process.argv[2];
const temporaryRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-git-seal-')));
fs.chmodSync(temporaryRoot, 0o700);
try {
  const identity = trustedGitIdentity();
  if (mode === 'malformed') {
    process.env.LAMINA_SAFE_GIT_IDENTITY = 'not-base64!';
  } else if (mode === 'oversized') {
    process.env.LAMINA_SAFE_GIT_IDENTITY = 'A'.repeat(4_097);
  } else if (mode === 'extra-field') {
    process.env.LAMINA_SAFE_GIT_IDENTITY = Buffer.from(JSON.stringify({
      ...identity, forged: true,
    })).toString('base64url');
  } else if (mode === 'mismatched') {
    process.env.LAMINA_SAFE_GIT_IDENTITY = Buffer.from(JSON.stringify({
      ...identity,
      digest: `${identity.digest[0] === 'f' ? 'e' : 'f'}${identity.digest.slice(1)}`,
    })).toString('base64url');
  } else if (mode === 'valid') {
    process.env.LAMINA_SAFE_GIT_IDENTITY = Buffer.from(JSON.stringify(identity)).toString('base64url');
  } else {
    throw new Error(`unknown sealed Git probe mode: ${mode}`);
  }

  const attempt = () => {
    try {
      const result = spawnTrustedGit(temporaryRoot, ['--version'], {
        encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { ok: result.status === 0, error: result.error?.message || null };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code || null };
    }
  };
  const first = attempt();
  const removedAfterFirst = process.env.LAMINA_SAFE_GIT_IDENTITY === undefined;
  const retry = attempt();
  if (mode === 'valid') {
    assert.equal(first.ok, true);
    assert.equal(retry.ok, true);
  } else {
    assert.equal(first.ok, false);
    assert.equal(retry.ok, false);
    assert.equal(first.code, 'LAMINA_SAFE_GIT_IDENTITY');
    assert.equal(retry.code, 'LAMINA_SAFE_GIT_IDENTITY');
    assert.match(retry.error, /previously failed validation/);
  }
  assert.equal(removedAfterFirst, true);
  process.stdout.write(`${JSON.stringify({ mode, first, retry, removed_after_first: removedAfterFirst })}\n`);
} finally {
  delete process.env.LAMINA_SAFE_GIT_IDENTITY;
  fs.rmSync(temporaryRoot, { recursive: true, force: false });
}
