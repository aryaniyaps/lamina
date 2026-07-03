import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownSections, buildPriorContext } from '../src/prior-context.js';

test('parseMarkdownSections extracts ## sections by heading name', () => {
  const markdown = '# Decisions\n\n## Active Decisions\n\n- Keep flow short\n\n## Decision Log\n\n- Added checkpoint';
  const sections = parseMarkdownSections(markdown);
  assert.match(sections['Active Decisions'], /Keep flow short/);
  assert.match(sections['Decision Log'], /Added checkpoint/);
});

test('buildPriorContext extracts non-placeholder bullets from key sections', () => {
  const prior = buildPriorContext({
    insights: '# Insights\n\n## Key Insights\n\n- Ask less, decide faster\n',
    decisions: '# Decisions\n\n## Active Decisions\n\n- Keep invite flow single-step\n- None recorded yet.\n',
    requirements: '# Requirements\n\n## User Requirements\n\n- Admin can invite by email\n',
  });

  assert.deepEqual(prior.activeDecisions, ['Keep invite flow single-step']);
  assert.deepEqual(prior.priorInsights, ['Ask less, decide faster']);
  assert.deepEqual(prior.priorRequirements, ['Admin can invite by email']);
});
