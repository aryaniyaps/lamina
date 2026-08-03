/** Bounded runtime task/thread policy for #52 Spike 1 (D+A) and #53 topology leaves.
 *
 * Activated when LAMINA_RUNTIME_BOUNDED_TOPOLOGY=1. Defaults are conservative
 * caps that keep aggregate cgroup tasks under ADR-014 pids.max=64 without
 * raising safe-runner limits.
 */

const POSITIVE_INT = /^\d+$/;

function readPositiveInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim();
  if (!POSITIVE_INT.test(normalized)) return fallback;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function runtimeBudgetFromEnvironment(env = process.env) {
  if (env.LAMINA_RUNTIME_BOUNDED_TOPOLOGY !== '1') return null;
  return Object.freeze({
    enabled: true,
    graphd_threads: readPositiveInt(env.LAMINA_RUNTIME_GRAPHD_THREADS, 4),
    worker_threads: readPositiveInt(env.LAMINA_RUNTIME_WORKER_THREADS, 4),
    observation_workers_max: readPositiveInt(env.LAMINA_RUNTIME_OBSERVATION_WORKERS, 1),
    observation_retries_max: readPositiveInt(env.LAMINA_RUNTIME_OBSERVATION_RETRIES, 0),
    defer_graphd_compat_recovery: env.LAMINA_RUNTIME_DEFER_GRAPHD_COMPAT_RECOVERY !== '0',
    idle_graphd_shutdown_ms: readPositiveInt(env.LAMINA_RUNTIME_IDLE_GRAPHD_SHUTDOWN_MS, 0),
  });
}

export function threadLimitEnvironment(threads) {
  const cap = String(Math.max(1, threads));
  return Object.freeze({
    OMP_NUM_THREADS: cap,
    OPENBLAS_NUM_THREADS: cap,
    MKL_NUM_THREADS: cap,
    VECLIB_MAXIMUM_THREADS: cap,
    NUMEXPR_NUM_THREADS: cap,
    ORT_NUM_THREADS: cap,
    UV_THREADPOOL_SIZE: cap,
    TOKENIZERS_PARALLELISM: 'false',
  });
}

export function applyRuntimeBudgetToEnvironment(baseEnv = process.env, budget = runtimeBudgetFromEnvironment(baseEnv)) {
  if (!budget) return { ...baseEnv };
  return {
    ...baseEnv,
    LAMINA_RUNTIME_BOUNDED_TOPOLOGY: '1',
    LAMINA_RUNTIME_GRAPHD_THREADS: String(budget.graphd_threads),
    LAMINA_RUNTIME_WORKER_THREADS: String(budget.worker_threads),
    LAMINA_RUNTIME_OBSERVATION_WORKERS: String(budget.observation_workers_max),
    LAMINA_RUNTIME_OBSERVATION_RETRIES: String(budget.observation_retries_max),
    ...(budget.defer_graphd_compat_recovery
      ? { LAMINA_RUNTIME_DEFER_GRAPHD_COMPAT_RECOVERY: '1' }
      : {}),
    ...(budget.idle_graphd_shutdown_ms > 0
      ? { LAMINA_RUNTIME_IDLE_GRAPHD_SHUTDOWN_MS: String(budget.idle_graphd_shutdown_ms) }
      : {}),
  };
}

export function workerThreadEnvironment(budget = runtimeBudgetFromEnvironment()) {
  if (!budget) return {};
  return threadLimitEnvironment(budget.worker_threads);
}

export function graphdThreadEnvironment(budget = runtimeBudgetFromEnvironment()) {
  if (!budget) return {};
  return threadLimitEnvironment(budget.graphd_threads);
}

export function maxObservationAttempts(budget = runtimeBudgetFromEnvironment()) {
  if (!budget) return 2;
  return Math.max(1, budget.observation_workers_max + budget.observation_retries_max);
}
