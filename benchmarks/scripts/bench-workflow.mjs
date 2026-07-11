/**
 * LaminaBench agent workflows — Design A (ecological adoption).
 *
 * Treatment (5 phases): full Lamina loop
 * Control (2 phases): Plan-mode baseline
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { invokeAgent } from '../../evals/scripts/invoke-agent.mjs';
import { captureImplementationArtifact, isArtifactValid } from './artifact-contract.mjs';
import { checkPhaseGate, GATE_RETRY_PROMPT } from './phase-gates.mjs';
import {
  withUnattendedContract,
  isClarifyOutput,
  shouldAttemptClarifyRecovery,
  createInteractionTracker,
  recordClarifyEvent,
  summarizeInteraction,
  buildClarifyAutoReply,
  clarifyStallGateName,
} from './bench-clarify.mjs';
import { LAMINA_RUN_LAYOUT_HINT, latestRunRecord } from './lamina-run-layout.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readTaskBrief(task) {
  if (task.description != null && task.context != null) {
    return `${task.description}\n\n---\n\nContext:\n${task.context}`;
  }
  const desc = fs
    .readFileSync(
      path.join(ROOT, task._paths?.description || `benchmarks/tasks/${task.id}/description.md`),
      'utf8'
    )
    .trim();
  const ctx = fs
    .readFileSync(
      path.join(ROOT, task._paths?.context || `benchmarks/tasks/${task.id}/context.md`),
      'utf8'
    )
    .trim();
  return `${desc}\n\n---\n\nContext:\n${ctx}`;
}

function hasBusinessContext(workspace) {
  const p = path.join(workspace, '.lamina/business-context.md');
  if (!fs.existsSync(p)) return false;
  return fs.readFileSync(p, 'utf8').trim().length > 200;
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
    const run = latestRunRecord(workspace);
    if (run && fs.existsSync(run.report)) return run.report;
    const lamina = path.join(workspace, '.lamina');
    for (const name of ['verify-report.md', 'report.md']) {
      const hits = findFileRecursive(lamina, name);
      if (hits.length) return hits.sort().at(-1);
    }
    const benchAudit = path.join(workspace, 'bench-audit-report.md');
    if (fs.existsSync(benchAudit)) return benchAudit;
  }

  const run = latestRunRecord(workspace);
  if (run && fs.existsSync(run.implement)) return run.implement;

  const lamina = path.join(workspace, '.lamina');
  const impl = findFileRecursive(lamina, 'implement.md').filter(
    (p) => p.includes(`${path.sep}runs${path.sep}`) && !p.includes(`${path.sep}ready_to_build${path.sep}`)
  );
  if (impl.length) return impl.sort().at(-1);

  for (const name of ['bench-product-brief.md']) {
    const p = path.join(workspace, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findLaminaFixBrief(workspace) {
  const run = latestRunRecord(workspace);
  if (run && fs.existsSync(run.fix)) return run.fix;
  const lamina = path.join(workspace, '.lamina');
  const hits = findFileRecursive(lamina, 'fix.md').filter((p) => p.includes(`${path.sep}runs${path.sep}`));
  return hits.length ? hits.sort().at(-1) : null;
}

function findLaminaVerifyReport(workspace) {
  const run = latestRunRecord(workspace);
  if (run && fs.existsSync(run.report)) return run.report;
  const lamina = path.join(workspace, '.lamina');
  const hits = findFileRecursive(lamina, 'verify-report.md');
  if (hits.length) return hits.sort().at(-1);
  const reports = findFileRecursive(lamina, 'report.md').filter((p) => p.includes(`${path.sep}runs${path.sep}`));
  return reports.length ? reports.sort().at(-1) : null;
}

function buildControlPlanPrompt(task) {
  const brief = readTaskBrief(task);
  if (task.workflow === 'audit') {
    return `You do NOT have Lamina or special product-design skills. You are in **Plan mode** (planning only — no app source changes).

${task.prompt}

Project context:

${brief}

Review the existing product in this workspace (read-only on app source). Write \`bench-plan.md\` with:
- product-behavior gaps (invariants, permissions, state consistency)
- prioritized fixes covering the audit scope
- what the implementation should demonstrate end-to-end

Do not modify app source. Do not create a \`.lamina/\` directory.`;
  }

  return `You do NOT have Lamina or special product-design skills. You are in **Plan mode** (planning only — no app source yet).

${task.prompt}

Project context:

${brief}

Write \`bench-plan.md\` — an actionable implementation plan covering:
- domain entities and key invariants
- actors and permissions
- all primary workflows from the requirements (not a thin demo stub)
- secondary surfaces called for by the brief (settings, empty/error states, recovery)
- edge cases and recovery paths to handle
- enough product surface that a user could complete the core jobs described in the brief

Plan for a coherent **full-product** implementation of the task scope — not a minimum demo. Write \`bench-plan.md\` now. Do not ask for permission. Do not write app source. Do not create a \`.lamina/\` directory.`;
}

const IMPLEMENT_UI_REQUIREMENT = `Include a real client UI surface (screens/components), not an API-only backend.
If the brief is mobile-first, ship mobile or responsive UI source (e.g. React Native, Expo, Next.js app router pages, or equivalent) plus any needed server code.
API-only / Prisma-schema-only / Express-routes-only implementations are incomplete.`;

function buildImplementPrompt(workspace, workflow) {
  const benchPlan = path.join(workspace, 'bench-plan.md');
  if (fs.existsSync(benchPlan)) {
    return `You are now in **implementation mode** (app source allowed; do not modify .lamina/ or bench-plan.md).

Read \`bench-plan.md\` in the workspace root and implement from it.

Implement the **full product scope** from the plan — not a stub or single-screen demo:
- core domain entities and invariants
- all primary workflows end-to-end
- secondary surfaces from the plan (settings, empty/error/recovery states)
- failure/recovery paths called out in the plan
- enough structure that the product jobs in the brief are actually usable

${IMPLEMENT_UI_REQUIREMENT}

Use any stack appropriate for the workspace. Write source files now — do not ask for permission or more context.`;
  }

  const briefPath = findImplementationContract(workspace, workflow);
  const rel = briefPath ? path.relative(workspace, briefPath) : null;
  if (rel) {
    return `You are now in **implementation mode** (app source allowed; do not modify .lamina/ or bench-plan.md).

Read the plan/contract at: ${rel}

Implement the **full product scope** from the contract — not a stub or single-screen demo:
- core domain entities and invariants
- all primary workflows end-to-end
- secondary surfaces from the contract (settings, empty/error/recovery states)
- failure/recovery paths called out in the contract
- enough structure that the product jobs in the brief are actually usable

${IMPLEMENT_UI_REQUIREMENT}

Use any stack appropriate for the workspace. Write source files now — do not ask for permission or more context.`;
  }
  return `You are now in **implementation mode** (app source allowed; do not modify .lamina/).

Using the plan from your previous step in this session, implement the **full product scope**:
- core domain rules and entities
- all primary workflows from the brief
- edge-case and recovery paths
- a coherent product surface, not a thin stub

${IMPLEMENT_UI_REQUIREMENT}

Write source files now — do not ask for permission or more context.`;
}

function buildPostImplementVerifyPrompt(task) {
  const brief = readTaskBrief(task);
  if (task.workflow === 'audit') {
    return `/lamina-verify

Implementation fixes are in this workspace. Re-verify the product against .lamina/ contracts and the original audit scope:

${task.prompt}

Project context:

${brief}

Walk the implementation (source-level review is OK if no live URL — document assumptions). Write findings to the active run under \`.lamina/runs/<run_id>/\` only. Do not modify app source.

${LAMINA_RUN_LAYOUT_HINT}`;
  }
  return `/lamina-verify

Implementation is complete in this workspace. Verify the built product against the design contract in the latest \`.lamina/runs/<run_id>/run.yaml\` (implement.md, scenarios, invariants).

Project context:

${brief}

Walk the implementation (source-level review is OK if no live URL — document assumptions). Write report.md, fix.md, and findings[] under the same run directory. Do not modify app source.

${LAMINA_RUN_LAYOUT_HINT}`;
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

Fix the reported product-behavior issues in the application source. Prioritize high-severity findings, then work through the rest of the verify scope so the product matches the design contract.`;
  }
  return `You are in **fix mode** (app source allowed; do not modify .lamina/).

Fix product-behavior gaps between the implementation and the design contract. Focus on invariants, permissions, and edge-case handling.`;
}

function pushGateStep(steps, phase, prompt_kind, gateResult) {
  steps.push({
    phase: `${phase}_gate`,
    prompt_kind: `${prompt_kind}_gate`,
    exitCode: gateResult.ok ? 0 : 1,
    duration_ms: 0,
    gate_ok: gateResult.ok,
    gate_reason: gateResult.reason ?? null,
  });
}

function pushStep(steps, phase, prompt_kind, result) {
  const usage = result.usage || null;
  steps.push({
    phase,
    prompt_kind,
    exitCode: result.exitCode,
    duration_ms: result.duration_ms ?? null,
    total_tokens: usage?.total_tokens ?? null,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    cost_usd: result.cost_usd ?? null,
    session_id: result.session_id ?? null,
  });
}

function sumUsage(steps) {
  let total = 0;
  let any = false;
  for (const s of steps) {
    if (s.total_tokens != null) {
      total += s.total_tokens;
      any = true;
    }
  }
  return any ? total : null;
}

function sumCost(steps) {
  let total = 0;
  let any = false;
  for (const s of steps) {
    if (s.cost_usd != null) {
      total += s.cost_usd;
      any = true;
    }
  }
  return any ? total : null;
}

function workflowResult({
  artifact,
  steps,
  workflow,
  phases,
  status,
  failed_gate = null,
  lastOutput = '',
  interaction = null,
}) {
  const valid = status === 'success' && isArtifactValid(artifact);
  return {
    artifact,
    artifact_valid: valid,
    status,
    failed_gate,
    steps,
    workflow,
    phases,
    total_tokens: sumUsage(steps),
    cost_usd: sumCost(steps),
    last_output: lastOutput,
    interaction: summarizeInteraction(interaction),
  };
}

async function invokeStep(agent, prompt, workspace, steps, phase, prompt_kind, sessionId) {
  const result = await invokeAgent(agent, prompt, workspace, { sessionId });
  pushStep(steps, phase, prompt_kind, result);
  return { result, sessionId: result.session_id ?? sessionId };
}

function resolveFailedGate(gateName, interaction, phase) {
  if (interaction.clarify_stalled && interaction.stall_phase === phase) {
    return clarifyStallGateName(gateName);
  }
  return gateName;
}

async function invokeStepWithGate(
  agent,
  prompt,
  workspace,
  steps,
  phase,
  prompt_kind,
  gate,
  task,
  sessionId,
  interaction
) {
  const fullPrompt = withUnattendedContract(prompt);
  let { result, sessionId: sid } = await invokeStep(
    agent,
    fullPrompt,
    workspace,
    steps,
    phase,
    prompt_kind,
    sessionId
  );

  let gateResult = checkPhaseGate(workspace, gate, task);

  if (!gateResult.ok && !isClarifyOutput(result.output)) {
    const retryPrompt = `${fullPrompt}\n\n${GATE_RETRY_PROMPT}\nMissing: ${gateResult.reason}`;
    ({ result, sessionId: sid } = await invokeStep(
      agent,
      retryPrompt,
      workspace,
      steps,
      phase,
      `${prompt_kind}_retry`,
      sid
    ));
    gateResult = checkPhaseGate(workspace, gate, task);
  }

  if (
    !gateResult.ok &&
    shouldAttemptClarifyRecovery(gateResult, result.output) &&
    !interaction.clarify_replied_phases.has(phase)
  ) {
    recordClarifyEvent(interaction, phase, { detected: true, autoReplied: false });
    const autoReply = buildClarifyAutoReply(task, readTaskBrief(task));
    const clarifyPrompt = withUnattendedContract(
      `${autoReply}\n\nContinue the current command from this session. Write required deliverables to disk now.`
    );
    ({ result, sessionId: sid } = await invokeStep(
      agent,
      clarifyPrompt,
      workspace,
      steps,
      phase,
      `${prompt_kind}_clarify_reply`,
      sid
    ));
    interaction.clarify_replied_phases.add(phase);
    interaction.events[interaction.events.length - 1].auto_replied = true;
    gateResult = checkPhaseGate(workspace, gate, task);

    if (!gateResult.ok && !isClarifyOutput(result.output)) {
      const retryPrompt = `${fullPrompt}\n\n${GATE_RETRY_PROMPT}\nMissing: ${gateResult.reason}`;
      ({ result, sessionId: sid } = await invokeStep(
        agent,
        retryPrompt,
        workspace,
        steps,
        phase,
        `${prompt_kind}_post_clarify_retry`,
        sid
      ));
      gateResult = checkPhaseGate(workspace, gate, task);
    }
  }

  if (!gateResult.ok && (isClarifyOutput(result.output) || interaction.clarify_replied_phases.has(phase))) {
    interaction.clarify_stalled = true;
    interaction.stall_phase = phase;
    gateResult = { ...gateResult, clarify_stall: true, lastOutput: result.output };
  }

  pushGateStep(steps, phase, prompt_kind, gateResult);

  return { result, sessionId: sid, gate: gateResult };
}

export async function runControlWorkflow(agent, workspace, task) {
  const steps = [];
  const interaction = createInteractionTracker();

  let { sessionId, gate: planGate } = await invokeStepWithGate(
    agent,
    buildControlPlanPrompt(task),
    workspace,
    steps,
    'plan',
    'control_plan',
    'control_plan',
    task,
    null,
    interaction
  );
  if (!planGate.ok) {
    const artifact = captureImplementationArtifact(workspace, '');
    return workflowResult({
      artifact,
      steps,
      workflow: 'control_plan_2_phase',
      phases: 2,
      status: 'phase_gate_failed',
      failed_gate: resolveFailedGate('control_plan', interaction, 'plan'),
      interaction,
    });
  }

  const { result: implement, gate: implGate } = await invokeStepWithGate(
    agent,
    buildImplementPrompt(workspace, task.workflow),
    workspace,
    steps,
    'implement',
    'control_implement',
    'implement',
    task,
    sessionId,
    interaction
  );

  const artifact = captureImplementationArtifact(workspace, implement.output);
  if (!implGate.ok) {
    return workflowResult({
      artifact,
      steps,
      workflow: 'control_plan_2_phase',
      phases: 2,
      status: 'phase_gate_failed',
      failed_gate: resolveFailedGate('implement', interaction, 'implement'),
      lastOutput: implement.output,
      interaction,
    });
  }

  return workflowResult({
    artifact,
    steps,
    workflow: 'control_plan_2_phase',
    phases: 2,
    status: 'success',
    lastOutput: implement.output,
    interaction,
  });
}

export async function runTreatmentWorkflow(agent, workspace, task) {
  const brief = readTaskBrief(task);
  const steps = [];
  const interaction = createInteractionTracker();
  const initMode = hasBusinessContext(workspace) ? 'update' : 'establish';

  let { sessionId, gate: initGate } = await invokeStepWithGate(
    agent,
    `/lamina-init ${initMode}

Use this project brief:

${brief}

Persist business context under .lamina/ only. Do not write app source.`,
    workspace,
    steps,
    'lamina-init',
    'treatment_init',
    'treatment_init',
    task,
    null,
    interaction
  );
  if (!initGate.ok) {
    const artifact = captureImplementationArtifact(workspace, '');
    return workflowResult({
      artifact,
      steps,
      workflow: 'treatment_lamina_5_phase',
      phases: 5,
      status: 'phase_gate_failed',
      failed_gate: resolveFailedGate('treatment_init', interaction, 'lamina-init'),
      interaction,
    });
  }

  let designGate;
  if (task.workflow === 'audit') {
    ({ sessionId, gate: designGate } = await invokeStepWithGate(
      agent,
      `/lamina-verify

${task.prompt}

Project context:

${brief}

Use business context in .lamina/. Audit the existing product behavior in this workspace (read-only on app source). Create or update a verify run under \`.lamina/runs/<run_id>/\` with report.md and findings[].

${LAMINA_RUN_LAYOUT_HINT}`,
      workspace,
      steps,
      'lamina-verify-audit',
      'treatment_verify_brownfield',
      'treatment_verify_brownfield',
      task,
      sessionId,
      interaction
    ));
  } else {
    ({ sessionId, gate: designGate } = await invokeStepWithGate(
      agent,
      `/lamina-design

${task.prompt}

Project context:

${brief}

Use business context in .lamina/. Follow the /lamina-design workflow and lamina-orchestrator artifacts.md.

${LAMINA_RUN_LAYOUT_HINT}

Write .lamina/ only — no app source.`,
      workspace,
      steps,
      'lamina-design',
      'treatment_design',
      'treatment_design',
      task,
      sessionId,
      interaction
    ));
  }
  const designGateName = task.workflow === 'audit' ? 'treatment_verify_brownfield' : 'treatment_design';
  const designPhase = task.workflow === 'audit' ? 'lamina-verify-audit' : 'lamina-design';
  if (!designGate.ok) {
    const artifact = captureImplementationArtifact(workspace, '');
    return workflowResult({
      artifact,
      steps,
      workflow: 'treatment_lamina_5_phase',
      phases: 5,
      status: 'phase_gate_failed',
      failed_gate: resolveFailedGate(designGateName, interaction, designPhase),
      interaction,
    });
  }

  const { sessionId: implSid, gate: implGate } = await invokeStepWithGate(
    agent,
    buildImplementPrompt(workspace, task.workflow),
    workspace,
    steps,
    'implement',
    'treatment_implement',
    'implement',
    task,
    sessionId,
    interaction
  );
  sessionId = implSid;
  if (!implGate.ok) {
    const artifact = captureImplementationArtifact(workspace, '');
    return workflowResult({
      artifact,
      steps,
      workflow: 'treatment_lamina_5_phase',
      phases: 5,
      status: 'phase_gate_failed',
      failed_gate: resolveFailedGate('implement', interaction, 'implement'),
      interaction,
    });
  }

  const { sessionId: verifySid, gate: verifyGate } = await invokeStepWithGate(
    agent,
    buildPostImplementVerifyPrompt(task),
    workspace,
    steps,
    'lamina-verify',
    'treatment_verify_post_build',
    'treatment_verify_post_build',
    task,
    sessionId,
    interaction
  );
  sessionId = verifySid;
  if (!verifyGate.ok) {
    const artifact = captureImplementationArtifact(workspace, '');
    return workflowResult({
      artifact,
      steps,
      workflow: 'treatment_lamina_5_phase',
      phases: 5,
      status: 'phase_gate_failed',
      failed_gate: resolveFailedGate('treatment_verify_post_build', interaction, 'lamina-verify'),
      interaction,
    });
  }

  const { result: fix, gate: fixGate } = await invokeStepWithGate(
    agent,
    buildFixPrompt(workspace),
    workspace,
    steps,
    'fix',
    'treatment_fix',
    'treatment_fix',
    task,
    sessionId,
    interaction
  );

  const artifact = captureImplementationArtifact(workspace, fix.output);
  if (!fixGate.ok) {
    return workflowResult({
      artifact,
      steps,
      workflow: 'treatment_lamina_5_phase',
      phases: 5,
      status: 'phase_gate_failed',
      failed_gate: resolveFailedGate('treatment_fix', interaction, 'fix'),
      lastOutput: fix.output,
      interaction,
    });
  }

  return workflowResult({
    artifact,
    steps,
    workflow: 'treatment_lamina_5_phase',
    phases: 5,
    status: 'success',
    lastOutput: fix.output,
    interaction,
  });
}
