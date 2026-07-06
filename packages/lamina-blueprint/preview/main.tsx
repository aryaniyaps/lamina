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
import type { FlowGraphData } from './flow-graph.js';
import { outgoingTransitions, inferEntryScreen } from './flow-graph.js';
import './styles/wireframe.css';

interface BlueprintConfig {
  root: string;
  id: string;
  diff: boolean;
}

interface BlueprintEntry {
  id: string;
  title: string;
}

interface FlowGraphResponse extends FlowGraphData {
  changedScreens: string[];
}

function subpathsForScreen(
  screenId: string,
  diff: boolean,
  variant?: 'baseline' | 'proposed',
): string[] {
  const file = `screens/${screenId}.tsx`;
  if (!diff || !variant) return [file];
  if (variant === 'baseline') return [`baseline/${file}`, file];
  return [`proposed/${file}`, file];
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

async function screenHasDistinctDiff(blueprintId: string, screenId: string): Promise<boolean> {
  const baseline = await tryResolveFsPath(
    blueprintId,
    subpathsForScreen(screenId, true, 'baseline'),
  );
  const proposed = await tryResolveFsPath(
    blueprintId,
    subpathsForScreen(screenId, true, 'proposed'),
  );
  return baseline !== null && proposed !== null && baseline !== proposed;
}

async function importScreen(blueprintId: string, candidates: string[]) {
  const fsPath = await resolveFsPath(blueprintId, candidates);
  return import(/* @vite-ignore */ `/@fs/${fsPath}`);
}

function ScreenView({
  blueprintId,
  screenId,
  variant,
  diff,
}: {
  blueprintId: string;
  screenId: string;
  variant?: 'baseline' | 'proposed';
  diff: boolean;
}) {
  const [Screen, setScreen] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setScreen(null);
    setError(null);

    importScreen(blueprintId, subpathsForScreen(screenId, diff, variant))
      .then((mod) => {
        if (!cancelled) setScreen(() => mod.default);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [blueprintId, screenId, variant, diff]);

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
  const [screens, setScreens] = useState<string[]>([]);
  const [activeScreen, setActiveScreen] = useState<string>('');
  const [flowGraph, setFlowGraph] = useState<FlowGraphResponse | null>(null);
  const [activeFlowId, setActiveFlowId] = useState('default');
  const [navFlash, setNavFlash] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const params = new URLSearchParams(window.location.search);
  const [activeBlueprint, setActiveBlueprint] = useState(params.get('id') ?? '');
  const [diffTab, setDiffTab] = useState<'baseline' | 'proposed'>('baseline');
  const [showDiffTabs, setShowDiffTabs] = useState(false);

  const loadScreens = useCallback(async (blueprintId: string, diff: boolean) => {
    const res = await fetch(
      `/__lamina/screens?id=${encodeURIComponent(blueprintId)}&diff=${diff ? '1' : '0'}`,
    );
    const list: string[] = await res.json();
    setScreens(list);
    setActiveScreen((prev) => (list.includes(prev) ? prev : list[0] ?? ''));
  }, []);

  const loadFlowGraph = useCallback(async (blueprintId: string) => {
    const res = await fetch(`/__lamina/flow-graph?id=${encodeURIComponent(blueprintId)}`);
    if (!res.ok) {
      setFlowGraph(null);
      return;
    }
    const data = (await res.json()) as FlowGraphResponse;
    setFlowGraph(data);
    const firstFlow = data.flows[0]?.id ?? 'default';
    setActiveFlowId(firstFlow);
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
          .then((entries: BlueprintEntry[]) => {
            setBlueprints(entries);
            return Promise.all([loadScreens(id, cfg.diff), loadFlowGraph(id)]);
          });
      });
  }, [loadScreens, loadFlowGraph]);

  useEffect(() => {
    if (!config?.diff || !activeScreen || !activeBlueprint) {
      setShowDiffTabs(false);
      return;
    }
    let cancelled = false;
    screenHasDistinctDiff(activeBlueprint, activeScreen).then((distinct) => {
      if (!cancelled) {
        setShowDiffTabs(distinct);
        if (distinct) setDiffTab('baseline');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [config?.diff, activeBlueprint, activeScreen]);

  const navigateToTarget = useCallback((target: string) => {
    setActiveScreen(target);
    setNavFlash(true);
    window.setTimeout(() => setNavFlash(false), 400);
  }, []);

  const resolveTransition = useCallback(
    (trigger: string) => {
      if (!flowGraph) return null;
      const flow = flowGraph.flows.find((f) => f.id === activeFlowId);
      const transitions = flow?.transitions ?? flowGraph.transitions;
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
      const el = (e.target as HTMLElement).closest('[data-trigger]');
      if (!el) return;
      const trigger = el.getAttribute('data-trigger');
      if (!trigger) return;
      const transition = resolveTransition(trigger);
      if (transition) navigateToTarget(transition.target);
    },
    [resolveTransition, navigateToTarget],
  );

  const onBlueprintChange = (id: string) => {
    setActiveBlueprint(id);
    const next = new URLSearchParams(window.location.search);
    next.set('id', id);
    window.history.replaceState({}, '', `?${next}`);
    loadScreens(id, config?.diff ?? false);
    loadFlowGraph(id);
  };

  const flowScreens = flowGraph
    ? (() => {
        const flow = flowGraph.flows.find((f) => f.id === activeFlowId);
        const transitions = flow?.transitions ?? [];
        const ids = new Set<string>();
        for (const t of transitions) {
          if (t.from) ids.add(t.from);
          ids.add(t.target);
        }
        if (!ids.size) return screens;
        return screens.filter((s) => ids.has(s));
      })()
    : screens;

  const displayScreens = flowScreens.length ? flowScreens : screens;

  const outgoing = flowGraph
    ? outgoingTransitions(
        flowGraph.flows.find((f) => f.id === activeFlowId)?.transitions ??
          flowGraph.transitions,
        activeScreen,
        activeFlowId,
      )
    : [];

  if (!config) {
    return (
      <div className="sub-preview-shell">
        <div className="sub-preview-canvas">Starting preview…</div>
      </div>
    );
  }

  const diffMode = config.diff;
  const comparing = diffMode && showDiffTabs;
  const changedScreens = flowGraph?.changedScreens ?? [];

  return (
    <div className="sub-preview-shell">
      <div className="sub-preview-topbar">
        <span className="sub-preview-topbar-title">{activeBlueprint}</span>
        {comparing ? <span className="sub-preview-topbar-meta">optimize</span> : null}
      </div>
      <div className="sub-preview-body">
        <aside className="sub-preview-sidebar">
          {blueprints.length > 1 ? (
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
          ) : null}
          {displayScreens.length > 0 ? (
            <>
              <h2>Screens</h2>
              <ul className="sub-screen-nav">
                {displayScreens.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      className={`${activeScreen === id ? 'active' : ''}${
                        changedScreens.includes(id) ? ' has-diff' : ''
                      }`}
                      onClick={() => setActiveScreen(id)}
                    >
                      {id}
                      {changedScreens.includes(id) ? (
                        <span className="sub-diff-badge" title="Changed in optimize" />
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>
        <main className="sub-preview-main">
          {comparing ? (
            <div className="sub-preview-tabs" role="tablist" aria-label="Optimize comparison">
              <button
                type="button"
                role="tab"
                aria-selected={diffTab === 'baseline'}
                className={diffTab === 'baseline' ? 'active' : ''}
                onClick={() => setDiffTab('baseline')}
              >
                Baseline
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={diffTab === 'proposed'}
                className={diffTab === 'proposed' ? 'active' : ''}
                onClick={() => setDiffTab('proposed')}
              >
                Proposed
              </button>
            </div>
          ) : null}
          <div
            ref={canvasRef}
            className={`sub-preview-canvas${navFlash ? ' sub-nav-flash' : ''}`}
            onClick={comparing ? undefined : onCanvasClick}
          >
            {activeScreen ? (
              <ScreenView
                blueprintId={activeBlueprint}
                screenId={activeScreen}
                variant={comparing ? diffTab : undefined}
                diff={comparing}
              />
            ) : (
              <div className="sub-text">No screens</div>
            )}
          </div>
          {!comparing && outgoing.length > 0 ? (
            <div className="sub-next-steps-bar">
              <span className="sub-next-steps-label">Next steps</span>
              {outgoing.map((t) => (
                <button
                  key={`${t.trigger}-${t.target}`}
                  type="button"
                  className="sub-next-step-chip"
                  onClick={() => navigateToTarget(t.target)}
                >
                  {t.trigger} → {t.target}
                </button>
              ))}
            </div>
          ) : null}
        </main>
        {!comparing && flowGraph ? (
          <aside className="sub-preview-flow-sidebar">
            <FlowGraphPanel
              graph={flowGraph}
              activeScreen={activeScreen}
              activeFlowId={activeFlowId}
              onSelectScreen={navigateToTarget}
              onSelectFlow={setActiveFlowId}
              changedScreens={changedScreens}
            />
          </aside>
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
