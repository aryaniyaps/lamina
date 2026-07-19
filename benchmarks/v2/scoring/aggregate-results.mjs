#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateClaims } from './claim-gates.mjs';

const median = (values) => {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function bootstrapMedianCi(values, iterations = 10000, seed = 0x5eed1234) {
  const sample = values.filter(Number.isFinite);
  if (!sample.length) return [null, null];
  let state = seed >>> 0;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const estimates = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const draw = Array.from({ length: sample.length }, () => sample[Math.floor(random() * sample.length)]);
    estimates.push(median(draw));
  }
  estimates.sort((a, b) => a - b);
  return [estimates[Math.floor(iterations * 0.025)], estimates[Math.ceil(iterations * 0.975) - 1]];
}

function group(records, key) {
  const groups = new Map();
  for (const record of records) {
    const value = key(record);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(record);
  }
  return groups;
}

function summarizeArm(records) {
  const numeric = (field, fallback) => median(records.map((record) => record[field] ?? (fallback ? record[fallback] : null)));
  return {
    record_count: records.length,
    repeats: records.map((record) => record.repeat).toSorted((a, b) => a - b),
    contract_score: numeric('contract_score'),
    contract_model_score: numeric('contract_model_score'),
    transfer_score: numeric('transfer_score'),
    contract_critical_omissions: numeric('contract_critical_omissions', 'critical_omissions'),
    contract_critical_failures: numeric('contract_critical_failures', 'critical_failures'),
    transfer_critical_omissions: numeric('transfer_critical_omissions', 'critical_omissions'),
    transfer_critical_failures: numeric('transfer_critical_failures', 'critical_failures'),
    incomplete_rate: records.filter((record) => record.incomplete).length / records.length,
    time_to_threshold: numeric('time_to_threshold'),
    rework_tokens: numeric('rework_tokens'),
    rework_tool_calls: numeric('rework_tool_calls'),
  };
}

const safeDifference = (left, right) => Number.isFinite(left) && Number.isFinite(right) ? left - right : null;
const safeRelativeReduction = (treatment, control) => {
  if (!Number.isFinite(treatment) || !Number.isFinite(control)) return null;
  return control > 0 ? (control - treatment) / control : treatment === 0 ? 0 : -1;
};

function pairedTask(taskId, taskRecords, comparator, thresholds, missingData) {
  const byArm = group(taskRecords, (record) => record.arm);
  if (!byArm.has('lamina') || !byArm.has(comparator)) {
    missingData.push({ task_id: taskId, issue: 'missing_paired_arm', present_arms: [...byArm.keys()] });
    return null;
  }
  const expectedRepeats = thresholds?.runs_per_cell || null;
  for (const arm of ['lamina', comparator]) {
    const records = byArm.get(arm);
    if (expectedRepeats && records.length !== expectedRepeats) missingData.push({ task_id: taskId, arm, issue: 'unexpected_repeat_count', expected: expectedRepeats, actual: records.length });
    const repeats = records.map((record) => record.repeat);
    if (new Set(repeats).size !== repeats.length) missingData.push({ task_id: taskId, arm, issue: 'duplicate_repeat' });
    for (const field of ['contract_score', 'transfer_score']) if (records.some((record) => !Number.isFinite(record[field]))) missingData.push({ task_id: taskId, arm, issue: `missing_${field}` });
    if (thresholds?.require_complete_model_ratings && records.some((record) => !Number.isFinite(record.contract_model_score))) missingData.push({ task_id: taskId, arm, issue: 'missing_contract_model_score' });
  }
  const lamina = summarizeArm(byArm.get('lamina'));
  const control = summarizeArm(byArm.get(comparator));
  return {
    task_id: taskId,
    lamina,
    comparator: control,
    effects: {
      contract_points: safeDifference(lamina.contract_score, control.contract_score),
      contract_model_points: safeDifference(lamina.contract_model_score, control.contract_model_score),
      transfer_points: safeDifference(lamina.transfer_score, control.transfer_score),
      critical_omission_reduction: safeRelativeReduction(lamina.transfer_critical_omissions, control.transfer_critical_omissions),
      time_reduction: safeRelativeReduction(lamina.time_to_threshold, control.time_to_threshold),
      rework_reduction: safeRelativeReduction(lamina.rework_tokens, control.rework_tokens),
      rework_tool_reduction: safeRelativeReduction(lamina.rework_tool_calls, control.rework_tool_calls),
    },
  };
}

