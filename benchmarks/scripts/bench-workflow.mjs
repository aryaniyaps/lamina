/**
 * LaminaBench agent workflows — Design A (ecological adoption).
 *
 * Documented in benchmarks/METHODOLOGY.md — unequal turns are intentional.
 *
 * Treatment (5 phases): full Lamina loop
 *   init → design|verify(audit) → implement → verify(post-build) → fix
 *
 * Control (2 phases): Plan-mode baseline (no Lamina) — matches hotel demo
 *   plan → implement
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { invokeAgent } from '../../evals/scripts/invoke-agent.mjs';
import { captureImplementationArtifact } from './artifact-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readTaskBrief(task) {
  const desc = fs.readFileSync(path.join(ROOT, task._paths?.description || `benchmarks/tasks/${task.id}/description.md`), 'utf8').trim();
  const ctx = fs.readFileSync(path.join(ROOT, task._paths?.context || `benchmarks/tasks/${task.id}/context.md`), 'utf8').trim();
  return `${desc}\n\n---\n\nContext:\n${ctx}`;
}

function hasBusinessContext(workspace) {
  const p = path.join(workspace, '.lamina/business-context.md');
  if (!fs.existsSync(p)) return false;
  return fs.readFileSync(p, 'utf8').trim().length > 50;
}

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

function findImplementationContract(workspace, workflow) {
  const benchPlan = path.join(workspace, 'bench-plan.md');
  if (fs.existsSync(benchPlan)) return benchPlan;

  if (workflow === 'audit') {
    const lamina = path.join(workspace, '.lamina');
    for (const name of ['verify-report.md', 'report.md']) {
      const hits = findFileRecursive(lamina, name);
      if (hits.length) return hits.sort().at(-1);
    }
    const benchAudit = path.join(workspace, 'bench-audit-report.md');
    if (fs.existsSync(benchAudit)) return benchAudit;
  }

  const lamina = path.join(workspace, '.lamina');
  const impl = findFileRecursive(lamina, 'implement.md');
  if (impl.length) return impl.sort().at(-1);

  for (const name of ['bench-product-brief.md']) {
    const p = path.join(workspace, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findLaminaFixBrief(workspace) {
  const lamina = path.join(workspace, '.lamina');
  const hits = findFileRecursive(lamina, 'fix.md');
  return hits.length ? hits.sort().at(-1) : null;
}

function findLaminaVerifyReport(workspace) {
  const lamina = path.join(workspace, '.lamina');
  const hits = findFileRecursive(lamina, 'verify-report.md');
  if (hits.length) return hits.sort().at(-1);
  const reports = findFileRecursive(lamina, 'report.md');
  return reports.length ? reports.sort().at(-1) : null;
}

function buildControlPlanPrompt(task) {
  const brief = readTaskBrief(task);
  if (task.workflow === 'audit') {
    return `You do NOT have Lamina or special product-design skills. You are in **Plan mode** (planning only — no app source changes).

${task.prompt}

Review the existing product in this workspace (read-only on app source). Write \`bench-plan.md\` with:
- product-behavior gaps (invariants, permissions, state consistency)
- prioritized fixes for a minimal vertical slice
- what the implementation should demonstrate

Do not modify app source. Do not create a \`.lamina/\` directory.`;
  }

  return `You do NOT have Lamina or special product-design skills. You are in **Plan mode** (planning only — no app source yet).

${task.prompt}

Project context:

${brief}

Write \`bench-plan.md\` — an actionable implementation plan covering:
- domain entities and key invariants
- actors and permissions
- one primary workflow to build end-to-end
- edge cases and recovery paths to handle

Keep scope to a minimal vertical slice. Do not write app source. Do not create a \`.lamina/\` directory.`;
}

function buildImplementPrompt(workspace, workflow) {
  const briefPath = findImplementationContract(workspace, workflow);
  const rel = briefPath ? path.relative(workspace, briefPath) : null;
  if (rel) {
    return `You are now in **implementation mode** (app source allowed; do not modify .lamina/ or bench-plan.md).

Read the plan/contract at: ${rel}

Implement a **minimal vertical slice** that demonstrates:
- core domain entities and invariants
- one primary workflow end-to-end
- at least one failure/recovery path from the plan

Use any stack appropriate for the workspace. Keep scope small — prove the plan is buildable, not a production app.`;
  }
  return `You are now in **implementation mode** (app source allowed; do not modify .lamina/).

Using the plan from your previous step, implement a **minimal vertical slice**:
- core domain rules
- one primary workflow
- one edge-case or recovery path

Keep scope small — prove the plan is buildable.`;
}

function buildPostImplementVerifyPrompt(task) {
  if (task.workflow === 'audit') {
    return `/lamina-verify

Implementation fixes are in this workspace. Re-verify the product against .lamina/ contracts and the original audit scope:

${task.prompt}

Walk the implementation (source-level review is OK if no live URL — document assumptions). Write findings to .lamina/ only. Do not modify app source.`;
  }
  return `/lamina-verify

Implementation is complete in this workspace. Verify the built product against the design contract in .lamina/ (run.yaml, implement.md, scenarios, invariants).

Walk the implementation (source-level review is OK if no live URL — document assumptions). Write verify-report with findings[]. .lamina/ only — do not modify app source.`;
}

function buildFixPrompt(workspace) {
  const fixBrief = findLaminaFixBrief(workspace);
  const reportRel = fixBrief
    ? path.relative(workspace, fixBrief)
    : (() => {
        const report = findLaminaVerifyReport(workspace);
        return report ? path.relative(workspace, report) : null;
      })();

  if (reportRel) {
    const isFixBrief = reportRel.endsWith('fix.md');
    return `You are in **fix mode** (app source allowed; do not modify .lamina/).

Read verify ${isFixBrief ? 'fix brief' : 'findings'} at: ${reportRel}

Fix the reported product-behavior issues in the application source. Prioritize high-severity findings. Keep changes scoped to this minimal slice.`;
  }
  return `You are in **fix mode** (app source allowed; do not modify .lamina/).

Fix product-behavior gaps between the implementation and the design contract. Focus on invariants, permissions, and edge-case handling.`;
}

/**
 * Control: Plan mode → implement (ecological baseline, matches hotel demo).
 * @returns {{ artifact: string, steps: object[], phases: number }}
 */
