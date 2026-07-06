import {
  StrictMode,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import { FlowGraphPanel } from './FlowGraphPanel.js';
import type { ScenarioEntry } from './scenarios.js';
import type { FlowGraphData } from './flow-graph.js';
import {
  outgoingTransitions,
  inferEntryScreen,
  resolveFlowTransitions,
  resolveActiveFlowId,
} from './flow-graph.js';
import './styles/wireframe.css';

interface BlueprintConfig {
  root: string;
  id: string;
  port?: number;
}

interface BlueprintEntry {
  id: string;
  title: string;
}

type ViewportPreset = 'mobile' | 'tablet' | 'desktop';

const VIEWPORT_STORAGE_KEY = 'lamina-blueprint-viewport';
const FLOW_SIDEBAR_WIDTH_KEY = 'lamina-blueprint-flow-sidebar-width';
const DEFAULT_FLOW_SIDEBAR_WIDTH = 480;
const MIN_FLOW_SIDEBAR_WIDTH = 320;
const MAX_FLOW_SIDEBAR_WIDTH = 720;

const VIEWPORT_PRESETS: Record<ViewportPreset, { label: string; width: number }> = {
  mobile: { label: 'Mobile', width: 390 },
  tablet: { label: 'Tablet', width: 768 },
  desktop: { label: 'Desktop', width: 1280 },
};

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

function subpathsForScreen(
  screenId: string,
  flowId: string,
  scenarioId?: string | null,
): string[] {
  const shared = `screens/${screenId}.tsx`;
  const flowScoped = `flows/${flowId}/screens/${screenId}.tsx`;
  if (scenarioId) {
    return [`scenarios/${scenarioId}/screens/${screenId}.tsx`, flowScoped, shared];
  }
  return [flowScoped, shared];
}

async function resolveFsPath(blueprintId: string, candidates: string[]): Promise<string> {
  const path = await tryResolveFsPath(blueprintId, candidates);
  if (!path) throw new Error(`Screen not found: ${candidates.join(' → ')}`);
  return path;
}

async function tryResolveFsPath(blueprintId: string, candidates: string[]): Promise<string | null> {
  const res = await fetch(
    `/__lamina/resolve?id=${encodeURIComponent(blueprintId)}&paths=${encodeURIComponent(candidates.join(','))}`,
  );
  const data = (await res.json()) as { path: string | null };
  return data.path;
}

async function importScreen(blueprintId: string, candidates: string[]) {
  const fsPath = await resolveFsPath(blueprintId, candidates);
  return import(/* @vite-ignore */ `/@fs/${fsPath}`);
}

function ScreenView({
  blueprintId,
  screenId,
  flowId,
  scenarioId,
  onLoaded,
}: {
  blueprintId: string;
  screenId: string;
  flowId: string;
  scenarioId?: string | null;
  onLoaded?: () => void;
}) {
  const [Screen, setScreen] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setScreen(null);
    setError(null);

    importScreen(blueprintId, subpathsForScreen(screenId, flowId, scenarioId))
      .then((mod) => {
        if (!cancelled) setScreen(() => mod.default);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [blueprintId, screenId, flowId, scenarioId]);

  useEffect(() => {
    if (Screen) onLoaded?.();
  }, [Screen, onLoaded]);

  if (error) {
    return (
      <div className="sub-error">
        Could not load screen `{screenId}`: {error}
      </div>
    );
  }
  if (!Screen) return <div className="sub-text">Loading…</div>;
  return <Screen />;
}

function App() {
  const [config, setConfig] = useState<BlueprintConfig | null>(null);
  const [blueprints, setBlueprints] = useState<BlueprintEntry[]>([]);
  const [activeScreen, setActiveScreen] = useState<string>('');
  const [flowGraph, setFlowGraph] = useState<FlowGraphData | null>(null);
  const [activeFlowId, setActiveFlowId] = useState('default');
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioEntry[]>([]);
  const [viewportPreset, setViewportPreset] = useState<ViewportPreset>(loadViewportPreset);
  const [flowSidebarWidth, setFlowSidebarWidth] = useState(loadFlowSidebarWidth);
  const viewportRef = useRef<HTMLDivElement>(null);

  const params = new URLSearchParams(window.location.search);
  const [activeBlueprint, setActiveBlueprint] = useState(params.get('id') ?? '');

  const jumpToFlowEntry = useCallback((graph: FlowGraphData, flowId: string) => {
    const transitions = resolveFlowTransitions(graph, flowId);
    const entry = inferEntryScreen(transitions);
    if (entry) setActiveScreen(entry);
  }, []);

  const loadScenarios = useCallback(async (blueprintId: string) => {
    const res = await fetch(`/__lamina/scenarios?id=${encodeURIComponent(blueprintId)}`);
    if (!res.ok) {
      setScenarios([]);
      return;
    }
    setScenarios((await res.json()) as ScenarioEntry[]);
  }, []);

  const loadFlowGraph = useCallback(
    async (blueprintId: string) => {
      const res = await fetch(`/__lamina/flow-graph?id=${encodeURIComponent(blueprintId)}`);
      if (!res.ok) {
        setFlowGraph(null);
        return;
      }
      const data = (await res.json()) as FlowGraphData;
      setFlowGraph(data);
      const flowId = resolveActiveFlowId(data, activeFlowId);
      setActiveFlowId(flowId);
      jumpToFlowEntry(data, flowId);
    },
    [activeFlowId, jumpToFlowEntry],
  );

  const loadFallbackScreens = useCallback(async (blueprintId: string) => {
    const res = await fetch(`/__lamina/screens?id=${encodeURIComponent(blueprintId)}`);
    const list: string[] = await res.json();
    if (list.length) setActiveScreen((prev) => (prev && list.includes(prev) ? prev : list[0]));
  }, []);

  useEffect(() => {
    fetch('/__lamina/config')
      .then((r) => r.json())
      .then((cfg: BlueprintConfig) => {
        setConfig(cfg);
        const id = params.get('id') ?? cfg.id;
        setActiveBlueprint(id);
        return fetch('/__lamina/blueprints')
          .then((r) => r.json())
          .then(async (entries: BlueprintEntry[]) => {
            setBlueprints(entries);
            await loadFlowGraph(id);
            await loadScenarios(id);
            return loadFallbackScreens(id);
          });
      });
  }, [loadFlowGraph, loadFallbackScreens, loadScenarios]);

  const activeTransitions = flowGraph ? resolveFlowTransitions(flowGraph, activeFlowId) : [];

  const applyHotspots = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const triggers = new Set(
      outgoingTransitions(activeTransitions, activeScreen).map((t) => t.trigger),
    );
    viewport.querySelectorAll('[data-trigger]').forEach((el) => {
      el.classList.toggle('sub-hotspot', triggers.has(el.getAttribute('data-trigger') ?? ''));
    });
  }, [activeTransitions, activeScreen]);

  useEffect(() => {
    applyHotspots();
    const id = window.setTimeout(applyHotspots, 100);
    return () => window.clearTimeout(id);
  }, [applyHotspots, activeScreen, activeFlowId]);

  const navigateToTarget = useCallback((target: string) => {
    setActiveScenario(null);
    setActiveScreen(target);
  }, []);

  const onFlowChange = useCallback(
    (flowId: string) => {
      setActiveScenario(null);
      setActiveFlowId(flowId);
      if (flowGraph) jumpToFlowEntry(flowGraph, flowId);
    },
    [flowGraph, jumpToFlowEntry],
  );

  const onSelectScenario = useCallback(
    (scenarioId: string) => {
      const scenario = scenarios.find((s) => s.id === scenarioId);
      if (!scenario) return;
      setActiveScenario(scenarioId);
      setActiveScreen(scenario.screen);
    },
    [scenarios],
  );

  const onClearScenario = useCallback(() => {
    setActiveScenario(null);
  }, []);

  const onFlowSidebarResizeStart = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = flowSidebarWidth;

      const onMove = (ev: globalThis.MouseEvent) => {
        const next = Math.min(
          MAX_FLOW_SIDEBAR_WIDTH,
          Math.max(MIN_FLOW_SIDEBAR_WIDTH, startWidth + (startX - ev.clientX)),
        );
        setFlowSidebarWidth(next);
      };

      const onUp = (ev: globalThis.MouseEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('sub-preview-resizing');
        const width = Math.min(
          MAX_FLOW_SIDEBAR_WIDTH,
          Math.max(MIN_FLOW_SIDEBAR_WIDTH, startWidth + (startX - ev.clientX)),
        );
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

  const resolveTransition = useCallback(
    (trigger: string) => {
      if (!flowGraph) return null;
      const transitions = resolveFlowTransitions(flowGraph, activeFlowId);
      const entry = inferEntryScreen(transitions);
      return transitions.find(
        (t) =>
          t.trigger === trigger &&
          (t.from === activeScreen || (!t.from && entry === activeScreen)),
      );
    },
    [flowGraph, activeFlowId, activeScreen],
  );

  const onCanvasClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, option')) return;
      const el = target.closest('[data-trigger]');
      if (!el) return;
      const trigger = el.getAttribute('data-trigger');
      if (!trigger) return;
      const transition = resolveTransition(trigger);
      if (transition) navigateToTarget(transition.target);
    },
    [resolveTransition, navigateToTarget],
  );

  const onViewportChange = (preset: ViewportPreset) => {
    setViewportPreset(preset);
    try {
      sessionStorage.setItem(VIEWPORT_STORAGE_KEY, preset);
    } catch {
      /* ignore */
    }
  };

  const onBlueprintChange = (id: string) => {
    setActiveBlueprint(id);
    const next = new URLSearchParams(window.location.search);
    next.set('id', id);
    window.history.replaceState({}, '', `?${next}`);
    loadFlowGraph(id);
    loadScenarios(id);
    loadFallbackScreens(id);
  };

  if (!config) {
    return (
      <div className="sub-preview-shell">
        <div className="sub-preview-canvas">Starting preview…</div>
      </div>
    );
  }

  return (
    <div className="sub-preview-shell">
      <div className="sub-preview-topbar">
        <span className="sub-preview-topbar-title">{activeBlueprint}</span>
        <div className="sub-preview-topbar-spacer" />
        <label className="sub-preview-viewport-control">
          <span className="sub-preview-viewport-label">Viewport</span>
          <select
            value={viewportPreset}
            onChange={(e) => onViewportChange(e.target.value as ViewportPreset)}
            aria-label="Viewport size preset"
          >
            {(Object.keys(VIEWPORT_PRESETS) as ViewportPreset[]).map((key) => (
              <option key={key} value={key}>
                {VIEWPORT_PRESETS[key].label} · {VIEWPORT_PRESETS[key].width}px
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="sub-preview-body">
        {blueprints.length > 1 ? (
          <aside className="sub-preview-sidebar">
            <div className="sub-preview-picker">
              <h2>Blueprint</h2>
              <select value={activeBlueprint} onChange={(e) => onBlueprintChange(e.target.value)}>
                {blueprints.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            </div>
          </aside>
        ) : null}
        <main className="sub-preview-main">
          <div className="sub-preview-canvas">
            <div
              ref={viewportRef}
              className="sub-preview-viewport"
              data-viewport={viewportPreset}
              style={{ width: VIEWPORT_PRESETS[viewportPreset].width }}
              onClick={onCanvasClick}
            >
              {activeScreen ? (
                <div
                  className="sub-preview-stage"
                  key={`${activeFlowId}:${activeScreen}:${activeScenario ?? 'happy'}`}
                >
                  <ScreenView
                    blueprintId={activeBlueprint}
                    screenId={activeScreen}
                    flowId={activeFlowId}
                    scenarioId={activeScenario}
                    onLoaded={applyHotspots}
                  />
                </div>
              ) : (
                <div className="sub-text">No screens</div>
              )}
            </div>
          </div>
        </main>
        {flowGraph ? (
          <div
            className="sub-preview-flow-sidebar-wrap"
            style={{ width: flowSidebarWidth }}
          >
            <div
              className="sub-preview-flow-resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize flow panel"
              onMouseDown={onFlowSidebarResizeStart}
            />
            <aside className="sub-preview-flow-sidebar">
              <FlowGraphPanel
                graph={flowGraph}
                activeScreen={activeScreen}
                activeFlowId={activeFlowId}
                onSelectScreen={setActiveScreen}
                onSelectFlow={onFlowChange}
                scenarios={scenarios}
                activeScenario={activeScenario}
                onSelectScenario={onSelectScenario}
                onClearScenario={onClearScenario}
              />
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
