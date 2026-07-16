#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  isLaminaArtifactPath,
  diffOutsideLamina,
  checkWriteBoundary,
  buildFileHashMap,
} from '../evals/lib/lamina-write-boundary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-write-boundary-'));
}

// isLaminaArtifactPath
assert.equal(isLaminaArtifactPath('.lamina/runs/x/run.json'), true);
assert.equal(isLaminaArtifactPath('.lamina'), true);
assert.equal(isLaminaArtifactPath('lib/CheckoutForm.tsx'), false);
assert.equal(isLaminaArtifactPath('preview/App.tsx'), false);
assert.equal(isLaminaArtifactPath('packages/foo/src/index.ts'), false);

// new file outside .lamina/
{
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  const pre = { file_hashes: buildFileHashMap(dir) };
  fs.writeFileSync(path.join(dir, 'lib', 'foo.ts'), 'export const x = 1;\n');
  const post = { file_hashes: buildFileHashMap(dir) };
  const violations = diffOutsideLamina(pre, post);
  assert.ok(violations.includes('lib/foo.ts'), `expected lib/foo.ts in ${violations}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// modified file outside .lamina/
{
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lib', 'foo.ts'), 'v1\n');
  const pre = { file_hashes: buildFileHashMap(dir) };
  fs.writeFileSync(path.join(dir, 'lib', 'foo.ts'), 'v2\n');
  const post = { file_hashes: buildFileHashMap(dir) };
  const violations = diffOutsideLamina(pre, post);
  assert.ok(violations.includes('lib/foo.ts'), `expected modified lib/foo.ts in ${violations}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// writes inside .lamina/ are allowed
{
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, '.lamina', 'runs', 'test'), { recursive: true });
  const pre = { file_hashes: buildFileHashMap(dir) };
  fs.writeFileSync(path.join(dir, '.lamina', 'runs', 'test', 'run.json'), 'id: test\n');
  const post = { file_hashes: buildFileHashMap(dir) };
  const violations = diffOutsideLamina(pre, post);
  assert.equal(violations.length, 0, `unexpected violations: ${violations}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// checkWriteBoundary
{
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const pre = { file_hashes: buildFileHashMap(dir) };
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'console.log(1)\n');
  const post = { file_hashes: buildFileHashMap(dir) };
  const result = checkWriteBoundary(pre, post);
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('src/app.ts'));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('lamina_write_boundary_test: ok');
