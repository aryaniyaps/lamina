import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import { FlowGraphPanel } from './FlowGraphPanel.js';
import { PersonaPanel } from './PersonaPanel.js';
import type { PersonaEntry, PersonaPreviewData } from './personas.js';
import type { ScreenMeta } from './screen-meta.js';
import type { ScenarioEntry } from './scenarios.js';
import type { FlowGraphData } from './flow-graph.js';
import {
  outgoingTransitions,
  inferEntryScreen,
  resolveFlowTransitions,
  resolveActiveFlowId,
} from './flow-graph.js';
import '@xyflow/react/dist/style.css';
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

const VIEWPORT_PRESETS: Record<
  ViewportPreset,
  { label: string; width: number; aspectRatio: string }
> = {
  mobile: { label: 'Mobile', width: 390, aspectRatio: '9 / 19.5' },
  tablet: { label: 'Tablet', width: 768, aspectRatio: '3 / 4' },
  desktop: { label: 'Desktop', width: 1280, aspectRatio: '16 / 9' },
};

function resolveDefaultPersonaId(data: PersonaPreviewData): string {
  if (data.primary && data.personas.some((p) => p.id === data.primary)) {
    return data.primary;
  }
  return data.personas[0]!.id;
}

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

async function tryResolveFsPath(blueprintId: string, candidates: string[]): Promise<string | null> {
  const res = await fetch(
    `/__lamina/resolve?id=${encodeURIComponent(blueprintId)}&paths=${encodeURIComponent(candidates.join(','))}`,
  );
  const data = (await res.json()) as { path: string | null };
  return data.path;
}

