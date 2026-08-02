#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  COLD_RUNS,
  fixtureById,
  loadManifest,
  SCENARIOS,
  summarizeNanoseconds,
  WARM_SAMPLES,
  WORKLOAD_SCHEMA,
} from '../benchmarks/runtime-baseline-v1/contract.mjs';
import { validateWorkloadRecord } from '../benchmarks/runtime-baseline-v1/validate.mjs';

const { manifest, digest } = loadManifest();
assert.equal(manifest.fixtures.length, 3);
assert.deepEqual(manifest.fixtures.map((item) => item.id), ['small', 'medium', 'large']);
assert.match(digest, /^[a-f0-9]{64}$/);
assert.equal(new Set(manifest.fixtures.map((item) => item.commit)).size, 3);
assert.ok(manifest.fixtures.every((item) => /^[a-f0-9]{40}$/.test(item.commit)));
assert.ok(manifest.fixtures.every((item) => item.url.startsWith('https://github.com/')));
assert.equal(fixtureById('large').polyglot, true);
assert.throws(() => fixtureById('../large'), /unknown runtime baseline fixture/);
assert.equal(SCENARIOS.length, 12);

const cold = summarizeNanoseconds([30, 10, 20], false);
assert.deepEqual(cold, { count: 3, median: 20, maximum: 30, p90: null, p95: null });
const warmValues = Array.from({ length: WARM_SAMPLES }, (_, index) => index + 1);
const warm = summarizeNanoseconds(warmValues, true);
assert.equal(warm.count, 30);
assert.equal(warm.p90, 27);
assert.equal(warm.p95, 29);

const fixture = manifest.fixtures[0];
const record = {
  schema: WORKLOAD_SCHEMA,
  manifest_digest: digest,
  fixture: {
    id: fixture.id, name: fixture.name, url: fixture.url, commit: fixture.commit,
    class: fixture.class, languages: fixture.languages, polyglot: false,
  },
  scenario: 'doctor-status-startup',
  runtime: { node: process.version, lamina_commit: 'a'.repeat(40), assets_release: 'cli-v0.3.5' },
  samples: Array.from({ length: COLD_RUNS }, (_, index) => ({
    index, wall_time_ns: index + 1, diagnostics: {},
    cleanup: { repository_removed: true, socket_removed: true, lock_removed: true },
  })),
  statistics: summarizeNanoseconds([1, 2, 3], false),
  classification: 'cold',
  repository: {
    commit: fixture.commit,
    tracked_files: 100,
    tracked_bytes: 1000,
    tracked_source_files: 80,
    tracked_source_bytes: 800,
    tracked_source_loc: 20000,
    observation_indexed_files: 90,
    observation_indexed_bytes: 900,
    retrieval_candidate_files: 70,
    retrieval_candidate_bytes: 700,
    retrieval_indexed_files: 70,
    retrieval_indexed_bytes: 700,
    retrieval_source_chunks: 140,
    exclusion_rules: manifest.exclusions,
    observation_paths_digest: 'b'.repeat(64),
    retrieval_paths_digest: 'c'.repeat(64),
  },
  diagnostics: [{}, {}, {}],
  cleanup: { repository_removed: true, socket_removed: true, lock_removed: true },
};
assert.deepEqual(validateWorkloadRecord(record, {
  fixtureId: 'small', scenario: 'doctor-status-startup',
}), { valid: true, errors: [] });

const mislabeled = structuredClone(record);
mislabeled.statistics.p95 = 3;
assert.equal(validateWorkloadRecord(mislabeled).valid, false);
const stalePin = structuredClone(record);
stalePin.fixture.commit = 'c'.repeat(40);
assert.equal(validateWorkloadRecord(stalePin).valid, false);
const incompleteCleanup = structuredClone(record);
incompleteCleanup.cleanup.socket_removed = false;
assert.equal(validateWorkloadRecord(incompleteCleanup).valid, false);
const coldSample = structuredClone(record);
coldSample.classification = 'cold-sample';
coldSample.samples = [coldSample.samples[0]];
coldSample.statistics = null;
assert.equal(validateWorkloadRecord(coldSample).valid, true);

assert.doesNotThrow(() => fs.accessSync(path.resolve('benchmarks/runtime-baseline-v1/workload.mjs')));
console.log('runtime_baseline_test: ok');
