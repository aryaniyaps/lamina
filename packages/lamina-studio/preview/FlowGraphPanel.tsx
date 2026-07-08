import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react';
import type { FlowGraphData } from './flow-graph.js';
import { resolveFlowTransitions } from './flow-graph.js';
import type { ScenarioEntry } from './scenarios.js';
import { blockerScreens, type PersonaEntry } from './personas.js';
import type { ScreenMeta } from './screen-meta.js';
import { buildFlowElements } from './flow-graph-reactflow.js';
import { flowNodeTypes } from './flow-nodes.js';

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
  activePersona?: PersonaEntry | null;
  screenMeta?: Record<string, ScreenMeta>;
}

function FlowFocus({ activeFlowId, nodeCount }: { activeFlowId: string; nodeCount: number }) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      fitView({ padding: 0.2, duration: 200 });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeFlowId, nodeCount, fitView]);

  return null;
}

function FlowGraphCanvas({
  graph,
  activeScreen,
  activeFlowId,
  onSelectScreen,
  scenarios,
  activeScenario,
  onSelectScenario,
  onClearScenario,
  activePersona,
  screenMeta = {},
}: Omit<FlowGraphPanelProps, 'onSelectFlow'> & { activeScenario: string | null }) {
  const personaBlockedScreens = useMemo(
    () => blockerScreens(activePersona?.simulation),
    [activePersona],
  );

  const blockerQuotes = useMemo(() => {
    const map = new Map<string, string>();
    if (!activePersona?.simulation) return map;
    for (const b of activePersona.simulation.blockers) {
      if (b.screenId && !map.has(b.screenId)) {
        map.set(b.screenId, b.quote);
      }
    }
    return map;
  }, [activePersona]);

  const { nodes, edges } = useMemo(
    () =>
      buildFlowElements({
        graph,
        activeFlowId,
        scenarios: scenarios ?? [],
        activeScreen,
        activeScenario,
        personaBlockedScreens,
        blockerQuotes,
        screenMeta,
      }),
    [
      graph,
      activeFlowId,
      scenarios,
      activeScreen,
      activeScenario,
      personaBlockedScreens,
      blockerQuotes,
      screenMeta,
    ],
  );

  const transitions = resolveFlowTransitions(graph, activeFlowId);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === 'screen') {
        onClearScenario?.();
        onSelectScreen(node.id);
        return;
      }
      if (node.type === 'scenario') {
        const scenarioId = (node.data as { scenarioId: string }).scenarioId;
        onSelectScenario?.(scenarioId);
      }
    },
    [onClearScenario, onSelectScreen, onSelectScenario],
  );

  if (transitions.length === 0) {
    return <p className="sub-flow-graph-empty">No transitions</p>;
  }

  return (
    <div className="sub-flow-graph-canvas">
      <ReactFlow
        key={activeFlowId}
        nodes={nodes}
        edges={edges}
        nodeTypes={flowNodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnScroll
        minZoom={0.5}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Controls showInteractive={false} />
        <FlowFocus activeFlowId={activeFlowId} nodeCount={nodes.length} />
      </ReactFlow>
    </div>
  );
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
  activePersona = null,
  screenMeta = {},
}: FlowGraphPanelProps) {
  const multiFlow = graph.flows.length > 1 || (graph.flows[0] && graph.flows[0].id !== 'default');

  return (
    <div className="sub-flow-graph-panel">
      <div className={`sub-flow-graph-header${multiFlow ? ' sub-flow-graph-header-stacked' : ''}`}>
        <h2>Flow</h2>
        {multiFlow ? (
          <select
            className="sub-flow-filter-lg"
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
      <ReactFlowProvider>
        <FlowGraphCanvas
          graph={graph}
          activeScreen={activeScreen}
          activeFlowId={activeFlowId}
          onSelectScreen={onSelectScreen}
          scenarios={scenarios}
          activeScenario={activeScenario}
          onSelectScenario={onSelectScenario}
          onClearScenario={onClearScenario}
          activePersona={activePersona}
          screenMeta={screenMeta}
        />
      </ReactFlowProvider>
    </div>
  );
}
