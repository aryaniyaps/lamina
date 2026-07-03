import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/cli.js';

function captureIo(cwd) {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      cwd: () => cwd,
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: (text) => { stderr += text; } },
    },
    output: () => ({ stdout, stderr }),
  };
}

test('lamina init creates .lamina in the current directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-cli-init-'));
  try {
    const { io, output } = captureIo(root);
    const code = await runCli(['init'], io);
    assert.equal(code, 0);
    assert.equal(existsSync(join(root, '.lamina', 'config.yml')), true);
    assert.match(output().stdout, /Created .lamina/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
