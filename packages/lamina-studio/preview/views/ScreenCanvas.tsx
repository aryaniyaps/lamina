import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
} from 'react';
import {
  outgoingTransitions,
  resolveFlowTransitions,
  inferEntryScreen,
} from '../flow-graph.js';
import { useStudio } from '../studio/StudioContext.js';
import { AnnotationOverlay } from './AnnotationOverlay.js';

const VIEWPORT_PRESETS = {
  mobile: { label: 'Mobile', width: 390, aspectRatio: '9 / 19.5' },
  tablet: { label: 'Tablet', width: 768, aspectRatio: '3 / 4' },
  desktop: { label: 'Desktop', width: 1280, aspectRatio: '16 / 9' },
} as const;

type ViewportPreset = keyof typeof VIEWPORT_PRESETS;

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
      <div className="sub-skeleton-screen-banner">Screen wireframe not authored yet</div>
      <div className="sub-page" data-sub="Page">
        <div className="sub-section" data-sub="Section">
          <div className="sub-heading sub-skeleton-line" data-sub="Heading" />
          <div className="sub-skeleton-line sub-skeleton-line-wide" />
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

export function ScreenCanvas() {
  const {
    blueprintId,
    activeScreen,
    activeFlowId,
    activeScenario,
    flowGraph,
    prototypeMode,
    scenarios,
    selectedScenarioId,
  } = useStudio();

  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportPreset] = useState<ViewportPreset>('desktop');

  const activeTransitions = flowGraph ? resolveFlowTransitions(flowGraph, activeFlowId) : [];

  const applyHotspots = useCallback(() => {
    if (!prototypeMode) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const triggers = new Set(
      outgoingTransitions(activeTransitions, activeScreen).map((t) => t.trigger),
    );
    viewport.querySelectorAll('[data-trigger]').forEach((el) => {
      el.classList.toggle('sub-hotspot', triggers.has(el.getAttribute('data-trigger') ?? ''));
    });
  }, [activeTransitions, activeScreen, prototypeMode]);

  useEffect(() => {
    applyHotspots();
    const id = window.setTimeout(applyHotspots, 100);
    return () => window.clearTimeout(id);
  }, [applyHotspots, activeScreen, activeFlowId]);

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

  const { setActiveScreen, setActiveScenario } = useStudio();

  const onCanvasClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!prototypeMode) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, option')) return;
      const el = target.closest('[data-trigger]');
      if (!el) return;
      const trigger = el.getAttribute('data-trigger');
      if (!trigger) return;
      const transition = resolveTransition(trigger);
      if (transition) {
        setActiveScenario(null);
        setActiveScreen(transition.target);
      }
    },
    [prototypeMode, resolveTransition, setActiveScreen, setActiveScenario],
  );

  const screenScenarios = scenarios.filter((s) => s.screen === activeScreen);
  const highlightScenarioId = selectedScenarioId ?? activeScenario;

  if (!blueprintId) {
    return (
      <div className="sub-studio-empty">
        <p>Link a blueprint to this run to view SUB wireframes.</p>
      </div>
    );
  }

  if (!activeScreen) {
    return <div className="sub-studio-empty">Select a screen</div>;
  }

  const preset = VIEWPORT_PRESETS[viewportPreset];

  return (
    <div
      className="sub-preview-screen-column"
      style={{ width: preset.width, maxWidth: 'calc(100% - 24px)' }}
    >
      <div
        ref={viewportRef}
        className="sub-preview-viewport sub-studio-viewport"
        data-viewport={viewportPreset}
        style={{ width: '100%', aspectRatio: preset.aspectRatio }}
        onClick={onCanvasClick}
      >
        <div
          className="sub-preview-stage"
          key={`${activeFlowId}:${activeScreen}:${activeScenario ?? 'happy'}`}
        >
          <ScreenView
            blueprintId={blueprintId}
            screenId={activeScreen}
            flowId={activeFlowId}
            scenarioId={activeScenario}
            onLoaded={applyHotspots}
          />
          <AnnotationOverlay
            containerRef={viewportRef}
            scenarios={screenScenarios}
            highlightScenarioId={highlightScenarioId}
          />
        </div>
      </div>
    </div>
  );
}
