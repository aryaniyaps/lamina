import { SCENARIO_CATEGORIES } from './scenarios.mjs';

/** @typedef {{ id: string; operation: string; subject: string; screenId: string; kind: 'read_collection' | 'read_resource' | 'mutate' | 'navigate' }} DerivedOperation */
/** @typedef {{ operationId: string; category: string; required: boolean; scenarioId: string | null; covered: boolean }} MatrixCell */
/** @typedef {{ operationId: string; operation: string; category: string; screenId: string; reason: string }} CoverageGap */
/** @typedef {{ id: string; title: string; screen: string; flow?: string; category: string; severity?: string; ux: string; trigger: { operation: string; subject: string; when: string }; description?: string }} ScenarioLike */

const WHEN_LABELS = {
  collection_empty: 'collection is empty',
  not_found: 'resource not found',
  validation_failed: 'validation fails',
  state_disallows: 'action not allowed in current state',
  concurrent_edit: 'concurrent edit conflict',
  session_expired: 'session expired',
  forbidden: 'access denied',
  dependency_unavailable: 'dependency unavailable',
  limit_reached: 'limit reached',
  timeout: 'request times out',
};

/**
 * @param {string} when
 */
export function whenToLabel(when) {
  return WHEN_LABELS[/** @type {keyof typeof WHEN_LABELS} */ (when)] ?? when.replace(/_/g, ' ');
}

/**
 * @param {{ operation: string; when: string }} trigger
 */
export function plainLanguageTrigger(trigger) {
  return `${trigger.operation} · ${whenToLabel(trigger.when)}`;
}

/**
 * @param {import('./run.mjs').RunScreenElement} el
 * @param {string} screenId
 * @returns {DerivedOperation | null}
 */
function operationFromElement(el, screenId) {
  const component = el.component;
  if (!component) return null;

  if (component === 'Table' || component === 'List' || component === 'Grid') {
    const source = el.source ?? el.name ?? screenId;
    return {
      id: `${screenId}:view:${source}`,
      operation: `view ${source}`,
      subject: source,
      screenId,
      kind: 'read_collection',
    };
  }

  if (component === 'Button' || component === 'Action' || component === 'Link') {
    const trigger = el.trigger ?? el.label?.toLowerCase() ?? 'action';
    const subject = el.name ?? trigger;
    return {
      id: `${screenId}:${trigger}`,
      operation: trigger.replace(/-/g, ' '),
      subject,
      screenId,
      kind: 'mutate',
    };
  }

  if (component === 'Form') {
    const name = el.name ?? 'form';
    return {
      id: `${screenId}:submit:${name}`,
      operation: `submit ${name}`,
      subject: name,
      screenId,
      kind: 'mutate',
    };
  }

  return null;
}

/**
 * @param {import('./run.mjs').RunScreen[]} screens
 * @returns {DerivedOperation[]}
 */
export function deriveOperations(screens = []) {
  /** @type {Map<string, DerivedOperation>} */
  const byId = new Map();

  for (const screen of screens) {
    for (const el of screen.elements ?? []) {
      const op = operationFromElement(el, screen.id);
      if (op && !byId.has(op.id)) byId.set(op.id, op);
    }
  }

  return [...byId.values()];
}

/**
 * @param {DerivedOperation} op
 * @returns {string[]}
 */
function requiredCategoriesForOperation(op) {
  switch (op.kind) {
    case 'read_collection':
      return ['empty', 'failure'];
    case 'read_resource':
      return ['empty', 'failure'];
    case 'mutate':
      return ['failure', 'permission'];
    case 'navigate':
      return [];
    default:
      return ['failure'];
  }
}

/**
 * @param {ScenarioLike[]} scenarios
 * @param {DerivedOperation[]} operations
 */
export function buildCoverageMatrix(scenarios = [], operations = []) {
  /** @type {MatrixCell[]} */
  const cells = [];
  /** @type {CoverageGap[]} */
  const gaps = [];

  for (const op of operations) {
    const required = requiredCategoriesForOperation(op);
    for (const category of SCENARIO_CATEGORIES) {
      const isRequired = required.includes(category);
      const match = scenarios.find(
        (s) =>
          s.category === category &&
          (s.trigger?.operation === op.operation ||
            s.trigger?.subject === op.subject ||
            s.screen === op.screenId),
      );
      cells.push({
        operationId: op.id,
        category,
        required: isRequired,
        scenarioId: match?.id ?? null,
        covered: Boolean(match),
      });
      if (isRequired && !match) {
        gaps.push({
          operationId: op.id,
          operation: op.operation,
          category,
          screenId: op.screenId,
          reason: `Missing ${category} scenario for "${op.operation}"`,
        });
      }
    }
  }

  const requiredCells = cells.filter((c) => c.required);
  const coveredRequired = requiredCells.filter((c) => c.covered).length;
  const score =
    requiredCells.length > 0 ? Math.round((coveredRequired / requiredCells.length) * 100) : 100;

  return { cells, gaps, score, operations };
}

/**
 * @param {string} laminaRoot
 * @param {string} runId
 * @param {import('node:fs')} fs
 * @param {import('./run.mjs')} runMod
 */
export function loadCoverageForRun(laminaRoot, runId, fs, runMod) {
  const runPath = runMod.resolveRunPath(laminaRoot, runId);
  if (!fs.existsSync(runPath)) {
    return { ok: false, error: 'run not found', runId };
  }
  const run = runMod.parseRunYaml(fs.readFileSync(runPath, 'utf8'));
  const screens = /** @type {import('./run.mjs').RunScreen[]} */ (run.screens ?? []);
  const scenarios = /** @type {ScenarioLike[]} */ (run.scenarios ?? []);
  const operations = deriveOperations(screens);
  const matrix = buildCoverageMatrix(scenarios, operations);

  return {
    ok: true,
    runId,
    run: {
      id: run.id,
      hook: run.hook,
      command: run.command,
      blueprint_id: run.blueprint_id,
      simulation: run.simulation,
    },
    screens,
    scenarios,
    ...matrix,
  };
}
