"use client";

import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type BuiltInEdge,
  type Node,
  type NodeProps,
} from "@xyflow/react";

type DiagramNodeData = {
  description: string;
  eyebrow: string;
  title: string;
  tone?: "agent" | "graph" | "source" | "evidence";
};

type DiagramNode = Node<DiagramNodeData, "diagram">;

const nodeTypes = {
  diagram: DiagramNodeCard,
};

const baseEdge = {
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color: "#85868b",
  },
  style: {
    stroke: "#85868b",
    strokeWidth: 1.6,
  },
};

function DiagramNodeCard({ data }: NodeProps<DiagramNode>) {
  return (
    <div className={`docs-flow-node docs-flow-node--${data.tone ?? "agent"}`}>
      <Handle
        className="docs-flow-handle"
        type="target"
        position={Position.Left}
      />
      <Handle
        className="docs-flow-handle"
        id="right"
        type="target"
        position={Position.Right}
      />
      <Handle
        className="docs-flow-handle"
        id="top"
        type="target"
        position={Position.Top}
      />
      <Handle
        className="docs-flow-handle"
        id="target-bottom"
        type="target"
        position={Position.Bottom}
      />
      <p className="docs-flow-eyebrow">{data.eyebrow}</p>
      <p className="docs-flow-title">{data.title}</p>
      <p className="docs-flow-description">{data.description}</p>
      <Handle
        className="docs-flow-handle"
        type="source"
        position={Position.Right}
      />
      <Handle
        className="docs-flow-handle"
        id="left"
        type="source"
        position={Position.Left}
      />
      <Handle
        className="docs-flow-handle"
        id="bottom"
        type="source"
        position={Position.Bottom}
      />
      <Handle
        className="docs-flow-handle"
        id="source-top"
        type="source"
        position={Position.Top}
      />
    </div>
  );
}

function Diagram({
  ariaLabel,
  caption,
  edges,
  height,
  nodes,
  summary,
}: {
  ariaLabel: string;
  caption: string;
  edges: BuiltInEdge[];
  height: number;
  nodes: DiagramNode[];
  summary: string;
}) {
  return (
    <figure className="docs-flow-figure">
      <div
        aria-label={`${ariaLabel}. Scroll horizontally to inspect the diagram.`}
        className="docs-flow-scroll"
        tabIndex={0}
      >
        <div
          aria-label={ariaLabel}
          className="docs-flow-canvas"
          role="img"
          style={{ height }}
        >
          <ReactFlow
            aria-label={ariaLabel}
            edges={edges}
            edgesFocusable={false}
            elementsSelectable={false}
            fitView
            fitViewOptions={{ maxZoom: 1, minZoom: 0.45, padding: 0.16 }}
            minZoom={0.45}
            nodes={nodes}
            nodesConnectable={false}
            nodesDraggable={false}
            nodesFocusable={false}
            nodeTypes={nodeTypes}
            panOnDrag={false}
            preventScrolling={false}
            proOptions={{ hideAttribution: true }}
            zoomOnDoubleClick={false}
            zoomOnPinch={false}
            zoomOnScroll={false}
          >
            <Background color="#d8d8dc" gap={24} size={1} />
          </ReactFlow>
        </div>
      </div>
      <figcaption>
        <span>{caption}</span>
        <span className="docs-flow-scroll-hint">
          {" "}
          Scroll horizontally to inspect the full flow.
        </span>
        <span className="sr-only"> {summary}</span>
      </figcaption>
    </figure>
  );
}

const productLoopNodes: DiagramNode[] = [
  {
    id: "init",
    type: "diagram",
    position: { x: 0, y: 0 },
    data: {
      eyebrow: "Establish once",
      title: "/lamina-init",
      description: "Ground the product, actors, and personas.",
      tone: "graph",
    },
  },
  {
    id: "design",
    type: "diagram",
    position: { x: 300, y: 0 },
    data: {
      eyebrow: "Publish intent",
      title: "/lamina-design",
      description: "Commit a validated GraphVersion.",
      tone: "graph",
    },
  },
  {
    id: "implement",
    type: "diagram",
    position: { x: 600, y: 0 },
    data: {
      eyebrow: "Coding session",
      title: "Implement",
      description: "Build the resolved projection in any stack.",
      tone: "agent",
    },
  },
  {
    id: "verify",
    type: "diagram",
    position: { x: 600, y: 220 },
    data: {
      eyebrow: "Exercise the product",
      title: "/lamina-verify",
      description: "Run isolated persona missions against the live app.",
      tone: "evidence",
    },
  },
  {
    id: "fix",
    type: "diagram",
    position: { x: 300, y: 220 },
    data: {
      eyebrow: "Coding session",
      title: "Apply findings",
      description: "Fix product behavior without bypassing the contract.",
      tone: "agent",
    },
  },
  {
    id: "done",
    type: "diagram",
    position: { x: 0, y: 220 },
    data: {
      eyebrow: "Evidence-backed",
      title: "Verified",
      description: "Keep the result or redesign a contract gap.",
      tone: "evidence",
    },
  },
];

