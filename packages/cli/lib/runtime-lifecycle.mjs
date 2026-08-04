/** Explicit graphd / worker lifecycle ownership for ADR-015 (#69 topology, #70 lifecycle).
 *
 * Single-writer durable store boundaries (canonical vs derived):
 * - graph.lbdb (canonical product graph): graphd only — GraphEngine in server.mjs
 * - context/retrieval.lbdb (derived hybrid index): graphd RetrievalStore only
 * - cocoindex state.db (observation memoization): CocoIndex worker only; never Ladybug
 * - Observation batches: CocoIndex worker → graphd IPC only; never direct graph writes
 *
 * Lifecycle state machine (bounded topology default-on):
 * - cold: no graphd lock/socket for this repository
 * - active: graphd serving IPC for the current CLI command
 * - released: graphd stopped after a completed non-live mutation command
 *
 * Read-only commands (status, doctor, query) may keep graphd resident until the next
 * mutation or explicit shutdown. Mutation commands release graphd on success so idle
 * RSS and descendant counts return toward ADR-015 gates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { GRAPH_CAPABILITIES, GRAPH_PROTOCOL_VERSION } from './graph-runtime/constants.mjs';
import { stopIncompatibleServer, daemonCompatibility, exchange, recoverWedgedGraphd } from './graph-runtime/client.mjs';
import {
  graphSocketPath,
  parseDaemonLock,
  processIsRunning,
  runtimePaths,
} from './graph-runtime/util.mjs';
import { CLI_VERSION } from './runtime-identity.mjs';
import { runtimeBudgetFromEnvironment } from './runtime-budget.mjs';

export const RUNTIME_IDENTITY_SCHEMA = 'lamina.runtime-identity/v1';
export const SUPPORTED_LAYOUT_VERSION = 1;
export const MAX_INSTALL_FOOTPRINT_BYTES = 750 * 1024 * 1024;
const RUNTIME_IDENTITY_FILE = 'runtime-identity.json';
const LEGACY_RUNS_DIR = 'runs';
const RUNTIME_ORPHAN_MARKERS = [
  'cocoindex-worker',
  'retrieval_worker.py',
  'graph-runtime/server.mjs',
  '--graphd',
];

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function runtimeIdentityPath(cwd = process.cwd()) {
  return path.join(runtimePaths(cwd).runtime_dir, RUNTIME_IDENTITY_FILE);
}

export function readRuntimeIdentity(cwd = process.cwd()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(runtimeIdentityPath(cwd), 'utf8'));
    if (parsed?.schema !== RUNTIME_IDENTITY_SCHEMA) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function detectLegacyMarkers(runtimeDir) {
  const markers = [];
  const runs = path.join(runtimeDir, LEGACY_RUNS_DIR);
  if (fs.existsSync(runs)) {
    markers.push({
      kind: 'legacy_runs_directory',
      path: runs,
      message: 'Legacy run storage under .git/lamina/runs is incompatible with the transactional runtime.',
    });
  }
  return markers;
}

export function invalidateDerivedStores(paths) {
  const removed = [];
  const removePath = (target) => {
    if (!fs.existsSync(target)) return;
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(target);
  };
  removePath(paths.context);
  removePath(path.join(paths.cocoindex, 'observation-generation-state.json'));
  removePath(path.join(paths.cocoindex, 'target-generation'));
  return { removed, canonical_graph_preserved: fs.existsSync(paths.database) };
}

export function applyRepositoryUpgrade(cwd = process.cwd()) {
  const paths = runtimePaths(cwd);
  const invalidated = invalidateDerivedStores(paths);
  writeRuntimeIdentity(cwd);
  return { upgraded: true, ...invalidated };
}

export function evaluateRepositoryCutover(cwd = process.cwd()) {
  const paths = runtimePaths(cwd);
  const markers = detectLegacyMarkers(paths.runtime_dir);
  if (markers.length) {
    return {
      status: 'incompatible',
      reason: 'legacy_runtime_markers',
      markers,
      guidance: [
        'Export canonical graph truth with lamina graph backup --output backup.json before any reset.',
        'Remove only incompatible legacy directories after backup; never delete graph.lbdb silently.',
        'Reinstall the current standalone CLI from GitHub Releases if runtime assets are stale.',
      ],
    };
  }
  const identity = readRuntimeIdentity(cwd);
  const graphExists = fs.existsSync(paths.database);
  if (!identity && !graphExists) return { status: 'absent' };
  if (!identity) {
    return {
      status: 'upgrade',
      reason: graphExists ? 'missing_runtime_identity' : 'fresh_runtime_layout',
      preserve_canonical_graph: graphExists,
    };
  }
  const layoutVersion = Number(identity.layout_version || 1);
  if (!Number.isInteger(layoutVersion) || layoutVersion < 1) {
    return { status: 'incompatible', reason: 'invalid_layout_version', identity };
  }
  if (layoutVersion > SUPPORTED_LAYOUT_VERSION) {
    return {
      status: 'incompatible',
      reason: 'future_layout_version',
      identity,
      supported_layout_version: SUPPORTED_LAYOUT_VERSION,
    };
  }
  if (identity.cli_version !== CLI_VERSION || identity.protocol_version !== GRAPH_PROTOCOL_VERSION) {
    return {
      status: 'upgrade',
      reason: 'runtime_identity_stale',
      identity,
      preserve_canonical_graph: graphExists,
    };
  }
  return { status: 'compatible', identity };
}

export function writeRuntimeIdentity(cwd = process.cwd()) {
  const paths = runtimePaths(cwd);
  fs.mkdirSync(paths.runtime_dir, { recursive: true, mode: 0o700 });
  const record = Object.freeze({
    schema: RUNTIME_IDENTITY_SCHEMA,
    layout_version: SUPPORTED_LAYOUT_VERSION,
    cli_version: CLI_VERSION,
    protocol_version: GRAPH_PROTOCOL_VERSION,
    capabilities: [...GRAPH_CAPABILITIES],
    updated_at: new Date().toISOString(),
  });
  fs.writeFileSync(runtimeIdentityPath(cwd), stableJson(record), { mode: 0o600 });
  return record;
}

export function assertCompatibleRuntimeIdentity(cwd = process.cwd()) {
  const paths = runtimePaths(cwd);
  const markers = detectLegacyMarkers(paths.runtime_dir);
  if (markers.length) {
    const error = new Error(markers[0].message);
    error.code = 'LAMINA_REPOSITORY_CUTOVER_INCOMPATIBLE';
    error.details = {
      markers,
      guidance: [
        'Export canonical graph truth with lamina graph backup --output backup.json before any reset.',
        'Remove only incompatible legacy directories after backup; never delete graph.lbdb silently.',
      ],
    };
    throw error;
  }
  const evaluation = evaluateRepositoryCutover(cwd);
  if (evaluation.status === 'incompatible') {
    const error = new Error(
      evaluation.reason === 'future_layout_version'
        ? 'Incompatible .git/lamina layout version. Export graph backup, then reinstall or migrate.'
        : 'Incompatible .git/lamina runtime state. Export graph backup before reset.',
    );
    error.code = evaluation.reason === 'future_layout_version'
      ? 'LAMINA_RUNTIME_INCOMPATIBLE'
      : 'LAMINA_REPOSITORY_CUTOVER_INCOMPATIBLE';
    error.details = evaluation;
    throw error;
  }
  if (evaluation.status === 'upgrade') {
    return applyRepositoryUpgrade(cwd);
  }
  if (!fs.existsSync(paths.database)) return { compatible: true, reason: 'greenfield' };
  const identity = readRuntimeIdentity(cwd);
  if (!identity) return { compatible: true, reason: 'legacy_unmarked' };
  return { compatible: true, identity };
}

/** Stop inherited graphd before observation when overlap would exhaust the task budget. */
export async function releaseGraphdBeforeObservation(cwd = process.cwd(), { force = false } = {}) {
  if (!runtimeBudgetFromEnvironment()) return { released: false, reason: 'unbounded' };
  const paths = runtimePaths(cwd);
  let lock = null;
  try { lock = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8')); } catch {}
  if (!processIsRunning(lock?.pid)) return { released: false, reason: 'absent' };
  if (!force) {
    try {
      const token = fs.readFileSync(paths.token, 'utf8').trim();
      const response = await exchange(graphSocketPath(paths), {
        id: 'pre-observation-ping',
        method: 'ping',
        cwd,
        auth: token,
      }, 500);
      if (response?.ok && daemonCompatibility(response.result).compatible) {
        return { released: false, reason: 'compatible_daemon' };
      }
    } catch {}
    if (await recoverWedgedGraphd(paths, lock?.pid)) {
      return { released: false, reason: 'recovered_wedge' };
    }
  }
  try {
    await stopIncompatibleServer(paths, lock?.pid);
    return { released: true, reason: force ? 'pre_observation_forced' : 'pre_observation' };
  } catch (error) {
    return {
      released: false,
      reason: 'stop_failed',
      error: { code: error.code || 'LAMINA_INTERNAL', message: error.message },
    };
  }
}

export function shouldReleaseGraphdAfterCommand({
  persistGraphd = false,
  budget = runtimeBudgetFromEnvironment(),
} = {}) {
  if (process.env.LAMINA_RUNTIME_PERSIST_GRAPHD === '1') return false;
  if (!budget || persistGraphd) return false;
  return true;
}

function managedGraphdPid(paths) {
  try {
    const lock = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'));
    return processIsRunning(lock?.pid) ? lock.pid : null;
  } catch {
    return null;
  }
}

async function waitForGraphdRelease(paths, pid, deadlineMs = 5_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const lockPresent = fs.existsSync(paths.lock);
    const socketPresent = fs.existsSync(graphSocketPath(paths));
    const running = pid ? processIsRunning(pid) : false;
    if (!lockPresent && !socketPresent && !running) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !fs.existsSync(paths.lock)
    && !fs.existsSync(graphSocketPath(paths))
    && (!pid || !processIsRunning(pid));
}

/** Release graphd after a completed command under bounded topology. */
export async function releaseGraphdAfterCommand(cwd = process.cwd(), options = {}) {
  if (!shouldReleaseGraphdAfterCommand(options)) {
    return { released: false, reason: options.persistGraphd ? 'persist_graphd' : 'unbounded' };
  }
  const paths = runtimePaths(cwd);
  const pid = managedGraphdPid(paths);
  if (!pid && !fs.existsSync(paths.lock) && !fs.existsSync(graphSocketPath(paths))) {
    return { released: false, reason: 'absent' };
  }
  try {
    await stopIncompatibleServer(paths, pid);
    if (await waitForGraphdRelease(paths, pid)) {
      return { released: true, reason: 'post_command' };
    }
    return {
      released: false,
      reason: 'stop_incomplete',
      error: { code: 'LAMINA_INTERNAL', message: `graphd ${pid || 'unknown'} did not release before sample isolation` },
    };
  } catch (error) {
    const lockPid = managedGraphdPid(paths);
    if (!lockPid) {
      for (const file of [paths.lock, graphSocketPath(paths)]) {
        try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
      }
      return { released: true, reason: 'stale_lock_recovered' };
    }
    return {
      released: false,
      reason: 'stop_failed',
      error: { code: error.code || 'LAMINA_INTERNAL', message: error.message },
    };
  }
}

function readProcessCommand(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
  } catch {
    return '';
  }
}

