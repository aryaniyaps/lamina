/**
 * Mid-phase filesystem gates for LaminaBench workflows.
 */
import fs from 'node:fs';
import path from 'node:path';
import { listImplementationFiles } from './artifact-contract.mjs';

function findFileRecursive(dir, name, limit = 16) {
  const hits = [];
  if (!fs.existsSync(dir)) return hits;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) hits.push(...findFileRecursive(abs, name, limit));
    else if (entry.name.toLowerCase() === name.toLowerCase()) hits.push(abs);
    if (hits.length >= limit) break;
  }
  return hits;
}

function fileNonTrivial(filePath, minChars = 50) {
  if (!fs.existsSync(filePath)) return false;
  return fs.readFileSync(filePath, 'utf8').trim().length >= minChars;
}

/**
 * @param {'control_plan'|'treatment_init'|'treatment_design'|'treatment_verify_brownfield'|'implement'|'treatment_verify_post_build'|'treatment_fix'} gate
 */
export function checkPhaseGate(workspace, gate, task = {}) {
  switch (gate) {
    case 'control_plan':
      return fileNonTrivial(path.join(workspace, 'bench-plan.md'))
        ? { ok: true }
        : { ok: false, reason: 'bench-plan.md missing or too short' };

    case 'treatment_init':
      return fileNonTrivial(path.join(workspace, '.lamina/business-context.md'))
        ? { ok: true }
        : { ok: false, reason: '.lamina/business-context.md missing or too short' };

    case 'treatment_design': {
      if (task.workflow === 'audit') {
        const lamina = path.join(workspace, '.lamina');
        const reports = [
          ...findFileRecursive(lamina, 'verify-report.md'),
          ...findFileRecursive(lamina, 'report.md'),
        ];
        return reports.length
          ? { ok: true }
          : { ok: false, reason: 'audit verify report missing under .lamina/' };
      }
      const impl = findFileRecursive(path.join(workspace, '.lamina'), 'implement.md');
      return impl.length
        ? { ok: true }
        : { ok: false, reason: 'implement.md missing under .lamina/' };
    }

    case 'treatment_verify_brownfield': {
      const lamina = path.join(workspace, '.lamina');
      const reports = [
        ...findFileRecursive(lamina, 'verify-report.md'),
        ...findFileRecursive(lamina, 'report.md'),
      ];
      return reports.length
        ? { ok: true }
        : { ok: false, reason: 'brownfield verify report missing under .lamina/' };
    }

    case 'implement':
      return listImplementationFiles(workspace).length > 0
        ? { ok: true }
        : { ok: false, reason: 'no implementation source files on disk' };

    case 'treatment_verify_post_build': {
      const lamina = path.join(workspace, '.lamina');
      const reports = [
        ...findFileRecursive(lamina, 'verify-report.md'),
        ...findFileRecursive(lamina, 'report.md'),
      ];
      return reports.length
        ? { ok: true }
        : { ok: false, reason: 'post-build verify report missing under .lamina/' };
    }

    case 'treatment_fix':
      return listImplementationFiles(workspace).length > 0
        ? { ok: true }
        : { ok: false, reason: 'no implementation source after fix phase' };

    default:
      return { ok: true };
  }
}

export const GATE_RETRY_PROMPT =
  'Required deliverables are still missing on disk. Write the files to this workspace now. Do not describe what you would do — create the actual files.';
