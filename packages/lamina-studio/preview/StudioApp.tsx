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
import type {
  CoverageData,
  NavigationTarget,
  RunArtifactsData,
  StudioConfig,
} from './studio/types.js';
import { ReviewView } from './views/ReviewView.js';
import { ArtifactReviewView } from './views/ArtifactReviewView.js';

interface BlueprintEntry {
  id: string;
  title: string;
  run_id?: string;
}

interface RunEntry {
  id: string;
  hook?: string;
}

function runLabel(run: RunEntry): string {
  return run.hook ? `${run.id} (${run.hook})` : run.id;
}

function RunNotFoundView({
  requestedRunId,
  runs,
  blueprints,
  onSelectRun,
}: {
  requestedRunId: string;
  runs: RunEntry[];
  blueprints: BlueprintEntry[];
  onSelectRun: (runId: string) => void;
}) {
  const availableRuns = runs.filter((run) => run.id !== requestedRunId);

  return (
    <section className="sub-studio-missing-run" aria-labelledby="missing-run-title">
      <div className="sub-studio-missing-run-card">
        <p className="sub-studio-missing-run-kicker">Run not found</p>
        <h1 id="missing-run-title">We could not find that Lamina run.</h1>
        <p>
          <code>{requestedRunId}</code> is not available in this workspace anymore. Pick one of the
          existing runs below to keep reviewing generated flows and artifacts.
        </p>

        {availableRuns.length ? (
          <div className="sub-studio-missing-run-list">
            <h2>Available runs</h2>
            {availableRuns.map((run) => {
              const linkedBlueprint = blueprints.find((b) => b.run_id === run.id);
              return (
                <button key={run.id} type="button" onClick={() => onSelectRun(run.id)}>
                  <span className="sub-studio-missing-run-id">{runLabel(run)}</span>
                  {linkedBlueprint ? (
                    <span className="sub-studio-missing-run-meta">
                      Opens {linkedBlueprint.title || linkedBlueprint.id}
                    </span>
                  ) : (
                    <span className="sub-studio-missing-run-meta">
                      Markdown artifacts only unless the run links a blueprint
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="sub-studio-muted">
            No other runs were found under <code>.lamina/runs</code>.
          </p>
        )}
      </div>
    </section>
  );
}

function resolveDefaultPersonaId(data: PersonaPreviewData): string {
  if (data.primary && data.personas.some((p) => p.id === data.primary)) {
    return data.primary;
  }
  return data.personas[0]!.id;
}

function runSlugFromPath(pathname: string): string {
  const segment = pathname.replace(/^\/+|\/+$/g, '').split('/')[0] ?? '';
  if (!segment || segment.startsWith('__lamina')) return '';
  try {
    return decodeURIComponent(segment).trim();
  } catch {
    return segment.trim();
  }
}

function initialRunFromUrl(): string {
  const fromPath = runSlugFromPath(window.location.pathname);
  if (fromPath) return fromPath;
  return new URLSearchParams(window.location.search).get('run')?.trim() ?? '';
}

function StudioShell() {
  const [config, setConfig] = useState<StudioConfig | null>(null);
  const [blueprints, setBlueprints] = useState<BlueprintEntry[]>([]);
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [runId, setRunId] = useState(initialRunFromUrl);
  const [blueprintId, setBlueprintId] = useState('');
  const [flowGraph, setFlowGraph] = useState<FlowGraphData | null>(null);
  const [flowGraphSource, setFlowGraphSource] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioEntry[]>([]);
  const [personaData, setPersonaData] = useState<PersonaPreviewData | null>(null);
  const [coverage, setCoverage] = useState<CoverageData | null>(null);
  const [artifacts, setArtifacts] = useState<RunArtifactsData | null>(null);
  const [screenMeta, setScreenMeta] = useState<Record<string, ScreenMeta>>({});
  const [activeStudioView, setActiveStudioView] = useState<'review' | 'artifacts' | 'handoff'>('review');
  const [activeFlowId, setActiveFlowId] = useState('default');
  const [activeScreen, setActiveScreen] = useState('');
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [prototypeMode, setPrototypeMode] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const syncUrl = useCallback((rid: string) => {
    const nextPath = rid ? `/${encodeURIComponent(rid)}` : '/';
    window.history.replaceState({}, '', nextPath);
  }, []);

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

  const fetchArtifacts = useCallback(async (rid: string) => {
    if (!rid) {
      setArtifacts(null);
      return null;
    }
    const res = await fetch(`/__lamina/artifacts?run=${encodeURIComponent(rid)}`);
    if (!res.ok) {
      setArtifacts(null);
      return null;
    }
    const data = (await res.json()) as RunArtifactsData;
    setArtifacts(data);
    return data;
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

  const fetchScreenMeta = useCallback(async (rid: string, bid: string, flowId: string) => {
    if (!rid && !bid) return {};
    const query = new URLSearchParams({ flowId });
    if (rid) query.set('run', rid);
    else if (bid) query.set('id', bid);
    const res = await fetch(`/__lamina/screen-meta?${query}`);
    if (!res.ok) return {};
    return (await res.json()) as Record<string, ScreenMeta>;
  }, []);

  const bootstrap = useCallback(
    async (rid: string, bid: string) => {
      setBootstrapError(null);
      if (!rid) setCoverage(null);
      const cov = rid ? await fetchCoverage(rid) : null;
      if (rid && cov && !cov.ok && cov.error) {
        setBootstrapError(null);
        setFlowGraph(null);
        setScenarios([]);
        setPersonaData(null);
        setActivePersonaId(null);
        setArtifacts(null);
        setScreenMeta({});
        setActiveScreen('');
        setActiveScenario(null);
        setSelectedScenarioId(null);
        return;
      }
      const resolvedBid = bid || cov?.run?.blueprint_id || '';
      if (resolvedBid) setBlueprintId(resolvedBid);
      if (rid) syncUrl(rid);

      const graph = await fetchFlowGraph(rid, resolvedBid);
      await fetchScenarios(rid, resolvedBid);
      await fetchPersonas(rid, resolvedBid);
      await fetchArtifacts(rid);

      if (graph) {
        const flowId = resolveActiveFlowId(graph, 'default');
        setActiveFlowId(flowId);
        const entry = inferEntryScreen(resolveFlowTransitions(graph, flowId));
        if (entry) setActiveScreen(entry);
      }
    },
    [fetchArtifacts, fetchCoverage, fetchFlowGraph, fetchPersonas, fetchScenarios, syncUrl],
  );

  useEffect(() => {
    fetch('/__lamina/config')
      .then((r) => r.json())
      .then((cfg: StudioConfig) => {
        setConfig(cfg);
        const urlRunId = initialRunFromUrl();
        const rid = urlRunId || cfg.runId || '';
        const bid = !rid ? (cfg.id ?? '') : '';
        if (rid) setRunId(rid);
        if (bid) setBlueprintId(bid);
        return Promise.all([
          fetch('/__lamina/blueprints').then((r) => r.json()),
          fetch('/__lamina/runs').then((r) => r.json()),
        ]).then(([bpEntries, runEntries]) => ({
          bpEntries,
          runEntries,
          initialRunId: rid,
          initialBlueprintId: bid,
        }));
      })
      .then(
        ({
          bpEntries,
          runEntries,
          initialRunId,
          initialBlueprintId,
        }: {
          bpEntries: BlueprintEntry[] | undefined;
          runEntries: RunEntry[] | undefined;
          initialRunId: string;
          initialBlueprintId: string;
        }) => {
        if (runEntries?.length) setRuns(runEntries);
        if (!bpEntries?.length) return;
        setBlueprints(bpEntries);
        const cfgBid = blueprintId;
        if (initialRunId) return;
        const initial: BlueprintEntry | undefined =
          (initialBlueprintId ? bpEntries.find((b) => b.id === initialBlueprintId) : undefined) ??
          (cfgBid ? bpEntries.find((b) => b.id === cfgBid) : undefined) ??
          bpEntries[0];
        if (initial && !initialBlueprintId && !cfgBid) {
          setBlueprintId(initial.id);
          if (initial.run_id) setRunId(initial.run_id);
          syncUrl(initial.run_id ?? '');
        } else if (initial?.run_id && !runId && !initialRunId) {
          setRunId(initial.run_id);
        }
      });
  }, [syncUrl]);

  useEffect(() => {
    if (!config) return;
    const bid = blueprintId || (!runId ? config.id : '') || '';
    if (!bid && !runId && !config.runId) return;
    const linkedRun =
      runId ||
      blueprints.find((b) => b.id === bid)?.run_id ||
      config.runId ||
      '';
    void bootstrap(linkedRun, bid);
  }, [config, runId, blueprintId, blueprints, bootstrap]);

  useEffect(() => {
    if (!blueprintId) return;
    let cancelled = false;
    fetchScreenMeta(runId, blueprintId, activeFlowId).then((meta) => {
      if (!cancelled) setScreenMeta(meta);
    });
    return () => {
      cancelled = true;
    };
  }, [runId, blueprintId, activeFlowId, fetchScreenMeta]);

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
    if (target.flowId) setActiveFlowId(target.flowId);
    if (target.screenId) setActiveScreen(target.screenId);
    if (target.scenarioId) {
      setSelectedScenarioId(target.scenarioId);
      setActiveScenario(target.scenarioId);
    }
  }, []);

  const handleRunChange = (nextRunId: string) => {
    const linkedBlueprint = blueprints.find((b) => b.run_id === nextRunId)?.id ?? '';
    setCoverage(null);
    setRunId(nextRunId);
    setBlueprintId(linkedBlueprint);
    syncUrl(nextRunId);
  };

  const missingRunId =
    runId && coverage?.runId === runId && !coverage.ok && coverage.error === 'run not found'
      ? runId
      : '';

  const studioValue: StudioContextValue = {
    config,
    runId,
    blueprintId,
    runMeta: coverage?.run ?? null,
    flowGraph,
    flowGraphSource,
    scenarios,
    personaData,
    coverage,
    artifacts,
    screenMeta,
    activeStudioView,
    setActiveStudioView,
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

  if (!blueprints.length && !blueprintId && !runId) {
    return (
      <div className="sub-preview-shell">
        <div className="sub-studio-empty sub-studio-empty-hero">
          <h1>UX Review Studio</h1>
          <p>No blueprints in this project yet.</p>
          <p className="sub-studio-muted">
            Run <code>/lamina-design</code> or <code>/lamina-audit</code> in Cursor to create artifacts
            under <code>.lamina/blueprints/</code>, then open Studio again.
          </p>
        </div>
      </div>
    );
  }

  if (missingRunId) {
    return (
      <div className="sub-preview-shell">
        <RunNotFoundView
          requestedRunId={missingRunId}
          runs={runs}
          blueprints={blueprints}
          onSelectRun={handleRunChange}
        />
      </div>
    );
  }

  return (
    <StudioProvider value={studioValue}>
      <div className="sub-preview-shell sub-studio-shell">
        <header className="sub-studio-chrome">
          <div className="sub-studio-chrome-title">
            <img
              className="sub-studio-brand-mark"
              src="/__lamina/brand/logo.svg"
              alt=""
              width="24"
              height="24"
            />
            <div className="sub-studio-brand-text">
              <strong>Lamina Studio</strong>
            </div>
          </div>
          <div className="sub-studio-chrome-controls">
            {runs.length > 0 || runId ? (
              <label className="sub-preview-topbar-control">
                <span className="sub-preview-topbar-control-label">Run</span>
                <select
                  value={runId}
                  onChange={(e) => handleRunChange(e.target.value)}
                  aria-label="Select run"
                >
                  {!runId ? <option value="">Select a run…</option> : null}
                  {runId && !runs.some((run) => run.id === runId) ? (
                    <option value={runId}>{runId}</option>
                  ) : null}
                  {runs.map((run) => (
                    <option key={run.id} value={run.id}>
                      {runLabel(run)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </header>

        <nav className="sub-studio-nav" aria-label="Studio views">
          <button
            type="button"
            className={activeStudioView === 'review' ? 'active' : ''}
            onClick={() => setActiveStudioView('review')}
          >
            Blueprint
          </button>
          <button
            type="button"
            className={activeStudioView === 'artifacts' ? 'active' : ''}
            onClick={() => setActiveStudioView('artifacts')}
            disabled={!artifacts?.documents.length}
          >
            Artifacts
            {artifacts?.documents.length ? (
              <span className="sub-studio-tab-badge">{artifacts.documents.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            className={activeStudioView === 'handoff' ? 'active' : ''}
            onClick={() => setActiveStudioView('handoff')}
            disabled={!artifacts?.documents.some((doc) => doc.kind === 'handoff')}
          >
            Handoff
          </button>
        </nav>

        <main className="sub-studio-main">
          {bootstrapError ? (
            <div className="sub-studio-banner-error">{bootstrapError}</div>
          ) : null}
          {!blueprintId && activeStudioView === 'review' ? (
            <div className="sub-studio-empty">
              <p>{runId ? 'No blueprint linked. Use Artifacts or Handoff to review markdown docs.' : 'Select a run above to load artifacts.'}</p>
            </div>
          ) : null}
          {blueprintId && activeStudioView === 'review' ? <ReviewView /> : null}
          {activeStudioView === 'artifacts' ? <ArtifactReviewView mode="artifacts" /> : null}
          {activeStudioView === 'handoff' ? <ArtifactReviewView mode="handoff" /> : null}
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
