#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function weightedRating(rating, rubric) {
  let score = 0;
  for (const [dimension, weight] of Object.entries(rubric.dimensions)) {
    const value = rating.dimensions?.[dimension];
    if (!Number.isInteger(value) || value < rubric.scale.min || value > rubric.scale.max) throw new Error(`${rating.artifact_id}/${rating.rater_id}: invalid ${dimension}`);
    score += ((value - rubric.scale.min) / (rubric.scale.max - rubric.scale.min)) * 100 * weight;
  }
  return score;
}

export function summarizeRatings(ratings, rubric) {
  const groups = new Map();
  for (const rating of ratings) {
    if (!groups.has(rating.artifact_id)) groups.set(rating.artifact_id, []);
    groups.get(rating.artifact_id).push({ ...rating, weighted_score: weightedRating(rating, rubric) });
  }
  return [...groups].map(([artifactId, items]) => {
    if (items.length < 2) throw new Error(`${artifactId}: at least two blinded ratings required`);
    const scores = items.map((item) => item.weighted_score);
    const disagreement = {};
    for (const dimension of Object.keys(rubric.dimensions)) {
      const values = items.map((item) => item.dimensions[dimension]);
      if (Math.max(...values) - Math.min(...values) > rubric.adjudicate_when_dimension_gap_exceeds) disagreement[dimension] = values;
    }
    return {
      artifact_id: artifactId,
      rater_count: items.length,
      individual_scores: items.map((item) => ({ rater_id: item.rater_id, score: item.weighted_score })),
      score: median(scores),
      score_range: [Math.min(...scores), Math.max(...scores)],
      critical_omissions: median(items.map((item) => item.critical_omissions.filter((omission) => omission.severity === 'critical').length)),
      critical_failures: median(items.map((item) => item.critical_failures.length)),
      adjudication_required: Object.keys(disagreement).length > 0,
      dimension_disagreements: disagreement,
    };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [ratingsPath, outputPath, rubricPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'product-contract-rubric.json')] = process.argv.slice(2);
  if (!ratingsPath || !outputPath) throw new Error('Usage: score-ratings.mjs RATINGS.json OUTPUT.json [RUBRIC.json]');
  const ratings = JSON.parse(fs.readFileSync(ratingsPath, 'utf8'));
  const rubric = JSON.parse(fs.readFileSync(rubricPath, 'utf8'));
  fs.writeFileSync(outputPath, `${JSON.stringify(summarizeRatings(ratings, rubric), null, 2)}\n`);
}
