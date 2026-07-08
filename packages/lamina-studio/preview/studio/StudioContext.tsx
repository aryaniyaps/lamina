import { createContext, useContext, type ReactNode } from 'react';
import type { FlowGraphData } from '../flow-graph.js';
import type { PersonaEntry, PersonaPreviewData } from '../personas.js';
import type { ScenarioEntry } from '../scenarios.js';
import type { ScreenMeta } from '../screen-meta.js';
import type { CoverageData, NavigationTarget, RunArtifactsData, StudioConfig } from './types.js';

export interface StudioContextValue {
  config: StudioConfig | null;
  runId: string;
  blueprintId: string;
  runMeta: CoverageData['run'] | null;
  flowGraph: FlowGraphData | null;
  flowGraphSource: string | null;
  scenarios: ScenarioEntry[];
  personaData: PersonaPreviewData | null;
  coverage: CoverageData | null;
  artifacts: RunArtifactsData | null;
  screenMeta: Record<string, ScreenMeta>;
  activeStudioView: 'review' | 'artifacts' | 'handoff';
  setActiveStudioView: (view: 'review' | 'artifacts' | 'handoff') => void;
  activeFlowId: string;
  setActiveFlowId: (id: string) => void;
  activeScreen: string;
  setActiveScreen: (id: string) => void;
  activeScenario: string | null;
  setActiveScenario: (id: string | null) => void;
  selectedScenarioId: string | null;
  setSelectedScenarioId: (id: string | null) => void;
  activePersonaId: string | null;
  setActivePersonaId: (id: string | null) => void;
  activePersona: PersonaEntry | null;
  prototypeMode: boolean;
  setPrototypeMode: (on: boolean) => void;
  navigate: (target: NavigationTarget) => void;
  gapScreenIds: Set<string>;
  scenariosByScreen: Map<string, number>;
  refreshCoverage: () => Promise<void>;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({
  value,
  children,
}: {
  value: StudioContextValue;
  children: ReactNode;
}) {
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio must be used within StudioProvider');
  return ctx;
}