function readProcessPpid(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    return Number(stat.slice(close + 2).trim().split(/\s+/)[1] || 0);
  } catch {
    return 0;
  }
}

/** Enumerate likely Lamina runtime descendants for orphan checks (Linux only). */
export function listRuntimeDescendantPids(cwd = process.cwd(), { exceptPid = process.pid } = {}) {
  if (process.platform !== 'linux' || !fs.existsSync('/proc')) return [];
  const paths = runtimePaths(cwd);
  let graphdPid = null;
  try {
    const lock = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'));
    if (processIsRunning(lock?.pid)) graphdPid = lock.pid;
  } catch {}
  const root = path.resolve(paths.root);
  const matches = [];
  for (const entry of fs.readdirSync('/proc')) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid <= 1 || pid === exceptPid) continue;
    const command = readProcessCommand(pid);
    if (!command) continue;
    const markerHit = RUNTIME_ORPHAN_MARKERS.some((marker) => command.includes(marker));
    const cwdLink = (() => {
      try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { return ''; }
    })();
    const inRepo = cwdLink && (cwdLink === root || cwdLink.startsWith(`${root}${path.sep}`));
    const childOfGraphd = graphdPid && readProcessPpid(pid) === graphdPid;
    if (markerHit && (inRepo || childOfGraphd)) matches.push(pid);
  }
  return [...new Set(matches)].sort((left, right) => left - right);
}

