import { useStudio } from '../studio/StudioContext.js';

function whenLabel(when: string): string {
  const labels: Record<string, string> = {
    collection_empty: 'collection is empty',
    not_found: 'resource not found',
    validation_failed: 'validation fails',
    state_disallows: 'action not allowed in current state',
    concurrent_edit: 'concurrent edit conflict',
    session_expired: 'session expired',
    forbidden: 'access denied',
    dependency_unavailable: 'dependency unavailable',
    limit_reached: 'limit reached',
    timeout: 'request times out',
  };
  return labels[when] ?? when.replace(/_/g, ' ');
}

export function PeopleView() {
  const { personaData, activePersonaId, setActivePersonaId, navigate, runMeta } = useStudio();

  if (!personaData?.personas.length) {
    return (
      <div className="sub-studio-empty">
        <p>No personas found. Add <code>.lamina/personas.yaml</code> to enable the People view.</p>
      </div>
    );
  }

  const simulation = runMeta?.simulation as
    | { confidence?: string; results?: unknown[] }
    | undefined;

  return (
    <div className="sub-studio-people">
      <header className="sub-studio-view-header">
        <h2>People</h2>
        <p className="sub-studio-view-subtitle">UX research — personas and simulation blockers</p>
        {simulation?.confidence ? (
          <span className="sub-studio-badge">Simulation confidence: {simulation.confidence}</span>
        ) : null}
        <span className="sub-studio-badge sub-studio-badge-muted">Simulated · not validated user research</span>
      </header>
      <div className="sub-studio-people-layout">
        <aside className="sub-studio-persona-list">
          {personaData.personas.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`sub-studio-persona-card${activePersonaId === p.id ? ' active' : ''}`}
              onClick={() => setActivePersonaId(p.id)}
            >
              <span className="sub-studio-persona-name">{p.displayName}</span>
              <span className="sub-studio-persona-type">{p.type}</span>
              {p.simulation ? (
                <span className={`sub-studio-outcome sub-studio-outcome-${p.simulation.outcome}`}>
                  {p.simulation.outcome.replace(/_/g, ' ')}
                </span>
              ) : null}
            </button>
          ))}
        </aside>
        <main className="sub-studio-persona-detail">
          {personaData.personas
            .filter((p) => p.id === activePersonaId)
            .map((p) => (
              <div key={p.id}>
                <h3>{p.displayName}</h3>
                {p.goals.end.length > 0 ? (
                  <section>
                    <h4>End goals</h4>
                    <ul>
                      {p.goals.end.map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {p.goals.experience.length > 0 ? (
                  <section>
                    <h4>Experience goals</h4>
                    <ul>
                      {p.goals.experience.map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {p.frustrations.length > 0 ? (
                  <section>
                    <h4>Frustrations</h4>
                    <ul>
                      {p.frustrations.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {p.simulation?.blockers.length ? (
                  <section>
                    <h4>Blockers</h4>
                    <div className="sub-studio-blocker-list">
                      {p.simulation.blockers.map((b, i) => (
                        <div key={`${b.step}-${i}`} className="sub-studio-blocker-card">
                          <div className="sub-studio-blocker-meta">
                            <span>{b.screenId ?? b.step}</span>
                            <span className={`sub-rf-badge-severity-${b.severity}`}>{b.severity}</span>
                          </div>
                          <blockquote>{b.quote}</blockquote>
                          <div className="sub-studio-blocker-actions">
                            {b.screenId ? (
                              <button
                                type="button"
                                onClick={() =>
                                  navigate({ view: 'screens', screenId: b.screenId })
                                }
                              >
                                Go to screen
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => navigate({ view: 'flows' })}
                            >
                              Go to flow
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : (
                  <p className="sub-studio-muted">No blockers recorded for this persona in the current run.</p>
                )}
              </div>
            ))}
        </main>
      </div>
    </div>
  );
}

export { whenLabel };
