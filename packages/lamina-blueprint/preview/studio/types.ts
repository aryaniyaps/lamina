export type StudioView = 'people' | 'flows' | 'screens' | 'scenarios';

export type ScenariosSubView = 'gaps' | 'matrix' | 'gallery';

export interface StudioConfig {
  root: string;
  id?: string;
  runId?: string;
  port?: number;
}

export interface RunScreenEntry {
  id: string;
  title?: string;
  status?: string;
  regions?: string[];
  elements?: Array<Record<string, unknown>>;
}

export interface CoverageGap {
  operationId: string;
  operation: string;
  category: string;
  screenId: string;
  reason: string;
}

export interface DerivedOperation {
  id: string;
  operation: string;
  subject: string;
  screenId: string;
  kind: string;
}

export interface MatrixCell {
  operationId: string;
  category: string;
  required: boolean;
  scenarioId: string | null;
  covered: boolean;
}

export interface CoverageData {
  ok: boolean;
  runId?: string;
  score?: number;
  gaps?: CoverageGap[];
  cells?: MatrixCell[];
  operations?: DerivedOperation[];
  scenarios?: import('../scenarios.js').ScenarioEntry[];
  screens?: RunScreenEntry[];
  run?: {
    id: string;
    hook?: string;
    command?: string;
    blueprint_id?: string;
    simulation?: unknown;
  };
  error?: string;
}

export interface NavigationTarget {
  view: StudioView;
  screenId?: string;
  flowId?: string;
  scenarioId?: string;
}
