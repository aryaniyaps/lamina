#!/usr/bin/env node
import { assertSafeRunnerContext } from '../../packages/cli/lib/safe-runner-context.mjs';

assertSafeRunnerContext('Compatibility matrix', { minimumTier: 'medium' });

const [{ default: fs }, { default: path }, { spawnSync }, { fileURLToPath }] = await Promise.all([
  import('node:fs'), import('node:path'), import('node:child_process'), import('node:url'),
]);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'evals/reports/compatibility-matrix.json');
const sandbox = path.join(root, 'evals/hooks/skills-sandbox.sh');
const agents = [
  'cursor', 'claude-code', 'codex', 'opencode', 'gemini-cli', 'github-copilot',
  'roo', 'windsurf', 'cline', 'amp', 'goose', 'antigravity', 'pi',
];
const results = agents.map((agent) => {
  const result = spawnSync('/bin/bash', [
    '-c', 'source "$1"; skills_dry_run -a "$2" -y --dry-run >/dev/null 2>&1',
    'lamina-compatibility', sandbox, agent,
  ], { cwd: root, stdio: 'ignore', env: process.env });
  return { agent, status: result.status === 0 ? 'pass' : 'fail' };
});
const passed = results.filter((item) => item.status === 'pass').length;
const failed = results.length - passed;
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify({
  timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  passed,
  failed,
  agents: results,
}, null, 2)}\n`);
process.stdout.write(`Compatibility matrix: ${passed} passed, ${failed} failed -> ${output}\n`);
process.exit(failed);
