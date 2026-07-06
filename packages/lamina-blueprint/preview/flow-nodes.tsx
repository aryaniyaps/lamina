import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

export type ScreenNodeData = {
  screenId: string;
  title: string;
  subtitle?: string;
  stepLabel?: string;
  isEntry: boolean;
  isTerminal: boolean;
  triggers: string[];
  states: string[];
  isActive: boolean;
  hasBlocker: boolean;
  blockerQuote?: string;
};

export type ScenarioNodeData = {
  title: string;
  description?: string;
  severity?: string;
  scenarioId: string;
  parentScreen: string;
  isActive: boolean;
};

export type ScreenNodeType = Node<ScreenNodeData, 'screen'>;
export type ScenarioNodeType = Node<ScenarioNodeData, 'scenario'>;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export const ScreenNode = memo(function ScreenNode({ data }: NodeProps<ScreenNodeType>) {
  const showSubtitle = Boolean(data.subtitle);
  const showStates = data.states.length > 0;

  return (
    <div
      className={`sub-rf-screen-node${data.isActive ? ' active' : ''}${data.hasBlocker ? ' blocked' : ''}`}
      title={data.blockerQuote}
    >
      <Handle type="target" position={Position.Top} className="sub-rf-handle" />
      <div className="sub-rf-screen-node-header">
        <span className="sub-rf-screen-node-title">{data.title}</span>
        <div className="sub-rf-screen-node-badges">
          {data.isEntry ? <span className="sub-rf-badge sub-rf-badge-entry">Entry</span> : null}
          {data.isTerminal ? <span className="sub-rf-badge sub-rf-badge-terminal">End</span> : null}
          {data.hasBlocker ? <span className="sub-rf-badge sub-rf-badge-blocker" aria-hidden /> : null}
        </div>
      </div>
      {showSubtitle ? (
        <p className="sub-rf-screen-node-subtitle">{truncate(data.subtitle!, 40)}</p>
      ) : null}
      <div className="sub-rf-screen-node-footer">
        {data.stepLabel ? <span className="sub-rf-screen-node-step">{data.stepLabel}</span> : null}
        {data.triggers.length > 0 ? (
          <span className="sub-rf-screen-node-triggers" title={data.triggers.join(', ')}>
            {data.triggers.join(' · ')}
          </span>
        ) : null}
      </div>
      {showStates ? (
        <div className="sub-rf-screen-node-states">
          {data.states.map((s) => (
            <span key={s} className="sub-rf-chip">
              {s.replace('State', '')}
            </span>
          ))}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="sub-rf-handle" />
      <Handle type="source" position={Position.Right} id="branch" className="sub-rf-handle" />
    </div>
  );
});

export const ScenarioNode = memo(function ScenarioNode({ data }: NodeProps<ScenarioNodeType>) {
  const showDesc =
    data.description &&
    data.description.trim().toLowerCase() !== data.title.trim().toLowerCase();

  return (
    <div className={`sub-rf-scenario-node${data.isActive ? ' active' : ''}`}>
      <Handle type="target" position={Position.Left} className="sub-rf-handle" />
      <div className="sub-rf-scenario-node-header">
        <span className="sub-rf-badge sub-rf-badge-branch">Branch</span>
        {data.severity ? (
          <span className={`sub-rf-badge sub-rf-badge-severity sub-rf-badge-severity-${data.severity}`}>
            {data.severity}
          </span>
        ) : null}
      </div>
      <span className="sub-rf-scenario-node-title">{data.title}</span>
      {showDesc ? <p className="sub-rf-scenario-node-desc">{data.description}</p> : null}
    </div>
  );
});

export const flowNodeTypes = {
  screen: ScreenNode,
  scenario: ScenarioNode,
};
