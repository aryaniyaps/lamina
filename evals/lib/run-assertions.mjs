/**
 * Eval-only helpers for grading run.json artifacts (not shared with benchmarks).
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateRunFields, validateRunJson } from '../../skills/lamina-orchestrator/lib/run.mjs';

export function findRunDirs(workspace) {
  const runsRoot = path.join(workspace, '.lamina/runs');
  if (!fs.existsSync(runsRoot)) return [];
  return fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsRoot, entry.name))
    .sort();
}

export function latestRunDir(workspace) {
  return findRunDirs(workspace).at(-1) ?? null;
}

export function readRunJsonSafe(runPath) {
  try {
    return JSON.parse(fs.readFileSync(runPath, 'utf8'));
  } catch {
    return null;
  }
}

export function latestRunJson(workspace) {
  const dir = latestRunDir(workspace);
  if (!dir) return { dir: null, run: null, runPath: null };
  const runPath = path.join(dir, 'run.json');
  if (!fs.existsSync(runPath)) return { dir, run: null, runPath: null };
  return { dir, run: readRunJsonSafe(runPath), runPath };
}

export function distinctPersonaRefs(run) {
  const refs = new Set();
  for (const finding of run?.persona_findings ?? []) {
    if (finding?.persona_ref) refs.add(finding.persona_ref);
  }
  return [...refs];
}

export function personaFindingErrors(run, rel = 'run.json') {
  return validateRunFields(run, rel).filter(
    (error) => error.includes('persona finding') || error.includes('persona_hypothesis'),
  );
}

export function traceabilityErrors(run, rel = 'run.json') {
  return validateRunFields(run, rel).filter((error) => error.includes('traceability') || error.includes('lacks trace'));
}

export function validateLatestRun(workspace, { requireProofPacket = false } = {}) {
  const { runPath } = latestRunJson(workspace);
  if (!runPath) return { ok: false, errors: ['No run.json found under .lamina/runs/'], runPath: null };
  return { ...validateRunJson(runPath, { requireProofPacket }), runPath };
}
