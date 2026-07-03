import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

test('lamina scan prints markdown summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-cli-scan-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { express: '5.0.0' } }));
    const { io, output } = captureIo(root);
    const code = await runCli(['scan'], io);
    assert.equal(code, 0);
    assert.match(output().stdout, /## What I found/);
    assert.match(output().stdout, /Express/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lamina scan --json prints context json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-cli-scan-json-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
    const { io, output } = captureIo(root);
    const code = await runCli(['scan', '--json'], io);
    assert.equal(code, 0);
    const parsed = JSON.parse(output().stdout);
    assert.equal(parsed.frameworks.includes('React'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
