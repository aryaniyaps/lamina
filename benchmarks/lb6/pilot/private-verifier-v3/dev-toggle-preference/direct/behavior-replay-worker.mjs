import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function resolve(value) {
  return value && typeof value.then === 'function' ? await value : value;
}

async function execute(root, sequence) {
  const moduleUrl = pathToFileURL(path.join(root, 'app.mjs')).href;
  const mod = await import(moduleUrl);
  for (const name of ['createInitialState', 'reduce', 'project']) {
    if (typeof mod[name] !== 'function') throw new TypeError(`missing export ${name}()`);
  }
  let state = await resolve(mod.createInitialState());
  const baseline = { state, view: await resolve(mod.project(state, sequence.actor)) };
  const steps = [];
  for (const action of sequence.actions ?? []) {
    const next = await resolve(mod.reduce(state, action));
    if (next === undefined || next === null) throw new Error(`reduce returned ${next} for ${action.type}`);
    state = next;
    steps.push({ action, state, view: await resolve(mod.project(state, sequence.actor)) });
  }
  return { baseline, steps };
}

process.once('message', async ({ root, sequence }) => {
  try {
    process.send?.({ ok: true, trace: await execute(root, sequence) });
  } catch (error) {
    process.send?.({
      ok: false,
      error: String(error?.message || error),
      code: error?.code || null,
    });
  } finally {
    setImmediate(() => process.exit(0));
  }
});
