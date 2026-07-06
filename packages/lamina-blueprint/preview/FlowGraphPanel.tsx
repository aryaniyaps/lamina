import { useEffect, useMemo, useRef } from 'react';
import type { FlowGraphData, TransitionEdge } from './flow-graph.js';
import { inferEntryScreen, resolveFlowTransitions } from './flow-graph.js';
import type { ScenarioEntry } from './scenarios.js';

export type { ScenarioEntry };

interface FlowGraphPanelProps {
  graph: FlowGraphData;
  activeScreen: string;
  activeFlowId: string;
  onSelectScreen: (id: string) => void;
  onSelectFlow: (id: string) => void;
  scenarios?: ScenarioEntry[];
  activeScenario?: string | null;
  onSelectScenario?: (id: string) => void;
  onClearScenario?: () => void;
}

const NODE_W = 140;
const NODE_H = 36;
const ROW_GAP = 48;
const BRANCH_GAP = 12;
const BRANCH_OFFSET_X = NODE_W + 48;

function scenarioNodeId(scenarioId: string) {
  return `scenario:${scenarioId}`;
}

function orderScreens(transitions: TransitionEdge[], screenIds: string[]): string[] {
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

function layoutNodesVertical(screenIds: string[]) {
  return screenIds.map((id, i) => ({
    id,
    x: 16,
    y: 12 + i * (NODE_H + ROW_GAP),
    kind: 'screen' as const,
  }));
}

function edgePathVertical(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const x1 = from.x + NODE_W / 2;
  const y1 = from.y + NODE_H;
  const x2 = to.x + NODE_W / 2;
  const y2 = to.y;
  const mid = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

function edgePathHorizontal(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

function truncateLabel(text: string, max = 18): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function FlowGraphPanel({
  graph,
  activeScreen,
  activeFlowId,
  onSelectScreen,
  onSelectFlow,
  scenarios = [],
  activeScenario = null,
  onSelectScenario,
  onClearScenario,
}: FlowGraphPanelProps) {
  const activeNodeRef = useRef<HTMLButtonElement>(null);
  const transitions = resolveFlowTransitions(graph, activeFlowId);

  const screenIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of transitions) {
      if (t.from) ids.add(t.from);
      ids.add(t.target);
    }
    if (!ids.size && graph.screens.length) {
      graph.screens.forEach((s) => ids.add(s));
    }
    return orderScreens(transitions, [...ids]);
  }, [transitions, graph.screens]);

  const visibleScenarios = useMemo(
    () => scenarios.filter((s) => !s.flow || s.flow === activeFlowId),
    [scenarios, activeFlowId],
  );

  const screenNodes = layoutNodesVertical(screenIds);
  const screenNodeMap = Object.fromEntries(screenNodes.map((n) => [n.id, n]));

  const scenarioNodes = useMemo(() => {
    const nodes: {
      id: string;
      scenarioId: string;
      screenId: string;
      label: string;
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
      const parent = screenNodeMap[screenId];
      if (!parent) continue;
      list.forEach((s, i) => {
        const yOffset = (i - (list.length - 1) / 2) * (NODE_H + BRANCH_GAP);
        nodes.push({
          id: scenarioNodeId(s.id),
          scenarioId: s.id,
          screenId,
          label: truncateLabel(s.title),
          x: parent.x + BRANCH_OFFSET_X,
          y: parent.y + yOffset,
        });
      });
    }

    return nodes;
  }, [visibleScenarios, screenNodeMap]);

  const entry = inferEntryScreen(transitions);
  const hasBranches = scenarioNodes.length > 0;
  const width = NODE_W + 32 + (hasBranches ? BRANCH_OFFSET_X + NODE_W : 0);
  const height = Math.max(
    120,
    screenNodes.length * (NODE_H + ROW_GAP) + 24,
    ...scenarioNodes.map((n) => n.y + NODE_H + 24),
  );

  const edges: { t: TransitionEdge; fromId: string; toId: string }[] = transitions.map((t) => ({
    t,
    fromId: t.from ?? entry ?? t.target,
    toId: t.target,
  }));

  const multiFlow = graph.flows.length > 1 || (graph.flows[0] && graph.flows[0].id !== 'default');

  useEffect(() => {
    activeNodeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeScreen, activeScenario]);

  const handleSelectScreen = (id: string) => {
    onClearScenario?.();
    onSelectScreen(id);
  };

  return (
    <div className="sub-flow-graph-panel">
      <div className="sub-flow-graph-header">
        <h2>Flow</h2>
        {multiFlow ? (
          <select
            className="sub-flow-filter"
            value={activeFlowId}
            onChange={(e) => onSelectFlow(e.target.value)}
            aria-label="Filter flow"
          >
            {graph.flows.map((f) => (
              <option key={f.id} value={f.id}>
                {f.id}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {transitions.length === 0 ? (
        <p className="sub-flow-graph-empty">No transitions</p>
      ) : (
        <div className="sub-flow-graph-canvas">
          <svg width={width} height={height} className="sub-flow-graph-svg" aria-hidden>
            {edges.map((e, i) => {
              const from = screenNodeMap[e.fromId];
              const to = screenNodeMap[e.toId];
              if (!from || !to) return null;
              const active =
                !activeScenario &&
                (activeScreen === e.fromId || activeScreen === e.toId);
              return (
                <g key={`${e.t.trigger}-${i}`}>
                  <path
                    d={edgePathVertical(from, to)}
                    className={`sub-flow-edge${active ? ' active' : ''}`}
                    fill="none"
                  />
                  <text
                    x={from.x + NODE_W / 2 + 8}
                    y={(from.y + NODE_H + to.y) / 2}
                    className="sub-flow-edge-label"
                    textAnchor="start"
                  >
                    {e.t.trigger}
                  </text>
                </g>
              );
            })}
            {scenarioNodes.map((n) => {
              const from = screenNodeMap[n.screenId];
              if (!from) return null;
              const active = activeScenario === n.scenarioId;
              return (
                <g key={`branch-${n.scenarioId}`}>
                  <path
                    d={edgePathHorizontal(from, n)}
                    className={`sub-flow-edge sub-flow-edge-branch${active ? ' active' : ''}`}
                    fill="none"
                  />
                </g>
              );
            })}
          </svg>
          <div className="sub-flow-nodes" style={{ width, height }}>
            {screenNodes.map((n) => {
              const isActive = activeScreen === n.id && !activeScenario;
              return (
                <button
                  key={n.id}
                  ref={isActive ? activeNodeRef : undefined}
                  type="button"
                  className={`sub-flow-node${isActive ? ' active' : ''}`}
                  style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
                  onClick={() => handleSelectScreen(n.id)}
                >
                  {n.id}
                </button>
              );
            })}
            {scenarioNodes.map((n) => {
              const isActive = activeScenario === n.scenarioId;
              return (
                <button
                  key={n.id}
                  ref={isActive ? activeNodeRef : undefined}
                  type="button"
                  className={`sub-flow-node sub-flow-node-scenario${isActive ? ' active' : ''}`}
                  style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
                  onClick={() => onSelectScenario?.(n.scenarioId)}
                  title={n.label}
                >
                  {n.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
