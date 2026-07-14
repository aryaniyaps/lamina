/** @typedef {{ operation: string; subject: string; when: string }} ScenarioTrigger */

/** @typedef {{ id: string; title: string; screen: string; flow?: string; description?: string; severity?: string; category: string; trigger: ScenarioTrigger; ux: string; acceptance?: string; dependency_ref?: string; invariant_ref?: string }} ScenarioEntry */

export const SCENARIO_CATEGORIES = new Set([
  'empty',
  'precondition',
  'partial',
  'conflict',
  'failure',
  'permission',
  'external',
  'boundary',
  'concurrency',
  'payment',
  'cancellation',
  'recovery',
  'degraded',
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
  'dependency_unmet',
  'limit_reached',
  'timeout',
  'insufficient_inventory',
  'hold_expired',
  'stripe_declined',
  'system_error_after_payment',
  'email_not_verified',
  'within_full_refund_window',
  'outside_refund_window',
  'hotel_initiated',
  'allowed',
  'sync_failed',
]);

export const SCENARIO_UX = new Set([
  'empty_state',
  'error_state',
  'alert',
  'banner',
  'redirect',
  'alternate_flow',
  'filter',
  'allow',
  'disabled_action',
  'degraded_view',
]);

/**
 * Minimal parser for scenarios.yaml (flat list items + nested trigger block).
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

  if (!s.acceptance || !String(s.acceptance).trim()) {
    errors.push(`scenarios.yaml: scenario ${label} missing acceptance (observable product behavior)`);
  }

  return errors;
}
