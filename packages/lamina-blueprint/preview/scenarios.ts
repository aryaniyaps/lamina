import fs from 'node:fs';
import path from 'node:path';

export interface ScenarioEntry {
  id: string;
  title: string;
  screen: string;
  flow?: string;
  description?: string;
  severity?: string;
}

function stripYamlScalar(raw: string): string | undefined {
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

export function parseScenariosYaml(source: string): ScenarioEntry[] {
  const scenarios: ScenarioEntry[] = [];
  let current: ScenarioEntry | null = null;

  for (const line of source.split('\n')) {
    const item = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (item) {
      if (current) scenarios.push(current);
      current = { id: stripYamlScalar(item[1])!, title: '', screen: '' };
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^\s{2,}(\w+):\s*(.*)$/);
    if (kv) {
      const val = stripYamlScalar(kv[2]);
      if (!val) continue;
      const key = kv[1];
      if (key === 'title' || key === 'screen' || key === 'flow' || key === 'description' || key === 'severity') {
        current[key] = val;
      }
    }
  }

  if (current) scenarios.push(current);
  return scenarios;
}

export function loadScenarios(blueprintRoot: string, blueprintId: string): ScenarioEntry[] {
  const file = path.join(path.resolve(blueprintRoot), blueprintId, 'scenarios.yaml');
  if (!fs.existsSync(file)) return [];
  return parseScenariosYaml(fs.readFileSync(file, 'utf8'));
}
