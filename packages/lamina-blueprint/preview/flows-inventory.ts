import fs from 'node:fs';
import path from 'node:path';
import type { FlowGraphData, TransitionEdge } from './flow-graph.js';
import { loadFlowsFromRun } from '../lib/run.mjs';

export interface InventoryFlow {
  id: string;
  name: string;
  routes?: string[];
  status?: string;
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

/** @deprecated Use run.yaml flows via loadRunFlowGraph. Kept for backward compatibility. */
export function parseFlowsInventoryYaml(source: string): InventoryFlow[] {
  const flows: InventoryFlow[] = [];
  let current: InventoryFlow | null = null;
  let inRoutes = false;

  for (const line of source.split('\n')) {
    const item = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (item) {
      if (current) flows.push(current);
      current = { id: stripYamlScalar(item[1])!, name: '' };
      inRoutes = false;
      continue;
    }
    if (!current) continue;

    if (/^\s+routes:\s*$/.test(line)) {
      inRoutes = true;
      current.routes = [];
      continue;
    }

    const routeItem = line.match(/^\s+-\s+(.+)$/);
    if (inRoutes && routeItem && current.routes) {
      const val = stripYamlScalar(routeItem[1]);
      if (val) current.routes.push(val);
      continue;
    }

    if (!line.match(/^\s{2,}/)) inRoutes = false;

    const kv = line.match(/^\s{2,}(\w+):\s*(.*)$/);
    if (kv) {
      const val = stripYamlScalar(kv[2]);
      if (!val) continue;
      if (kv[1] === 'name') current.name = val;
      else if (kv[1] === 'status') current.status = val;
    }
  }

  if (current) flows.push(current);
  return flows;
}

/** @deprecated */
export function loadFlowsInventory(laminaRoot: string): InventoryFlow[] {
  const file = path.join(path.resolve(laminaRoot), 'flows-inventory.yaml');
  if (!fs.existsSync(file)) return [];
  return parseFlowsInventoryYaml(fs.readFileSync(file, 'utf8'));
}

export function runFlowsToFlowGraph(
  runFlows: ReturnType<typeof loadFlowsFromRun>,
): FlowGraphData {
  const flows = runFlows.flatMap((flow) => {
    const graphs = flow.graphs?.length
      ? flow.graphs
      : [{ id: flow.id, transitions: [] as TransitionEdge[] }];

    return graphs.map((graph) => {
      const transitions: TransitionEdge[] = (graph.transitions ?? []).map((t) => ({
        from: t.from,
        trigger: t.trigger,
        target: t.target,
        flowId: graph.id,
      }));
      return { id: graph.id, transitions };
    });
  });

  const allTransitions = flows.flatMap((f) => f.transitions);
  const screens = [
    ...new Set(allTransitions.flatMap((t) => [t.from, t.target].filter(Boolean) as string[])),
  ].sort();

  return { flows, transitions: allTransitions, screens };
}

/** @deprecated */
export function inventoryToFlowGraph(inventory: InventoryFlow[]): FlowGraphData {
  const flows = inventory.map((flow) => {
    const routes = flow.routes?.length ? flow.routes : [`/${flow.id}`];
    const screenIds = routes.map((route) => {
      const segment = route.replace(/\/+$/, '').split('/').filter(Boolean).pop();
      return segment?.replace(/[^a-zA-Z0-9_-]/g, '-') || 'screen';
    });
    const transitions: TransitionEdge[] = [];

    for (let i = 0; i < screenIds.length - 1; i++) {
      transitions.push({
        from: screenIds[i],
        trigger: 'continue',
        target: screenIds[i + 1],
        flowId: flow.id,
      });
    }

    return { id: flow.id, transitions };
  });

  const allTransitions = flows.flatMap((f) => f.transitions);
  const screens = [
    ...new Set(allTransitions.flatMap((t) => [t.from, t.target].filter(Boolean) as string[])),
  ].sort();

  return { flows, transitions: allTransitions, screens };
}

export function resolveLaminaRoot(blueprintRoot: string): string {
  return path.resolve(blueprintRoot, '..');
}

function readMetaRunId(blueprintRoot: string, blueprintId: string): string | null {
  const metaPath = path.join(path.resolve(blueprintRoot), blueprintId, 'meta.yaml');
  if (!fs.existsSync(metaPath)) return null;
  const m = fs.readFileSync(metaPath, 'utf8').match(/^run_id:\s*(.+)$/m);
  if (!m) return null;
  return stripYamlScalar(m[1]) ?? null;
}

export function loadRunFlowGraph(blueprintRoot: string, blueprintId: string): FlowGraphData | null {
  const laminaRoot = resolveLaminaRoot(blueprintRoot);
  const runId = readMetaRunId(blueprintRoot, blueprintId);
  if (!runId) return null;
  const runFlows = loadFlowsFromRun(laminaRoot, runId);
  if (!runFlows.length) return null;
  return runFlowsToFlowGraph(runFlows);
}
