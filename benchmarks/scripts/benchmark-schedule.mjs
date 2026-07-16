import { createHash } from 'node:crypto';

/** Deterministic blocked schedule with near-exact arm-order balance. */
export function scheduledPairs(taskIds, runs, seed) {
  const schedule = [];
  const canonicalTasks = [...taskIds].sort();
  const armFlip =
    parseInt(createHash('sha256').update(`${seed}:arm-order`).digest('hex').slice(0, 2), 16) % 2;
  for (let run = 1; run <= runs; run++) {
    const orderedTasks = [...taskIds].sort((a, b) => {
      const key = (id) => createHash('sha256').update(`${seed}:task:${run}:${id}`).digest('hex');
      return key(a).localeCompare(key(b));
    });
    for (const taskId of orderedTasks) {
      const treatmentFirst =
        (canonicalTasks.indexOf(taskId) + run + armFlip) % 2 === 0;
      const arms = treatmentFirst ? ['treatment', 'control'] : ['control', 'treatment'];
      for (const arm of arms) schedule.push({ run, taskId, harborName: `${taskId}-${arm}` });
    }
  }
  return schedule;
}
