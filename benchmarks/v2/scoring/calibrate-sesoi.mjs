#!/usr/bin/env node
import fs from 'node:fs';

const [ratingsPath, outputPath] = process.argv.slice(2);
if (!ratingsPath || !outputPath) {
  console.error('Usage: calibrate-sesoi.mjs <development-ratings.json> <frozen-thresholds.json>');
  process.exit(1);
}
const ratings = JSON.parse(fs.readFileSync(ratingsPath, 'utf8'));
const values = ratings.map((rating) => Number(rating.score ?? rating.weighted_score ?? rating.total)).filter(Number.isFinite);
if (values.length < 8) throw new Error('At least eight independently summarized development artifacts are required');
const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
const sd = Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1));
const thresholds = {
  calibrated_at: new Date().toISOString(),
  development_artifact_count: values.length,
  pooled_sd: sd,
  graph_quality_points: Math.max(6, 0.5 * sd),
  transfer_quality_points: Math.max(5, 0.35 * sd),
  critical_omission_relative_reduction: 0.2,
  efficiency_time_reduction: 0.2,
  efficiency_rework_reduction: 0.25,
  selected_efficiency_outcome: "rework_tokens",
  product_quality_threshold: 70,
  noninferiority_margin_points: 0.25 * sd,
  favorable_tasks_required: 8,
  task_count: 12,
  runs_per_cell: 2,
  require_complete_model_ratings: true
};
fs.writeFileSync(outputPath, `${JSON.stringify(thresholds, null, 2)}\n`);
