#!/usr/bin/env node
import assert from 'node:assert/strict';
import { attachScreenIds, resolveBlockerScreenId } from '../packages/lamina-studio/lib/persona-blockers.mjs';
import { parseSimulationYaml } from '../packages/lamina-studio/lib/persona-simulation.mjs';

{
  const blockers = [
    {
      step: 'Request reset',
      severity: 'medium',
      quote: 'Email copy is unclear',
      screenId: 'request-reset',
    },
  ];
  const attached = attachScreenIds(blockers, ['request-reset', 'check-email']);
  assert.equal(attached[0].screenId, 'request-reset');
}

{
  const blockers = [
    {
      step: 'request-reset',
      severity: 'high',
      quote: 'Missing helper text',
    },
  ];
  const attached = attachScreenIds(blockers, ['request-reset']);
  assert.equal(attached[0].screenId, 'request-reset');
}

{
  const blocker = { step: 'Unknown step', severity: 'low', quote: 'No link', screenId: 'missing-screen' };
  assert.equal(resolveBlockerScreenId(blocker, new Set(['request-reset'])), undefined);
}

{
  const yaml = `simulation:
  results:
    - persona_id: primary-user
      outcome: partial_fail
      blockers:
        - step: Request reset
          screen_id: request-reset
          flow_id: password-reset
          severity: high
          quote: Where is the confirmation?
`;
  const results = parseSimulationYaml(yaml);
  assert.equal(results.length, 1);
  assert.equal(results[0].persona_id, 'primary-user');
  assert.equal(results[0].blockers[0].screenId, 'request-reset');
  assert.equal(results[0].blockers[0].flowId, 'password-reset');
  assert.equal(results[0].blockers[0].quote, 'Where is the confirmation?');

  const attached = attachScreenIds(results[0].blockers, ['request-reset']);
  assert.equal(attached[0].screenId, 'request-reset');
}

console.log('persona_blockers_test: ok');
