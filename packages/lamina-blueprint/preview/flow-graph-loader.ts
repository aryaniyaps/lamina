import fs from 'node:fs';
import path from 'node:path';
import {
  collectScreensFromTransitions,
  parseFlowsSource,
  type FlowGraphData,
} from './flow-graph.js';
import { inventoryToFlowGraph, loadFlowsInventory, loadRunFlowGraph, resolveLaminaRoot } from './flows-inventory.js';

export type FlowGraphSource = 'flows.tsx' | 'run.yaml' | 'flows-inventory' | 'screens-only';

export function blueprintExists(blueprintRoot: string, blueprintId: string): boolean {
  if (!blueprintId.trim()) return false;
  const dir = path.join(path.resolve(blueprintRoot), blueprintId);
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

export function listScreenIds(blueprintRoot: string, blueprintId: string): string[] {
  const screensDir = path.join(path.resolve(blueprintRoot), blueprintId, 'screens');
  const ids = new Set<string>();
  if (!fs.existsSync(screensDir)) return [];

  for (const file of fs.readdirSync(screensDir)) {
    if (file.endsWith('.tsx')) ids.add(file.replace(/\.tsx$/, ''));
  }
  return [...ids].sort();
}

export function loadFlowGraph(blueprintRoot: string, blueprintId: string): FlowGraphData {
  const flowsPath = path.join(path.resolve(blueprintRoot), blueprintId, 'flows.tsx');
  if (!fs.existsSync(flowsPath)) {
    return { flows: [], transitions: [], screens: listScreenIds(blueprintRoot, blueprintId) };
  }
  const source = fs.readFileSync(flowsPath, 'utf8');
  const parsed = parseFlowsSource(source);
  const screens = collectScreensFromTransitions(
    parsed.transitions,
    listScreenIds(blueprintRoot, blueprintId),
  );
  return { ...parsed, screens };
}

export function loadFlowGraphFromDisk(
  blueprintRoot: string,
  blueprintId: string,
): { graph: FlowGraphData; source: FlowGraphSource } {
  const graph = loadFlowGraph(blueprintRoot, blueprintId);
  const flowsPath = path.join(path.resolve(blueprintRoot), blueprintId, 'flows.tsx');

  if (fs.existsSync(flowsPath) && graph.transitions.length > 0) {
    return { graph, source: 'flows.tsx' };
  }

  const fromRun = loadRunFlowGraph(blueprintRoot, blueprintId);
  if (fromRun && fromRun.transitions.length > 0) {
    const screens = [...new Set([...fromRun.screens, ...graph.screens])].sort();
    return {
      graph: { ...fromRun, screens },
      source: 'run.yaml',
    };
  }

  const inventory = loadFlowsInventory(resolveLaminaRoot(blueprintRoot));
  if (inventory.length) {
    const fromInventory = inventoryToFlowGraph(inventory);
    const screens = [...new Set([...fromInventory.screens, ...graph.screens])].sort();
    return {
      graph: { ...fromInventory, screens },
      source: 'flows-inventory',
    };
  }

  return { graph, source: 'screens-only' };
}
