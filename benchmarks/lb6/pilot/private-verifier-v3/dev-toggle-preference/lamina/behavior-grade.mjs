import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

function snapshot(value, label = 'value') {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError('serialized to undefined');
    JSON.parse(serialized);
    return serialized;
  } catch (error) {
    const wrapped = new TypeError(`${label} is not JSON-serializable: ${error?.message || error}`);
    wrapped.code = 'LB6_NON_JSON_SERIALIZABLE';
    throw wrapped;
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function primitiveEquals(actual, accepted) {
  if (typeof actual === 'boolean') {
    return accepted.some((value) => {
      if (typeof value === 'boolean') return value === actual;
      const normalized = String(value).toLowerCase();
      return actual
        ? ['true', 'on', 'enabled', 'active', 'yes', 'done', 'completed'].includes(normalized)
        : ['false', 'off', 'disabled', 'inactive', 'no', 'open', 'pending'].includes(normalized);
    });
  }
  const normalized = String(actual).toLowerCase();
  return accepted.some((value) => normalized === String(value).toLowerCase());
}

function walk(node, visitor, pathParts = []) {
  if (node === null || node === undefined) return;
  visitor(node, pathParts);
  if (typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((value, index) => walk(value, visitor, [...pathParts, String(index)]));
    return;
  }
  for (const [key, value] of Object.entries(node)) walk(value, visitor, [...pathParts, key]);
}

function recordsForId(root, id) {
  const wanted = String(id).toLowerCase();
  const records = [];
  walk(root, (value, pathParts) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const ownId = value.id ?? value.entityId ?? value.itemId ?? value.loanId ?? value.inviteId ?? value.preferenceId ?? value.prefId;
    const keyedById = pathParts[pathParts.length - 1]?.toLowerCase() === wanted;
    if ((ownId !== undefined && String(ownId).toLowerCase() === wanted) || keyedById) records.push(value);
  });
  return records;
}

function valuesForFields(root, fields) {
  const wanted = new Set((fields ?? []).map((field) => String(field).toLowerCase()));
  const values = [];
  walk(root, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, fieldValue] of Object.entries(value)) {
      if (wanted.has(key.toLowerCase())) values.push(fieldValue);
    }
  });
  return values;
}

function valuesForCriterion(view, criterion) {
  const roots = criterion.entity_id ? recordsForId(view, criterion.entity_id) : [view];
  return roots.flatMap((root) => valuesForFields(root, criterion.fields));
}

function containsPrimitive(root, expected) {
  let found = false;
  walk(root, (value) => {
    if (found || (typeof value === 'object' && value !== null)) return;
    if (primitiveEquals(value, [expected])) found = true;
  });
  return found;
}

