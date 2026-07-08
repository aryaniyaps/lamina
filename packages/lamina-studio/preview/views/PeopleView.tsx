import { useEffect, useState } from 'react';
import { useStudio } from '../studio/StudioContext.js';

export function PeopleView() {
  const { personaData, activePersonaId, navigate, runMeta } = useStudio();
  const [detailPersonaId, setDetailPersonaId] = useState<string | null>(null);

  useEffect(() => {
    if (activePersonaId) setDetailPersonaId(activePersonaId);
  }, [activePersonaId]);

  if (!personaData?.personas.length) {
    return (
      <div className="sub-studio-empty">
        <p>No personas in this project yet.</p>
        <p className="sub-studio-muted">
          Run <code>/lamina-design</code> to create or update <code>.lamina/personas.yaml</code>.
          Flows and Scenarios still work without personas.
        </p>
      </div>
    );
  }

  const simulation = runMeta?.simulation as
    | { confidence?: string; results?: unknown[] }
    | undefined;

  const detailId = detailPersonaId ?? activePersonaId ?? personaData.personas[0]!.id;
  const detailPersona = personaData.personas.find((p) => p.id === detailId);

  return (
    <div className="sub-studio-people">
      <header className="sub-studio-view-header">
        <h2>People</h2>
        <p className="sub-studio-view-subtitle">Who are we designing for?</p>
        {simulation?.confidence ? (
          <span className="sub-studio-badge">Simulation confidence: {simulation.confidence}</span>
        ) : null}
        <span className="sub-studio-badge sub-studio-badge-muted">Simulated · not user research</span>
      </header>
      <div className="sub-studio-people-layout">
        <aside className="sub-studio-persona-list" aria-label="Personas">
          {personaData.personas.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`sub-studio-persona-card${detailId === p.id ? ' active' : ''}${activePersonaId === p.id ? ' lens' : ''}`}
              onClick={() => setDetailPersonaId(p.id)}
            >
              <span className="sub-studio-persona-name">{p.displayName}</span>
              <span className="sub-studio-persona-type">{p.type}</span>
              {activePersonaId === p.id ? (
                <span className="sub-studio-persona-lens-tag">Viewing as</span>
              ) : null}
              {p.simulation ? (
                <span className={`sub-studio-outcome sub-studio-outcome-${p.simulation.outcome}`}>
                  {p.simulation.outcome.replace(/_/g, ' ')}
                </span>
              ) : null}
            </button>
          ))}
        </aside>
        <main className="sub-studio-persona-detail">
          {detailPersona ? (
            <div>
              <h3>{detailPersona.displayName}</h3>
              {detailPersona.goals.end.length > 0 ? (
                <section>
                  <h4>End goals</h4>
                  <ul>
                    {detailPersona.goals.end.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {detailPersona.goals.experience.length > 0 ? (
                <section>
                  <h4>Experience goals</h4>
                  <ul>
                    {detailPersona.goals.experience.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {detailPersona.frustrations.length > 0 ? (
                <section>
                  <h4>Frustrations</h4>
                  <ul>
                    {detailPersona.frustrations.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {detailPersona.simulation?.blockers.length ? (
                <section>
                  <h4>Blockers</h4>
                  <div className="sub-studio-blocker-list">
                    {detailPersona.simulation.blockers.map((b, i) => (
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
                              onClick={() => navigate({ screenId: b.screenId })}
                            >
                              Go to screen
                            </button>
                          ) : null}
                          <button type="button" onClick={() => navigate({})}>
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
          ) : null}
        </main>
      </div>
    </div>
  );
}
