import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  useReactFlow,
  useNodesState,
  useEdgesState,
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
  onSelectFlow?: (id: string) => void;
  scenarios?: ScenarioEntry[];
  activeScenario?: string | null;
  onSelectScenario?: (id: string) => void;
  onClearScenario?: () => void;
  activePersona?: PersonaEntry | null;
  screenMeta?: Record<string, ScreenMeta>;
  gapCounts?: Map<string, number>;
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
  gapCounts = new Map(),
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

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () =>
      buildFlowElements({
        graph,
        activeFlowId,
        scenarios: scenarios ?? [],
        activeScreen,
        activeScenario,
        personaBlockedScreens,
        blockerQuotes,
        gapCounts,
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
      gapCounts,
      screenMeta,
    ],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  useEffect(() => {
    setNodes((current) => {
      const positionById = new Map(current.map((node) => [node.id, node.position]));
      return layoutNodes.map((node) => ({
        ...node,
        position: positionById.get(node.id) ?? node.position,
      }));
    });
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges, setNodes, setEdges]);

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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodesDraggable
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
  gapCounts = new Map(),
}: FlowGraphPanelProps) {
  const multiFlow = graph.flows.length > 1 || (graph.flows[0] && graph.flows[0].id !== 'default');

  return (
    <div className="sub-flow-graph-panel">
      <div className={`sub-flow-graph-header${multiFlow ? ' sub-flow-graph-header-stacked' : ''}`}>
        <h2>Flow</h2>
        {multiFlow && onSelectFlow ? (
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
          gapCounts={gapCounts}
        />
      </ReactFlowProvider>
    </div>
  );
}
