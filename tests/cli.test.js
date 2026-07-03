import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../src/cli.js';

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: (text) => { stderr += text; } },
    },
    output: () => ({ stdout, stderr }),
  };
}

test('prints help with no arguments', async () => {
  const { io, output } = captureIo();
  const code = await runCli([], io);
  assert.equal(code, 0);
  assert.match(output().stdout, /Usage: lamina <command>/);
  assert.match(output().stdout, /init/);
  assert.match(output().stdout, /scan/);
  assert.match(output().stdout, /start/);
});

test('prints help with --help', async () => {
  const { io, output } = captureIo();
  const code = await runCli(['--help'], io);
  assert.equal(code, 0);
  assert.match(output().stdout, /Usage: lamina <command>/);
});

test('unknown command exits with code 1', async () => {
  const { io, output } = captureIo();
  const code = await runCli(['wat'], io);
  assert.equal(code, 1);
  assert.match(output().stderr, /Unknown command: wat/);
});
