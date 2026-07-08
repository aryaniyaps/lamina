import fs from 'node:fs';
import path from 'node:path';
import type { FlowGraphData } from './flow-graph.js';
import { resolveFlowTransitions } from './flow-graph.js';
import { loadScreenMetaForFlow } from './screen-meta.js';
import { loadFlowGraphFromDisk } from './flow-graph-loader.js';

export interface BlueprintStateResponse {
  blueprintId: string;
  flowId: string;
  source: 'flows.tsx' | 'run.yaml' | 'flows-inventory' | 'screens-only';
  screens: string[];
  completeness: {
    complete: number;
    skeleton: number;
    error: number;
    total: number;
  };
  screenMeta: Record<string, { completeness: string; title?: string }>;
  provisional: boolean;
}

export function buildBlueprintState(
  blueprintRoot: string,
  blueprintId: string,
  flowId: string,
): BlueprintStateResponse {
  const { graph, source } = loadFlowGraphFromDisk(blueprintRoot, blueprintId);
  const resolvedFlowId = graph.flows.some((f) => f.id === flowId)
    ? flowId
    : (graph.flows[0]?.id ?? 'default');
  const meta = loadScreenMetaForFlow(blueprintRoot, blueprintId, graph, resolvedFlowId);
  const transitions = resolveFlowTransitions(graph, resolvedFlowId);

  const screens = [...new Set(transitions.flatMap((t) => [t.from, t.target].filter(Boolean) as string[]))];
  if (!screens.length) screens.push(...graph.screens);

  let complete = 0;
  let skeleton = 0;
  let error = 0;

  const screenMetaSummary: Record<string, { completeness: string; title?: string }> = {};
  for (const screenId of screens.length ? screens : graph.screens) {
    const m = meta[screenId];
    const c = m?.completeness ?? 'skeleton';
    if (c === 'complete') complete++;
    else if (c === 'error') error++;
    else skeleton++;
    screenMetaSummary[screenId] = { completeness: c, title: m?.title };
  }

  const total = complete + skeleton + error;

  return {
    blueprintId,
    flowId: resolvedFlowId,
    source,
    screens: screens.length ? screens.sort() : graph.screens,
    completeness: { complete, skeleton, error, total },
    screenMeta: screenMetaSummary,
    provisional: source === 'flows-inventory' || source === 'run.yaml',
  };
}

export function blueprintDirExists(blueprintRoot: string, blueprintId: string): boolean {
  const dir = path.join(path.resolve(blueprintRoot), blueprintId);
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}
