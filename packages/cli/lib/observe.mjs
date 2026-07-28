import fs from 'node:fs';
import path from 'node:path';
import { ensureGraphd, graphRequest } from './graph-runtime/client.mjs';
import { digest } from './graph-runtime/util.mjs';
import { OBSERVATION_BACKEND as COCOINDEX_BACKEND, runCocoIndex } from './observation-runtime/cocoindex.mjs';
import { OBSERVATION_BACKEND as NODE_BACKEND, observeNode } from './observation-runtime/node.mjs';

const ignore = [
  '**/.git/**', '**/.lamina/runs/**', '**/node_modules/**', '**/.venv*/**',
  '**/__pycache__/**', '**/.next/**', '**/dist/**', '**/build/**', '**/coverage/**',
  '**/benchmarks/results/**', '**/evals/fixtures/.vendor-tmp*/**',
];

/**
 * The public observation contract is independent of its implementation. The
 * default backend is CocoIndex, shipped as a private native worker with the
 * standalone release. The Node backend remains an explicit development switch.
 */
export async function runObservation({ cwd = process.cwd(), live = false, invalidate = false, discover = false } = {}) {
  const backend = process.env.LAMINA_OBSERVATION_BACKEND || COCOINDEX_BACKEND;
  if (![COCOINDEX_BACKEND, NODE_BACKEND].includes(backend)) {
    const error = new Error(`Unsupported observation backend: ${backend}.`);
    error.code = 'LAMINA_OBSERVATION_UNAVAILABLE';
    throw error;
  }
  const paths = await ensureGraphd(cwd);
  const invalidation = invalidate
    ? await graphRequest('observation.invalidate', { product: paths.product }, cwd)
    : null;
  let generation = fs.readFileSync(path.join(paths.cocoindex, 'target-generation'), 'utf8').trim();
  const extractorDigest = digest('extractors', ['lamina.source-file.v2']);
  const workerDiagnostics = [];
  if (backend === COCOINDEX_BACKEND) {
    workerDiagnostics.push(runCocoIndex({ paths, generation, live, ignore, extractorDigest }));
  } else {
    await observeNode({ paths, generation, graphRequest, live, ignoreDigest: digest('ignore', ignore), extractorDigest });
  }
  let observed = await graphRequest('observation.status', { product: paths.product, generation }, cwd);
  // CocoIndex commits the target-state transaction before its final graphd
  // batch can be visible. Wait for that committed view and retry once from a
  // fresh generation if it was interrupted after target-state commit.
  const deadline = Date.now() + 10_000;
  while (!observed.exists && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    observed = await graphRequest('observation.status', { product: paths.product, generation }, cwd);
  }
  if (!observed.exists && backend === COCOINDEX_BACKEND && !live) {
    const recovery = await graphRequest('observation.invalidate', { product: paths.product }, cwd);
    generation = recovery.generation;
    workerDiagnostics.push(runCocoIndex({ paths, generation, live, ignore, extractorDigest }));
    const recoveryDeadline = Date.now() + 10_000;
    while (!observed.exists && Date.now() < recoveryDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      observed = await graphRequest('observation.status', { product: paths.product, generation }, cwd);
    }
  }
  if (!observed.exists || observed.count !== observed.source_key_count ||
      (observed.count > 0 && !observed.source_revisions.includes(paths.source_revision))) {
    const error = new Error('Observation runtime exited without a complete committed graphd target state.');
    error.code = 'LAMINA_OBSERVATION_INCOMPLETE';
    error.details = {
      backend,
      expected_source_revision: paths.source_revision,
      observed,
      ...(workerDiagnostics.length ? { worker_diagnostics: workerDiagnostics } : {}),
    };
    throw error;
  }
  return {
    ok: true,
    backend,
    mode: live ? 'live' : invalidate ? 'rebuild' : discover ? 'discover' : 'observe',
    invalidation,
    generation,
    expected: observed.source_key_count,
    observed,
    discovery_report: discover ? {
      source_roots: observed.source_roots,
      ignored_patterns: ignore,
      extractor_coverage: observed.coverage,
      unsupported_sources: observed.unsupported,
      stale_snapshots: observed.source_revisions.filter((item) => item !== paths.source_revision),
      limitations: observed.limitations,
    } : undefined,
  };
}
