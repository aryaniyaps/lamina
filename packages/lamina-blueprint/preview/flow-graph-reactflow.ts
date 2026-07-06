import type { Edge, Node } from '@xyflow/react';
import type { FlowGraphData } from './flow-graph.js';
import { inferEntryScreen, resolveFlowTransitions } from './flow-graph.js';
import type { ScenarioEntry } from './scenarios.js';
import type { ScreenMeta } from './screen-meta.js';

export const SCREEN_NODE_W = 200;
export const SCREEN_NODE_H = 78;
export const SCENARIO_NODE_W = 188;
/** Layout estimate; scenario nodes size to content when height is omitted. */
export const SCENARIO_NODE_H = 92;
const ROW_GAP = 56;
const BRANCH_GAP = 16;
const BRANCH_GAP_X = 88;
const BRANCH_OFFSET_X = SCREEN_NODE_W + BRANCH_GAP_X;

const FLOW_EDGE_LABEL = {
  labelShowBg: true,
  labelBgPadding: [6, 4] as [number, number],
  labelBgBorderRadius: 4,
};

function distinctSubtitle(
  title: string,
  subtitle: string | undefined,
  screenId: string,
): string | undefined {
  if (!subtitle?.trim()) return undefined;
  const norm = (s: string) => s.trim().toLowerCase();
  if (norm(subtitle) === norm(title)) return undefined;
  if (norm(subtitle) === norm(screenId)) return undefined;
  return subtitle;
}

export function scenarioNodeId(scenarioId: string) {
  return `scenario:${scenarioId}`;
}

function orderScreens(
  transitions: ReturnType<typeof resolveFlowTransitions>,
  screenIds: string[],
): string[] {
  const entry = inferEntryScreen(transitions);
  const ordered: string[] = [];
  const seen = new Set<string>();

  if (entry) {
    ordered.push(entry);
    seen.add(entry);
  }

  for (const t of transitions) {
    if (t.from && !seen.has(t.from)) {
      ordered.push(t.from);
      seen.add(t.from);
    }
    if (!seen.has(t.target)) {
      ordered.push(t.target);
      seen.add(t.target);
    }
  }

  for (const id of screenIds) {
    if (!seen.has(id)) ordered.push(id);
  }

  return ordered;
}

function layoutGraph(
  transitions: ReturnType<typeof resolveFlowTransitions>,
  screenIds: string[],
  visibleScenarios: ScenarioEntry[],
): {
  screens: { id: string; x: number; y: number }[];
  scenarios: {
    id: string;
    scenarioId: string;
    screenId: string;
    entry: ScenarioEntry;
    x: number;
    y: number;
  }[];
} {
  const ordered = orderScreens(transitions, screenIds);
  const screens = ordered.map((id, i) => ({
    id,
    x: 16,
    y: 12 + i * (SCREEN_NODE_H + ROW_GAP),
  }));

  const screenMap = Object.fromEntries(screens.map((s) => [s.id, s]));
  const scenarios: {
    id: string;
    scenarioId: string;
    screenId: string;
    entry: ScenarioEntry;
    x: number;
    y: number;
  }[] = [];

  const byScreen = new Map<string, ScenarioEntry[]>();
  for (const s of visibleScenarios) {
    const list = byScreen.get(s.screen) ?? [];
    list.push(s);
    byScreen.set(s.screen, list);
  }

  for (const [screenId, list] of byScreen) {
    const parent = screenMap[screenId];
    if (!parent) continue;
    list.forEach((entry, i) => {
      const yOffset = (i - (list.length - 1) / 2) * (SCENARIO_NODE_H + BRANCH_GAP);
      scenarios.push({
        id: scenarioNodeId(entry.id),
        scenarioId: entry.id,
        screenId,
        entry,
        x: parent.x + BRANCH_OFFSET_X,
        y: parent.y + yOffset,
      });
    });
  }

  return { screens, scenarios };
}

