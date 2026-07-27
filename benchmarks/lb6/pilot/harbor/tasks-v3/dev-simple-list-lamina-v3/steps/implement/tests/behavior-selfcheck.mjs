/**
 * Structural self-check for Harbor agents.
 * Uses published action examples only — never golden expect / must_not_include strings.
 * Honest capability pressure: non-noop reduce, action-id anchoring, actor-scoped project for revoke-like actions.
 *
 * Dependent actions (mark_missed after add_task, etc.) are checked via short golden
 * sequence prefixes so empty-state isolation does not falsely fail a real reducer.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/**
 * For each action type, return the shortest golden prefix that ends with that type.
 * Strips expect / must_not_include so agents never see graded substrings here.
 */
export function collectActionPrefixes(golden) {
  const byType = new Map();
  for (const sequence of golden.sequences ?? []) {
    const actions = sequence.actions ?? [];
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (!action?.type) continue;
      if (byType.has(action.type)) continue;
      const prefix = actions.slice(0, i + 1).map(stripGradedFields);
      byType.set(action.type, prefix);
    }
  }
  return [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function stripGradedFields(action) {
  const copy = { ...action };
  delete copy.expect;
  delete copy.must_not_include;
  delete copy.expects;
  return copy;
}

async function resolve(value) {
  return value && typeof value.then === 'function' ? await value : value;
}

function snap(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function runBehaviorSelfcheck({ root = '/app', golden }) {
  const errors = [];
  let mod;
  try {
    mod = await import(pathToFileURL(path.join(root, 'app.mjs')).href + '?selfcheck=' + Date.now());
  } catch (error) {
    return { ok: false, errors: [`failed to import app.mjs: ${error?.message || error}`] };
  }

  for (const name of ['createInitialState', 'reduce', 'project']) {
    if (typeof mod[name] !== 'function') errors.push(`missing export ${name}()`);
  }
  if (errors.length) return { ok: false, errors };

  const prefixes = collectActionPrefixes(golden);
  if (!prefixes.length) return { ok: false, errors: ['no published actions in golden'] };

  for (const [type, prefix] of prefixes) {
    const target = prefix[prefix.length - 1];
    let state = await resolve(mod.createInitialState());

    // Apply all but the last action to establish prerequisites.
    for (let i = 0; i < prefix.length - 1; i++) {
      const next = await resolve(mod.reduce(state, prefix[i]));
      if (next === undefined || next === null) {
        errors.push(`${type}: prerequisite reduce (${prefix[i].type}) returned ${next}`);
        state = null;
        break;
      }
      state = next;
    }
    if (state === null) continue;

    const before = snap(state);
    const actor = target.actor || 'owner';
    const beforeView = snap(await resolve(mod.project(state, actor)));

    const next = await resolve(mod.reduce(state, target));
    if (next === undefined || next === null) {
      errors.push(`${type}: reduce returned ${next}`);
      continue;
    }
    state = next;
    const after = snap(state);
    if (before === after) {
      errors.push(`${type}: reduce() must mutate state (got no-op)`);
    }
    if (target.id && !after.toLowerCase().includes(String(target.id).toLowerCase())) {
      errors.push(`${type}: reduced state must retain action id "${target.id}"`);
    }

    const afterView = snap(await resolve(mod.project(state, actor)));
    if (beforeView === afterView && before === after) {
      errors.push(`${type}: project() unchanged after no-op reduce`);
    }

    // Revoke / expire / deny-style actions must change the affected actor's projection.
    if (/revoke|expire|deny/i.test(type)) {
      const subject = target.actor || target.email || 'subject';
      const other = subject === 'owner' ? 'caregiver' : 'owner';
      const subjectView = snap(await resolve(mod.project(state, subject)));
      const otherView = snap(await resolve(mod.project(state, other)));
      if (subjectView === otherView) {
        errors.push(`${type}: project(${subject}) must differ from project(${other}) after access change`);
      }
      if (subjectView === beforeView) {
        errors.push(`${type}: project(${subject}) must change after access revocation/expiry`);
      }
    }
  }

  // Replay purity: project depends on reduced state, not hidden globals.
  for (const [, prefix] of prefixes) {
    async function reducePrefix(targetMod) {
      let s = await resolve(targetMod.createInitialState());
      for (const action of prefix) {
        s = await resolve(targetMod.reduce(s, action));
      }
      return s;
    }
    const actor = prefix[prefix.length - 1].actor || 'owner';
    const stateA = await reducePrefix(mod);
    const viewA = snap(await resolve(mod.project(stateA, actor)));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 3));
    const replayMod = await import(
      pathToFileURL(path.join(root, 'app.mjs')).href + `?selfcheckReplay=${Date.now()}-${Math.random()}`
    );
    const stateB = await reducePrefix(replayMod);
    const viewB = snap(await resolve(replayMod.project(stateB, actor)));
    if (snap(stateA) !== snap(stateB) || viewA !== viewB) {
      errors.push(`${prefix[prefix.length - 1].type}: reducer/project replay is nondeterministic`);
      break;
    }
  }

  return { ok: errors.length === 0, errors };
}
