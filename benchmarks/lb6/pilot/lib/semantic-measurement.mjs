export const SEMANTIC_MEASUREMENT = 'semantic_criteria_v3';
export const SEMANTIC_REWARD_TRANSFORM = '(earned + 1) / (possible + 2)';

function nearlyEqual(a, b, tolerance = 1e-9) {
  return Number.isFinite(Number(a))
    && Number.isFinite(Number(b))
    && Math.abs(Number(a) - Number(b)) <= tolerance;
}

export function validateSemanticRows(criteria, summary = {}) {
  const rows = Array.isArray(criteria) ? criteria : [];
  const reasons = [];
  const ids = rows.map((criterion) => criterion?.id);
  if (rows.length !== 10 || ids.some((id) => !id) || new Set(ids).size !== 10) {
    reasons.push('criteria must contain ten unique named outcomes');
  }
  if (rows.some((criterion) => !Number.isFinite(Number(criterion?.possible)) || Number(criterion.possible) <= 0)) {
    reasons.push('criterion possible weights invalid');
  }
  if (rows.some((criterion) => !Number.isFinite(Number(criterion?.earned)) || Number(criterion.earned) < 0 || Number(criterion.earned) > Number(criterion.possible))) {
    reasons.push('criterion earned weights invalid');
  }

  const earned = rows.reduce((sum, criterion) => sum + Number(criterion?.earned || 0), 0);
  const possible = rows.reduce((sum, criterion) => sum + Number(criterion?.possible || 0), 0);
  const raw = possible ? earned / possible : 0;
  const reward = Number(((earned + 1) / (possible + 2)).toFixed(4));
  if (!nearlyEqual(possible, 10)) reasons.push(`possible weight total ${possible} != 10`);
  if (!nearlyEqual(summary.earned, earned)) reasons.push('earned total mismatch');
  if (!nearlyEqual(summary.possible, possible)) reasons.push('possible total mismatch');
  if (!nearlyEqual(summary.raw, raw)) reasons.push('raw behavior mismatch');
  if (!nearlyEqual(summary.reward, reward, 1e-4)) reasons.push('smoothed reward mismatch');

  return {
    passed: reasons.length === 0,
    reasons,
    criteriaCount: rows.length,
    earned,
    possible,
    raw,
    reward,
  };
}

export function validateSemanticMeasurement(rewardRecord, behaviorReport) {
  const reasons = [];
  if (!rewardRecord || !behaviorReport) reasons.push('reward/report pair missing');
  if (behaviorReport?.measurement !== SEMANTIC_MEASUREMENT) reasons.push('behavior measurement contract mismatch');
  if (rewardRecord?.measurement !== SEMANTIC_MEASUREMENT) reasons.push('reward measurement contract mismatch');
  if (behaviorReport?.reward_transform !== SEMANTIC_REWARD_TRANSFORM) reasons.push('behavior reward transform mismatch');
  if (rewardRecord?.reward_transform !== SEMANTIC_REWARD_TRANSFORM) reasons.push('reward transform mismatch');
  if (behaviorReport?.measurement_invalid !== false || rewardRecord?.measurement_invalid !== false) {
    reasons.push('measurement invalid flag set or missing');
  }

  const rowCheck = validateSemanticRows(behaviorReport?.criteria, {
    earned: behaviorReport?.earned,
    possible: behaviorReport?.possible,
    raw: behaviorReport?.raw_behavior,
    reward: behaviorReport?.reward,
  });
  reasons.push(...rowCheck.reasons);
  if (!nearlyEqual(rewardRecord?.earned, rowCheck.earned)) reasons.push('reward earned total mismatch');
  if (!nearlyEqual(rewardRecord?.possible, rowCheck.possible)) reasons.push('reward possible total mismatch');
  if (!nearlyEqual(rewardRecord?.raw_behavior, rowCheck.raw)) reasons.push('reward raw behavior mismatch');
  if (!nearlyEqual(rewardRecord?.reward, rowCheck.reward, 1e-4)) reasons.push('reward smoothed value mismatch');

  return {
    passed: reasons.length === 0,
    reasons,
    measurement: behaviorReport?.measurement ?? null,
    criteriaCount: rowCheck.criteriaCount,
    earned: rowCheck.earned,
    possible: rowCheck.possible,
    raw: rowCheck.raw,
    reward: rowCheck.reward,
  };
}
