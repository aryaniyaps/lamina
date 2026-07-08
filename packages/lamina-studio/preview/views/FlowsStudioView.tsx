import { useState } from 'react';
import { FlowGraphPanel } from '../FlowGraphPanel.js';
import { useStudio } from '../studio/StudioContext.js';
import { ScreenCanvas } from './ScreenCanvas.js';

export function FlowsStudioView() {
  const {
    flowGraph,
    activeScreen,
    setActiveScreen,
    activeFlowId,
    setActiveFlowId,
    scenarios,
    activeScenario,
    setActiveScenario,
    setSelectedScenarioId,
    activePersona,
    screenMeta,
    blueprintId,
    coverage,
    navigate,
  } = useStudio();

  const [showSource, setShowSource] = useState(false);

  if (!flowGraph) {
    return (
      <div className="sub-studio-empty">
        <p>
          No flows in this run yet. Add flows to <code>run.yaml</code> with{' '}
          <code>/lamina-design</code>.
        </p>
      </div>
    );
  }

  const screens = coverage?.screens ?? [];
  const activeTitle =
    screens.find((s) => s.id === activeScreen)?.title ??
    screenMeta[activeScreen]?.title ??
    activeScreen;

  return (
    <div className="sub-studio-flows">
      <header className="sub-studio-view-header">
        <h2>Flow</h2>
        <p className="sub-studio-view-subtitle">
          How users move through this — select a step to see its wireframe and edge cases
        </p>
      </header>
      <div className="sub-studio-flows-body sub-studio-flows-unified">
        <div className="sub-studio-flows-graph">
          <FlowGraphPanel
            graph={flowGraph}
            activeScreen={activeScreen}
            activeFlowId={activeFlowId}
            onSelectScreen={(id) => {
              setActiveScenario(null);
              setActiveScreen(id);
            }}
            onSelectFlow={setActiveFlowId}
            scenarios={scenarios}
            activeScenario={activeScenario}
            onSelectScenario={(id) => {
              const scenario = scenarios.find((s) => s.id === id);
              setActiveScenario(id);
              setSelectedScenarioId(id);
              if (scenario?.screen) setActiveScreen(scenario.screen);
            }}
            onClearScenario={() => setActiveScenario(null)}
            activePersona={activePersona}
            screenMeta={screenMeta}
          />
        </div>
        <div className="sub-studio-flows-canvas">
          {!blueprintId ? (
            <div className="sub-studio-empty">
              <p>Wireframes aren&apos;t linked for this run — that&apos;s optional.</p>
              <p className="sub-studio-muted">
                The flow graph shows structure and edge-case branches from <code>run.yaml</code>.
                Link a blueprint to see screen wireframes here.
              </p>
              <div className="sub-studio-empty-actions">
                <button type="button" onClick={() => navigate({})}>
                  Review gaps
                </button>
              </div>
            </div>
          ) : !activeScreen ? (
            <div className="sub-studio-empty">
              <p>Select a screen on the flow graph to preview its wireframe.</p>
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
        </div>
      </div>
    </div>
  );
}
