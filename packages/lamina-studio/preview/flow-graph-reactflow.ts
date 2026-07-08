import type { Edge, Node } from '@xyflow/react';
import type { FlowGraphData, TransitionEdge } from './flow-graph.js';
import {
  inferEntryScreen,
  outgoingTransitions,
  resolveFlowTransitions,
} from './flow-graph.js';
import type { ScenarioEntry } from './scenarios.js';
import type { ScreenMeta } from './screen-meta.js';

const SCREEN_NODE_WIDTH = 168;
const SCREEN_NODE_HEIGHT = 88;
const SCENARIO_NODE_WIDTH = 148;
const H_GAP = 96;
const V_GAP = 56;
const SCENARIO_OFFSET_Y = 112;

interface BuildParams {
  graph: FlowGraphData;
  activeFlowId: string;
  scenarios: ScenarioEntry[];
  activeScreen: string;
  activeScenario: string | null;
  personaBlockedScreens: Set<string>;
  blockerQuotes: Map<string, string>;
  screenMeta: Record<string, ScreenMeta>;
}

function layoutScreens(
  transitions: TransitionEdge[],
  entry: string | undefined,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (!entry) return positions;

  const columns = new Map<number, string[]>();
  const stepByScreen = new Map<string, number>();
  const queue: { id: string; step: number }[] = [{ id: entry, step: 0 }];
  const visited = new Set<string>();

  while (queue.length) {
    const { id, step } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    stepByScreen.set(id, step);
    if (!columns.has(step)) columns.set(step, []);
    columns.get(step)!.push(id);

    for (const t of outgoingTransitions(transitions, id)) {
      if (!visited.has(t.target)) queue.push({ id: t.target, step: step + 1 });
    }
  }

  for (const [col, ids] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    const totalHeight = ids.length * SCREEN_NODE_HEIGHT + (ids.length - 1) * V_GAP;
    let y = -totalHeight / 2;
    for (const id of ids) {
      positions.set(id, { x: col * (SCREEN_NODE_WIDTH + H_GAP), y });
      y += SCREEN_NODE_HEIGHT + V_GAP;
    }
  }

  return positions;
}

export function buildFlowElements({
  graph,
  activeFlowId,
  scenarios,
  activeScreen,
  activeScenario,
  personaBlockedScreens,
  screenMeta,
}: BuildParams): { nodes: Node[]; edges: Edge[] } {
  const transitions = resolveFlowTransitions(graph, activeFlowId);
  const entry = inferEntryScreen(transitions);
  const positions = layoutScreens(transitions, entry);
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const [screenId, pos] of positions) {
    const meta = screenMeta[screenId];
    nodes.push({
      id: screenId,
      type: 'screen',
      position: pos,
      data: {
        label: meta?.title ?? screenId,
        subtitle: meta?.title && meta.title !== screenId ? screenId : undefined,
        step: meta?.stepIndex,
        triggers: meta?.triggers,
        active: screenId === activeScreen && !activeScenario,
        blocked: personaBlockedScreens.has(screenId),
        completeness: meta?.completeness ?? 'skeleton',
        isEntry: meta?.isEntry,
        isTerminal: meta?.isTerminal,
      },
      style: { width: SCREEN_NODE_WIDTH, height: SCREEN_NODE_HEIGHT },
    });
  }

  for (const t of transitions) {
    const from = t.from ?? entry;
    if (!from) continue;
    edges.push({
      id: `${from}-${t.trigger}-${t.target}`,
      source: from,
      target: t.target,
      label: t.trigger,
      type: 'smoothstep',
      animated: false,
      style: { stroke: 'var(--sub-border-strong)' },
      labelStyle: { fontSize: 10, fill: 'var(--sub-text-muted)' },
    });
  }

  const flowScenarios = scenarios.filter(
    (s) => !s.flow || s.flow === activeFlowId,
  );

  for (const scenario of flowScenarios) {
    const anchor = positions.get(scenario.screen);
    if (!anchor) continue;

    const scenarioNodeId = `scenario:${scenario.id}`;
    nodes.push({
      id: scenarioNodeId,
      type: 'scenario',
      position: {
        x: anchor.x + (SCREEN_NODE_WIDTH - SCENARIO_NODE_WIDTH) / 2,
        y: anchor.y + SCENARIO_OFFSET_Y,
      },
      data: {
        scenarioId: scenario.id,
        title: scenario.title,
        description: scenario.description,
        severity: scenario.severity,
        active: activeScenario === scenario.id,
      },
      className: 'sub-rf-flow-node-scenario',
      style: { width: SCENARIO_NODE_WIDTH },
    });

    edges.push({
      id: `scenario-edge-${scenario.id}`,
      source: scenario.screen,
      target: scenarioNodeId,
      type: 'smoothstep',
      style: { stroke: 'var(--sub-border-strong)', strokeDasharray: '4 4' },
    });
  }

  return { nodes, edges };
}