export function aggregateResults(records, { comparator = 'structured', track, cohortId, thresholds } = {}) {
  const filtered = records.filter((record) => (!track || record.track === track) && (!cohortId || record.cohort_id === cohortId));
  const tracks = new Set(filtered.map((record) => record.track));
  const cohorts = new Set(filtered.map((record) => record.cohort_id));
  const protocolHashes = new Set(filtered.map((record) => record.protocol_hash).filter(Boolean));
  if (!track && tracks.size > 1) throw new Error('Autonomous and oracle tracks must be aggregated separately; supply --track');
  if (!cohortId && cohorts.size > 1) throw new Error('Model cohorts must be aggregated separately; supply --cohort');
  if (protocolHashes.size > 1) throw new Error(`Refusing to combine ${protocolHashes.size} incompatible protocol hashes`);
  const byTask = group(filtered, (record) => record.task_id);
  const missingData = [];
  const tasks = [...byTask].map(([taskId, taskRecords]) => pairedTask(taskId, taskRecords, comparator, thresholds, missingData)).filter(Boolean);
  if (!tasks.length) throw new Error('No paired Lamina/comparator task results');
  if (thresholds?.task_count && tasks.length !== thresholds.task_count) missingData.push({ issue: 'unexpected_task_count', expected: thresholds.task_count, actual: tasks.length });

  const humanEffects = tasks.map((task) => task.effects.contract_points);
  const modelEffects = tasks.map((task) => task.effects.contract_model_points);
  const humanMedian = median(humanEffects);
  const modelMedian = median(modelEffects);
  const completeModelPairs = modelEffects.filter(Number.isFinite).length === tasks.length;
  const selectedEfficiencyOutcome = thresholds?.selected_efficiency_outcome || 'rework_tokens';
  const selectedEffects = selectedEfficiencyOutcome === 'time_to_threshold'
    ? tasks.map((task) => task.effects.time_reduction)
    : selectedEfficiencyOutcome === 'rework_tool_calls'
      ? tasks.map((task) => task.effects.rework_tool_reduction)
      : tasks.map((task) => task.effects.rework_reduction);
  const selectedSeed = selectedEfficiencyOutcome === 'time_to_threshold' ? 0x5eed1236 : selectedEfficiencyOutcome === 'rework_tool_calls' ? 0x5eed1238 : 0x5eed1237;
  const analysisComplete = missingData.length === 0;
  const results = {
    analysis: { complete: analysisComplete, missing_data: missingData },
    graph: {
      effect_points: humanMedian,
      effect_ci95: bootstrapMedianCi(humanEffects),
      favorable_tasks: humanEffects.filter((value) => value > 0).length,
      human_model_direction_agree: completeModelPairs && Number.isFinite(humanMedian) && Number.isFinite(modelMedian) && Math.sign(modelMedian) === Math.sign(humanMedian),
      model_rating_pairs_complete: completeModelPairs,
      critical_failure_increase: tasks.some((task) => task.lamina.contract_critical_failures > task.comparator.contract_critical_failures),
    },
    transfer: {
      effect_points: median(tasks.map((task) => task.effects.transfer_points)),
      effect_ci95: bootstrapMedianCi(tasks.map((task) => task.effects.transfer_points), 10000, 0x5eed1235),
      critical_omission_reduction: median(tasks.map((task) => task.effects.critical_omission_reduction)),
      favorable_tasks: tasks.filter((task) => task.effects.transfer_points > 0).length,
      incomplete_trial_increase: tasks.some((task) => task.lamina.incomplete_rate > task.comparator.incomplete_rate),
      critical_failure_increase: tasks.some((task) => task.lamina.transfer_critical_failures > task.comparator.transfer_critical_failures),
    },
    efficiency: {
      selected_outcome: selectedEfficiencyOutcome,
      selected_reduction: median(selectedEffects),
      selected_reduction_ci95: bootstrapMedianCi(selectedEffects, 10000, selectedSeed),
      time_to_threshold_reduction: median(tasks.map((task) => task.effects.time_reduction)),
      time_reduction_ci95: bootstrapMedianCi(tasks.map((task) => task.effects.time_reduction), 10000, 0x5eed1236),
      rework_reduction: median(tasks.map((task) => task.effects.rework_reduction)),
      rework_reduction_ci95: bootstrapMedianCi(tasks.map((task) => task.effects.rework_reduction), 10000, 0x5eed1237),
      rework_tool_reduction: median(tasks.map((task) => task.effects.rework_tool_reduction)),
      rework_tool_reduction_ci95: bootstrapMedianCi(tasks.map((task) => task.effects.rework_tool_reduction), 10000, 0x5eed1238),
      quality_delta: median(tasks.map((task) => task.effects.transfer_points)),
      favorable_tasks: selectedEffects.filter((value) => value > 0).length,
    },
  };
  return { comparator, track: track || 'all', cohort_id: cohortId || 'all', task_count: tasks.length, tasks, results, claims: thresholds ? evaluateClaims(results, thresholds) : null };
}

function readJsonLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`${file}:${index + 1}: ${error.message}`); }
  });
}

function parseArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) if (argv[index].startsWith('--')) options[argv[index].slice(2)] = argv[++index];
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv);
  if (!options.input) throw new Error('Usage: aggregate-results.mjs --input SCORES.jsonl [--thresholds FILE] [--output FILE] [--track TRACK] [--cohort ID] [--comparator structured]');
  const thresholds = options.thresholds ? JSON.parse(fs.readFileSync(options.thresholds, 'utf8')) : null;
  const report = aggregateResults(readJsonLines(options.input), { comparator: options.comparator || 'structured', track: options.track, cohortId: options.cohort, thresholds });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, serialized);
  else process.stdout.write(serialized);
}
