import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function listRunJsonPaths(laminaRoot) {
  const runsDir = path.join(laminaRoot, 'runs');
  if (!fs.existsSync(runsDir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runJson = path.join(runsDir, entry.name, 'run.json');
    if (fs.existsSync(runJson)) found.push(runJson);
  }
  return found;
}

function hasVerifyOutputs(runPaths) {
  for (const runPath of runPaths) {
    const runDir = path.dirname(runPath);
    const fixMd = path.join(runDir, 'fix.md');
    const reportMd = path.join(runDir, 'report.md');
    if (fs.existsSync(fixMd) && fs.existsSync(reportMd)) return true;
    try {
      const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
      if (Array.isArray(run.findings) && run.findings.length > 0) return true;
    } catch { /* handled elsewhere */ }
  }
  return false;
}

function listFilesRecursive(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFilesRecursive(full, out);
    else out.push(full);
  }
  return out;
}

function hasWalkthroughPack(runDir) {
  const walkDir = path.join(runDir, 'walkthrough');
  const indexPath = path.join(walkDir, 'index.yaml');
  if (!fs.existsSync(indexPath)) return false;
  const index = fs.readFileSync(indexPath, 'utf8');
  if (!/^mode:\s*live_app\s*$/m.test(index)) return false;
  if (!/^source:\s*product\s*$/m.test(index)) return false;
  const files = listFilesRecursive(walkDir);
  const hasStepEvidence = files.some((file) =>
    /\.(png|jpg|jpeg|webp|a11y\.json|desc\.yaml|html)$/i.test(file) || /\/steps\//.test(file)
  );
  return hasStepEvidence;
}

function hasPersonaSimulation(run) {
  const findings = Array.isArray(run?.persona_findings) ? run.persona_findings : [];
  const refs = new Set(
    findings
      .map((finding) => finding?.persona_ref)
      .filter((ref) => typeof ref === 'string' && ref.length > 0)
  );
  return refs.size >= 2;
}

function checkVerifyAudit(runPaths, missing) {
  let walkOk = false;
  let personaOk = false;
  for (const runPath of runPaths) {
    const runDir = path.dirname(runPath);
    if (hasWalkthroughPack(runDir)) walkOk = true;
    try {
      const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
      if (hasPersonaSimulation(run)) personaOk = true;
      const evidence = Array.isArray(run.evidence) ? run.evidence : [];
      if (evidence.some((item) => item?.kind === 'visual_walkthrough' && hasWalkthroughPack(runDir))) {
        walkOk = true;
      }
    } catch { /* invalid JSON handled elsewhere */ }
  }
  if (!walkOk) {
    missing.push('.lamina/runs/*/walkthrough/ (live_app UI audit with step evidence)');
  }
  if (!personaOk) {
    missing.push('.lamina/runs/*/run.json persona_findings (≥2 distinct persona_ref from subagent panel)');
  }
}

function checkVerifyOutputs(root, runPaths, missing) {
  if (!hasVerifyOutputs(runPaths)) {
    missing.push('.lamina/runs/*/fix.md + report.md (or findings in run.json)');
  }
}

export function checkLaminaTreatment(root, phase) {
  const laminaRoot = path.join(root, '.lamina');
  const missing = [];
  const charter = path.join(laminaRoot, 'business-context.md');
  const personas = path.join(laminaRoot, 'personas.json');
  if (!fs.existsSync(charter)) missing.push('.lamina/business-context.md');
  if (!fs.existsSync(personas)) missing.push('.lamina/personas.json');

  if (phase === 'lamina_init') {
    return { valid: missing.length === 0, missing, run_status: null };
  }

  const runPaths = listRunJsonPaths(laminaRoot);
  if (!runPaths.length) missing.push('.lamina/runs/*/run.json');

  let runStatus = null;
  const readyStatuses = ['ready_to_build', 'verifying', 'complete'];
  const verifyPhases = ['lamina_verify', 'fix', 'verify_fix'];
  const verifyOutputsPresent = verifyPhases.includes(phase) && hasVerifyOutputs(runPaths);

  for (const runPath of runPaths) {
    try {
      const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
      runStatus = run.status;
      if (phase === 'lamina_design' && run.status !== 'ready_to_build') {
        missing.push(`${path.relative(root, runPath)} status must be ready_to_build after design`);
      } else if (['implement', 'shape_build'].includes(phase) && !readyStatuses.includes(run.status)) {
        missing.push(`${path.relative(root, runPath)} status must be ready_to_build, verifying, or complete`);
      } else if (verifyPhases.includes(phase) && !verifyOutputsPresent && !['verifying', 'complete'].includes(run.status)) {
        missing.push(`${path.relative(root, runPath)} status must be verifying or complete after verify`);
      }
    } catch {
      missing.push(`${path.relative(root, runPath)} must be valid JSON`);
    }
  }

  if (verifyPhases.includes(phase)) {
    checkVerifyOutputs(root, runPaths, missing);
    checkVerifyAudit(runPaths, missing);
  }

  return {
    valid: missing.length === 0,
    missing,
    run_status: runStatus,
  };
}

async function resolve(value) {
  return value && typeof value.then === 'function' ? await value : value;
}

function stateSnapshot(state) {
  try {
    return JSON.stringify(state);
  } catch {
    return String(state);
  }
}

