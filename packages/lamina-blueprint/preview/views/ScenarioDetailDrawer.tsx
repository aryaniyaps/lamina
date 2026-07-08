import { useMemo } from 'react';
import { useStudio } from '../studio/StudioContext.js';
import { whenLabel } from './PeopleView.js';

export function ScenarioDetailDrawer({
  scenarioId,
  onClose,
}: {
  scenarioId: string;
  onClose: () => void;
}) {
  const { scenarios, navigate } = useStudio();
  const scenario = useMemo(
    () => scenarios.find((s) => s.id === scenarioId),
    [scenarios, scenarioId],
  );

  if (!scenario) return null;

  return (
    <div className="sub-studio-drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="sub-studio-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Scenario ${scenario.title}`}
      >
        <header>
          <h3>{scenario.title}</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <dl className="sub-studio-drawer-fields">
          <dt>Description</dt>
          <dd>{scenario.description ?? '—'}</dd>
          <dt>Screen</dt>
          <dd>{scenario.screen}{scenario.flow ? ` (${scenario.flow} flow)` : ''}</dd>
          <dt>Category</dt>
          <dd>{scenario.category}</dd>
          <dt>When</dt>
          <dd>{whenLabel(scenario.trigger.when)}</dd>
          <dt>Operation</dt>
          <dd>{scenario.trigger.operation}</dd>
          <dt>Subject</dt>
          <dd>{scenario.trigger.subject}</dd>
          <dt>Pattern</dt>
          <dd>{scenario.ux}</dd>
          {scenario.severity ? (
            <>
              <dt>Severity</dt>
              <dd>{scenario.severity}</dd>
            </>
          ) : null}
        </dl>
        <div className="sub-studio-drawer-actions">
          <button
            type="button"
            onClick={() =>
              navigate({ view: 'screens', screenId: scenario.screen, scenarioId: scenario.id })
            }
          >
            Show on screen
          </button>
        </div>
      </aside>
    </div>
  );
}
