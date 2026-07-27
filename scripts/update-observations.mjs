#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ensureGraphd, graphRequest } from '../skills/lamina-orchestrator/lib/graph-runtime/client.mjs';
import { digest, graphSocketPath, runtimePaths } from '../skills/lamina-orchestrator/lib/graph-runtime/util.mjs';

const paths = await ensureGraphd();
const ignore = ['.git', '.lamina', 'node_modules', '.venv', '__pycache__'];
const targetGenerationFile = `${paths.cocoindex}/target-generation`;
if (!fs.existsSync(targetGenerationFile)) {
  fs.writeFileSync(targetGenerationFile, `${digest('generation', { database: paths.database, initialized: Date.now() })}\n`);
}
const generation = fs.readFileSync(targetGenerationFile, 'utf8').trim();
const environment = {
  ...process.env,
  COCOINDEX_DB: `${paths.cocoindex}/state.db`,
  LAMINA_SOURCE_ROOT: paths.root,
  LAMINA_GRAPHD_SOCKET: graphSocketPath(paths),
  LAMINA_PRODUCT: paths.product,
  LAMINA_SOURCE_REVISION: paths.source_revision,
  LAMINA_IGNORE_DIGEST: digest('ignore', ignore),
  LAMINA_EXTRACTOR_DIGEST: digest('extractors', ['lamina.source-file.v1']),
  LAMINA_OBSERVATION_GENERATION: generation,
};
const args = ['run', '--project', paths.root, '--python', '3.13', 'cocoindex', 'update'];
if (process.argv.includes('--live')) args.push('--live');
args.push(`${paths.root}/cocoindex_app.py`);
const result = spawnSync('uv', args, { cwd: paths.root, env: environment, stdio: 'inherit' });
if (result.error) throw result.error;
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

const excluded = new Set(['.git', '.lamina', 'node_modules', '.venv', '__pycache__']);
function countSourceFiles(directory) {
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) count += countSourceFiles(full);
    else if (entry.isFile()) count += 1;
  }
  return count;
}
const expected = countSourceFiles(paths.root);
const observed = await graphRequest('observation.status', {
  product: environment.LAMINA_PRODUCT,
  generation,
});
if (!observed.exists || observed.count !== expected ||
    (expected > 0 && !observed.source_revisions.includes(paths.source_revision))) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: {
      code: 'LAMINA_OBSERVATION_INCOMPLETE',
      message: 'CocoIndex exited without a complete committed graphd target state.',
      details: { expected, observed },
    },
  }, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ ok: true, expected, observed }, null, 2)}\n`);
