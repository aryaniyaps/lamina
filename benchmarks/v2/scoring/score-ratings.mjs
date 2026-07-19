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
  const expected = Object.keys(rubric.dimensions);
  const actual = Object.keys(rating.dimensions || {});
  const unexpected = actual.filter((dimension) => !expected.includes(dimension));
  if (unexpected.length) throw new Error(`${rating.artifact_id}/${rating.rater_id}: unexpected dimensions ${unexpected.join(', ')}`);
  for (const [dimension, weight] of Object.entries(rubric.dimensions)) {
    const value = rating.dimensions?.[dimension];
    if (!Number.isInteger(value) || value < rubric.scale.min || value > rubric.scale.max) throw new Error(`${rating.artifact_id}/${rating.rater_id}: invalid ${dimension}`);
    score += ((value - rubric.scale.min) / (rubric.scale.max - rubric.scale.min)) * 100 * weight;
  }
  return score;
}

function validateNarrativeFields(rating) {
  if (!rating.artifact_id || !rating.rater_id) throw new Error('Every rating requires artifact_id and rater_id');
  if (!['low', 'medium', 'high'].includes(rating.confidence || 'medium')) throw new Error(`${rating.artifact_id}/${rating.rater_id}: invalid confidence`);
  if (!Array.isArray(rating.critical_omissions) || !Array.isArray(rating.critical_failures)) throw new Error(`${rating.artifact_id}/${rating.rater_id}: critical omissions and failures must be arrays`);
  for (const omission of rating.critical_omissions) {
    if (!omission?.description || !['critical', 'major', 'minor'].includes(omission.severity)) throw new Error(`${rating.artifact_id}/${rating.rater_id}: every omission needs a concrete description and valid severity`);
  }
  for (const failure of rating.critical_failures) if (typeof failure !== 'string' || !failure.trim()) throw new Error(`${rating.artifact_id}/${rating.rater_id}: every critical failure needs a concrete description`);
}

export function summarizeRatings(ratings, rubric, { minimumPrimaryRaters = 2 } = {}) {
  const groups = new Map();
  for (const rating of ratings) {
    validateNarrativeFields(rating);
    if (!groups.has(rating.artifact_id)) groups.set(rating.artifact_id, []);
    groups.get(rating.artifact_id).push({ ...rating, weighted_score: weightedRating(rating, rubric) });
  }
  return [...groups].map(([artifactId, items]) => {
    const raterIds = items.map((item) => item.rater_id);
    if (new Set(raterIds).size !== raterIds.length) throw new Error(`${artifactId}: rater IDs must be independent and unique`);
    const primary = items.filter((item) => (item.rating_role || 'primary') === 'primary');
    const adjudicators = items.filter((item) => item.rating_role === 'adjudicator');
    if (primary.length < minimumPrimaryRaters) throw new Error(`${artifactId}: at least ${minimumPrimaryRaters} independent blinded primary ratings required`);
    const scores = items.map((item) => item.weighted_score);
    const disagreement = {};
    for (const dimension of Object.keys(rubric.dimensions)) {
      const values = primary.map((item) => item.dimensions[dimension]);
      if (Math.max(...values) - Math.min(...values) > rubric.adjudicate_when_dimension_gap_exceeds) disagreement[dimension] = values;
    }
    const adjudicationRequired = Object.keys(disagreement).length > 0;
    const adjudicationComplete = !adjudicationRequired || adjudicators.length > 0;
    return {
      artifact_id: artifactId,
      rater_count: items.length,
      primary_rater_count: primary.length,
      adjudicator_count: adjudicators.length,
      individual_scores: items.map((item) => ({ rater_id: item.rater_id, score: item.weighted_score })),
      score: adjudicationComplete ? median(scores) : null,
      score_range: [Math.min(...scores), Math.max(...scores)],
      dimension_medians: Object.fromEntries(Object.keys(rubric.dimensions).map((dimension) => [dimension, adjudicationComplete ? median(items.map((item) => item.dimensions[dimension])) : null])),
      critical_omissions: adjudicationComplete ? median(items.map((item) => item.critical_omissions.filter((omission) => omission.severity === 'critical').length)) : null,
      critical_failures: adjudicationComplete ? median(items.map((item) => item.critical_failures.length)) : null,
      adjudication_required: adjudicationRequired,
      adjudication_complete: adjudicationComplete,
      dimension_disagreements: disagreement,
    };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const minimumIndex = args.indexOf('--minimum-primary-raters');
  const minimumPrimaryRaters = minimumIndex === -1 ? 2 : Number(args[minimumIndex + 1]);
  if (minimumIndex !== -1) args.splice(minimumIndex, 2);
  const [ratingsPath, outputPath, rubricPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'product-contract-rubric.json')] = args;
  if (!ratingsPath || !outputPath || !Number.isInteger(minimumPrimaryRaters) || minimumPrimaryRaters < 1) throw new Error('Usage: score-ratings.mjs RATINGS.json OUTPUT.json [RUBRIC.json] [--minimum-primary-raters N]');
  const ratings = JSON.parse(fs.readFileSync(ratingsPath, 'utf8'));
  const rubric = JSON.parse(fs.readFileSync(rubricPath, 'utf8'));
  fs.writeFileSync(outputPath, `${JSON.stringify(summarizeRatings(ratings, rubric, { minimumPrimaryRaters }), null, 2)}\n`);
}
