import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ScreenCompleteness } from './screen-meta.js';

export interface ScreenNodeData {
  label: string;
  subtitle?: string;
  step?: number;
  triggers?: string[];
  active?: boolean;
  blocked?: boolean;
  gapCount?: number;
  completeness?: ScreenCompleteness;
  isEntry?: boolean;
  isTerminal?: boolean;
  [key: string]: unknown;
}

export interface ScenarioNodeData {
  scenarioId: string;
  title: string;
  description?: string;
  severity?: string;
  active?: boolean;
  [key: string]: unknown;
}

function completenessLabel(completeness?: ScreenCompleteness): string | null {
  if (completeness === 'skeleton') return 'Pending';
  if (completeness === 'error') return 'Error';
  return null;
}

function ScreenNodeComponent({ data }: NodeProps) {
  const d = data as ScreenNodeData;
  const stateLabel = completenessLabel(d.completeness);

  return (
    <div
      className={[
        'sub-rf-node',
        'sub-rf-screen-node',
        d.active ? 'active' : '',
        d.blocked ? 'blocked' : '',
        d.completeness === 'skeleton' ? 'skeleton' : '',
        d.completeness === 'error' ? 'error' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Handle type="target" position={Position.Left} className="sub-rf-handle" />
      <div className="sub-rf-screen-node-header">
        <div className="sub-rf-screen-node-titles">
          <span className="sub-rf-screen-node-title">{d.label}</span>
          {d.subtitle ? <p className="sub-rf-screen-node-subtitle">{d.subtitle}</p> : null}
        </div>
        <div className="sub-rf-screen-node-badges">
          {d.isEntry ? <span className="sub-rf-badge sub-rf-badge-entry">Entry</span> : null}
          {d.isTerminal ? <span className="sub-rf-badge sub-rf-badge-terminal">End</span> : null}
          {d.gapCount ? (
            <span
              className="sub-rf-badge sub-rf-badge-gap"
              title={`${d.gapCount} coverage gap${d.gapCount === 1 ? '' : 's'}`}
            >
              {d.gapCount} gap{d.gapCount === 1 ? '' : 's'}
            </span>
          ) : null}
          {d.blocked ? (
            <span className="sub-rf-badge sub-rf-badge-blocker" title="Persona blocker" />
          ) : null}
        </div>
      </div>
      <div className="sub-rf-screen-node-footer">
        {d.step !== undefined ? (
          <span className="sub-rf-screen-node-step">Step {d.step + 1}</span>
        ) : (
          <span />
        )}
        {d.triggers?.length ? (
          <span className="sub-rf-screen-node-triggers">{d.triggers.join(' · ')}</span>
        ) : null}
      </div>
      {stateLabel ? (
        <div className="sub-rf-screen-node-states">
          <span className="sub-rf-chip">{stateLabel}</span>
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} className="sub-rf-handle" />
    </div>
  );
}

function ScenarioNodeComponent({ data }: NodeProps) {
  const d = data as ScenarioNodeData;

  return (
    <div
      className={[
        'sub-rf-node',
        'sub-rf-scenario-node',
        d.active ? 'active' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Handle type="target" position={Position.Top} className="sub-rf-handle" />
      <div className="sub-rf-scenario-node-header">
        <span className="sub-rf-scenario-node-title">{d.title}</span>
        <span className="sub-rf-badge sub-rf-badge-branch">Branch</span>
        {d.severity ? (
          <span className={`sub-rf-badge sub-rf-badge-severity-${d.severity}`}>{d.severity}</span>
        ) : null}
      </div>
      {d.description ? <p className="sub-rf-scenario-node-desc">{d.description}</p> : null}
      <Handle type="source" position={Position.Bottom} className="sub-rf-handle" />
    </div>
  );
}

export const flowNodeTypes = {
  screen: memo(ScreenNodeComponent),
  scenario: memo(ScenarioNodeComponent),
};
