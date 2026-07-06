import { useEffect, useMemo, useState } from 'react';
import type { PersonaEntry } from './personas.js';
import { collectPainPointsForScreen, personaAvatarUrl } from './persona-avatar.js';

interface PersonaPanelProps {
  persona: PersonaEntry;
  personas: PersonaEntry[];
  activeScreen: string;
  onPersonaChange: (personaId: string) => void;
}

function outcomeLabel(outcome: string): string {
  return outcome.replace(/_/g, ' ');
}

export function PersonaPanel({
  persona,
  personas,
  activeScreen,
  onPersonaChange,
}: PersonaPanelProps) {
  const screenPainPoints = useMemo(
    () => collectPainPointsForScreen(persona, activeScreen),
    [persona, activeScreen],
  );
  const [painIndex, setPainIndex] = useState(0);
  const canSwitch = personas.length > 1;
  const goal = persona.goals.experience[0] ?? persona.goals.end[0];

  useEffect(() => {
    setPainIndex(0);
  }, [persona.id, activeScreen]);

  const currentPain = screenPainPoints[painIndex];
  const hasMultiple = screenPainPoints.length > 1;

  const goPrev = () => {
    setPainIndex((i) => (i <= 0 ? screenPainPoints.length - 1 : i - 1));
  };

  const goNext = () => {
    setPainIndex((i) => (i >= screenPainPoints.length - 1 ? 0 : i + 1));
  };

  return (
    <div className="sub-persona-card">
      <div className="sub-persona-layout">
        <div className="sub-persona-identity">
          <div className="sub-persona-profile">
            <img
              className="sub-persona-avatar sub-persona-avatar-lg"
              src={personaAvatarUrl(persona.id)}
              alt=""
              width={56}
              height={56}
            />
            <div className="sub-persona-profile-meta">
              {canSwitch ? (
                <select
                  className="sub-persona-name-select"
                  value={persona.id}
                  onChange={(e) => onPersonaChange(e.target.value)}
                  aria-label="Switch persona"
                >
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="sub-persona-card-name">{persona.displayName}</span>
              )}
            </div>
          </div>
          {goal ? <p className="sub-persona-goal">{goal}</p> : null}
        </div>

        <div className="sub-persona-chat">
          {currentPain ? (
            <>
              <div className="sub-persona-bubble" role="status">
                {currentPain.text}
              </div>
              {hasMultiple ? (
                <div className="sub-persona-slideshow">
                  <button
                    type="button"
                    className="sub-persona-slideshow-btn"
                    onClick={goPrev}
                    aria-label="Previous pain point"
                  >
                    ←
                  </button>
                  <span className="sub-persona-slideshow-count">
                    {painIndex + 1} / {screenPainPoints.length}
                  </span>
                  <button
                    type="button"
                    className="sub-persona-slideshow-btn"
                    onClick={goNext}
                    aria-label="Next pain point"
                  >
                    →
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="sub-persona-bubble sub-persona-bubble-ok" role="status">
              This screen looks fine for me!
            </div>
          )}
        </div>
      </div>

      {persona.simulation ? (
        <div className="sub-persona-card-footer">
          <p className="sub-persona-disclaimer">Simulation — not user research</p>
          <span className={`sub-persona-outcome sub-persona-outcome-${persona.simulation.outcome}`}>
            {outcomeLabel(persona.simulation.outcome)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function PersonaAvatar({ personaId, size = 24, className = '' }: {
  personaId: string;
  size?: number;
  className?: string;
}) {
  return (
    <img
      className={`sub-persona-avatar ${className}`.trim()}
      src={personaAvatarUrl(personaId)}
      alt=""
      width={size}
      height={size}
    />
  );
}
