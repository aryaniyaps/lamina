import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import { FlowGraphPanel } from '../FlowGraphPanel.js';
import { PersonaPanel } from '../PersonaPanel.js';
import { inferEntryScreen, resolveFlowTransitions } from '../flow-graph.js';
import { gapCountByScreenForFlow } from '../studio/coverage-insights.js';
import { useStudio } from '../studio/StudioContext.js';
import { ScreenCanvas, type ViewportPreset } from './ScreenCanvas.js';
import { FlowCoveragePanel } from './FlowCoveragePanel.js';

const VIEWPORT_STORAGE_KEY = 'lamina-studio-viewport';
const FLOW_SIDEBAR_WIDTH_KEY = 'lamina-studio-flow-sidebar-width';
const DEFAULT_FLOW_SIDEBAR_WIDTH = 480;
const MIN_FLOW_SIDEBAR_WIDTH = 320;
const MAX_FLOW_SIDEBAR_WIDTH = 720;

function loadViewportPreset(): ViewportPreset {
  try {
    const stored = sessionStorage.getItem(VIEWPORT_STORAGE_KEY);
    if (stored === 'mobile' || stored === 'tablet' || stored === 'desktop') return stored;
  } catch {
    /* ignore */
  }
  return 'desktop';
}

function loadFlowSidebarWidth(): number {
  try {
    const stored = Number(sessionStorage.getItem(FLOW_SIDEBAR_WIDTH_KEY));
    if (stored >= MIN_FLOW_SIDEBAR_WIDTH && stored <= MAX_FLOW_SIDEBAR_WIDTH) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_FLOW_SIDEBAR_WIDTH;
}

export function ReviewView() {
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
    setActivePersonaId,
    activePersona,
    personaData,
    screenMeta,
    blueprintId,
    coverage,
  } = useStudio();

  const [viewportPreset, setViewportPreset] = useState<ViewportPreset>(loadViewportPreset);
  const [flowSidebarWidth, setFlowSidebarWidth] = useState(loadFlowSidebarWidth);
  const screens = coverage?.screens ?? [];
  const gapCounts = useMemo(
    () => gapCountByScreenForFlow(coverage, activeFlowId),
    [coverage, activeFlowId],
  );

  const activeTitle =
    screens.find((s) => s.id === activeScreen)?.title ??
    screenMeta[activeScreen]?.title ??
    activeScreen;

  const onPersonaChange = useCallback(
    (personaId: string) => {
      setActivePersonaId(personaId);
    },
    [setActivePersonaId],
  );

  const onViewportChange = (preset: ViewportPreset) => {
    setViewportPreset(preset);
    try {
      sessionStorage.setItem(VIEWPORT_STORAGE_KEY, preset);
    } catch {
      /* ignore */
    }
  };

  const onFlowSidebarResizeStart = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = flowSidebarWidth;

      const clampWidth = (clientX: number) =>
        Math.min(
          MAX_FLOW_SIDEBAR_WIDTH,
          Math.max(MIN_FLOW_SIDEBAR_WIDTH, startWidth + (startX - clientX)),
        );

      const onMove = (ev: globalThis.MouseEvent) => {
        setFlowSidebarWidth(clampWidth(ev.clientX));
      };

      const onUp = (ev: globalThis.MouseEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('sub-preview-resizing');
        const width = clampWidth(ev.clientX);
        setFlowSidebarWidth(width);
        try {
          sessionStorage.setItem(FLOW_SIDEBAR_WIDTH_KEY, String(width));
        } catch {
          /* ignore */
        }
      };

      document.body.classList.add('sub-preview-resizing');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [flowSidebarWidth],
  );

  const onSelectFlow = useCallback(
    (flowId: string) => {
      if (!flowGraph) return;
      setActiveScenario(null);
      setSelectedScenarioId(null);
      setActiveFlowId(flowId);
      const entry = inferEntryScreen(resolveFlowTransitions(flowGraph, flowId));
      if (entry) setActiveScreen(entry);
    },
    [flowGraph, setActiveFlowId, setActiveScenario, setActiveScreen, setSelectedScenarioId],
  );

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

  return (
    <div className="sub-studio-review sub-studio-review-focused">
      <main className="sub-preview-main">
        <div className="sub-studio-screen-canvas-header">
          <div>
            <span className="sub-studio-screen-title">{activeTitle || 'Blueprint preview'}</span>
          </div>
          <div className="sub-studio-screen-actions">
            <label className="sub-preview-topbar-control">
              <span className="sub-preview-topbar-control-label">Viewport</span>
              <select
                value={viewportPreset}
                onChange={(e) => onViewportChange(e.target.value as ViewportPreset)}
                aria-label="Viewport size preset"
              >
                <option value="mobile">Mobile</option>
                <option value="tablet">Tablet</option>
                <option value="desktop">Desktop</option>
              </select>
            </label>
          </div>
        </div>

        <div className="sub-preview-canvas">
          {!blueprintId ? (
            <div className="sub-studio-empty">
              <p>Select a run with a linked blueprint to preview wireframes.</p>
            </div>
          ) : !activeScreen ? (
            <div className="sub-studio-empty">
              <p>Select a screen from the flow graph.</p>
            </div>
          ) : (
            <ScreenCanvas viewportPreset={viewportPreset} />
          )}
        </div>

        {personaData && activePersona ? (
          <div className="sub-preview-persona-dock">
            <PersonaPanel
              persona={activePersona}
              personas={personaData.personas}
              activeScreen={activeScreen}
              onPersonaChange={onPersonaChange}
            />
          </div>
        ) : null}
      </main>

      <div
        className="sub-preview-flow-sidebar-wrap"
        style={{ width: flowSidebarWidth }}
      >
        <div
          className="sub-preview-flow-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize flow graph"
          onMouseDown={onFlowSidebarResizeStart}
        />
        <aside className="sub-preview-flow-sidebar" aria-label="Flow">
          <FlowGraphPanel
            graph={flowGraph}
            activeScreen={activeScreen}
            activeFlowId={activeFlowId}
            onSelectScreen={(id) => {
              setActiveScenario(null);
              setActiveScreen(id);
            }}
            onSelectFlow={onSelectFlow}
            scenarios={scenarios}
            activeScenario={activeScenario}
            onSelectScenario={(id) => {
              const scenario = scenarios.find((s) => s.id === id);
              setActiveScenario(id);
              if (scenario?.screen) setActiveScreen(scenario.screen);
            }}
            onClearScenario={() => setActiveScenario(null)}
            activePersona={activePersona}
            screenMeta={screenMeta}
            gapCounts={gapCounts}
          />
          {activeFlowId ? (
            <div className="sub-preview-flow-insights">
              <FlowCoveragePanel activeFlowId={activeFlowId} />
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
