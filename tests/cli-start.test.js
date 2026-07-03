import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../src/cli.js';

test('lamina start requires interactive ask support in tests and adapters', async () => {
  let stderr = '';
  const code = await runCli(['start'], {
    cwd: () => process.cwd(),
    stdout: { write: () => {} },
    stderr: { write: (text) => { stderr += text; } },
  });

  assert.equal(code, 1);
  assert.match(stderr, /Interactive input is required/);
});
