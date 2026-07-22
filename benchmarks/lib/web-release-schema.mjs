import { CONTRACT_VERSION, SUPPORTED_STATUSES } from './web-release-lib.mjs';

const SOURCE_KEYS = new Set(['repository', 'commit', 'protocolSha256']);
const RUNTIME_KEYS = new Set(['agent', 'model', 'attemptsPerArm', 'totalBudgetSecondsPerArm']);
const STEP_BUDGET_KEYS = new Set(['step', 'agentTimeoutSeconds', 'verifierTimeoutSeconds']);
const ARM_KEYS = new Set([
  'id',
  'label',
  'description',
  'workflowSteps',
  'totalBudgetSeconds',
  'stepBudgets',
]);
const TASK_KEYS = new Set(['id', 'kind', 'stage', 'briefPath', 'title', 'summary']);
const CONTROL_KEYS = new Set(['id', 'label', 'description']);
const ARTIFACT_KEYS = new Set(['id', 'label', 'role', 'path', 'url']);

const SHARED_RELEASE_KEYS = new Set([
  'contractVersion',
  'releaseKey',
  'benchmarkId',
  'benchmarkVersion',
  'status',
  'generatedAt',
  'construct',
  'measurement',
  'source',
  'runtime',
  'arms',
  'tasks',
  'controls',
  'artifacts',
]);

const STATUS_EXTENSION_KEYS = {
  running: ['methodologyLockedAt'],
  withheld: ['withheldAt', 'reasonCode'],
  published: ['publishedAt', 'coverage', 'results'],
};

const PUBLISHED_COVERAGE_KEYS = new Set(['tasks', 'arms', 'attemptsPerArm', 'completeCells']);
const PUBLISHED_RESULTS_KEYS = new Set(['aggregate', 'perTask', 'uncertainty']);
const PUBLISHED_PER_TASK_KEYS = new Set(['taskId', 'arm', 'rate']);

function validateExactKeys(value, allowedKeys, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unexpected field ${label}.${key}`);
    }
  }
}

function allowedReleaseKeys(status) {
  const keys = new Set(SHARED_RELEASE_KEYS);
  for (const key of STATUS_EXTENSION_KEYS[status] ?? []) keys.add(key);
  return keys;
}

export function validateReleaseExactKeys(release, errors) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) return;

  const status = release.status;
  if (SUPPORTED_STATUSES.has(status)) {
    validateExactKeys(release, allowedReleaseKeys(status), 'release', errors);
  }

  validateExactKeys(release.source, SOURCE_KEYS, 'source', errors);
  validateExactKeys(release.runtime, RUNTIME_KEYS, 'runtime', errors);

  if (Array.isArray(release.arms)) {
    for (const [index, arm] of release.arms.entries()) {
      validateExactKeys(arm, ARM_KEYS, `arms[${index}]`, errors);
      if (Array.isArray(arm.stepBudgets)) {
        for (const [stepIndex, step] of arm.stepBudgets.entries()) {
          validateExactKeys(step, STEP_BUDGET_KEYS, `arms[${index}].stepBudgets[${stepIndex}]`, errors);
        }
      }
    }
  }

  if (Array.isArray(release.tasks)) {
    for (const [index, task] of release.tasks.entries()) {
      validateExactKeys(task, TASK_KEYS, `tasks[${index}]`, errors);
    }
  }

  if (Array.isArray(release.controls)) {
    for (const [index, control] of release.controls.entries()) {
      validateExactKeys(control, CONTROL_KEYS, `controls[${index}]`, errors);
    }
  }

  if (Array.isArray(release.artifacts)) {
    for (const [index, artifact] of release.artifacts.entries()) {
      validateExactKeys(artifact, ARTIFACT_KEYS, `artifacts[${index}]`, errors);
    }
  }

  if (status === 'published') {
    validateExactKeys(release.coverage, PUBLISHED_COVERAGE_KEYS, 'coverage', errors);
    validateExactKeys(release.results, PUBLISHED_RESULTS_KEYS, 'results', errors);
    if (release.results && typeof release.results.aggregate === 'object' && !Array.isArray(release.results.aggregate)) {
      const allowedArms = new Set((release.arms ?? []).map((arm) => arm.id));
      for (const key of Object.keys(release.results.aggregate)) {
        if (!allowedArms.has(key)) {
          errors.push(`Unexpected field results.aggregate.${key}`);
        }
      }
    }
    if (Array.isArray(release.results?.perTask)) {
      for (const [index, cell] of release.results.perTask.entries()) {
        validateExactKeys(cell, PUBLISHED_PER_TASK_KEYS, `results.perTask[${index}]`, errors);
      }
    }
  }
}

export { CONTRACT_VERSION };
