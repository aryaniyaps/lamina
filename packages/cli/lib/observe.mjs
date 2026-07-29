import fs from 'node:fs';
import path from 'node:path';
import {
  daemonCompatibility,
  ensureGraphd,
  graphdIdentity,
  graphRequest,
  restartGraphd,
} from './graph-runtime/client.mjs';
import { digest } from './graph-runtime/util.mjs';
import { OBSERVATION_BACKEND as COCOINDEX_BACKEND, runCocoIndex } from './observation-runtime/cocoindex.mjs';
import { OBSERVATION_BACKEND as NODE_BACKEND, observeNode } from './observation-runtime/node.mjs';

const ignore = [
  '**/.git/**', '**/.lamina/runs/**', '**/.lamina/runtime/**', '**/.lamina/runtime-cli/**',
  '**/.agents/skills/**', '**/.codex/skills/**', '**/.claude/skills/**', '**/.opencode/skills/**',
  '**/node_modules/**', '**/.venv*/**',
  '**/__pycache__/**', '**/.next/**', '**/dist/**', '**/build/**', '**/coverage/**',
  '**/benchmarks/results/**', '**/evals/fixtures/.vendor-tmp*/**',
];

function check(pass, expected, actual) {
  return { pass, expected, actual };
}

export function observationCompletionChecks(observed, {
  generation,
  sourceRevision,
  workerCompleted = true,
} = {}) {
  const statusObject = Boolean(observed) && typeof observed === 'object' && !Array.isArray(observed);
  const checks = {
    'status.object': check(statusObject, 'object', observed === null ? 'null' : typeof observed),
    'status.exists': check(typeof observed?.exists === 'boolean', 'boolean', typeof observed?.exists),
    'status.count': check(
      Number.isInteger(observed?.count) && observed.count >= 0,
      'non-negative integer',
      observed?.count,
    ),
    'status.source_key_count': check(
      Number.isInteger(observed?.source_key_count) && observed.source_key_count >= 0,
      'non-negative integer',
      observed?.source_key_count,
    ),
    'status.source_revisions': check(
      Array.isArray(observed?.source_revisions) &&
        observed.source_revisions.every((item) => typeof item === 'string'),
      'string array',
      observed?.source_revisions,
    ),
    'status.generation': check(
      typeof observed?.generation === 'string',
      generation,
      observed?.generation,
    ),
    'target.generation_matches': check(observed?.generation === generation, generation, observed?.generation),
    'target.exists': check(observed?.exists === true, true, observed?.exists),
    'target.count_matches_source_keys': check(
      Number.isInteger(observed?.count) &&
        Number.isInteger(observed?.source_key_count) &&
        observed.count === observed.source_key_count,
      observed?.source_key_count,
      observed?.count,
    ),
    'target.current_revision_present': check(
      Array.isArray(observed?.source_revisions) &&
        observed.source_revisions.includes(sourceRevision),
      sourceRevision,
      observed?.source_revisions,
    ),
    'worker.completed': check(workerCompleted, true, workerCompleted),
  };
  const shapeChecks = [
    'status.object',
    'status.exists',
    'status.count',
    'status.source_key_count',
    'status.source_revisions',
    'status.generation',
  ];
  const failedChecks = Object.entries(checks)
    .filter(([, result]) => !result.pass)
    .map(([name]) => name);
  return {
    valid_shape: shapeChecks.every((name) => checks[name].pass),
    complete: failedChecks.length === 0,
    failed_checks: failedChecks,
    checks,
  };
}

async function observationStatus(cwd, product, generation, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let observed = await graphRequest('observation.status', { product, generation }, cwd);
  while (observed?.exists === false && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    observed = await graphRequest('observation.status', { product, generation }, cwd);
  }
  return observed;
}

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

  const runWorker = async (attempt) => {
    try {
      if (backend === COCOINDEX_BACKEND) {
        const result = runCocoIndex({ paths, generation, live, ignore, extractorDigest });
        workerDiagnostics.push({ attempt, ok: true, ...result });
      } else {
        await observeNode({
          paths,
          generation,
          graphRequest,
          live,
          ignoreDigest: digest('ignore', ignore),
          extractorDigest,
        });
        workerDiagnostics.push({ attempt, ok: true, backend });
      }
      return true;
    } catch (error) {
      if (error.code === 'LAMINA_OBSERVATION_UNAVAILABLE') throw error;
      workerDiagnostics.push({
        attempt,
        ok: false,
        code: error.code || 'LAMINA_OBSERVATION_FAILED',
        message: error.message,
        details: error.details || {},
      });
      return false;
    }
  };

  let workerCompleted = await runWorker(1);
  let observed = await observationStatus(cwd, paths.product, generation);
  let completion = observationCompletionChecks(observed, {
    generation,
    sourceRevision: paths.source_revision,
    workerCompleted,
  });
  let compatibilityRecovery = null;

  if (!completion.valid_shape) {
    const before = await graphdIdentity(cwd);
    const replacement = await restartGraphd(cwd, before?.pid);
    compatibilityRecovery = {
      reason: 'invalid_observation_status_contract',
      previous_daemon: before,
      replacement_daemon: replacement.daemon,
    };
    observed = await observationStatus(cwd, paths.product, generation);
    completion = observationCompletionChecks(observed, {
      generation,
      sourceRevision: paths.source_revision,
      workerCompleted,
    });
  }

  // Retry the observer once against the compatible daemon without changing
  // generation. Rebuilds are explicit because invalidation destroys the
  // active observation view and cannot repair runtime-version skew.
  if (!completion.complete && !live) {
    const retryCompleted = await runWorker(2);
    workerCompleted = retryCompleted;
    observed = await observationStatus(cwd, paths.product, generation);
    completion = observationCompletionChecks(observed, {
      generation,
      sourceRevision: paths.source_revision,
      workerCompleted,
    });
  }

  const daemon = await graphdIdentity(cwd);
  if (!completion.complete) {
    const error = new Error('Observation runtime exited without a complete committed graphd target state.');
    error.code = 'LAMINA_OBSERVATION_INCOMPLETE';
    error.details = {
      backend,
      failed_checks: completion.failed_checks,
      checks: completion.checks,
      expected: {
        generation,
        source_revision: paths.source_revision,
      },
      observed,
      daemon: {
        ...daemon,
        compatibility: daemonCompatibility(daemon),
      },
      ...(compatibilityRecovery ? { compatibility_recovery: compatibilityRecovery } : {}),
      ...(workerDiagnostics.length ? { worker_diagnostics: workerDiagnostics } : {}),
      troubleshooting: completion.failed_checks.some((item) => item.startsWith('status.'))
        ? 'Reinstall or restart Lamina if graphd still lacks the required status contract.'
        : 'Run `lamina graph rebuild-observations` only when the reported target generation is genuinely incomplete or corrupted.',
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
