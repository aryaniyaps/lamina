/**
 * Shared index.jsonl helpers for LaminaBench run + score pipelines.
 *
 * Resume policy (cost-safe):
 * - Skip a job only when it succeeded with a matching job_fingerprint.
 * - Fingerprint covers results_contract_version + task brief + fixture + agent/model.
 * - Harness script tweaks that do not bump results_contract_version do NOT force re-runs.
 * - Failed / invalid / fingerprint-mismatched jobs are re-run.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS_RAW = path.join(ROOT, 'benchmarks/results/raw');

export function jobKey(entry) {
  return `${entry.task_id}:${entry.arm}:run${entry.run}`;
}

export function getHarnessVersion() {
  try {
    const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
    return String(release.harness_version || release.version || '0');
  } catch {
    return '0';
  }
}

/** Bump in release.yaml only when prior successful results must be invalidated. */
export function getResultsContractVersion() {
  try {
    const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
    return String(release.results_contract_version || release.harness_version || release.version || '0');
  } catch {
    return '0';
  }
}

function readTaskFile(task, kind) {
  if (kind === 'description' && task.description != null) return String(task.description);
  if (kind === 'context' && task.context != null) return String(task.context);
  const rel =
    kind === 'description'
      ? task._paths?.description || `benchmarks/tasks/${task.id}/description.md`
      : task._paths?.context || `benchmarks/tasks/${task.id}/context.md`;
  const abs = path.join(ROOT, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
}

function fixtureFingerprint(fixtureName) {
  if (!fixtureName) return 'none';
  const manifestPath = path.join(ROOT, 'benchmarks/fixtures/manifests', `${fixtureName}.json`);
  if (!fs.existsSync(manifestPath)) return `missing:${fixtureName}`;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ name: fixtureName, layers: manifest.layers || [] }))
    .digest('hex')
    .slice(0, 12);
}

/**
 * Stable fingerprint for resume. Change any input → job must re-run.
 */
export function computeJobFingerprint(task, { arm, run, agent, model, resultsContractVersion }) {
  const payload = {
    results_contract_version: resultsContractVersion || getResultsContractVersion(),
    task_id: task.id,
    arm,
    run,
    agent: agent || '',
    model: model || '',
    category: task.category || '',
    workflow: task.workflow || '',
    prompt: task.prompt || '',
    fixture: task.fixture || null,
    fixture_fp: fixtureFingerprint(task.fixture),
    description: readTaskFile(task, 'description'),
    context: readTaskFile(task, 'context'),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

/** Parse all index rows (may include duplicates). */
export function readIndexRows(resultsDir = RESULTS_RAW) {
  const indexPath = path.join(resultsDir, 'index.jsonl');
  if (!fs.existsSync(indexPath)) return [];
  return fs
    .readFileSync(indexPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** Latest row per job key (by timestamp). */
export function dedupeIndexByJob(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = jobKey(row);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, row);
      continue;
    }
    const prevTs = Date.parse(prev.timestamp || 0) || 0;
    const nextTs = Date.parse(row.timestamp || 0) || 0;
    if (nextTs >= prevTs) map.set(key, row);
  }
  return [...map.values()];
}

/** True when a completed job may be scored into the composite. */
export function isScoreableEntry(entry, resultsContractVersion = getResultsContractVersion()) {
  if (!entry) return false;
  if (entry.artifact_valid !== true) return false;
  if (entry.status !== 'success') return false;
  if (entry.failed_gate) return false;
  // Prefer results_contract_version; fall back to harness_version for older rows.
  const rowContract = entry.results_contract_version || entry.harness_version;
  if (resultsContractVersion && rowContract !== resultsContractVersion) return false;
  return true;
}

/** True when resume should skip this job (success + matching fingerprint). */
export function isCompleteForResume(entry, expectedFingerprint) {
  if (!entry) return false;
  if (entry.artifact_valid !== true) return false;
  if (entry.status !== 'success') return false;
  if (entry.failed_gate) return false;
  if (!expectedFingerprint || !entry.job_fingerprint) return false;
  return entry.job_fingerprint === expectedFingerprint;
}

export function loadScoreableIndex(
  resultsDir = RESULTS_RAW,
  resultsContractVersion = getResultsContractVersion()
) {
  return dedupeIndexByJob(readIndexRows(resultsDir)).filter((e) =>
    isScoreableEntry(e, resultsContractVersion)
  );
}

/**
 * Build the set of job keys that should be skipped.
 * @param {object} opts
 * @param {object[]} opts.jobs - planned jobs with { task, run, arm }
 * @param {string} opts.agent
 * @param {string} opts.model
 * @param {string} [opts.resultsContractVersion]
 * @param {string} [opts.resultsDir]
 * @param {Set<string>} [opts.forceKeys] - job keys that must re-run
 */
export function loadCompletedJobKeys({
  jobs,
  agent,
  model,
  resultsContractVersion = getResultsContractVersion(),
  resultsDir = RESULTS_RAW,
  forceKeys = new Set(),
} = {}) {
  const byKey = new Map();
  for (const row of dedupeIndexByJob(readIndexRows(resultsDir))) {
    byKey.set(jobKey(row), row);
  }

  const completed = new Set();
  for (const job of jobs || []) {
    const key = `${job.task.id}:${job.arm}:run${job.run}`;
    if (forceKeys.has(key) || forceKeys.has(job.task.id)) continue;
    const fp = computeJobFingerprint(job.task, {
      arm: job.arm,
      run: job.run,
      agent,
      model,
      resultsContractVersion,
    });
    const row = byKey.get(key);
    if (isCompleteForResume(row, fp)) completed.add(key);
  }
  return completed;
}

/**
 * Upsert one entry into index.jsonl (rewrite file, latest per job key wins).
 */
export function upsertIndexEntry(entry, resultsDir = RESULTS_RAW) {
  const indexPath = path.join(resultsDir, 'index.jsonl');
  fs.mkdirSync(resultsDir, { recursive: true });
  const rows = readIndexRows(resultsDir);
  const map = new Map();
  for (const row of rows) map.set(jobKey(row), row);
  map.set(jobKey(entry), entry);
  const out = [...map.values()]
    .sort((a, b) => jobKey(a).localeCompare(jobKey(b)))
    .map((r) => JSON.stringify(r))
    .join('\n');
  fs.writeFileSync(indexPath, out ? out + '\n' : '');
}