function evaluateCriterion(criterion, trace) {
  const after = Number.isInteger(criterion.after) ? criterion.after : trace.steps.length;
  const point = after === 0 ? trace.baseline : trace.steps[after - 1];
  const previous = after <= 1 ? trace.baseline : trace.steps[after - 2];
  if (!point) return { passed: false, reason: `checkpoint ${after} unavailable` };

  const accepted = Array.isArray(criterion.accepted) ? criterion.accepted : [criterion.accepted];
  if (criterion.kind === 'entity_present') {
    const passed = recordsForId(point.view, criterion.entity_id).length > 0 || containsPrimitive(point.view, criterion.entity_id);
    return { passed, reason: passed ? null : `entity ${criterion.entity_id} absent from actor view` };
  }
  if (criterion.kind === 'entity_absent') {
    const existedBefore = !criterion.requires_entity_before
      || recordsForId(previous.view, criterion.requires_entity_before).length > 0
      || containsPrimitive(previous.view, criterion.requires_entity_before);
    const absentAfter = recordsForId(point.view, criterion.entity_id).length === 0 && !containsPrimitive(point.view, criterion.entity_id);
    const passed = existedBefore && absentAfter;
    return { passed, reason: passed ? null : `entity absence lacked a causal before/after transition` };
  }
  if (criterion.kind === 'field_equals') {
    const values = valuesForCriterion(point.view, criterion);
    const passed = values.some((value) => primitiveEquals(value, accepted));
    return { passed, reason: passed ? null : `none of [${criterion.fields.join(', ')}] matched declared values` };
  }
  if (criterion.kind === 'field_not_equals') {
    const values = valuesForCriterion(point.view, criterion);
    const passed = values.length > 0 && values.every((value) => !primitiveEquals(value, accepted));
    return { passed, reason: passed ? null : `a declared field matched forbidden values` };
  }
  if (criterion.kind === 'capability_paused') {
    const records = criterion.entity_id ? recordsForId(point.view, criterion.entity_id) : [point.view];
    const pausedValues = records.flatMap((root) => valuesForFields(root, criterion.paused_fields ?? []));
    const enabledValues = records.flatMap((root) => valuesForFields(root, criterion.enabled_fields ?? []));
    const passed = pausedValues.some((value) => primitiveEquals(value, [true, 'paused', 'blocked']))
      || enabledValues.some((value) => primitiveEquals(value, [false, 'disabled', 'blocked']));
    return { passed, reason: passed ? null : 'no distinct paused/disabled lending capability was projected' };
  }
  if (criterion.kind === 'state_unchanged_or_field_equals') {
    const unchanged = snapshot(point.state, 'checkpoint state') === snapshot(previous.state, 'prior state');
    const values = valuesForCriterion(point.view, criterion);
    const explicitlyRejected = values.some((value) => primitiveEquals(value, accepted));
    const passed = unchanged || explicitlyRejected;
    return { passed, reason: passed ? null : 'invalid action was neither ignored nor explicitly rejected' };
  }
  if (criterion.kind === 'field_contains') {
    const values = valuesForCriterion(point.view, criterion);
    const passed = values.some((value) => containsPrimitive(value, criterion.value));
    return { passed, reason: passed ? null : `declared field did not contain ${criterion.value}` };
  }
  if (criterion.kind === 'state_contains') {
    const passed = containsPrimitive(point.state, criterion.value);
    return { passed, reason: passed ? null : `reduced state missing ${criterion.value}` };
  }
  if (criterion.kind === 'secret_absent') {
    const passed = !snapshot(point.view, 'actor view').toLowerCase().includes(String(criterion.value).toLowerCase());
    return { passed, reason: passed ? null : 'hidden marker leaked into actor view' };
  }
  if (criterion.kind === 'view_changed') {
    const passed = snapshot(point.view, 'actor view') !== snapshot(previous.view, 'prior actor view');
    return { passed, reason: passed ? null : 'actor view did not change at checkpoint' };
  }
  if (criterion.kind === 'state_unchanged') {
    const priorChanged = !criterion.requires_prior_change
      || snapshot(previous.state, 'prior state') !== snapshot(trace.baseline.state, 'baseline state');
    const passed = priorChanged && snapshot(point.state, 'checkpoint state') === snapshot(previous.state, 'prior state');
    return { passed, reason: passed ? null : 'unknown/missing-id action changed state' };
  }
  if (criterion.kind === 'view_unchanged') {
    const passed = snapshot(point.view, 'actor view') === snapshot(previous.view, 'prior actor view');
    return { passed, reason: passed ? null : 'unknown/missing-id action changed actor view' };
  }
  if (criterion.kind === 'entities_present') {
    const missing = (criterion.entity_ids ?? []).filter(
      (id) => recordsForId(point.view, id).length === 0 && !containsPrimitive(point.view, id),
    );
    return { passed: missing.length === 0, reason: missing.length ? `missing entities: ${missing.join(', ')}` : null };
  }
  return { passed: false, reason: `unknown criterion kind ${criterion.kind}` };
}

