import { useEffect, useMemo, useState } from 'react';
import type { PersonaEntry } from './personas.js';
import { collectPainPointsForScreen, personaAvatarUrl } from './persona-avatar.js';

interface PersonaPanelProps {
  persona: PersonaEntry;
  activeScreen: string;
}

function outcomeLabel(outcome: string): string {
  return outcome.replace(/_/g, ' ');
}

export function PersonaPanel({ persona, activeScreen }: PersonaPanelProps) {
  const screenPainPoints = useMemo(
    () => collectPainPointsForScreen(persona, activeScreen),
    [persona, activeScreen],
  );
  const [painIndex, setPainIndex] = useState(0);

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
      <div className="sub-persona-card-header">
        <img
          className="sub-persona-avatar"
          src={personaAvatarUrl(persona.id)}
          alt=""
          width={40}
          height={40}
        />
        <div className="sub-persona-card-meta">
          <span className="sub-persona-card-name">{persona.displayName}</span>
          {persona.simulation ? (
            <span className={`sub-persona-outcome sub-persona-outcome-${persona.simulation.outcome}`}>
              {outcomeLabel(persona.simulation.outcome)}
            </span>
          ) : null}
        </div>
      </div>

      {persona.goals.experience[0] ? (
        <p className="sub-persona-goal">{persona.goals.experience[0]}</p>
      ) : persona.goals.end[0] ? (
        <p className="sub-persona-goal">{persona.goals.end[0]}</p>
      ) : null}

      {currentPain ? (
        <div className="sub-persona-chat">
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
        </div>
      ) : (
        <div className="sub-persona-chat">
          <div className="sub-persona-bubble sub-persona-bubble-ok" role="status">
            This screen looks fine for them.
          </div>
        </div>
      )}

      {persona.simulation ? (
        <p className="sub-persona-disclaimer">Simulation — not user research</p>
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
