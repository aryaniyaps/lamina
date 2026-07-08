import type { PersonaEntry } from './personas.js';

const DICEBEAR_STYLE = 'lorelei';

export function personaAvatarUrl(personaId: string): string {
  const params = new URLSearchParams({
    seed: personaId,
    backgroundColor: '2e2e2e',
    radius: '50',
  });
  return `https://api.dicebear.com/9.x/${DICEBEAR_STYLE}/svg?${params}`;
}

export interface PainPoint {
  text: string;
  screenId?: string;
  severity?: string;
  step?: string;
}

export function collectPainPointsForScreen(persona: PersonaEntry, screenId: string): PainPoint[] {
  if (!persona.simulation) return [];
  return persona.simulation.blockers
    .filter((b) => b.screenId === screenId && b.quote.trim())
    .map((b) => ({
      text: b.quote,
      screenId: b.screenId,
      severity: b.severity,
      step: b.step,
    }));
}
