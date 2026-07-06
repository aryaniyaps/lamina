import fs from 'node:fs';
import path from 'node:path';
import {
  parseScenariosYaml,
  type ScenarioEntry as MjsScenarioEntry,
} from '../lib/scenarios.mjs';

export interface ScenarioTrigger {
  operation: string;
  subject: string;
  when: string;
}

export interface ScenarioEntry {
  id: string;
  title: string;
  screen: string;
  flow?: string;
  description?: string;
  severity?: string;
  category: string;
  trigger: ScenarioTrigger;
  ux: string;
}

export function loadScenarios(blueprintRoot: string, blueprintId: string): ScenarioEntry[] {
  const file = path.join(path.resolve(blueprintRoot), blueprintId, 'scenarios.yaml');
  if (!fs.existsSync(file)) return [];
  return parseScenariosYaml(fs.readFileSync(file, 'utf8')) as ScenarioEntry[];
}

export { parseScenariosYaml };
export type { MjsScenarioEntry };
