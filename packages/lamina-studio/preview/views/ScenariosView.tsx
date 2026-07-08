import { useEffect, useState } from 'react';
import { useStudio } from '../studio/StudioContext.js';
import { CATEGORY_LABELS, SCENARIO_CATEGORIES } from '../studio/scenario-categories.js';
import { whenLabel } from '../studio/when-label.js';
import { ScenarioDetailDrawer } from './ScenarioDetailDrawer.js';

const ADVANCED_STORAGE_KEY = 'lamina-studio-advanced-coverage';

const CATEGORIES = [...SCENARIO_CATEGORIES];

function readAdvancedPreference(): boolean {
  try {
    return localStorage.getItem(ADVANCED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function ScenariosView() {
  const {
    coverage,
    scenarios,
    selectedScenarioId,
    setSelectedScenarioId,
    navigate,
  } = useStudio();

  const gaps = coverage?.gaps ?? [];
  const score = coverage?.score ?? 0;
  const operations = coverage?.operations ?? [];
  const cells = coverage?.cells ?? [];
  const [showAdvanced, setShowAdvanced] = useState(readAdvancedPreference);

  useEffect(() => {
    try {
      localStorage.setItem(ADVANCED_STORAGE_KEY, showAdvanced ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, [showAdvanced]);

  return (
    <div className="sub-studio-scenarios sub-studio-scenarios-simple">
      <header className="sub-studio-view-header sub-studio-view-header-row">
        <div>
          <h2>Scenarios</h2>
          <p className="sub-studio-view-subtitle">What could go wrong?</p>
        </div>
        <span className="sub-studio-coverage-score">
          {score}% covered · {gaps.length} gaps · {scenarios.length} edge cases
        </span>
      </header>

      <div className="sub-studio-scenarios-simple-body">
        <section className="sub-studio-scenarios-section">
          <h3>Gaps to fix</h3>
          {gaps.length ? (
            <div className="sub-studio-gap-cards">
              {gaps.map((g) => (
                <article key={`${g.operationId}-${g.category}`} className="sub-studio-gap-card">
                  <h4>
                    {g.operation} — {CATEGORY_LABELS[g.category] ?? g.category}
                  </h4>
                  <p className="sub-studio-muted">{g.reason}</p>
                  <p>
                    Screen: <strong>{g.screenId}</strong>
                  </p>
                  <button
                    type="button"
                    className="sub-studio-primary-action"
                    onClick={() => navigate({ screenId: g.screenId })}
                  >
                    Go to screen
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="sub-studio-muted">All required edge cases are covered for this run.</p>
          )}
        </section>

        <section className="sub-studio-scenarios-section">
          <h3>Mapped edge cases</h3>
          {scenarios.length ? (
            <ul className="sub-studio-mapped-list">
              {scenarios.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="sub-studio-mapped-item"
                    onClick={() => setSelectedScenarioId(s.id)}
                  >
                    <span className="sub-studio-mapped-title">{s.title}</span>
                    <span className="sub-studio-muted">
                      {s.screen} · {whenLabel(s.trigger.when)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="sub-studio-link-action"
                    onClick={() =>
                      navigate({ screenId: s.screen, scenarioId: s.id })
                    }
                  >
                    Open screen
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sub-studio-muted">No edge cases mapped yet for this run.</p>
          )}
        </section>

        <section className="sub-studio-scenarios-section">
          <button
            type="button"
            className="sub-studio-advanced-toggle"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? 'Hide' : 'Show'} advanced coverage matrix
          </button>
          {showAdvanced ? (
            <div className="sub-studio-matrix-wrap">
              <p className="sub-studio-matrix-legend sub-studio-muted">
                ● Covered · ○ Missing · — Not required
              </p>
              <table className="sub-studio-matrix">
                <thead>
                  <tr>
                    <th>Operation</th>
                    {CATEGORIES.map((c) => (
                      <th key={c} title={CATEGORY_LABELS[c]}>
                        {CATEGORY_LABELS[c]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {operations.map((op) => (
                    <tr key={op.id}>
                      <td>{op.operation}</td>
                      {CATEGORIES.map((cat) => {
                        const cell = cells.find(
                          (c) => c.operationId === op.id && c.category === cat,
                        );
                        if (!cell?.required) {
                          return (
                            <td key={cat} className="sub-studio-matrix-na">
                              —
                            </td>
                          );
                        }
                        return (
                          <td key={cat}>
                            <button
                              type="button"
                              className={
                                cell.covered ? 'sub-studio-matrix-covered' : 'sub-studio-matrix-gap'
                              }
                              title={cell.covered ? 'Covered' : 'Missing'}
                              onClick={() => {
                                if (cell.scenarioId) setSelectedScenarioId(cell.scenarioId);
                              }}
                            >
                              {cell.covered ? '●' : '○'}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>

      {selectedScenarioId ? (
        <ScenarioDetailDrawer
          scenarioId={selectedScenarioId}
          onClose={() => setSelectedScenarioId(null)}
        />
      ) : null}
    </div>
  );
}
