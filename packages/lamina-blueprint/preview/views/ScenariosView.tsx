import { useStudio } from '../studio/StudioContext.js';
import { whenLabel } from './PeopleView.js';
import { ScenarioDetailDrawer } from './ScenarioDetailDrawer.js';

const CATEGORIES = [
  'empty',
  'precondition',
  'partial',
  'conflict',
  'failure',
  'permission',
  'external',
  'boundary',
];

export function ScenariosView() {
  const {
    coverage,
    scenariosSubView,
    setScenariosSubView,
    scenarios,
    selectedScenarioId,
    setSelectedScenarioId,
    navigate,
    gapScreenIds,
  } = useStudio();

  const gaps = coverage?.gaps ?? [];
  const score = coverage?.score ?? 0;
  const operations = coverage?.operations ?? [];
  const cells = coverage?.cells ?? [];

  return (
    <div className="sub-studio-scenarios">
      <header className="sub-studio-view-header sub-studio-view-header-row">
        <div>
          <h2>Scenarios</h2>
          <p className="sub-studio-view-subtitle">UX design — edge-case coverage</p>
        </div>
        <span className="sub-studio-coverage-score">Coverage: {score}%</span>
      </header>
      <div className="sub-studio-scenarios-body">
        <aside className="sub-studio-scenarios-rail">
          <section>
            <h3>Gaps ({gaps.length})</h3>
            <ul>
              {gaps.map((g) => (
                <li key={`${g.operationId}-${g.category}`}>
                  <button type="button" className="sub-studio-gap-item">
                    <span className="sub-studio-gap-label">
                      {g.operation} × {g.category}
                    </span>
                    <span className="sub-studio-muted">{g.screenId}</span>
                  </button>
                </li>
              ))}
              {!gaps.length ? <li className="sub-studio-muted">No required gaps</li> : null}
            </ul>
          </section>
          <section>
            <h3>Mapped ({scenarios.length})</h3>
            <ul>
              {scenarios.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={selectedScenarioId === s.id ? 'active' : ''}
                    onClick={() => setSelectedScenarioId(s.id)}
                  >
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
        <main className="sub-studio-scenarios-main">
          <div className="sub-studio-subtabs">
            {(['gaps', 'matrix', 'gallery'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={scenariosSubView === tab ? 'active' : ''}
                onClick={() => setScenariosSubView(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {scenariosSubView === 'gaps' ? (
            <div className="sub-studio-gap-cards">
              {gaps.map((g) => (
                <article key={`${g.operationId}-${g.category}`} className="sub-studio-gap-card">
                  <h4>
                    GAP · {g.operation} × {g.category}
                  </h4>
                  <p>
                    Screen: {g.screenId}
                  </p>
                  <p className="sub-studio-muted">{g.reason}</p>
                </article>
              ))}
              {!gaps.length ? (
                <p className="sub-studio-muted">All required operation × outcome cells are covered.</p>
              ) : null}
            </div>
          ) : null}

          {scenariosSubView === 'matrix' ? (
            <div className="sub-studio-matrix-wrap">
              <table className="sub-studio-matrix">
                <thead>
                  <tr>
                    <th>Operation</th>
                    {CATEGORIES.map((c) => (
                      <th key={c}>{c}</th>
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

          {scenariosSubView === 'gallery' ? (
            <div className="sub-studio-gallery">
              {scenarios.map((s, i) => (
                <article key={s.id} className="sub-studio-scenario-card">
                  <header>
                    <span className="sub-studio-chip">{s.category}</span>
                    {s.severity ? <span className="sub-studio-chip">{s.severity}</span> : null}
                    <span className="sub-studio-card-num">#{i + 1}</span>
                  </header>
                  <h4>{s.title}</h4>
                  <p>{whenLabel(s.trigger.when)}</p>
                  <p className="sub-studio-muted">
                    Pattern: {s.ux} · Screen: {s.screen}
                    {gapScreenIds.has(s.screen) ? '' : ''}
                  </p>
                  <div className="sub-studio-card-actions">
                    <button type="button" onClick={() => setSelectedScenarioId(s.id)}>
                      Inspect
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate({ view: 'screens', screenId: s.screen, scenarioId: s.id })}
                    >
                      Show on screen
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </main>
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
