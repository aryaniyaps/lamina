import fs from 'node:fs';

export const ATTRIBUTION_SCHEMA = 'lamina.runtime-baseline-attribution/v1';

export const LIFECYCLE_PHASES = Object.freeze([
  'doctor',
  'status',
  'startup',
  'observation',
  'retrieval_readiness',
  'preparation',
  'noop_sync',
  'incremental_change',
  'rebuild',
  'idle',
  'shutdown',
  'cleanup',
]);

export const SCENARIO_PHASE_IDS = Object.freeze({
  footprint: [],
  'doctor-status-startup': ['doctor', 'status', 'startup'],
  'initial-observation': ['startup', 'observation'],
  'initial-retrieval-readiness': ['observation', 'retrieval_readiness'],
  'first-useful-preparation': ['observation', 'retrieval_readiness', 'preparation'],
  'warm-preparation': ['preparation'],
  'noop-synchronization': ['noop_sync'],
  'one-file-change': ['incremental_change', 'retrieval_readiness'],
  'multi-file-change': ['incremental_change', 'retrieval_readiness'],
  'full-derived-state-rebuild': ['rebuild', 'retrieval_readiness'],
  'post-command-idle-rss': ['idle'],
  'cancellation-shutdown-cleanup': ['observation', 'shutdown', 'cleanup'],
});

const ROLE_ALIASES = Object.freeze({
  graphd: 'graphd_startup',
  asset_extraction_worker: 'cocoindex_worker',
  observation_worker: 'cocoindex_worker',
  retrieval_worker: 'cocoindex_worker',
  onnx_embedder: 'onnx_embedder',
  cli: 'cli',
});

export function scenarioPhaseIds(scenario) {
  const phases = SCENARIO_PHASE_IDS[scenario];
  if (!phases) throw new Error(`unknown runtime baseline scenario: ${scenario}`);
  return phases;
}

export function classifyProcessRole(command = '') {
  const normalized = String(command).toLowerCase();
  if (normalized.includes('server.mjs') || /\bgraphd\b/.test(normalized)) return 'graphd';
  if (normalized.includes('extract-assets')) return 'asset_extraction_worker';
  if (normalized.includes('retrieval') && (normalized.includes('cocoindex') || normalized.includes('retrieval_worker'))) {
    return 'retrieval_worker';
  }
  if (normalized.includes('cocoindex') || normalized.includes('cocoindex_app')) return 'observation_worker';
  if (normalized.includes('onnx') || normalized.includes('embedder')) return 'onnx_embedder';
  if (normalized.includes('lamina.mjs') || /\blamina\b/.test(normalized)) return 'cli';
  return 'other';
}

function emptySubprocessLaunches() {
  return {
    graphd: 0,
    cocoindex_worker: 0,
    onnx_embedder: 0,
    cli: 0,
    other: 0,
  };
}

function mergeRolePeak(target, role, record) {
  const bucket = target[role] || (target[role] = { peak_threads: 0, peak_rss_bytes: 0, processes: 0 });
  bucket.peak_threads = Math.max(bucket.peak_threads, record.threads || 0);
  bucket.peak_rss_bytes = Math.max(bucket.peak_rss_bytes, record.rss_bytes || 0);
  bucket.processes += 1;
}

function readDescendantRecords(rootPid) {
  if (process.platform !== 'linux') return [];
  let records;
  try {
    records = fs.readdirSync('/proc')
      .filter((name) => /^\d+$/.test(name))
      .map((name) => {
        const pid = Number(name);
        try {
          const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
          const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
          const close = stat.lastIndexOf(')');
          const fields = stat.slice(close + 2).trim().split(/\s+/);
          const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`).toString('utf8').split('\0').filter(Boolean).join(' ');
          return {
            pid,
            ppid: Number(fields[1]),
            threads: Number(status.match(/^Threads:\s+(\d+)$/m)?.[1] || 0),
            rss_bytes: Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1] || 0) * 1024,
            command: cmdline.slice(0, 1_000),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
  const byParent = new Map();
  for (const record of records) {
    if (!byParent.has(record.ppid)) byParent.set(record.ppid, []);
    byParent.get(record.ppid).push(record);
  }
  const found = [];
  const queue = [rootPid];
  const seen = new Set(queue);
  while (queue.length) {
    const parent = queue.shift();
    for (const child of byParent.get(parent) || []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      found.push(child);
      queue.push(child.pid);
    }
  }
  return found;
}

export function sampleDescendantPeaks(phaseId) {
  const byRole = {};
  for (const record of readDescendantRecords(process.pid)) {
    if (!record?.command) continue;
    mergeRolePeak(byRole, classifyProcessRole(record.command), record);
  }
  return { phase_id: phaseId, roles: byRole };
}

export function createPhaseTracker(scenario) {
  const phaseTimeNs = new Array(LIFECYCLE_PHASES.length).fill(null);
  const descendantPeaksByPhase = {};
  const subprocessLaunches = emptySubprocessLaunches();
  let activePhase = null;
  let phaseStarted = null;

  const finishPhase = () => {
    if (!activePhase || phaseStarted === null) return;
    const index = LIFECYCLE_PHASES.indexOf(activePhase);
    if (index >= 0) phaseTimeNs[index] = Number(process.hrtime.bigint() - phaseStarted);
    const sample = sampleDescendantPeaks(activePhase);
    if (Object.keys(sample.roles).length) descendantPeaksByPhase[activePhase] = sample.roles;
    activePhase = null;
    phaseStarted = null;
  };

  return {
    begin(phaseId) {
      finishPhase();
      if (!LIFECYCLE_PHASES.includes(phaseId)) throw new Error(`unknown lifecycle phase: ${phaseId}`);
      activePhase = phaseId;
      phaseStarted = process.hrtime.bigint();
    },
    end: finishPhase,
    recordSubprocessLaunch(role) {
      const key = ROLE_ALIASES[role] || role;
      if (!(key in subprocessLaunches)) subprocessLaunches.other += 1;
      else subprocessLaunches[key] += 1;
    },
    recordCliLaunch() {
      this.recordSubprocessLaunch('cli');
    },
    mergeProductAttribution(attribution = {}) {
      if (!attribution || typeof attribution !== 'object') return;
      for (const [key, value] of Object.entries(attribution.subprocess_launches || {})) {
        if (Number.isInteger(value) && value > 0) {
          const normalized = ROLE_ALIASES[key] || key;
          if (normalized in subprocessLaunches) subprocessLaunches[normalized] += value;
          else subprocessLaunches.other += value;
        }
      }
    },
    snapshot() {
      finishPhase();
      return {
        phase_order: LIFECYCLE_PHASES,
        phase_ids: scenarioPhaseIds(scenario),
        phase_time_ns: phaseTimeNs,
        subprocess_launches: subprocessLaunches,
        descendant_peaks_by_phase: descendantPeaksByPhase,
      };
    },
  };
}

export function compactProductAttribution(value) {
  if (!value?.attribution || typeof value.attribution !== 'object') return null;
  const attribution = value.attribution;
  return {
    backend: attribution.backend || value.backend || null,
    mode: attribution.mode || value.mode || null,
    subprocess_launches: attribution.subprocess_launches || null,
    worker_attempts: attribution.worker_attempts ?? null,
    graphd_pid: attribution.graphd_pid ?? null,
    graphd_threads: attribution.graphd_threads ?? null,
    observation_fan_out: attribution.observation_fan_out ?? value.expected ?? null,
    ipc_round_trips: attribution.ipc_round_trips ?? null,
    db_checkpoints: attribution.db_checkpoints ?? null,
  };
}