export function runControlWorkflow(agent, workspace, task) {
  const steps = [];

  const p1 = invokeAgent(agent, buildControlPlanPrompt(task), workspace);
  steps.push({ phase: 'plan', prompt_kind: 'control_plan', exitCode: p1.exitCode });

  const p2 = invokeAgent(agent, buildImplementPrompt(workspace, task.workflow), workspace);
  steps.push({ phase: 'implement', prompt_kind: 'control_implement', exitCode: p2.exitCode });

  const artifact = captureImplementationArtifact(workspace, p2.output);
  return { artifact, steps, workflow: 'control_plan_2_phase', phases: 2 };
}

/**
 * Treatment: init → design|verify(audit) → implement → verify → fix
 * @returns {{ artifact: string, steps: object[], phases: number }}
 */
export function runTreatmentWorkflow(agent, workspace, task) {
  const brief = readTaskBrief(task);
  const steps = [];
  const initMode = hasBusinessContext(workspace) ? 'update' : 'establish';

  const p1 = invokeAgent(
    agent,
    `/lamina-init ${initMode}

Use this project brief:

${brief}

Persist business context under .lamina/ only. Do not write app source.`,
    workspace
  );
  steps.push({ phase: 'lamina-init', prompt_kind: 'treatment_init', exitCode: p1.exitCode });

  let p2;
  if (task.workflow === 'audit') {
    p2 = invokeAgent(
      agent,
      `/lamina-verify

${task.prompt}

Use business context in .lamina/. Audit the existing product behavior in this workspace (read-only on app source). Write findings under .lamina/ only.`,
      workspace
    );
    steps.push({ phase: 'lamina-verify-audit', prompt_kind: 'treatment_verify_brownfield', exitCode: p2.exitCode });
  } else {
    p2 = invokeAgent(
      agent,
      `/lamina-design

${task.prompt}

Use business context in .lamina/. Emit run.yaml + implement.md at ready_to_build. Write .lamina/ only — no app source.`,
      workspace
    );
    steps.push({ phase: 'lamina-design', prompt_kind: 'treatment_design', exitCode: p2.exitCode });
  }

  const p3 = invokeAgent(agent, buildImplementPrompt(workspace, task.workflow), workspace);
  steps.push({ phase: 'implement', prompt_kind: 'treatment_implement', exitCode: p3.exitCode });

  const p4 = invokeAgent(agent, buildPostImplementVerifyPrompt(task), workspace);
  steps.push({ phase: 'lamina-verify', prompt_kind: 'treatment_verify_post_build', exitCode: p4.exitCode });

  const p5 = invokeAgent(agent, buildFixPrompt(workspace), workspace);
  steps.push({ phase: 'fix', prompt_kind: 'treatment_fix', exitCode: p5.exitCode });

  const artifact = captureImplementationArtifact(workspace, p5.output);
  return { artifact, steps, workflow: 'treatment_lamina_5_phase', phases: 5 };
}