function checkActionAnchoring(state, actions, errors) {
  const stateText = stateSnapshot(state).toLowerCase();
  for (const action of actions) {
    if (action.id && !stateText.includes(String(action.id).toLowerCase())) {
      errors.push(`reduced state missing action id "${action.id}"`);
    }
    if (action.actor && String(action.type ?? '').includes('revoke') && !stateText.includes(String(action.actor).toLowerCase())) {
      errors.push(`reduced state missing revoked actor "${action.actor}"`);
    }
  }
}

export async function evaluateSequence(mod, sequence) {
  const errors = [];
  const actions = sequence.actions ?? [];
  let state = await resolve(mod.createInitialState());

  const baselineView = await resolve(mod.project(state, sequence.actor));
  const baselineSerialized = JSON.stringify(baselineView);

  let anyStateChange = false;
  let anyViewChange = false;
  let prevView = baselineView;

  for (const action of actions) {
    const beforeState = stateSnapshot(state);
    const next = await resolve(mod.reduce(state, action));
    if (next === undefined || next === null) {
      errors.push(`reduce returned ${next} for action ${action.type}`);
      break;
    }
    state = next;
    const afterState = stateSnapshot(state);
    if (beforeState !== afterState) anyStateChange = true;

    const nextView = await resolve(mod.project(state, sequence.actor));
    if (JSON.stringify(prevView) !== JSON.stringify(nextView)) anyViewChange = true;
    prevView = nextView;
  }

  const finalView = await resolve(mod.project(state, sequence.actor));
  const finalSerialized = JSON.stringify(finalView);

  if (actions.length > 0 && baselineSerialized === finalSerialized) {
    errors.push('project() returns identical view before and after actions (static projection)');
  }
  if (actions.length > 0 && !anyStateChange && !anyViewChange) {
    errors.push('reduce() and project() are no-ops for the action sequence');
  }

  let replay = await resolve(mod.createInitialState());
  for (const action of actions) {
    replay = await resolve(mod.reduce(replay, action));
  }
  const replayView = await resolve(mod.project(replay, sequence.actor));
  if (JSON.stringify(replayView) !== JSON.stringify(finalView)) {
    errors.push('project() is not a pure function of reduced state');
  }

  checkActionAnchoring(state, actions, errors);

  const actual = finalSerialized.toLowerCase();

  if (Array.isArray(sequence.must_not_include)) {
    for (const term of sequence.must_not_include) {
      if (actual.includes(String(term).toLowerCase())) {
        errors.push(`forbidden term "${term}" present in actor view`);
      }
    }
  }

  const expectations = sequence.expect ?? [];
  for (const group of expectations) {
    const terms = Array.isArray(group) ? group : [group];
    for (const term of terms) {
      if (!actual.includes(String(term).toLowerCase())) {
        errors.push(`missing "${term}" in actor view`);
      }
    }
  }

  return { passed: errors.length === 0, errors, view: finalView };
}

export async function gradeBehavior({ root = '/app', golden, arm = 'direct', phase = 'verify_fix', taskId = 'unknown' }) {
  const scores = { import: 0, behavior: 0 };
  const sequenceResults = [];
  const treatment = arm === 'lamina' ? checkLaminaTreatment(root, phase) : { valid: true, missing: [] };

  let mod = null;
  try {
    mod = await import(pathToFileURL(path.join(root, 'app.mjs')).href + '?grade=' + Date.now());
  } catch (error) {
    const result = {
      reward: 0,
      scores,
      task_id: taskId,
      arm,
      phase,
      measurement: 'behavior_pass_rate',
      invalid_treatment: arm === 'lamina' && !treatment.valid,
      treatment,
      import_error: String(error?.message || error),
      sequences: sequenceResults,
    };
    return result;
  }

  const hasApi = ['createInitialState', 'reduce', 'project'].every((name) => typeof mod[name] === 'function');
  scores.import = Number(hasApi);
  if (!hasApi) {
    return {
      reward: 0,
      scores,
      task_id: taskId,
      arm,
      phase,
      measurement: 'behavior_pass_rate',
      invalid_treatment: arm === 'lamina' && !treatment.valid,
      treatment,
      sequences: sequenceResults,
    };
  }

  let passed = 0;
  for (const sequence of golden.sequences ?? []) {
    try {
      const outcome = await evaluateSequence(mod, sequence);
      sequenceResults.push({ actor: sequence.actor, passed: outcome.passed, errors: outcome.errors });
      if (outcome.passed) passed += 1;
    } catch (error) {
      sequenceResults.push({
        actor: sequence.actor,
        passed: false,
        errors: [String(error?.message || error)],
      });
    }
  }

  const total = golden.sequences?.length ?? 0;
  scores.behavior = total ? passed / total : 0;

  const invalidTreatment = arm === 'lamina' && !treatment.valid;
  const reward = invalidTreatment ? 0 : Number(scores.behavior.toFixed(4));

  return {
    reward,
    scores,
    task_id: taskId,
    arm,
    phase,
    measurement: 'behavior_pass_rate',
    invalid_treatment: invalidTreatment,
    treatment,
    sequences: sequenceResults,
    behavior_pass_rate: scores.behavior,
  };
}
