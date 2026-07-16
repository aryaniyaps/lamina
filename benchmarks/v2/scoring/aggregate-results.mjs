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
  const numeric = (field) => median(records.map((record) => record[field]).filter((value) => typeof value === 'number'));
  return {
    contract_score: numeric('contract_score'),
    contract_model_score: numeric('contract_model_score'),
    transfer_score: numeric('transfer_score'),
    critical_omissions: numeric('critical_omissions'),
    critical_failures: numeric('critical_failures'),
    incomplete_rate: records.filter((record) => record.incomplete).length / records.length,
    time_to_threshold: numeric('time_to_threshold'),
    rework_tokens: numeric('rework_tokens'),
  };
}

const safeRelativeReduction = (treatment, control) => {
  if (!Number.isFinite(treatment) || !Number.isFinite(control)) return null;
  return control > 0 ? (control - treatment) / control : treatment === 0 ? 0 : -1;
};

export function aggregateResults(records, { comparator = 'structured', track, cohortId, thresholds } = {}) {
  const filtered = records.filter((record) => (!track || record.track === track) && (!cohortId || record.cohort_id === cohortId));
  const byTask = group(filtered, (record) => record.task_id);
  const tasks = [];
  for (const [taskId, taskRecords] of byTask) {
    const byArm = group(taskRecords, (record) => record.arm);
    if (!byArm.has('lamina') || !byArm.has(comparator)) continue;
    const lamina = summarizeArm(byArm.get('lamina'));
    const control = summarizeArm(byArm.get(comparator));
    tasks.push({
      task_id: taskId,
      lamina,
      comparator: control,
      effects: {
        contract_points: lamina.contract_score - control.contract_score,
        contract_model_points: Number.isFinite(lamina.contract_model_score) && Number.isFinite(control.contract_model_score) ? lamina.contract_model_score - control.contract_model_score : null,
        transfer_points: lamina.transfer_score - control.transfer_score,
        critical_omission_reduction: safeRelativeReduction(lamina.critical_omissions, control.critical_omissions),
        time_reduction: safeRelativeReduction(lamina.time_to_threshold, control.time_to_threshold),
        rework_reduction: safeRelativeReduction(lamina.rework_tokens, control.rework_tokens),
      },
    });
  }
  if (!tasks.length) throw new Error('No paired Lamina/comparator task results');

  const humanEffects = tasks.map((task) => task.effects.contract_points);
  const modelPairs = tasks.filter((task) => Number.isFinite(task.effects.contract_model_points));
  const humanModelDirectionAgree = modelPairs.length >= Math.ceil(tasks.length / 2) && Math.sign(median(modelPairs.map((task) => task.effects.contract_model_points))) === Math.sign(median(humanEffects));
  const results = {
    graph: {
      effect_points: median(humanEffects),
      effect_ci95: bootstrapMedianCi(humanEffects),
      favorable_tasks: humanEffects.filter((value) => value > 0).length,
      human_model_direction_agree: humanModelDirectionAgree,
      critical_failure_increase: tasks.some((task) => task.lamina.critical_failures > task.comparator.critical_failures),
    },
    transfer: {
      effect_points: median(tasks.map((task) => task.effects.transfer_points)),
      effect_ci95: bootstrapMedianCi(tasks.map((task) => task.effects.transfer_points), 10000, 0x5eed1235),
      critical_omission_reduction: median(tasks.map((task) => task.effects.critical_omission_reduction)),
      favorable_tasks: tasks.filter((task) => task.effects.transfer_points > 0).length,
      incomplete_trial_increase: tasks.some((task) => task.lamina.incomplete_rate > task.comparator.incomplete_rate),
    },
    efficiency: {
      time_to_threshold_reduction: median(tasks.map((task) => task.effects.time_reduction)),
      time_reduction_ci95: bootstrapMedianCi(tasks.map((task) => task.effects.time_reduction), 10000, 0x5eed1236),
      rework_reduction: median(tasks.map((task) => task.effects.rework_reduction)),
      rework_reduction_ci95: bootstrapMedianCi(tasks.map((task) => task.effects.rework_reduction), 10000, 0x5eed1237),
      quality_delta: median(tasks.map((task) => task.effects.transfer_points)),
      favorable_tasks: tasks.filter((task) => task.effects.time_reduction > 0 || task.effects.rework_reduction > 0).length,
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
