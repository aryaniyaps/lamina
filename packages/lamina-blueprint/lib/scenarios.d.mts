export const SCENARIO_CATEGORIES: Set<string>;
export type ScenarioEntry = import('../preview/scenarios.js').ScenarioEntry;
export function parseScenariosYaml(source: string): ScenarioEntry[];