export async function assertNoRuntimeOrphans(cwd = process.cwd(), options = {}) {
  const remaining = listRuntimeDescendantPids(cwd, options)
    .filter((pid) => processIsRunning(pid));
  if (!remaining.length) return { ok: true, remaining: [] };
  const error = new Error('Lamina runtime descendants remain after command cleanup.');
  error.code = 'LAMINA_RUNTIME_ORPHAN';
  error.details = {
    remaining: remaining.map((pid) => ({ pid, command: readProcessCommand(pid) })),
  };
  throw error;
}

export async function forceStopRuntimeOrphans(cwd = process.cwd(), options = {}) {
  const paths = runtimePaths(cwd);
  const graphdPid = managedGraphdPid(paths);
  const preset = Array.isArray(options.presetPids) ? options.presetPids : [];
  const pids = [...new Set([
    ...preset,
    ...listRuntimeDescendantPids(cwd, options),
  ])].filter((pid) => processIsRunning(pid) && pid !== graphdPid);
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!pids.some((pid) => processIsRunning(pid))) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  for (const pid of pids) {
    if (processIsRunning(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  }
  return { stopped: pids };
}

let activeCancellation = null;

export function installCommandCancellation({ onCancel, label = 'command' } = {}) {
  if (activeCancellation) return activeCancellation;
  let cancelled = false;
  const cleanups = [];
  const handler = (signal) => {
    if (cancelled) return;
    cancelled = true;
    for (const cleanup of cleanups.splice(0)) {
      try { cleanup(signal); } catch {}
    }
    try { onCancel?.(signal); } catch {}
  };
  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);
  activeCancellation = {
    label,
    onCleanup(fn) {
      if (typeof fn === 'function') cleanups.push(fn);
      return this;
    },
    cancel: () => handler('SIGINT'),
    dispose() {
      process.removeListener('SIGINT', handler);
      process.removeListener('SIGTERM', handler);
      if (activeCancellation === this) activeCancellation = null;
    },
    get cancelled() { return cancelled; },
  };
  return activeCancellation;
}

