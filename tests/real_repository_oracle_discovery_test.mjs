#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reviewedCollectionForTier } from '../benchmarks/real-repository-oracle-v1/collection-authority.mjs';
import {
  CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES, CASE_DISCOVERY_PAYLOAD_PREFIX,
  CASE_DISCOVERY_SCHEMA, decodeDiscoveryPayload, discoverCandidateFacts,
  encodeDiscoveryPayload,
} from '../benchmarks/real-repository-oracle-v1/case-discovery.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DISCOVERY_SOURCE = fs.readFileSync(path.join(
  ROOT, 'benchmarks/real-repository-oracle-v1/case-discovery.mjs',
), 'utf8');
assert.match(DISCOVERY_SOURCE,
  /import \{ brownfieldSignals \} from '\.\.\/\.\.\/packages\/cli\/lib\/observation-runtime\/node\.mjs'/,
  'discovery must call the unchanged production brownfield signal seam');
for (const forbidden of [
  './contract.mjs', './evaluate.mjs', './grade.mjs', 'reviews/inventory-v1.json',
  'reviewedCase.expected', 'expectedByRequest',
]) {
  assert.equal(DISCOVERY_SOURCE.includes(forbidden), false,
    `unreviewed discovery must not import or decode quality expectations via ${forbidden}`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-oracle-discovery-test-'));
function git(args) {
  const result = spawnSync('git', args, {
    cwd: temporary, encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
}
try {
  git(['init', '--quiet']);
  fs.mkdirSync(path.join(temporary, 'src/routes'), { recursive: true });
  fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({
    scripts: { test: 'node test.mjs', start: 'node src/index.ts' },
    dependencies: { express: '1.0.0' },
  }));
  fs.writeFileSync(path.join(temporary, 'src/routes/checkout.ts'), [
    'interface CheckoutRequest { role: string }',
    'const FEATURE_CHECKOUT = true;',
    'function createCheckoutHandler(request: CheckoutRequest) {',
    "  app.post('/checkout', request);",
    "  emit('checkout.completed');",
    '}',
  ].join('\n'));
  fs.writeFileSync(path.join(temporary, 'src/routes/checkout.test.ts'),
    "test('checkout', () => expect(true).toBe(true));\n");
  git(['add', '--', 'package.json', 'src/routes/checkout.ts', 'src/routes/checkout.test.ts']);

  const collection = reviewedCollectionForTier('small');
  const first = discoverCandidateFacts(fs.realpathSync.native(temporary), collection);
  const replay = discoverCandidateFacts(fs.realpathSync.native(temporary), collection);
  assert.deepEqual(replay, first, 'unchanged Git objects produce deterministic discovery evidence');
  assert.equal(first.schema, CASE_DISCOVERY_SCHEMA);
  assert.equal(first.status, 'unreviewed_case_discovery_candidate');
  assert.equal(first.expectations_loaded, false);
  assert.equal(first.grade_controller_evidence, false);
  assert.deepEqual(first.authoring_handoff, {
    next_action: 'independent_human_review',
    freeze_allowed: false,
    required_receipt: 'lamina.real-repository-oracle-case-expectation-review/v1',
    required_checks: [
      'git_blob_and_symbol_identity',
      'expectation_private_from_adapter',
      'all_query_intent_scope_and_repository_state_coverage_per_pin',
      'production_seam_result_provenance',
    ],
  });
  assert.ok(Object.values(first.quality_claims).every((claim) => claim === false));
  assert.match(first.limitation, /does not define golden expectations/);
  assert.ok(first.category_coverage.routes > 0);
  assert.ok(first.category_coverage.handlers > 0);
  assert.ok(first.category_coverage.tests > 0);
  assert.ok(first.category_coverage.dependencies > 0);
  const checkout = first.retained_records.find((record) =>
    record.path === 'src/routes/checkout.ts');
  assert.ok(checkout);
  assert.ok(checkout.definitions.some((item) =>
    item.symbol === 'createCheckoutHandler' && item.context.includes('function createCheckoutHandler')));
  assert.ok(checkout.definitions.every((item) => /^[a-f0-9]{64}$/.test(item.context_sha256)));

  const encoded = encodeDiscoveryPayload(first);
  assert.ok(Buffer.byteLength(encoded.line) <= CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES);
  assert.ok(encoded.line.startsWith(CASE_DISCOVERY_PAYLOAD_PREFIX));
  assert.deepEqual(decodeDiscoveryPayload(encoded.line), encoded.result);
  assert.ok(Object.values(encoded.result.category_coverage).every((count) => count > 0),
    'category-first sampling survives retained-tail compaction');

  const oversized = structuredClone(first);
  oversized.retained_records = Array.from({ length: 96 }, (_, index) => ({
    ...structuredClone(first.retained_records[index % first.retained_records.length]),
    path: `src/routes/generated-${index}.ts`,
    definitions: [{
      kind: 'function', symbol: `generated${index}`, line: index + 1,
      context: crypto.randomBytes(180).toString('hex'),
      context_sha256: crypto.randomBytes(32).toString('hex'),
    }],
  }));
  oversized.retained_record_count = oversized.retained_records.length;
  oversized.omitted_signal_records = 0;
  oversized.retained_records_sha256 = crypto.createHash('sha256')
    .update(JSON.stringify(oversized.retained_records)).digest('hex');
  const compacted = encodeDiscoveryPayload(oversized);
  assert.ok(Buffer.byteLength(compacted.line) <= CASE_DISCOVERY_MAX_PAYLOAD_LINE_BYTES);
  assert.ok(compacted.result.retained_record_count < oversized.retained_record_count,
    'oversized candidate evidence is deterministically compacted, never stdout-truncated');
  assert.deepEqual(decodeDiscoveryPayload(compacted.line), compacted.result);

  const singletonCoverage = structuredClone(first);
  singletonCoverage.retained_records = ['routes', 'handlers', 'tests'].map((category, index) => ({
    path: `src/singleton-${category}.ts`, blob_oid: String(index + 1).repeat(40),
    byte_length: 1, content_sha256: String(index + 4).repeat(64), categories: [category],
    signals: { [category]: [category] }, unsupported: [],
    definitions: [{
      kind: 'function', symbol: `singleton${index}`, line: 1,
      context: crypto.randomBytes(180).toString('hex'),
      context_sha256: crypto.randomBytes(32).toString('hex'),
    }],
  }));
  singletonCoverage.retained_records.push(...Array.from({ length: 93 }, (_, index) => ({
    ...structuredClone(singletonCoverage.retained_records[index % 3]),
    path: `src/filler-${index}.ts`,
    categories: ['documentation'],
    signals: { documentation: [`document-${index}`] },
    definitions: [{
      kind: 'function', symbol: `filler${index}`, line: 1,
      context: crypto.randomBytes(180).toString('hex'),
      context_sha256: crypto.randomBytes(32).toString('hex'),
    }],
  })));
  singletonCoverage.retained_record_count = singletonCoverage.retained_records.length;
  singletonCoverage.omitted_signal_records = 0;
  singletonCoverage.category_coverage = {
    routes: 1, handlers: 1, tests: 1, documentation: 93,
  };
  const singletonCompacted = encodeDiscoveryPayload(singletonCoverage);
  assert.deepEqual(Object.keys(singletonCompacted.result.category_coverage),
    ['routes', 'handlers', 'tests', 'documentation']);
  assert.ok(Object.values(singletonCompacted.result.category_coverage).every((count) => count > 0),
    'compaction mechanically retains at least one record for every original category');
  assert.deepEqual(decodeDiscoveryPayload(singletonCompacted.line), singletonCompacted.result);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log('real repository oracle case-discovery tests passed');