async function executeSequence(mod, sequence) {
  let state = await resolve(mod.createInitialState());
  const baseline = { state, view: await resolve(mod.project(state, sequence.actor)) };
  const steps = [];
  for (const action of sequence.actions ?? []) {
    const next = await resolve(mod.reduce(state, action));
    if (next === undefined || next === null) throw new Error(`reduce returned ${next} for ${action.type}`);
    state = next;
    const view = await resolve(mod.project(state, sequence.actor));
    snapshot(state, `state after ${action.type}`);
    snapshot(view, `view after ${action.type}`);
    steps.push({ action, state, view });
  }
  snapshot(baseline.state, 'initial state');
  snapshot(baseline.view, 'initial view');
  return { baseline, steps };
}

function traceSnapshot(trace) {
  return snapshot({
    baseline: trace.baseline,
    steps: trace.steps.map((step) => ({ state: step.state, view: step.view })),
  });
}

function executeSequenceInFreshProcess(root, sequence, timeoutMs = 15_000) {
  const workerPath = fileURLToPath(new URL('./behavior-replay-worker.mjs', import.meta.url));
  return new Promise((resolveTrace, rejectTrace) => {
    const child = fork(workerPath, [], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced',
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectTrace(new Error(`fresh replay timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const finish = (callback) => {
      clearTimeout(timer);
      callback();
    };
    child.once('error', (error) => finish(() => rejectTrace(error)));
    child.once('message', (message) => finish(() => {
      if (message?.ok) {
        resolveTrace(message.trace);
        return;
      }
      const error = new Error(message?.error || stderr || 'fresh replay worker failed');
      if (message?.code) error.code = message.code;
      rejectTrace(error);
    }));
    child.send({ root, sequence });
  });
}

export async function evaluateSequence(mod, sequence, {
  determinismReplays = 3,
  determinismDelayMs = 3,
  freshModule = null,
  freshProcessRoot = null,
} = {}) {
  const errors = [];
  let trace;
  try {
    trace = freshProcessRoot
      ? await executeSequenceInFreshProcess(freshProcessRoot, sequence)
      : await executeSequence(mod, sequence);
    traceSnapshot(trace);
  } catch (error) {
    const reason = String(error?.message || error);
    return {
      passed: false,
      errors: [reason],
      criteria: (sequence.criteria ?? []).map((criterion) => ({
        id: criterion.id,
        earned: 0,
        possible: criterion.weight ?? 1,
        passed: false,
        reason,
      })),
      deterministic: error?.code !== 'LB6_NON_JSON_SERIALIZABLE',
      measurement_invalid_reason: error?.code === 'LB6_NON_JSON_SERIALIZABLE'
        ? 'non_json_serializable_trace'
        : null,
    };
  }

  const expectedTrace = traceSnapshot(trace);
  let replayInvalidReason = null;
  for (let replay = 1; replay < determinismReplays; replay += 1) {
    if (determinismDelayMs > 0) await delay(determinismDelayMs);
    try {
      const candidateTrace = freshProcessRoot
        ? await executeSequenceInFreshProcess(freshProcessRoot, sequence)
        : await executeSequence(freshModule ? await freshModule(replay) : mod, sequence);
      if (traceSnapshot(candidateTrace) !== expectedTrace) {
        errors.push(`deterministic replay diverged on replay ${replay + 1}`);
        replayInvalidReason = 'behavior_nondeterministic';
        break;
      }
    } catch (error) {
      if (error?.code === 'LB6_NON_JSON_SERIALIZABLE') {
        errors.push(error.message);
        replayInvalidReason = 'non_json_serializable_trace';
        break;
      }
      throw error;
    }
  }

  const criteria = (sequence.criteria ?? []).map((criterion) => {
    const outcome = evaluateCriterion(criterion, trace);
    if (!outcome.passed && outcome.reason) errors.push(`${criterion.id}: ${outcome.reason}`);
    const possible = Number(criterion.weight ?? 1);
    return {
      id: criterion.id,
      earned: outcome.passed ? possible : 0,
      possible,
      passed: outcome.passed,
      reason: outcome.reason,
    };
  });

  return {
    passed: criteria.every((criterion) => criterion.passed) && errors.length === 0,
    errors,
    criteria,
    deterministic: replayInvalidReason === null,
    measurement_invalid_reason: replayInvalidReason,
  };
}

export async function gradeBehavior({ root = '/app', golden, arm = 'direct', phase = 'verify_fix', taskId = 'unknown' }) {
  const scores = { import: 0, behavior: 0, earned: 0, possible: 0, raw_behavior: 0 };
  const sequenceResults = [];
  const treatment = arm === 'lamina' ? checkLaminaTreatment(root, phase) : { valid: true, missing: [] };

  let mod = null;
  const moduleUrl = pathToFileURL(path.join(root, 'app.mjs')).href;
  let importNonce = 0;
  const importFresh = async () => {
    importNonce += 1;
    return import(`${moduleUrl}?grade=${Date.now()}-${process.pid}-${importNonce}`);
  };
  try {
    mod = await importFresh();
  } catch (error) {
    return {
      reward: 0,
      scores,
      task_id: taskId,
      arm,
      phase,
      measurement: 'semantic_criteria_v3',
      measurement_invalid: true,
      measurement_invalid_reason: 'import_error',
      invalid_treatment: arm === 'lamina' && !treatment.valid,
      treatment,
      import_error: String(error?.message || error),
      sequences: sequenceResults,
      criteria: [],
    };
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
      measurement: 'semantic_criteria_v3',
      measurement_invalid: true,
      measurement_invalid_reason: 'api_contract_missing',
      invalid_treatment: arm === 'lamina' && !treatment.valid,
      treatment,
      sequences: sequenceResults,
      criteria: [],
    };
  }

  const allCriteria = [];
  let deterministic = true;
  let traceInvalidReason = null;
  for (const sequence of golden.sequences ?? []) {
    try {
      const outcome = await evaluateSequence(mod, sequence, {
        freshModule: importFresh,
        freshProcessRoot: root,
      });
      sequenceResults.push({ id: sequence.id, actor: sequence.actor, passed: outcome.passed, deterministic: outcome.deterministic, errors: outcome.errors, criteria: outcome.criteria });
      allCriteria.push(...outcome.criteria.map((criterion) => ({ ...criterion, sequence_id: sequence.id })));
      if (!outcome.deterministic) deterministic = false;
      if (outcome.measurement_invalid_reason) traceInvalidReason ||= outcome.measurement_invalid_reason;
    } catch (error) {
      sequenceResults.push({
        id: sequence.id,
        actor: sequence.actor,
        passed: false,
        deterministic: true,
        errors: [String(error?.message || error)],
      });
    }
  }

  const earned = allCriteria.reduce((sum, criterion) => sum + criterion.earned, 0);
  const possible = allCriteria.reduce((sum, criterion) => sum + criterion.possible, 0);
  scores.earned = earned;
  scores.possible = possible;
  scores.raw_behavior = possible ? earned / possible : 0;
  scores.behavior = scores.raw_behavior;

  const invalidTreatment = arm === 'lamina' && !treatment.valid;
  const invalidRubric = possible !== 10;
  const measurementInvalid = !deterministic || invalidRubric;
  const measurementInvalidReason = !deterministic
    ? (traceInvalidReason || 'behavior_nondeterministic')
    : invalidRubric
      ? `rubric_weight_total_${possible}_expected_10`
      : null;
  const reward = invalidTreatment || measurementInvalid
    ? 0
    : Number(((earned + 1) / (possible + 2)).toFixed(4));

  return {
    reward,
    scores,
    task_id: taskId,
    arm,
    phase,
    measurement: 'semantic_criteria_v3',
    reward_transform: '(earned + 1) / (possible + 2)',
    smoothing: { kind: 'laplace', alpha: 1, beta: 1, arm_blind: true },
    measurement_invalid: measurementInvalid,
    measurement_invalid_reason: measurementInvalidReason,
    invalid_treatment: invalidTreatment,
    treatment,
    sequences: sequenceResults,
    criteria: allCriteria,
    behavior_pass_rate: scores.raw_behavior,
    raw_behavior: scores.raw_behavior,
    earned,
    possible,
  };
}
