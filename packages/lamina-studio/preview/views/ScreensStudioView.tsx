import { useState } from 'react';
import { useStudio } from '../studio/StudioContext.js';
import { ScreenCanvas } from './ScreenCanvas.js';

export function ScreensStudioView() {
  const {
    coverage,
    activeScreen,
    setActiveScreen,
    flowGraph,
    blueprintId,
    scenarios,
    navigate,
    screenMeta,
  } = useStudio();

  const [showSource, setShowSource] = useState(false);

  const screens = coverage?.screens ?? [];
  const flowScreens = flowGraph
    ? [...new Set(flowGraph.transitions.flatMap((t) => [t.from, t.target].filter(Boolean) as string[]))]
    : screens.map((s) => s.id);

  const orderedScreens = flowScreens.length ? flowScreens : screens.map((s) => s.id);

  const screenScenarios = (id: string) => scenarios.filter((s) => s.screen === id).length;

  const activeTitle =
    screens.find((s) => s.id === activeScreen)?.title ??
    screenMeta[activeScreen]?.title ??
    activeScreen;

  return (
    <div className="sub-studio-screens">
      <header className="sub-studio-view-header">
        <h2>Screens</h2>
        <p className="sub-studio-view-subtitle">What&apos;s on each screen?</p>
      </header>
      <div className="sub-studio-screens-body">
        <aside className="sub-studio-screen-list">
          <h3>Screens</h3>
          <ul>
            {orderedScreens.map((id) => {
              const inv = screens.find((s) => s.id === id);
              const meta = screenMeta[id];
              const count = screenScenarios(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={activeScreen === id ? 'active' : ''}
                    onClick={() => setActiveScreen(id)}
                  >
                    <span>{inv?.title ?? meta?.title ?? id}</span>
                    {count > 0 ? (
                      <span className="sub-studio-screen-meta">{count} scenarios</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
        <main className="sub-studio-screen-canvas-wrap">
          {!blueprintId ? (
            <div className="sub-studio-empty">
              <p>Wireframes aren&apos;t linked for this run — that&apos;s optional.</p>
              <p className="sub-studio-muted">
                You can still review flows and scenarios. Link a blueprint in <code>run.yaml</code>{' '}
                to see screen wireframes here.
              </p>
              <div className="sub-studio-empty-actions">
                <button type="button" onClick={() => navigate({})}>
                  View flows
                </button>
                <button type="button" onClick={() => navigate({})}>
                  Review gaps
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="sub-studio-screen-canvas-header">
                <span className="sub-studio-screen-title">{activeTitle}</span>
                <button
                  type="button"
                  className="sub-studio-link-action"
                  aria-expanded={showSource}
                  onClick={() => setShowSource((v) => !v)}
                >
                  {showSource ? 'Hide source' : 'Source'}
                </button>
              </div>
              {showSource ? (
                <code className="sub-studio-source-path">
                  blueprints/{blueprintId}/screens/{activeScreen}.tsx
                </code>
              ) : null}
              <ScreenCanvas />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