const productLoopEdges: BuiltInEdge[] = [
  { id: "init-design", source: "init", target: "design", ...baseEdge },
  { id: "design-implement", source: "design", target: "implement", ...baseEdge },
  {
    id: "implement-verify",
    source: "implement",
    sourceHandle: "bottom",
    target: "verify",
    targetHandle: "top",
    ...baseEdge,
  },
  {
    id: "verify-fix",
    source: "verify",
    sourceHandle: "left",
    target: "fix",
    targetHandle: "right",
    ...baseEdge,
  },
  {
    id: "fix-done",
    source: "fix",
    sourceHandle: "left",
    target: "done",
    targetHandle: "right",
    ...baseEdge,
  },
  {
    id: "fix-verify",
    source: "fix",
    sourceHandle: "bottom",
    target: "verify",
    targetHandle: "target-bottom",
    label: "re-verify",
    type: "smoothstep",
    pathOptions: { borderRadius: 12, offset: 22 },
    ...baseEdge,
    style: {
      ...baseEdge.style,
      strokeDasharray: "6 5",
    },
  },
  {
    id: "verify-design",
    source: "verify",
    target: "design",
    targetHandle: "top",
    label: "contract gap",
    type: "smoothstep",
    pathOptions: { borderRadius: 12, offset: 28 },
    ...baseEdge,
  },
];

export function ProductLoopDiagram() {
  return (
    <Diagram
      ariaLabel="Lamina product design and verification loop"
      caption="Intent becomes a GraphVersion; implementation and evidence stay separate."
      edges={productLoopEdges}
      height={430}
      nodes={productLoopNodes}
      summary="Initialize the product, design a GraphVersion, implement it, verify the live product, apply findings, and re-verify. Verification can return a contract gap to design."
    />
  );
}

const runtimeNodes: DiagramNode[] = [
  {
    id: "sources",
    type: "diagram",
    position: { x: 0, y: 0 },
    data: {
      eyebrow: "Observed",
      title: "Repository sources",
      description: "Managed CocoIndex worker emits rebuildable observations.",
      tone: "source",
    },
  },
  {
    id: "agents",
    type: "diagram",
    position: { x: 0, y: 190 },
    data: {
      eyebrow: "Inferred",
      title: "Agent proposals",
      description: "Typed resources and statements enter explicit sessions.",
      tone: "agent",
    },
  },
  {
    id: "runs",
    type: "diagram",
    position: { x: 0, y: 380 },
    data: {
      eyebrow: "Runtime evidence",
      title: "Mission runs",
      description: "Adapters normalize events and attach evidence.",
      tone: "evidence",
    },
  },
  {
    id: "graphd",
    type: "diagram",
    position: { x: 340, y: 190 },
    data: {
      eyebrow: "Sole writer",
      title: "graphd",
      description: "Authenticates, validates, versions, and commits atomically.",
      tone: "graph",
    },
  },
  {
    id: "ladybug",
    type: "diagram",
    position: { x: 680, y: 100 },
    data: {
      eyebrow: "Canonical",
      title: "Ladybug",
      description: "Stores GraphVersions, views, missions, runs, and facts.",
      tone: "graph",
    },
  },
  {
    id: "cas",
    type: "diagram",
    position: { x: 680, y: 300 },
    data: {
      eyebrow: "Content-addressed",
      title: "Evidence CAS",
      description: "Keeps immutable evidence payloads outside graph facts.",
      tone: "evidence",
    },
  },
];

