#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = path.resolve('packages/cli/bin/lamina.mjs');

for (const [args, patterns] of [
  [['--help'], [/Usage: lamina <command>/, /lamina graph --help/]],
  [['graph', '--help'], [/Usage: lamina graph <command>/, /propose --input FILE/, /restore --input FILE/]],
  [['context', '--help'], [/Usage: lamina context <command>/, /status/, /rebuild/, /canonical product graph/]],
  [['design', '--help'], [/prepare-walk --workflow WORKFLOW/, /record-walk --task FILE/, /no separately authored Experience Contract/]],
  [['work', '--help'], [/Usage: lamina work <command>/, /prepare --request-file FILE/, /map --packet FILE/, /mechanically creates every obligation/, /action=modify/, /action=create/, /accessibility evidence/]],
  [['session', '--help'], [/Usage: lamina session <command>/, /publish SESSION/]],
  [['mission', '--help'], [/Usage: lamina mission <command>/, /--events FILE must contain a JSON array/]],
]) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  for (const pattern of patterns) assert.match(result.stdout, pattern);
}

const invalid = spawnSync(process.execPath, [cli, 'graph', 'not-a-command'], {
  encoding: 'utf8',
});
assert.equal(invalid.status, 1);
assert.equal(JSON.parse(invalid.stderr).error.code, 'LAMINA_BAD_REQUEST');

console.log('cli_help_test: ok');
