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
    prototypeMode,
    setPrototypeMode,
    navigate,
    blueprintId,
  } = useStudio();

  if (!flowGraph) {
    return (
      <div className="sub-studio-empty">
        <p>No flow graph available. Add flows to <code>run.yaml</code> or blueprint <code>flows.tsx</code>.</p>
      </div>
    );
  }

  return (
    <div className="sub-studio-flows">
      <header className="sub-studio-view-header sub-studio-view-header-row">
        <div>
          <h2>Flows</h2>
          <p className="sub-studio-view-subtitle">UX design — user flows and prototype navigation</p>
        </div>
        <label className="sub-studio-toggle">
          <input
            type="checkbox"
            checked={prototypeMode}
            onChange={(e) => setPrototypeMode(e.target.checked)}
          />
          Prototype mode
        </label>
      </header>
      <div className={`sub-studio-flows-body${prototypeMode ? ' sub-studio-flows-prototype' : ''}`}>
        <div className="sub-studio-flows-graph">
          <FlowGraphPanel
            graph={flowGraph}
            activeScreen={activeScreen}
            activeFlowId={activeFlowId}
            onSelectScreen={(id) => {
              setActiveScenario(null);
              setActiveScreen(id);
              if (!prototypeMode) navigate({ view: 'screens', screenId: id });
            }}
            onSelectFlow={setActiveFlowId}
            scenarios={scenarios}
            activeScenario={activeScenario}
            onSelectScenario={(id) => {
              setActiveScenario(id);
              setSelectedScenarioId(id);
              navigate({ view: 'scenarios', scenarioId: id });
            }}
            onClearScenario={() => setActiveScenario(null)}
            activePersona={activePersona}
            screenMeta={screenMeta}
          />
        </div>
        {prototypeMode && blueprintId ? (
          <div className="sub-studio-flows-canvas">
            <ScreenCanvas />
          </div>
        ) : null}
      </div>
    </div>
  );
}
