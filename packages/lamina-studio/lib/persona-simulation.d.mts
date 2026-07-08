import type { PersonaBlocker, PersonaSimulation } from '../preview/personas.js';

export interface SimulationResult {
  persona_id: string;
  outcome: PersonaSimulation['outcome'];
  blockers: PersonaBlocker[];
}

export function parseSimulationYaml(source: string): SimulationResult[];
