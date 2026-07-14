#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildOrderFromDependencies,
  resolveDependencyMode,
  validateDependencyGraph,
} from '../skills/lamina-orchestrator/lib/dependencies.mjs';

{
  assert.equal(resolveDependencyMode({ failure: 'unreachable' }), 'unreachable');
  assert.equal(resolveDependencyMode({ mode: 'degraded' }), 'degraded');
}

{
  const run = {
    status: 'ready_to_build',
    domain: {
      entities: [{ id: 'account' }, { id: 'budget' }],
      dependencies: [
        {
          id: 'review-needs-account',
          from: 'workflow.weekly-review',
          requires: 'entity.account',
          mode: 'degraded',
          degraded_surfaces: ['weekly-review'],
          recovery: 'workflow.account-linking',
          scenario_ref: 'review-stale',
        },
      ],
    },
    workflows: [
      { id: 'account-linking', standalone: true, provides: ['entity.account'] },
      { id: 'weekly-review', requires: ['review-needs-account'] },
    ],
    screens: [{ id: 'weekly-review' }],
    scenarios: [
      {
        id: 'review-stale',
        dependency_ref: 'review-needs-account',
        trigger: { when: 'dependency_unmet' },
      },
    ],
  };
  const errors = validateDependencyGraph(run);
  assert.equal(errors.length, 0, errors.join('; '));
  assert.deepEqual(buildOrderFromDependencies(run), [
    'account-linking',
    'weekly-review',
  ]);
}

{
  const run = {
    status: 'ready_to_build',
    domain: {
      dependencies: [
        {
          id: 'bad',
          from: 'workflow.a',
          requires: 'entity.x',
          mode: 'degraded',
        },
      ],
    },
    workflows: [{ id: 'a', requires: ['bad'] }],
    screens: [],
    scenarios: [],
  };
  const errors = validateDependencyGraph(run);
  assert.ok(errors.some((e) => e.includes('degraded_surfaces')));
  assert.ok(errors.some((e) => e.includes('missing scenarios')));
}

console.log('dependencies_test: ok');
