/**
 * Mid-phase filesystem gates for LaminaBench workflows.
 */
import path from 'node:path';
import { listImplementationFiles } from './artifact-contract.mjs';
import {
  checkDesignRunLayout,
  checkVerifyRunLayout,
  fileNonTrivial,
  latestRunRecord,
} from './lamina-run-layout.mjs';

/** Categories that must ship a client UI surface, not API-only. */
const UI_REQUIRED_CATEGORIES = new Set(['greenfield', 'workflow_edge', 'resilience']);

const UI_EXT = /\.(tsx|jsx|vue|svelte|swift|kt|html)$/i;
const UI_PATH =
  /(^|\/)(screens?|components?|pages?|views?|ui|mobile|frontend|client|app)(\/|$)/i;

export function hasUiSurface(files) {
  return files.some((rel) => {
    if (UI_EXT.test(rel)) return true;
    if (UI_PATH.test(rel) && /\.(ts|js|tsx|jsx|vue|svelte)$/i.test(rel)) return true;
    return false;
  });
}

export function checkImplementGate(workspace, task = {}) {
  const files = listImplementationFiles(workspace);
  if (!files.length) {
    return { ok: false, reason: 'no implementation source files on disk' };
  }

  const category = task.category || '';
  if (UI_REQUIRED_CATEGORIES.has(category) && !hasUiSurface(files)) {
    return {
      ok: false,
      reason:
        `API/backend-only implementation rejected for ${category} tasks — ` +
        'include client UI (e.g. .tsx/.jsx screens or components/, app/, mobile/)',
    };
  }

  return { ok: true };
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
      return fileNonTrivial(path.join(workspace, '.lamina/business-context.md'), 200)
        ? { ok: true }
        : { ok: false, reason: '.lamina/business-context.md missing or too short (<200 chars)' };

    case 'treatment_design':
      if (task.workflow === 'audit') {
        return checkVerifyRunLayout(workspace);
      }
      return checkDesignRunLayout(workspace);

    case 'treatment_verify_brownfield':
      return checkVerifyRunLayout(workspace);

    case 'implement':
      return checkImplementGate(workspace, task);

    case 'treatment_verify_post_build': {
      const layout = checkVerifyRunLayout(workspace);
      if (!layout.ok) return layout;
      const run = latestRunRecord(workspace);
      if (run && fileNonTrivial(run.fix)) return { ok: true };
      return {
        ok: false,
        reason: 'post-build verify missing fix.md under `.lamina/runs/<run_id>/`',
      };
    }

    case 'treatment_fix':
      return checkImplementGate(workspace, task);

    default:
      return { ok: false, reason: `unknown phase gate: ${gate}` };
  }
}

export const GATE_RETRY_PROMPT =
  'Required deliverables are still missing on disk. Write the files to this workspace now. Do not describe what you would do — create the actual files. For Lamina design/verify, use `.lamina/runs/<run_id>/` per artifacts.md — never `.lamina/ready_to_build/`. For greenfield/workflow/resilience tasks, include client UI source — not API-only.';
