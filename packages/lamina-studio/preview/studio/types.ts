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
  flowId: string;
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
  flowId?: string;
}

export interface MatrixCell {
  operationId: string;
  category: string;
  required: boolean;
  scenarioId: string | null;
  covered: boolean;
  flowId?: string;
}

export interface FlowCoverageSummary {
  id: string;
  score: number;
  gapCount: number;
}

export interface CoverageData {
  ok: boolean;
  runId?: string;
  score?: number;
  gaps?: CoverageGap[];
  cells?: MatrixCell[];
  operations?: DerivedOperation[];
  flows?: FlowCoverageSummary[];
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
  screenId?: string;
  flowId?: string;
  scenarioId?: string;
}

export interface RunArtifactIndexEntry {
  id: string;
  type?: string;
  pack?: string;
  path?: string;
  confidence?: string;
  evidence_mode?: string;
  diagram?: string;
}

export interface RunArtifactDocument {
  id: string;
  title: string;
  path: string;
  kind: 'report' | 'handoff' | 'artifact';
  pack?: string;
  confidence?: string;
  evidenceMode?: string;
  diagram?: string;
  content: string;
}

export interface RunArtifactsData {
  runId: string;
  index: RunArtifactIndexEntry[];
  documents: RunArtifactDocument[];
}
