/**
 * Lamina run directory layout helpers for LaminaBench gates and prompts.
 * Canonical layout: .lamina/runs/<run_id>/{run.yaml, implement.md, report.md, fix.md, ...}
 */
import fs from 'node:fs';
import path from 'node:path';

export const LAMINA_RUN_LAYOUT_HINT = [
  'Follow lamina-orchestrator artifacts.md:',
  '- Create `.lamina/runs/<run_id>/run.yaml` (status: designing → ready_to_build for design; verifying → complete for verify).',
  '- Write `implement.md`, `report.md`, and `fix.md` inside that same run directory.',
  '- `ready_to_build` is a status field in run.yaml — never create a `.lamina/ready_to_build/` folder.',
].join('\n');

export function listRunDirs(workspace) {
  const runsRoot = path.join(workspace, '.lamina/runs');
  if (!fs.existsSync(runsRoot)) return [];
  return fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsRoot, entry.name));
}

export function findRunRecords(workspace) {
  const records = [];
  for (const runDir of listRunDirs(workspace)) {
    const runYaml = path.join(runDir, 'run.yaml');
    if (!fs.existsSync(runYaml)) continue;
    let mtime = 0;
    try {
      mtime = fs.statSync(runYaml).mtimeMs;
    } catch {
      /* skip */
    }
    records.push({
      runDir,
      runId: path.basename(runDir),
      runYaml,
      implement: path.join(runDir, 'implement.md'),
      report: path.join(runDir, 'report.md'),
      fix: path.join(runDir, 'fix.md'),
      mtime,
    });
  }
  return records.sort((a, b) => a.mtime - b.mtime);
}

export function latestRunRecord(workspace) {
  const records = findRunRecords(workspace);
  return records.length ? records.at(-1) : null;
}

export function fileNonTrivial(filePath, minChars = 50) {
  if (!fs.existsSync(filePath)) return false;
  return fs.readFileSync(filePath, 'utf8').trim().length >= minChars;
}

export function runYamlHasStatus(runYamlPath, status) {
  if (!fs.existsSync(runYamlPath)) return false;
  const text = fs.readFileSync(runYamlPath, 'utf8');
  return new RegExp(`status:\\s*${status}`, 'i').test(text);
}

export function hasLegacyReadyToBuildDir(workspace) {
  return fs.existsSync(path.join(workspace, '.lamina/ready_to_build'));
}

export function checkDesignRunLayout(workspace) {
  if (hasLegacyReadyToBuildDir(workspace)) {
    return {
      ok: false,
      reason:
        'invalid layout: `.lamina/ready_to_build/` directory — use `.lamina/runs/<run_id>/` with status: ready_to_build in run.yaml',
    };
  }

  const run = latestRunRecord(workspace);
  if (!run) {
    return { ok: false, reason: 'missing `.lamina/runs/<run_id>/run.yaml`' };
  }

  if (!fileNonTrivial(run.runYaml)) {
    return { ok: false, reason: 'run.yaml missing or too short under `.lamina/runs/<run_id>/`' };
  }

  if (!fileNonTrivial(run.implement)) {
    return {
      ok: false,
      reason: 'implement.md missing under `.lamina/runs/<run_id>/` (not at repo root or ready_to_build/)',
    };
  }

  if (!runYamlHasStatus(run.runYaml, 'ready_to_build')) {
    return { ok: false, reason: 'run.yaml missing `status: ready_to_build`' };
  }

  if (!fileNonTrivial(run.report)) {
    return { ok: false, reason: 'report.md missing under `.lamina/runs/<run_id>/`' };
  }

  return { ok: true, run };
}

export function checkVerifyRunLayout(workspace) {
  if (hasLegacyReadyToBuildDir(workspace)) {
    return {
      ok: false,
      reason: 'invalid layout: `.lamina/ready_to_build/` — verify artifacts belong under `.lamina/runs/<run_id>/`',
    };
  }

  const run = latestRunRecord(workspace);
  if (!run) {
    return { ok: false, reason: 'missing `.lamina/runs/<run_id>/run.yaml` for verify output' };
  }

  if (!fileNonTrivial(run.report)) {
    return { ok: false, reason: 'report.md missing under `.lamina/runs/<run_id>/`' };
  }

  const runText = fs.readFileSync(run.runYaml, 'utf8');
  const hasFindings = /findings\s*:/i.test(runText) && !/findings\s*:\s*\[\s*\]/i.test(runText);
  const hasFix = fileNonTrivial(run.fix);

  if (!hasFindings && !hasFix) {
    return {
      ok: false,
      reason: 'verify run missing findings[] in run.yaml and fix.md under `.lamina/runs/<run_id>/`',
    };
  }

  return { ok: true, run };
}
