import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles/wireframe.css';
import './styles/studio.css';
import {
  inferEntryScreen,
  resolveActiveFlowId,
  resolveFlowTransitions,
} from './flow-graph.js';
import type { FlowGraphData } from './flow-graph.js';
import type { PersonaEntry, PersonaPreviewData } from './personas.js';
import type { ScenarioEntry } from './scenarios.js';
import type { ScreenMeta } from './screen-meta.js';
import { StudioProvider, type StudioContextValue } from './studio/StudioContext.js';
import type { CoverageData, NavigationTarget, ScenariosSubView, StudioConfig, StudioView } from './studio/types.js';
import { FlowsStudioView } from './views/FlowsStudioView.js';
import { PeopleView } from './views/PeopleView.js';
import { ScenariosView } from './views/ScenariosView.js';
import { ScreensStudioView } from './views/ScreensStudioView.js';

interface BlueprintEntry {
  id: string;
  title: string;
}

function resolveDefaultPersonaId(data: PersonaPreviewData): string {
  if (data.primary && data.personas.some((p) => p.id === data.primary)) {
    return data.primary;
  }
  return data.personas[0]!.id;
}

function StudioShell() {
  const params = new URLSearchParams(window.location.search);
  const [config, setConfig] = useState<StudioConfig | null>(null);
  const [blueprints, setBlueprints] = useState<BlueprintEntry[]>([]);
  const [runId, setRunId] = useState(params.get('run')?.trim() ?? '');
  const [blueprintId, setBlueprintId] = useState(params.get('id')?.trim() ?? '');
  const [activeView, setActiveView] = useState<StudioView>('people');
  const [scenariosSubView, setScenariosSubView] = useState<ScenariosSubView>('gaps');
  const [flowGraph, setFlowGraph] = useState<FlowGraphData | null>(null);
  const [flowGraphSource, setFlowGraphSource] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioEntry[]>([]);
  const [personaData, setPersonaData] = useState<PersonaPreviewData | null>(null);
  const [coverage, setCoverage] = useState<CoverageData | null>(null);
  const [screenMeta, setScreenMeta] = useState<Record<string, ScreenMeta>>({});
  const [activeFlowId, setActiveFlowId] = useState('default');
  const [activeScreen, setActiveScreen] = useState('');
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [prototypeMode, setPrototypeMode] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchCoverage = useCallback(async (rid: string) => {
    const res = await fetch(`/__lamina/coverage?run=${encodeURIComponent(rid)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as CoverageData;
    setCoverage(data);
    return data;
  }, []);

  const fetchFlowGraph = useCallback(async (rid: string, bid: string) => {
    const query = rid
      ? `run=${encodeURIComponent(rid)}`
      : `id=${encodeURIComponent(bid)}`;
    const res = await fetch(`/__lamina/flow-graph?${query}`);
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

  const fetchScenarios = useCallback(async (rid: string, bid: string) => {
    const query = rid
      ? `run=${encodeURIComponent(rid)}`
      : `id=${encodeURIComponent(bid)}`;
    const res = await fetch(`/__lamina/scenarios?${query}`);
    if (!res.ok) {
      setScenarios([]);
      return;
    }
    setScenarios((await res.json()) as ScenarioEntry[]);
  }, []);

  const fetchPersonas = useCallback(async (rid: string, bid: string) => {
    const parts: string[] = [];
    if (rid) parts.push(`run=${encodeURIComponent(rid)}`);
    if (bid) parts.push(`id=${encodeURIComponent(bid)}`);
    const res = await fetch(`/__lamina/personas?${parts.join('&')}`);
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
  }, []);

  const fetchScreenMeta = useCallback(async (bid: string, flowId: string) => {
    if (!bid) return {};
    const res = await fetch(
      `/__lamina/screen-meta?id=${encodeURIComponent(bid)}&flowId=${encodeURIComponent(flowId)}`,
    );
    if (!res.ok) return {};
    return (await res.json()) as Record<string, ScreenMeta>;
  }, []);

  const bootstrap = useCallback(
    async (rid: string, bid: string) => {
      setLoadError(null);
      const cov = rid ? await fetchCoverage(rid) : null;
      const resolvedBid = bid || cov?.run?.blueprint_id || '';
      if (resolvedBid) setBlueprintId(resolvedBid);

      const graph = await fetchFlowGraph(rid, resolvedBid);
      await fetchScenarios(rid, resolvedBid);
      await fetchPersonas(rid, resolvedBid);

      if (graph) {
        const flowId = resolveActiveFlowId(graph, 'default');
        setActiveFlowId(flowId);
        const entry = inferEntryScreen(resolveFlowTransitions(graph, flowId));
        if (entry) setActiveScreen(entry);
      }
    },
    [fetchCoverage, fetchFlowGraph, fetchPersonas, fetchScenarios],
  );

  useEffect(() => {
    fetch('/__lamina/config')
      .then((r) => r.json())
      .then((cfg: StudioConfig) => {
        setConfig(cfg);
        const rid = params.get('run')?.trim() ?? cfg.runId ?? '';
        const bid = params.get('id')?.trim() ?? cfg.id ?? '';
        if (rid) setRunId(rid);
        if (bid) setBlueprintId(bid);
        return fetch('/__lamina/blueprints').then((r) => r.json());
      })
      .then((entries: BlueprintEntry[] | undefined) => {
        if (entries) setBlueprints(entries);
      });
  }, []);

  useEffect(() => {
    if (!config) return;
    const rid = runId || config.runId || '';
    const bid = blueprintId || config.id || '';
    if (!rid && !bid) {
      setLoadError('Add ?run=<run_id> or ?id=<blueprint_id> to the URL.');
      return;
    }
    void bootstrap(rid, bid);
  }, [config, runId, blueprintId, bootstrap]);

  useEffect(() => {
    if (!blueprintId) return;
    let cancelled = false;
    fetchScreenMeta(blueprintId, activeFlowId).then((meta) => {
      if (!cancelled) setScreenMeta(meta);
    });
    return () => {
      cancelled = true;
    };
  }, [blueprintId, activeFlowId, fetchScreenMeta]);

  const activePersona = useMemo((): PersonaEntry | null => {
    if (!activePersonaId || !personaData) return null;
    return personaData.personas.find((p) => p.id === activePersonaId) ?? null;
  }, [activePersonaId, personaData]);

  const gapScreenIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of coverage?.gaps ?? []) ids.add(g.screenId);
    return ids;
  }, [coverage]);

  const scenariosByScreen = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of scenarios) {
      map.set(s.screen, (map.get(s.screen) ?? 0) + 1);
    }
    return map;
  }, [scenarios]);

  const navigate = useCallback((target: NavigationTarget) => {
    setActiveView(target.view);
    if (target.flowId) setActiveFlowId(target.flowId);
    if (target.screenId) setActiveScreen(target.screenId);
    if (target.scenarioId) {
      setSelectedScenarioId(target.scenarioId);
      setActiveScenario(target.scenarioId);
    }
  }, []);

  const studioValue: StudioContextValue = {
    config,
    runId,
    blueprintId,
    runMeta: coverage?.run ?? null,
    activeView,
    setActiveView,
    scenariosSubView,
    setScenariosSubView,
    flowGraph,
    flowGraphSource,
    scenarios,
    personaData,
    coverage,
    screenMeta,
    activeFlowId,
    setActiveFlowId,
    activeScreen,
    setActiveScreen,
    activeScenario,
    setActiveScenario,
    selectedScenarioId,
    setSelectedScenarioId,
    activePersonaId,
    setActivePersonaId,
    activePersona,
    prototypeMode,
    setPrototypeMode,
    navigate,
    gapScreenIds,
    scenariosByScreen,
    refreshCoverage: async () => {
      if (runId) await fetchCoverage(runId);
    },
  };

  if (!config) {
    return (
      <div className="sub-preview-shell">
        <div className="sub-preview-canvas">Starting UX Review Studio…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="sub-preview-shell">
        <div className="sub-studio-empty">
          <h1>UX Review Studio</h1>
          <p>{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <StudioProvider value={studioValue}>
      <div className="sub-preview-shell sub-studio-shell">
        <header className="sub-studio-chrome">
          <div className="sub-studio-chrome-title">
            <strong>UX Review Studio</strong>
            {runId ? <span>{runId}</span> : null}
            {coverage?.run?.command ? <span className="sub-studio-muted">{coverage.run.command}</span> : null}
          </div>
          <div className="sub-studio-chrome-controls">
            {personaData?.personas.length ? (
              <label className="sub-preview-topbar-control">
                <span className="sub-preview-topbar-control-label">View as</span>
                <select
                  value={activePersonaId ?? ''}
                  onChange={(e) => setActivePersonaId(e.target.value)}
                  aria-label="Persona lens"
                >
                  {personaData.personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {flowGraph && flowGraph.flows.length > 1 ? (
              <label className="sub-preview-topbar-control">
                <span className="sub-preview-topbar-control-label">Flow</span>
                <select
                  value={activeFlowId}
                  onChange={(e) => setActiveFlowId(e.target.value)}
                  aria-label="Active flow"
                >
                  {flowGraph.flows.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {blueprints.length > 1 ? (
              <label className="sub-preview-topbar-control">
                <span className="sub-preview-topbar-control-label">Blueprint</span>
                <select
                  value={blueprintId}
                  onChange={(e) => {
                    setBlueprintId(e.target.value);
                    const next = new URLSearchParams(window.location.search);
                    next.set('id', e.target.value);
                    window.history.replaceState({}, '', `?${next}`);
                  }}
                  aria-label="Blueprint"
                >
                  {blueprints.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title !== b.id ? `${b.title} (${b.id})` : b.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </header>
        <nav className="sub-studio-nav" aria-label="Studio views">
          {(
            [
              ['people', 'People'],
              ['flows', 'Flows'],
              ['screens', 'Screens'],
              ['scenarios', 'Scenarios'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={activeView === id ? 'active' : ''}
              onClick={() => setActiveView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <main className="sub-studio-main">
          {activeView === 'people' ? <PeopleView /> : null}
          {activeView === 'flows' ? <FlowsStudioView /> : null}
          {activeView === 'screens' ? <ScreensStudioView /> : null}
          {activeView === 'scenarios' ? <ScenariosView /> : null}
        </main>
      </div>
    </StudioProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StudioShell />
  </StrictMode>,
);
