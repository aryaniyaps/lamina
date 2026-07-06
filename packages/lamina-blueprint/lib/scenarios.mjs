import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {{ id: string; title: string; screen: string; flow?: string; description?: string; severity?: string }} ScenarioEntry
 */

/**
 * Minimal parser for blueprint scenarios.yaml (flat list items only).
 * @param {string} source
 * @returns {ScenarioEntry[]}
 */
export function parseScenariosYaml(source) {
  const scenarios = [];
  let current = null;

  for (const line of source.split('\n')) {
    const item = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (item) {
      if (current) scenarios.push(current);
      current = { id: stripYamlScalar(item[1]) };
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^\s{2,}(\w+):\s*(.*)$/);
    if (kv) {
      const val = stripYamlScalar(kv[2]);
      if (val) current[kv[1]] = val;
    }
  }

  if (current) scenarios.push(current);
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
