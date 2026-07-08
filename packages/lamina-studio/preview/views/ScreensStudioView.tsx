import { useStudio } from '../studio/StudioContext.js';
import { ScreenCanvas } from './ScreenCanvas.js';

export function ScreensStudioView() {
  const {
    coverage,
    activeScreen,
    setActiveScreen,
    flowGraph,
    activeFlowId,
    blueprintId,
    scenarios,
    prototypeMode,
    setPrototypeMode,
    screenMeta,
  } = useStudio();

  const screens = coverage?.screens ?? [];
  const flowScreens = flowGraph
    ? [...new Set(flowGraph.transitions.flatMap((t) => [t.from, t.target].filter(Boolean) as string[]))]
    : screens.map((s) => s.id);

  const orderedScreens = flowScreens.length
    ? flowScreens
    : screens.map((s) => s.id);

  const screenScenarios = (id: string) => scenarios.filter((s) => s.screen === id).length;

  return (
    <div className="sub-studio-screens">
      <header className="sub-studio-view-header sub-studio-view-header-row">
        <div>
          <h2>Screens</h2>
          <p className="sub-studio-view-subtitle">UX design — IA inventory and SUB wireframes</p>
        </div>
        {blueprintId ? (
          <label className="sub-studio-toggle">
            <input
              type="checkbox"
              checked={prototypeMode}
              onChange={(e) => setPrototypeMode(e.target.checked)}
            />
            Prototype mode
          </label>
        ) : null}
      </header>
      <div className="sub-studio-screens-body">
        <aside className="sub-studio-screen-list">
          <h3>Screen inventory</h3>
          <ul>
            {orderedScreens.map((id) => {
              const meta = screenMeta[id];
              const inv = screens.find((s) => s.id === id);
              const completeness = meta?.completeness ?? (blueprintId ? 'skeleton' : 'skeleton');
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={activeScreen === id ? 'active' : ''}
                    onClick={() => setActiveScreen(id)}
                  >
                    <span>{inv?.title ?? meta?.title ?? id}</span>
                    <span className="sub-studio-screen-meta">
                      {screenScenarios(id)} scenarios · {completeness}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
        <main className="sub-studio-screen-canvas-wrap">
          {!blueprintId ? (
            <div className="sub-studio-empty">
              <p>
                No blueprint linked. Add <code>blueprint_id</code> to <code>run.yaml</code> and author
                SUB TSX under <code>.lamina/blueprints/</code>.
              </p>
            </div>
          ) : (
            <>
              <div className="sub-studio-screen-canvas-header">
                <span>
                  {activeScreen} · {activeFlowId} flow
                </span>
                <code>blueprints/{blueprintId}/screens/{activeScreen}.tsx</code>
              </div>
              <ScreenCanvas />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
