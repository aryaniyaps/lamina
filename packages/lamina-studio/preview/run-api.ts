import fs from 'node:fs';
import path from 'node:path';
import { loadCoverageForRun } from '../lib/coverage.mjs';
import {
  loadRunYaml,
  parseRunYaml,
  resolveRunPath,
  readBlueprintRunId,
} from '../lib/run.mjs';
import { loadFlowsFromRun } from '../lib/run.mjs';
import { loadScenariosFromRun } from '../lib/run.mjs';
import { runFlowsToFlowGraph } from './flows-inventory.js';
import type { FlowGraphData } from './flow-graph.js';

export interface RunMeta {
  id: string;
  hook?: string;
  command?: string;
  blueprint_id?: string;
  simulation?: unknown;
}

export function resolveLaminaRoot(blueprintRoot: string): string {
  return path.resolve(blueprintRoot, '..');
}

export function listRuns(laminaRoot: string): { id: string; hook?: string }[] {
  const runsDir = path.join(laminaRoot, 'runs');
  if (!fs.existsSync(runsDir)) return [];
  return fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const runPath = path.join(runsDir, d.name, 'run.yaml');
      if (!fs.existsSync(runPath)) return { id: d.name };
      const run = parseRunYaml(fs.readFileSync(runPath, 'utf8'));
      return { id: d.name, hook: run.hook as string | undefined };
    });
}

export function resolveRunId(
  laminaRoot: string,
  blueprintRoot: string,
  blueprintId?: string,
  runId?: string,
): string | null {
  if (runId) return runId;
  if (blueprintId) {
    const fromMeta = readBlueprintRunId(path.join(blueprintRoot, blueprintId));
    if (fromMeta) return fromMeta;
  }
  return null;
}

export function resolveBlueprintId(
  laminaRoot: string,
  runId?: string,
  blueprintId?: string,
): string | null {
  if (blueprintId) return blueprintId;
  if (!runId) return null;
  const runPath = resolveRunPath(laminaRoot, runId);
  if (!fs.existsSync(runPath)) return null;
  const run = parseRunYaml(fs.readFileSync(runPath, 'utf8'));
  return (run.blueprint_id as string) ?? null;
}

export function loadRunFlowGraphByRunId(laminaRoot: string, runId: string): FlowGraphData | null {
  const runFlows = loadFlowsFromRun(laminaRoot, runId);
  if (!runFlows.length) return null;
  return runFlowsToFlowGraph(runFlows);
}

export function getRunMeta(laminaRoot: string, runId: string): RunMeta | null {
  const runPath = resolveRunPath(laminaRoot, runId);
  if (!fs.existsSync(runPath)) return null;
  const run = parseRunYaml(fs.readFileSync(runPath, 'utf8'));
  return {
    id: runId,
    hook: run.hook as string | undefined,
    command: run.command as string | undefined,
    blueprint_id: run.blueprint_id as string | undefined,
    simulation: run.simulation,
  };
}

export function getCoverage(laminaRoot: string, runId: string) {
  return loadCoverageForRun(laminaRoot, runId, fs, {
    resolveRunPath,
    parseRunYaml,
  });
}

export function getRunScreens(laminaRoot: string, runId: string) {
  const runPath = resolveRunPath(laminaRoot, runId);
  if (!fs.existsSync(runPath)) return [];
  const run = parseRunYaml(fs.readFileSync(runPath, 'utf8'));
  return (run.screens ?? []) as Array<{ id: string; title?: string; status?: string }>;
}

export { loadScenariosFromRun, loadRunYaml };
