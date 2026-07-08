import type { PersonaBlocker } from '../preview/personas.js';

export function resolveBlockerScreenId(
  blocker: PersonaBlocker,
  screenIds: Set<string>,
): string | undefined;

export function attachScreenIds(
  blockers: PersonaBlocker[],
  screenIds: string[],
): PersonaBlocker[];
