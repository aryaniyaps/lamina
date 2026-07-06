import { useMemo } from 'react';
import type { FlowGraphData, TransitionEdge } from './flow-graph.js';
import { inferEntryScreen } from './flow-graph.js';

interface FlowGraphPanelProps {
  graph: FlowGraphData;
  activeScreen: string;
  activeFlowId: string;
  onSelectScreen: (id: string) => void;
  onSelectFlow: (id: string) => void;
  changedScreens?: string[];
}

const NODE_W = 140;
const NODE_H = 36;
const ROW_GAP = 48;

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

export function FlowGraphPanel({
  graph,
  activeScreen,
  activeFlowId,
  onSelectScreen,
  onSelectFlow,
  changedScreens = [],
}: FlowGraphPanelProps) {
  const flow = graph.flows.find((f) => f.id === activeFlowId) ?? graph.flows[0];
  const transitions = flow?.transitions ?? graph.transitions;

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

  const nodes = layoutNodesVertical(screenIds);
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const entry = inferEntryScreen(transitions);
  const width = NODE_W + 32;
  const height = Math.max(120, nodes.length * (NODE_H + ROW_GAP) + 24);

  const edges: { t: TransitionEdge; fromId: string; toId: string }[] = transitions.map((t) => ({
    t,
    fromId: t.from ?? entry ?? t.target,
    toId: t.target,
  }));

  const multiFlow = graph.flows.length > 1 || (graph.flows[0] && graph.flows[0].id !== 'default');

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
              const from = nodeMap[e.fromId];
              const to = nodeMap[e.toId];
              if (!from || !to) return null;
              const active = activeScreen === e.fromId || activeScreen === e.toId;
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
          </svg>
          <div className="sub-flow-nodes" style={{ width, height }}>
            {nodes.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`sub-flow-node${activeScreen === n.id ? ' active' : ''}${
                  changedScreens.includes(n.id) ? ' changed' : ''
                }`}
                style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
                onClick={() => onSelectScreen(n.id)}
              >
                {n.id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