function SkeletonScreen({ screenId }: { screenId: string }) {
  return (
    <div className="sub-screen sub-skeleton-screen" data-sub="Screen" data-screen-id={screenId}>
      <div className="sub-skeleton-screen-banner">Screen not generated yet</div>
      <div className="sub-page" data-sub="Page">
        <div className="sub-section" data-sub="Section">
          <div className="sub-heading sub-skeleton-line" data-sub="Heading" />
          <div className="sub-skeleton-line sub-skeleton-line-wide" />
          <div className="sub-skeleton-line sub-skeleton-line-medium" />
          <div className="sub-skeleton-block" />
        </div>
      </div>
    </div>
  );
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
  const [isSkeleton, setIsSkeleton] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setScreen(null);
    setError(null);
    setIsSkeleton(false);

    const candidates = subpathsForScreen(screenId, flowId, scenarioId);

    tryResolveFsPath(blueprintId, candidates)
      .then((fsPath) => {
        if (cancelled) return;
        if (!fsPath) {
          setIsSkeleton(true);
          return;
        }
        return import(/* @vite-ignore */ `/@fs/${fsPath}`);
      })
      .then((mod) => {
        if (cancelled || !mod) return;
        setScreen(() => mod.default);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [blueprintId, screenId, flowId, scenarioId]);

  useEffect(() => {
    if (Screen || isSkeleton) onLoaded?.();
  }, [Screen, isSkeleton, onLoaded]);

  if (error) {
    return (
      <div className="sub-error">
        Could not load screen `{screenId}`: {error}
      </div>
    );
  }
  if (isSkeleton) return <SkeletonScreen screenId={screenId} />;
  if (!Screen) return <div className="sub-text">Loading…</div>;
  return <Screen />;
}

function BlueprintIdErrorScreen({
  kind,
  requestedId,
  blueprints,
  onSelectBlueprint,
}: {
  kind: 'missing' | 'invalid';
  requestedId?: string;
  blueprints: BlueprintEntry[];
  onSelectBlueprint: (id: string) => void;
}) {
  const exampleId = blueprints[0]?.id ?? 'your-blueprint';

  return (
    <div className="sub-preview-shell">
      <div className="sub-blueprint-id-error">
        <div className="sub-blueprint-id-error-card">
          <h1 className="sub-blueprint-id-error-title">
            {kind === 'missing' ? 'No blueprint selected' : 'Blueprint not found'}
          </h1>
          <p className="sub-blueprint-id-error-lead">
            {kind === 'missing'
              ? 'Add a blueprint id to the URL to open a preview.'
              : `We couldn't find a blueprint with id "${requestedId}".`}
          </p>
          <p className="sub-blueprint-id-error-hint">
            Check the <code>?id=</code> value in the address bar and try again.
          </p>
          <p className="sub-blueprint-id-error-example">
            Example:{' '}
            <code>
              {window.location.origin}
              {window.location.pathname}?id={exampleId}
            </code>
          </p>
          {blueprints.length > 0 ? (
            <div className="sub-blueprint-id-error-list">
              <p className="sub-blueprint-id-error-list-label">Available blueprints</p>
              <ul>
                {blueprints.map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => onSelectBlueprint(b.id)}>
                      <span className="sub-blueprint-id-error-id">{b.id}</span>
                      {b.title !== b.id ? (
                        <span className="sub-blueprint-id-error-name">{b.title}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [config, setConfig] = useState<BlueprintConfig | null>(null);
  const [blueprints, setBlueprints] = useState<BlueprintEntry[]>([]);
  const [activeScreen, setActiveScreen] = useState<string>('');
  const [flowGraph, setFlowGraph] = useState<FlowGraphData | null>(null);
  const [flowGraphSource, setFlowGraphSource] = useState<string | null>(null);
  const [activeFlowId, setActiveFlowId] = useState('default');
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioEntry[]>([]);
  const [personaData, setPersonaData] = useState<PersonaPreviewData | null>(null);
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [screenMeta, setScreenMeta] = useState<Record<string, ScreenMeta>>({});
  const [viewportPreset, setViewportPreset] = useState<ViewportPreset>(loadViewportPreset);
  const [flowSidebarWidth, setFlowSidebarWidth] = useState(loadFlowSidebarWidth);
  const viewportRef = useRef<HTMLDivElement>(null);

  const params = new URLSearchParams(window.location.search);
  const [activeBlueprint, setActiveBlueprint] = useState('');
  const [blueprintError, setBlueprintError] = useState<
    { kind: 'missing' | 'invalid'; id?: string } | null
  >(null);

  const jumpToFlowEntry = useCallback((graph: FlowGraphData, flowId: string) => {
    const transitions = resolveFlowTransitions(graph, flowId);
    const entry = inferEntryScreen(transitions);
    if (entry) setActiveScreen(entry);
  }, []);

  const applyFlow = useCallback(
    (graph: FlowGraphData, flowId: string) => {
      const resolved = resolveActiveFlowId(graph, flowId);
      setActiveScenario(null);
      setActiveFlowId(resolved);
      jumpToFlowEntry(graph, resolved);
    },
    [jumpToFlowEntry],
  );

  const fetchFlowGraph = useCallback(async (blueprintId: string): Promise<FlowGraphData | null> => {
    const res = await fetch(`/__lamina/flow-graph?id=${encodeURIComponent(blueprintId)}`);
    if (!res.ok) {
      setFlowGraph(null);
      return null;
    }
    const data = (await res.json()) as FlowGraphData & { source?: string };
    const { source, ...graph } = data;
    setFlowGraph(graph);
    setFlowGraphSource(source ?? null);
    return graph;
  }, []);

  const fetchScenarios = useCallback(async (blueprintId: string) => {
    const res = await fetch(`/__lamina/scenarios?id=${encodeURIComponent(blueprintId)}`);
    if (!res.ok) {
      setScenarios([]);
      return;
    }
    setScenarios((await res.json()) as ScenarioEntry[]);
  }, []);

  const fetchPersonas = useCallback(
    async (blueprintId: string): Promise<PersonaPreviewData | null> => {
      const res = await fetch(`/__lamina/personas?id=${encodeURIComponent(blueprintId)}`);
      if (!res.ok) {
        setPersonaData(null);
        setActivePersonaId(null);
        return null;
      }
      const data = (await res.json()) as PersonaPreviewData;
      if (!data.personas.length) {
        setPersonaData(null);
        setActivePersonaId(null);
        return null;
      }
      setPersonaData(data);
      setActivePersonaId((prev) => {
        if (prev && data.personas.some((p) => p.id === prev)) return prev;
        return resolveDefaultPersonaId(data);
      });
      return data;
    },
    [],
  );

  const fetchScreenMeta = useCallback(
    async (blueprintId: string, flowId: string): Promise<Record<string, ScreenMeta>> => {
      const res = await fetch(
        `/__lamina/screen-meta?id=${encodeURIComponent(blueprintId)}&flowId=${encodeURIComponent(flowId)}`,
      );
      if (!res.ok) return {};
      return (await res.json()) as Record<string, ScreenMeta>;
    },
    [],
  );

  const fetchFallbackScreens = useCallback(async (blueprintId: string) => {
    const res = await fetch(`/__lamina/screens?id=${encodeURIComponent(blueprintId)}`);
    const list: string[] = await res.json();
    if (list.length) setActiveScreen((prev) => (prev && list.includes(prev) ? prev : list[0]));
  }, []);

  const bootstrapBlueprint = useCallback(
    async (blueprintId: string, abort?: { cancelled: boolean }) => {
      const isCancelled = () => abort?.cancelled ?? false;

      const graph = await fetchFlowGraph(blueprintId);
      if (isCancelled() || !graph) return;

      await fetchScenarios(blueprintId);
      if (isCancelled()) return;

      const personas = await fetchPersonas(blueprintId);
      if (isCancelled()) return;

      const flowId =
        personas?.personas.length
          ? (() => {
              const personaId = resolveDefaultPersonaId(personas);
              const persona = personas.personas.find((p) => p.id === personaId);
              return persona?.flow
                ? resolveActiveFlowId(graph, persona.flow)
                : resolveActiveFlowId(graph, 'default');
            })()
          : resolveActiveFlowId(graph, 'default');

      applyFlow(graph, flowId);

      if (!inferEntryScreen(resolveFlowTransitions(graph, flowId))) {
        await fetchFallbackScreens(blueprintId);
      }
    },
    [applyFlow, fetchFallbackScreens, fetchFlowGraph, fetchPersonas, fetchScenarios],
  );

  useEffect(() => {
    const urlId = params.get('id')?.trim() ?? '';
    const abort = { cancelled: false };

    fetch('/__lamina/config')
      .then((r) => r.json())
      .then((cfg: BlueprintConfig) => {
        if (abort.cancelled) return;
        setConfig(cfg);
        return fetch('/__lamina/blueprints').then((r) => r.json());
      })
      .then((entries: BlueprintEntry[] | undefined) => {
        if (abort.cancelled || !entries) return;
        setBlueprints(entries);

        if (!urlId) {
          setBlueprintError({ kind: 'missing' });
          return;
        }

        if (!entries.some((e) => e.id === urlId)) {
          setBlueprintError({ kind: 'invalid', id: urlId });
          return;
        }

        setBlueprintError(null);
        setActiveBlueprint(urlId);
        return bootstrapBlueprint(urlId, abort);
      });

    return () => {
      abort.cancelled = true;
    };
  }, [bootstrapBlueprint]);

  useEffect(() => {
    if (!activeBlueprint) return;
    let cancelled = false;
    fetchScreenMeta(activeBlueprint, activeFlowId).then((meta) => {
      if (!cancelled) setScreenMeta(meta);
    });
    return () => {
      cancelled = true;
    };
  }, [activeBlueprint, activeFlowId, fetchScreenMeta]);

  const activePersona = useMemo((): PersonaEntry | null => {
    if (!activePersonaId || !personaData) return null;
    return personaData.personas.find((p) => p.id === activePersonaId) ?? null;
  }, [activePersonaId, personaData]);

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
      if (flowGraph) applyFlow(flowGraph, flowId);
    },
    [flowGraph, applyFlow],
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

  const onPersonaChange = useCallback(
    (personaId: string) => {
      setActivePersonaId(personaId);
      if (!personaData || !flowGraph) return;
      const persona = personaData.personas.find((p) => p.id === personaId);
      if (!persona?.flow) return;
      const resolved = resolveActiveFlowId(flowGraph, persona.flow);
      if (resolved !== activeFlowId) {
        applyFlow(flowGraph, resolved);
      }
    },
    [personaData, flowGraph, activeFlowId, applyFlow],
  );

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
    setBlueprintError(null);
    setActiveBlueprint(id);
    const next = new URLSearchParams(window.location.search);
    next.set('id', id);
    window.history.replaceState({}, '', `?${next}`);
    void bootstrapBlueprint(id);
  };

  if (!config) {
    return (
      <div className="sub-preview-shell">
        <div className="sub-preview-canvas">Starting preview…</div>
      </div>
    );
  }

  if (blueprintError) {
    return (
      <BlueprintIdErrorScreen
        kind={blueprintError.kind}
        requestedId={blueprintError.id}
        blueprints={blueprints}
        onSelectBlueprint={onBlueprintChange}
      />
    );
  }

  return (
    <div className="sub-preview-shell">
      <div className="sub-preview-topbar">
        <span className="sub-preview-topbar-title">{activeBlueprint}</span>
        {flowGraphSource === 'flows-inventory' ? (
          <span className="sub-preview-provisional-badge">Provisional flow (from inventory)</span>
        ) : null}
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
              className="sub-preview-screen-column"
              style={{
                width: VIEWPORT_PRESETS[viewportPreset].width,
                maxWidth: 'calc(100% - 24px)',
              }}
            >
              <div
                ref={viewportRef}
                className="sub-preview-viewport"
                data-viewport={viewportPreset}
                style={{
                  width: '100%',
                  aspectRatio: VIEWPORT_PRESETS[viewportPreset].aspectRatio,
                }}
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
          </div>
          {personaData && activePersona && activePersonaId ? (
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
                activePersona={activePersona}
                screenMeta={screenMeta}
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