const runtimeEdges: BuiltInEdge[] = [
  {
    id: "sources-graphd",
    source: "sources",
    target: "graphd",
    label: "observations",
    ...baseEdge,
  },
  {
    id: "agents-graphd",
    source: "agents",
    target: "graphd",
    label: "proposals",
    ...baseEdge,
  },
  {
    id: "runs-graphd",
    source: "runs",
    target: "graphd",
    label: "events",
    ...baseEdge,
  },
  {
    id: "graphd-ladybug",
    source: "graphd",
    target: "ladybug",
    label: "transactions",
    ...baseEdge,
  },
  {
    id: "graphd-cas",
    source: "graphd",
    target: "cas",
    label: "evidence",
    ...baseEdge,
  },
];

export function RuntimeArchitectureDiagram() {
  return (
    <Diagram
      ariaLabel="Lamina runtime ownership and data flow"
      caption="Every ingress crosses graphd; no observer, agent, or adapter opens Ladybug."
      edges={runtimeEdges}
      height={520}
      nodes={runtimeNodes}
      summary="Repository sources, agent proposals, and mission runs send typed data to graphd. Graphd is the sole Ladybug writer and stores evidence payloads in a content-addressed store."
    />
  );
}

const transactionNodes: DiagramNode[] = [
  {
    id: "base",
    type: "diagram",
    position: { x: 0, y: 0 },
    data: {
      eyebrow: "Branch view",
      title: "Base GraphVersion",
      description: "A session starts from the current resolved head.",
      tone: "graph",
    },
  },
  {
    id: "stage",
    type: "diagram",
    position: { x: 280, y: 0 },
    data: {
      eyebrow: "Private workspace",
      title: "Stage mutations",
      description: "Add, retire, patch, and link typed graph facts.",
      tone: "agent",
    },
  },
  {
    id: "validate",
    type: "diagram",
    position: { x: 560, y: 0 },
    data: {
      eyebrow: "Deterministic gate",
      title: "Validate closure",
      description: "Check references, policy, cycles, evidence, and conflicts.",
      tone: "evidence",
    },
  },
  {
    id: "publish",
    type: "diagram",
    position: { x: 560, y: 210 },
    data: {
      eyebrow: "Compare-and-swap",
      title: "Publish atomically",
      description: "Commit the whole delta only if the branch head still matches.",
      tone: "graph",
    },
  },
  {
    id: "head",
    type: "diagram",
    position: { x: 280, y: 210 },
    data: {
      eyebrow: "New resolved view",
      title: "GraphVersion",
      description: "Move the branch head and preserve the version history.",
      tone: "graph",
    },
  },
  {
    id: "rebase",
    type: "diagram",
    position: { x: 0, y: 210 },
    data: {
      eyebrow: "Head changed",
      title: "Rebase or inspect",
      description: "Reconcile concurrent facts; keep contradictions visible.",
      tone: "source",
    },
  },
];

const transactionEdges: BuiltInEdge[] = [
  { id: "base-stage", source: "base", target: "stage", ...baseEdge },
  { id: "stage-validate", source: "stage", target: "validate", ...baseEdge },
  {
    id: "validate-publish",
    source: "validate",
    sourceHandle: "bottom",
    target: "publish",
    targetHandle: "top",
    label: "approved",
    ...baseEdge,
  },
  {
    id: "publish-head",
    source: "publish",
    sourceHandle: "left",
    target: "head",
    targetHandle: "right",
    ...baseEdge,
  },
  {
    id: "head-rebase",
    source: "head",
    sourceHandle: "left",
    target: "rebase",
    targetHandle: "right",
    ...baseEdge,
  },
  {
    id: "rebase-stage",
    source: "rebase",
    sourceHandle: "left",
    target: "stage",
    targetHandle: "top",
    label: "retry",
    type: "smoothstep",
    pathOptions: { borderRadius: 12, offset: 28 },
    ...baseEdge,
  },
];

export function TransactionLifecycleDiagram() {
  return (
    <Diagram
      ariaLabel="Lamina transactional graph session lifecycle"
      caption="A session publishes one validated delta or leaves the branch unchanged."
      edges={transactionEdges}
      height={420}
      nodes={transactionNodes}
      summary="Start from a base GraphVersion, stage typed mutations, validate the affected closure, and publish atomically. If the branch head changed, rebase and retry."
    />
  );
}
