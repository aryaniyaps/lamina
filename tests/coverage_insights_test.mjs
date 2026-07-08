#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  formatGapSummary,
  flowCoverageInsights,
  gapCountByScreenForFlow,
} from '../packages/lamina-studio/lib/coverage-insights.mjs';

const coverage = {
  score: 75,
  flows: [
    { id: 'checkout', score: 50, gapCount: 2 },
    { id: 'wishlist', score: 100, gapCount: 0 },
  ],
  gaps: [
    {
      flowId: 'checkout',
      operationId: 'checkout-read',
      operation: 'view wishlist',
      category: 'empty',
      screenId: 'wishlist',
      reason: 'Missing empty edge case for "view wishlist"',
    },
    {
      flowId: 'checkout',
      operationId: 'checkout-mutate',
      operation: 'place order',
      category: 'failure',
      screenId: 'checkout',
      reason: 'Missing failure edge case for "place order"',
    },
    {
      flowId: 'onboarding',
      operationId: 'start-read',
      operation: 'open start',
      category: 'permission',
      screenId: 'start',
      reason: 'Missing permission edge case for "open start"',
    },
  ],
};

{
  const counts = gapCountByScreenForFlow(coverage, 'checkout');
  assert.equal(counts.get('wishlist'), 1);
  assert.equal(counts.get('checkout'), 1);
  assert.equal(counts.get('start'), undefined);
}

{
  const insights = flowCoverageInsights(coverage, 'checkout');
  assert.equal(insights.gapCount, 2);
  assert.equal(insights.score, 50);
  assert.equal(insights.gaps[0].category, 'empty');
}

{
  const summary = formatGapSummary(coverage.gaps[0]);
  assert.equal(summary, 'Missing empty edge case for view wishlist');
}

console.log('coverage_insights_test: ok');
