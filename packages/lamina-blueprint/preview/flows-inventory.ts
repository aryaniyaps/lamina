import fs from 'node:fs';
import path from 'node:path';
import type { FlowGraphData, TransitionEdge } from './flow-graph.js';

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

function routeToScreenId(route: string): string {
  const segment = route.replace(/\/+$/, '').split('/').filter(Boolean).pop();
  return segment?.replace(/[^a-zA-Z0-9_-]/g, '-') || 'screen';
}

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

export function loadFlowsInventory(laminaRoot: string): InventoryFlow[] {
  const file = path.join(path.resolve(laminaRoot), 'flows-inventory.yaml');
  if (!fs.existsSync(file)) return [];
  return parseFlowsInventoryYaml(fs.readFileSync(file, 'utf8'));
}

export function inventoryToFlowGraph(inventory: InventoryFlow[]): FlowGraphData {
  const flows = inventory.map((flow) => {
    const routes = flow.routes?.length ? flow.routes : [`/${flow.id}`];
    const screenIds = routes.map(routeToScreenId);
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
  const screens = [...new Set(allTransitions.flatMap((t) => [t.from, t.target].filter(Boolean) as string[]))].sort();

  return { flows, transitions: allTransitions, screens };
}

export function resolveLaminaRoot(blueprintRoot: string): string {
  return path.resolve(blueprintRoot, '..');
}
