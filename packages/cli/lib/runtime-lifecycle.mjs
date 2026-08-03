/** Explicit graphd / worker lifecycle ownership for ADR-015 bounded topology (#69).
 *
 * Single-writer durable store boundaries (canonical vs derived):
 * - graph.lbdb (canonical product graph): graphd only — GraphEngine in server.mjs
 * - context/retrieval.lbdb (derived hybrid index): graphd RetrievalStore only
 * - cocoindex state.db (observation memoization): CocoIndex worker only; never Ladybug
 * - Observation batches: CocoIndex worker → graphd IPC only; never direct graph writes
 *
 * Lifecycle hooks coordinate descendant fan-out under ADR-014 pids.max without
 * raising safe-runner limits.
 */

import { stopIncompatibleServer } from './graph-runtime/client.mjs';
import { runtimePaths } from './graph-runtime/util.mjs';
import { runtimeBudgetFromEnvironment } from './runtime-budget.mjs';

/** Stop any inherited graphd tree before observation so seed + observe do not overlap. */
export async function releaseGraphdBeforeObservation(cwd = process.cwd()) {
  if (!runtimeBudgetFromEnvironment()) return;
  await stopIncompatibleServer(runtimePaths(cwd));
}
