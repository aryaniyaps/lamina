import fs from 'node:fs';
import path from 'node:path';
import {
  parseScenariosYaml,
  type ScenarioEntry as MjsScenarioEntry,
} from '../lib/scenarios.mjs';
import { loadScenariosFromRun } from '../lib/run.mjs';

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

function readMetaRunId(blueprintRoot: string, blueprintId: string): string | null {
  const metaPath = path.join(path.resolve(blueprintRoot), blueprintId, 'meta.yaml');
  if (!fs.existsSync(metaPath)) return null;
  const m = fs.readFileSync(metaPath, 'utf8').match(/^run_id:\s*(.+)$/m);
  if (!m) return null;
  const raw = m[1].trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

export function loadScenarios(blueprintRoot: string, blueprintId: string): ScenarioEntry[] {
  const laminaRoot = path.resolve(blueprintRoot, '..');
  const runId = readMetaRunId(blueprintRoot, blueprintId);
  if (runId) {
    const fromRun = loadScenariosFromRun(laminaRoot, runId);
    if (fromRun.length) return fromRun as ScenarioEntry[];
  }

  const file = path.join(path.resolve(blueprintRoot), blueprintId, 'scenarios.yaml');
  if (!fs.existsSync(file)) return [];
  return parseScenariosYaml(fs.readFileSync(file, 'utf8')) as ScenarioEntry[];
}

export { parseScenariosYaml };
export type { MjsScenarioEntry };
