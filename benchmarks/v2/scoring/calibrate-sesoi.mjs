#!/usr/bin/env node
import fs from 'node:fs';

const [ratingsPath, outputPath] = process.argv.slice(2);
if (!ratingsPath || !outputPath) {
  console.error('Usage: calibrate-sesoi.mjs <development-ratings.json> <frozen-thresholds.json>');
  process.exit(1);
}
const ratings = JSON.parse(fs.readFileSync(ratingsPath, 'utf8'));
const values = ratings.flatMap((rating) => Array.isArray(rating.individual_scores)
  ? rating.individual_scores.map((item) => Number(item.score))
  : [Number(rating.score ?? rating.weighted_score ?? rating.total)]).filter(Number.isFinite);
if (values.length < 8) throw new Error('At least eight calibrated development ratings are required');
const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
const sd = Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1));
const thresholds = {
  calibrated_at: new Date().toISOString(),
  development_rating_count: values.length,
  pooled_sd: sd,
  graph_quality_points: Math.max(6, 0.5 * sd),
  transfer_quality_points: Math.max(5, 0.35 * sd),
  critical_omission_relative_reduction: 0.2,
  efficiency_time_reduction: 0.2,
  efficiency_rework_reduction: 0.25,
  noninferiority_margin_points: 0.25 * sd,
  favorable_tasks_required: 8,
  task_count: 12
};
fs.writeFileSync(outputPath, `${JSON.stringify(thresholds, null, 2)}\n`);