export interface BuildFlowElementsInput {
  graph: FlowGraphData;
  activeFlowId: string;
  scenarios: ScenarioEntry[];
  activeScreen: string;
  activeScenario: string | null;
  personaBlockedScreens: Set<string>;
  blockerQuotes: Map<string, string>;
  screenMeta: Record<string, ScreenMeta>;
}

export function buildFlowElements(input: BuildFlowElementsInput): {
  nodes: Node[];
  edges: Edge[];
} {
  const {
    graph,
    activeFlowId,
    scenarios,
    activeScreen,
    activeScenario,
    personaBlockedScreens,
    blockerQuotes,
    screenMeta,
  } = input;

  const transitions = resolveFlowTransitions(graph, activeFlowId);
  const screenIdSet = new Set<string>();
  for (const t of transitions) {
    if (t.from) screenIdSet.add(t.from);
    screenIdSet.add(t.target);
  }
  if (!screenIdSet.size && graph.screens.length) {
    graph.screens.forEach((s) => screenIdSet.add(s));
  }

  const visibleScenarios = scenarios.filter((s) => !s.flow || s.flow === activeFlowId);
  const { screens, scenarios: scenarioLayouts } = layoutGraph(
    transitions,
    [...screenIdSet],
    visibleScenarios,
  );

  const nodes: Node[] = [
    ...screens.map((s) => {
      const meta = screenMeta[s.id];
      return {
        id: s.id,
        type: 'screen' as const,
        position: { x: s.x, y: s.y },
        data: {
          screenId: s.id,
          title: meta?.title ?? s.id,
          subtitle: distinctSubtitle(meta?.title ?? s.id, meta?.subtitle, s.id),
          stepLabel: meta ? `${meta.stepIndex}/${meta.stepTotal}` : undefined,
          isEntry: meta?.isEntry ?? false,
          isTerminal: meta?.isTerminal ?? false,
          triggers: meta?.triggers ?? [],
          states: meta?.states ?? [],
          isActive: activeScreen === s.id && !activeScenario,
          hasBlocker: personaBlockedScreens.has(s.id),
          blockerQuote: blockerQuotes.get(s.id),
        },
        style: { width: SCREEN_NODE_W, height: SCREEN_NODE_H },
      };
    }),
    ...scenarioLayouts.map((s) => ({
      id: s.id,
      type: 'scenario' as const,
      position: { x: s.x, y: s.y },
      data: {
        title: s.entry.title,
        description: s.entry.description,
        severity: s.entry.severity,
        scenarioId: s.scenarioId,
        parentScreen: s.screenId,
        isActive: activeScenario === s.scenarioId,
      },
      style: { width: SCENARIO_NODE_W },
      className: 'sub-rf-flow-node-scenario',
    })),
  ];

  const entry = inferEntryScreen(transitions);
  const edges: Edge[] = transitions.map((t, i) => {
    const fromId = t.from ?? entry ?? t.target;
    const active =
      !activeScenario && (activeScreen === fromId || activeScreen === t.target);
    return {
      id: `flow-${t.trigger}-${i}`,
      source: fromId,
      target: t.target,
      label: t.trigger,
      type: 'smoothstep',
      className: active ? 'sub-rf-edge sub-rf-edge-flow sub-rf-edge-active' : 'sub-rf-edge sub-rf-edge-flow',
      ...FLOW_EDGE_LABEL,
    };
  });

  for (const s of scenarioLayouts) {
    const active = activeScenario === s.scenarioId;
    edges.push({
      id: `scenario-${s.scenarioId}`,
      source: s.screenId,
      sourceHandle: 'branch',
      target: s.id,
      type: 'smoothstep',
      className: active
        ? 'sub-rf-edge sub-rf-edge-branch sub-rf-edge-active'
        : 'sub-rf-edge sub-rf-edge-branch',
    });
  }

  return { nodes, edges };
}
