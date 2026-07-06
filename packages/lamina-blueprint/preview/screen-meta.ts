import fs from 'node:fs';
import path from 'node:path';
import type { FlowGraphData } from './flow-graph.js';
import {
  inferEntryScreen,
  outgoingTransitions,
  parseScreenIdsFromSource,
  parseTriggersFromScreenSource,
  resolveFlowTransitions,
} from './flow-graph.js';

export type ScreenCompleteness = 'complete' | 'skeleton' | 'error';

export interface ScreenMeta {
  completeness: ScreenCompleteness;
  title?: string;
  triggers: string[];
  stepIndex?: number;
  isEntry?: boolean;
  isTerminal?: boolean;
}

function effectiveScreenPath(blueprintDir: string, flowId: string, screenId: string): string {
  const flowPath = path.join(blueprintDir, 'flows', flowId, 'screens', `${screenId}.tsx`);
  if (fs.existsSync(flowPath)) return flowPath;
  return path.join(blueprintDir, 'screens', `${screenId}.tsx`);
}

function parseScreenTitle(source: string): string | undefined {
  const m = source.match(/<Screen\b[^>]*\btitle=["']([^"']+)["']/);
  return m?.[1];
}

function screensInFlow(transitions: { from?: string; target: string }[]): Set<string> {
  const screens = new Set<string>();
  for (const t of transitions) {
    if (t.from) screens.add(t.from);
    screens.add(t.target);
  }
  return screens;
}

function buildStepOrder(
  transitions: ReturnType<typeof resolveFlowTransitions>,
  entry: string | undefined,
): Map<string, number> {
  const stepOrder = new Map<string, number>();
  if (!entry) return stepOrder;

  const queue: { id: string; step: number }[] = [{ id: entry, step: 0 }];
  const visited = new Set<string>();

  while (queue.length) {
    const { id, step } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    stepOrder.set(id, step);
    for (const t of outgoingTransitions(transitions, id)) {
      if (!visited.has(t.target)) queue.push({ id: t.target, step: step + 1 });
    }
  }

  return stepOrder;
}

export function loadScreenMetaForFlow(
  blueprintRoot: string,
  blueprintId: string,
  graph: FlowGraphData,
  flowId: string,
): Record<string, ScreenMeta> {
  const blueprintDir = path.join(path.resolve(blueprintRoot), blueprintId);
  const transitions = resolveFlowTransitions(graph, flowId);
  const entry = inferEntryScreen(transitions);
  const screens = screensInFlow(transitions);
  const stepOrder = buildStepOrder(transitions, entry);
  const meta: Record<string, ScreenMeta> = {};

  for (const screenId of screens) {
    const filePath = effectiveScreenPath(blueprintDir, flowId, screenId);
    let completeness: ScreenCompleteness = 'skeleton';
    let title: string | undefined;
    let triggers: string[] = [];

    if (fs.existsSync(filePath)) {
      try {
        const source = fs.readFileSync(filePath, 'utf8');
        title = parseScreenTitle(source);
        triggers = parseTriggersFromScreenSource(source);
        const ids = parseScreenIdsFromSource(source);
        completeness = ids.length ? 'complete' : 'error';
      } catch {
        completeness = 'error';
      }
    }

    const outgoing = outgoingTransitions(transitions, screenId);

    meta[screenId] = {
      completeness,
      title,
      triggers,
      stepIndex: stepOrder.get(screenId),
      isEntry: screenId === entry,
      isTerminal: outgoing.length === 0,
    };
  }

  return meta;
}