export function disposeCommandCancellation(token) {
  token?.dispose?.();
}

export async function finalizeRuntimeCommand(cwd, {
  persistGraphd = false,
  cleanupOrphans = true,
} = {}) {
  const results = {};
  const paths = runtimePaths(cwd);
  const graphdPid = managedGraphdPid(paths);
  const presetOrphans = cleanupOrphans && process.platform === 'linux'
    ? listRuntimeDescendantPids(cwd)
      .filter((pid) => processIsRunning(pid) && pid !== graphdPid)
    : [];
  results.graphd = await releaseGraphdAfterCommand(cwd, { persistGraphd });
  if (cleanupOrphans && process.platform === 'linux') {
    results.orphans = await forceStopRuntimeOrphans(cwd, { presetPids: presetOrphans });
  }
  if (cleanupOrphans && process.platform === 'linux') {
    results.orphan_check = await assertNoRuntimeOrphans(cwd).catch((error) => ({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details || {} },
    }));
  }
  return results;
}

export async function runWithRuntimeLifecycle(cwd, fn, {
  live = false,
  persistGraphd = false,
  mutation = false,
} = {}) {
  if (mutation) assertCompatibleRuntimeIdentity(cwd);
  let cancellation = null;
  if (live) {
    cancellation = installCommandCancellation({
      label: 'live_runtime',
      onCancel: () => {},
    });
  }
  try {
    const result = await fn({ cancellation });
    if (mutation && !live) writeRuntimeIdentity(cwd);
    return result;
  } finally {
    disposeCommandCancellation(cancellation);
    await finalizeRuntimeCommand(cwd, { persistGraphd });
  }
}
