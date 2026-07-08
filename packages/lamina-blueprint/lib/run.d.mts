export function parseRunYaml(source: string): Record<string, unknown>;
export function resolveRunPath(laminaRoot: string, runId: string): string;
export function loadFlowsFromRun(
  laminaRoot: string,
  runId: string,
): Array<{
  id: string;
  graphs?: Array<{
    id: string;
    entry_screen?: string;
    transitions: Array<{ from?: string; target: string; trigger: string }>;
  }>;
}>;
export function loadScenariosFromRun(laminaRoot: string, runId: string): import('../preview/scenarios.js').ScenarioEntry[];
export function readBlueprintRunId(blueprintDir: string): string | null;
export function loadRunYaml(runPath: string): Record<string, unknown>;
