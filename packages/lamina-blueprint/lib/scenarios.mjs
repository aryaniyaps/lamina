import fs from 'node:fs';
import path from 'node:path';

/** @typedef {{ operation: string; subject: string; when: string }} ScenarioTrigger */

/** @typedef {{ id: string; title: string; screen: string; flow?: string; description?: string; severity?: string; category: string; trigger: ScenarioTrigger; ux: string }} ScenarioEntry */

export const SCENARIO_CATEGORIES = new Set([
  'empty',
  'precondition',
  'partial',
  'conflict',
  'failure',
  'permission',
  'external',
  'boundary',
]);

export const TRIGGER_WHEN = new Set([
  'collection_empty',
  'not_found',
  'validation_failed',
  'state_disallows',
  'concurrent_edit',
  'session_expired',
  'forbidden',
  'dependency_unavailable',
  'limit_reached',
  'timeout',
]);

export const SCENARIO_UX = new Set([
  'empty_state',
  'error_state',
  'alert',
  'banner',
  'redirect',
  'alternate_flow',
]);

/**
 * Minimal parser for blueprint scenarios.yaml (flat list items + nested trigger block).
 * @param {string} source
 * @returns {ScenarioEntry[]}
 */
export function parseScenariosYaml(source) {
  const scenarios = [];
  /** @type {Record<string, unknown> | null} */
  let current = null;
  let inTrigger = false;

  for (const line of source.split('\n')) {
    const item = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (item) {
      if (current) scenarios.push(/** @type {ScenarioEntry} */ (current));
      current = { id: stripYamlScalar(item[1]) };
      inTrigger = false;
      continue;
    }
    if (!current) continue;

    if (inTrigger) {
      const nested = line.match(/^\s{6,}(\w+):\s*(.*)$/);
      if (nested) {
        const val = stripYamlScalar(nested[2]);
        if (val) {
          if (!current.trigger) current.trigger = {};
          /** @type {Record<string, string>} */ (current.trigger)[nested[1]] = val;
        }
        continue;
      }
      if (/^\s{4,5}\S/.test(line)) inTrigger = false;
    }

    const kv = line.match(/^\s{4,}(\w+):\s*(.*)$/);
    if (!kv) continue;

    const key = kv[1];
    const val = stripYamlScalar(kv[2]);

    if (key === 'trigger' && !val) {
      inTrigger = true;
      current.trigger = current.trigger || {};
      continue;
    }

    inTrigger = false;
    if (val) current[key] = val;
  }

  if (current) scenarios.push(/** @type {ScenarioEntry} */ (current));
  return scenarios;
}

/**
 * @param {string} raw
 */
function stripYamlScalar(raw) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null') return undefined;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * @param {ScenarioEntry} s
 * @returns {string[]}
 */
export function validateScenarioFields(s) {
  const errors = [];
  const label = s.id ? `"${s.id}"` : '(missing id)';

  if (!s.id) errors.push('scenarios.yaml: scenario missing id');
  if (!s.title) errors.push(`scenarios.yaml: scenario ${label} missing title`);
  if (!s.screen) errors.push(`scenarios.yaml: scenario ${label} missing screen`);
  if (!s.category) {
    errors.push(`scenarios.yaml: scenario ${label} missing category`);
  } else if (!SCENARIO_CATEGORIES.has(s.category)) {
    errors.push(
      `scenarios.yaml: scenario ${label} invalid category "${s.category}" (expected: ${[...SCENARIO_CATEGORIES].join(', ')})`,
    );
  }

  if (!s.ux) {
    errors.push(`scenarios.yaml: scenario ${label} missing ux`);
  } else if (!SCENARIO_UX.has(s.ux)) {
    errors.push(
      `scenarios.yaml: scenario ${label} invalid ux "${s.ux}" (expected: ${[...SCENARIO_UX].join(', ')})`,
    );
  }

  if (!s.trigger) {
    errors.push(`scenarios.yaml: scenario ${label} missing trigger`);
  } else {
    if (!s.trigger.operation) {
      errors.push(`scenarios.yaml: scenario ${label} missing trigger.operation`);
    }
    if (!s.trigger.subject) {
      errors.push(`scenarios.yaml: scenario ${label} missing trigger.subject`);
    }
    if (!s.trigger.when) {
      errors.push(`scenarios.yaml: scenario ${label} missing trigger.when`);
    } else if (!TRIGGER_WHEN.has(s.trigger.when)) {
      errors.push(
        `scenarios.yaml: scenario ${label} invalid trigger.when "${s.trigger.when}" (expected: ${[...TRIGGER_WHEN].join(', ')})`,
      );
    }
  }

  return errors;
}

/**
 * @param {string} blueprintDir — path to a single blueprint directory
 * @returns {ScenarioEntry[]}
 */
export function loadScenariosFromBlueprintDir(blueprintDir) {
  const file = path.join(path.resolve(blueprintDir), 'scenarios.yaml');
  if (!fs.existsSync(file)) return [];
  return parseScenariosYaml(fs.readFileSync(file, 'utf8'));
}

/**
 * @param {string} blueprintRoot
 * @param {string} blueprintId
 * @returns {ScenarioEntry[]}
 */
export function loadScenarios(blueprintRoot, blueprintId) {
  return loadScenariosFromBlueprintDir(path.join(path.resolve(blueprintRoot), blueprintId));
}

/**
 * @param {string} blueprintDir
 * @param {string} scenarioId
 * @param {string} screenId
 */
export function scenarioScreenPathInBlueprint(blueprintDir, scenarioId, screenId) {
  return path.join(
    path.resolve(blueprintDir),
    'scenarios',
    scenarioId,
    'screens',
    `${screenId}.tsx`,
  );
}

/**
 * @param {string} blueprintRoot
 * @param {string} blueprintId
 * @param {string} scenarioId
 * @param {string} screenId
 */
export function scenarioScreenPath(blueprintRoot, blueprintId, scenarioId, screenId) {
  return scenarioScreenPathInBlueprint(
    path.join(path.resolve(blueprintRoot), blueprintId),
    scenarioId,
    screenId,
  );
}
