#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCoverageMatrix,
  loadCoverageForRun,
  screensForFlow,
} from '../lib/coverage.mjs';
import * as runMod from '../lib/run.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-coverage-flow-'));
}

{
  const flow = {
    id: 'checkout',
    graphs: [
      {
        id: 'checkout',
        entry_screen: 'cart',
        transitions: [
          { from: 'cart', target: 'checkout', trigger: 'continue' },
        ],
      },
    ],
  };
  const screens = screensForFlow(flow);
  assert.ok(screens.has('cart'));
  assert.ok(screens.has('checkout'));
}

{
  const scenarios = [
    {
      id: 'checkout-empty',
      title: 'Empty cart',
      screen: 'cart',
      flow: 'checkout',
      category: 'empty',
      ux: 'inline_message',
      trigger: { operation: 'view cart', subject: 'cart', when: 'collection_empty' },
    },
  ];
  const operations = [
    {
      id: 'cart:view:cart',
      operation: 'view cart',
      subject: 'cart',
      screenId: 'cart',
      kind: 'read_collection',
    },
    {
      id: 'checkout:continue',
      operation: 'continue',
      subject: 'continue',
      screenId: 'checkout',
      kind: 'mutate',
    },
  ];

  const matrix = buildCoverageMatrix(scenarios, operations, 'checkout');
  assert.equal(matrix.gaps.some((g) => g.flowId === 'checkout' && g.category === 'failure'), true);
  assert.equal(matrix.gaps.every((g) => g.reason.includes('edge case')), true);
  assert.equal(matrix.gaps.some((g) => g.screenId === 'checkout'), true);
}

{
  const dir = tmpDir();
  const runDir = path.join(dir, 'runs', 'flow-coverage-test');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'run.yaml'),
    `id: flow-coverage-test
hook: design
command: /lamina-design
flows:
  - id: checkout
    name: Checkout
    graphs:
      - id: checkout
        entry_screen: cart
        transitions:
          - trigger: continue
            from: cart
            target: checkout
screens:
  - id: cart
    title: Cart
    elements:
      - component: Table
        source: cart
  - id: checkout
    title: Checkout
    elements:
      - component: Button
        label: Place order
        trigger: place-order
scenarios:
  - id: cart-empty
    title: Empty cart
    screen: cart
    flow: checkout
    category: empty
    ux: inline_message
    trigger:
      operation: view cart
      subject: cart
      when: collection_empty
`,
  );

  const laminaRoot = path.join(dir);
  const result = loadCoverageForRun(laminaRoot, 'flow-coverage-test', fs, runMod);
  assert.equal(result.ok, true);
  assert.equal(result.flows?.length, 1);
  assert.ok(result.gaps?.every((g) => g.flowId));
  assert.ok(result.gaps?.some((g) => g.flowId === 'checkout'));
  assert.equal(
    result.gaps?.some((g) => g.flowId === 'checkout' && g.screenId === 'checkout'),
    true,
  );

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('coverage_per_flow_test: ok');
