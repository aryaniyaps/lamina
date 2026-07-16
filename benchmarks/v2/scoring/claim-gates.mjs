#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function evaluateClaims(results, thresholds) {
  const graph = results.graph;
  const transfer = results.transfer;
  const efficiency = results.efficiency;
  const lowerPositive = (interval) => Array.isArray(interval) && Number.isFinite(interval[0]) && interval[0] > 0;
  const graphPassed = graph.effect_points >= thresholds.graph_quality_points && lowerPositive(graph.effect_ci95) && graph.favorable_tasks >= thresholds.favorable_tasks_required && graph.human_model_direction_agree && !graph.critical_failure_increase;
  const transferPassed = transfer.effect_points >= thresholds.transfer_quality_points && lowerPositive(transfer.effect_ci95) && transfer.critical_omission_reduction >= thresholds.critical_omission_relative_reduction && transfer.favorable_tasks >= thresholds.favorable_tasks_required && !transfer.incomplete_trial_increase;
  const efficiencyGain = (efficiency.time_to_threshold_reduction >= thresholds.efficiency_time_reduction && lowerPositive(efficiency.time_reduction_ci95)) || (efficiency.rework_reduction >= thresholds.efficiency_rework_reduction && lowerPositive(efficiency.rework_reduction_ci95));
  const efficiencyPassed = efficiencyGain && efficiency.quality_delta >= -thresholds.noninferiority_margin_points && efficiency.favorable_tasks >= thresholds.favorable_tasks_required;
  return {
    product_contract: graphPassed ? 'passed' : 'failed',
    downstream_implementation: graphPassed && transferPassed ? 'passed' : 'failed',
    agent_iteration_efficiency: graphPassed && transferPassed && efficiencyPassed ? 'passed' : 'failed',
    human_iteration_speed: 'not_tested'
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  if (process.argv.length < 4) throw new Error('Usage: claim-gates.mjs RESULTS.json THRESHOLDS.json');
  const results = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const thresholds = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  console.log(JSON.stringify(evaluateClaims(results, thresholds), null, 2));
}
