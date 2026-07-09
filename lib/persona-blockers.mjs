/**
 * @param {import('../preview/personas.js').PersonaBlocker} blocker
 * @param {Set<string>} screenIds
 */
export function resolveBlockerScreenId(blocker, screenIds) {
  if (blocker.screenId && screenIds.has(blocker.screenId)) return blocker.screenId;
  if (blocker.step && screenIds.has(blocker.step)) return blocker.step;
  return undefined;
}

/**
 * @param {import('../preview/personas.js').PersonaBlocker[]} blockers
 * @param {string[]} screenIds
 */
export function attachScreenIds(blockers, screenIds) {
  const ids = new Set(screenIds);
  return blockers.map((b) => ({
    ...b,
    screenId: resolveBlockerScreenId(b, ids),
  }));
}
