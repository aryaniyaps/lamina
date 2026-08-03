#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  CANDIDATE_ADAPTER_SCHEMA,
  CANDIDATE_PUBLIC_BATCH_SCHEMA,
  CANDIDATE_RAW_MAX_CANONICAL_BYTES,
  CANDIDATE_RAW_SCHEMA,
  PERSONA_PROBE_EVIDENCE_SCHEMA,
  candidatePublicInputDigest,
  candidateRawArtifactDigest,
  createCandidatePublicBatch,
  parseCandidatePublicBatchBytes,
  parseCandidateRawArtifactBytes,
  serializeCandidatePublicBatch,
  serializeCandidateRawArtifact,
  validateCandidatePublicBatch,
  validateCandidateRawArtifact,
} from '../benchmarks/real-repository-oracle-v1/candidate-contract.mjs';
import {
  WORKFLOW_SEED_CANONICAL_SHA256,
  WORKFLOW_TIER_SEED_CANONICAL_SHA256,
  loadWorkflowSeed,
  loadWorkflowTierProjection,
  workflowTierProjection,
} from '../benchmarks/real-repository-oracle-v1/workflow-seed.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const clone = (value) => structuredClone(value);
const adapter = {
  schema: CANDIDATE_ADAPTER_SCHEMA,
  id: 'candidate-one',
  version: 1,
  input_format: CANDIDATE_PUBLIC_BATCH_SCHEMA,
  output_format: CANDIDATE_RAW_SCHEMA,
};
const requests = [
  { nonce: '1'.repeat(64), order: 1, request: '  Preserve this request exactly.  ' },
  { nonce: '2'.repeat(64), order: 2, request: 'Find the relevant Workflow and source.' },
];
const batch = createCandidatePublicBatch({ tier: 'small', implementation: adapter, requests });

assert.deepEqual(validateCandidatePublicBatch(batch), { valid: true, errors: [] });
assert.equal(batch.public_input_sha256, candidatePublicInputDigest(batch));
assert.equal(batch.tier_seed.source_canonical_sha256, WORKFLOW_SEED_CANONICAL_SHA256);
assert.equal(batch.tier_seed.workflows.length, 5);
assert.ok(batch.tier_seed.workflows.some((workflow) => workflow.scenarios.length > 0),
  'the exact reviewed public tier projection retains legitimate Workflow scenarios');
for (const tier of ['small', 'medium', 'large']) {
  const projected = workflowTierProjection(loadWorkflowSeed().seed, tier);
  const loaded = loadWorkflowTierProjection(tier);
  assert.deepEqual(loaded.tier_seed, projected);
  assert.equal(loaded.canonical_sha256, WORKFLOW_TIER_SEED_CANONICAL_SHA256[tier]);
  assert.ok(loaded.canonical_bytes < 64 * 1024);
  assert.equal(Object.isFrozen(loaded.tier_seed), true);
  assert.equal(Object.isFrozen(loaded.tier_seed.workflows[0]), true);
}

const publicBytes = serializeCandidatePublicBatch(batch);
assert.throws(
  () => parseCandidatePublicBatchBytes(Buffer.from(`\n ${publicBytes.toString('utf8')} \n`)),
  /not canonical JSON/,
);
const parsedPublic = parseCandidatePublicBatchBytes(publicBytes);
assert.deepEqual(parsedPublic.batch, batch);
assert.deepEqual(parsedPublic.canonical_bytes, publicBytes);
assert.equal(parsedPublic.canonical_sha256, sha256(publicBytes));
assert.equal(parsedPublic.batch.requests[0].request, '  Preserve this request exactly.  ');
assert.equal(publicBytes[0], 0x7b, 'canonical transport is direct JSON rather than a compressed envelope');

const result = (selected = 'small.workflow.login') => ({
  workflow_outcome: 'selected',
  selected_workflow_ids: [selected],
  workflow_ranking: [{ id: selected }],
  source_ranking: [{ path: 'src/example.ts', symbol: '  exactSymbol  ' }],
  observations: [{ category: 'routes', path: 'src/example.ts' }],
  obligations: [{ category: 'implementation', path: 'src/example.ts' }],
  repository_state: {
    head: null, branch: '(detached)', upstream: null, ahead: 0, behind: 0,
    worktree_role: 'primary', changes: [],
  },
});
const observations = [{ category: 'personas', path: 'docs/persona-probe.md' }];
const row = (request, body = result()) => ({ nonce: request.nonce, order: request.order, result: body });
const artifact = {
  schema: CANDIDATE_RAW_SCHEMA,
  public_input_sha256: batch.public_input_sha256,
  adapter: clone(adapter),
  persona_probe: {
    schema: PERSONA_PROBE_EVIDENCE_SCHEMA,
    input_sha256: 'a'.repeat(64),
    observations,
    observations_sha256: sha256(Buffer.from(JSON.stringify(observations))),
  },
  first: batch.requests.map((request) => row(request)),
  replay: batch.requests.map((request) => row(request)),
};

assert.deepEqual(validateCandidateRawArtifact(artifact, batch), { valid: true, errors: [] });
const rawBytes = serializeCandidateRawArtifact(artifact, batch);
assert.throws(
  () => parseCandidateRawArtifactBytes(Buffer.from(` ${rawBytes.toString('utf8')} `), batch),
  /not canonical JSON/,
);
const parsedRaw = parseCandidateRawArtifactBytes(rawBytes, batch);
assert.deepEqual(parsedRaw.artifact, artifact);
assert.deepEqual(parsedRaw.canonical_bytes, rawBytes);
assert.equal(parsedRaw.canonical_sha256, candidateRawArtifactDigest(artifact, batch));
assert.equal(parsedRaw.artifact.first[0].result.source_ranking[0].symbol, '  exactSymbol  ');
assert.equal(rawBytes[0], 0x7b);

const schema = JSON.parse(fs.readFileSync(
  new URL('../benchmarks/real-repository-oracle-v1/schema/candidate-raw.schema.json', import.meta.url),
));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
assert.equal(validateSchema(artifact), true, JSON.stringify(validateSchema.errors));

const unknownBatch = clone(batch);
unknownBatch.controller_note = 'not public';
assert.match(validateCandidatePublicBatch(unknownBatch).errors.join('; '), /unexpected|private controller/);
const privateBatch = clone(batch);
privateBatch['ｅｘｐｅｃｔｅｄ＿Ｃａｓｅ＿ＩＤ'] = 'hidden';
assert.match(validateCandidatePublicBatch(privateBatch).errors.join('; '), /private controller/);
const tierTamper = clone(batch);
tierTamper.tier_seed.workflows[0].name += ' changed';
tierTamper.public_input_sha256 = candidatePublicInputDigest(tierTamper);
assert.match(validateCandidatePublicBatch(tierTamper).errors.join('; '), /frozen Workflow projection/);
const duplicateNonce = clone(batch);
duplicateNonce.requests[1].nonce = duplicateNonce.requests[0].nonce;
duplicateNonce.public_input_sha256 = candidatePublicInputDigest(duplicateNonce);
assert.match(validateCandidatePublicBatch(duplicateNonce).errors.join('; '), /nonces must be unique/);
const reorderedRequests = clone(batch);
reorderedRequests.requests.reverse();
reorderedRequests.public_input_sha256 = candidatePublicInputDigest(reorderedRequests);
assert.match(validateCandidatePublicBatch(reorderedRequests).errors.join('; '), /out of order/);
assert.throws(() => parseCandidatePublicBatchBytes(Buffer.from([0xff])), /UTF-8 JSON/);

for (const privateName of [
  'case_id', 'ScenarioRecipe', 'fixtureAuthority', 'expected_results', 'mutationPlan',
  'gradingResult', 'qualityClaims', 'runnerAttestation',
]) {
  const leaked = clone(artifact);
  leaked.first[0].result[privateName] = 'hidden';
  assert.match(validateCandidateRawArtifact(leaked, batch).errors.join('; '), /private controller key/,
    `${privateName} must be rejected after recursive normalized-key inspection`);
}
const rowId = clone(artifact);
rowId.first[0].id = 'private-case';
assert.match(validateCandidateRawArtifact(rowId, batch).errors.join('; '), /unexpected|exactly correlated/);
const bodyId = clone(artifact);
bodyId.first[0].result.id = 'private-case';
assert.match(validateCandidateRawArtifact(bodyId, batch).errors.join('; '), /exact normalized result case body/);
const duplicateRanking = clone(artifact);
duplicateRanking.first[0].result.workflow_ranking.push({ id: duplicateRanking.first[0].result.workflow_ranking[0].id });
assert.match(validateCandidateRawArtifact(duplicateRanking, batch).errors.join('; '), /workflow_ranking is invalid/);
const reorderedFirst = clone(artifact);
reorderedFirst.first.reverse();
assert.match(validateCandidateRawArtifact(reorderedFirst, batch).errors.join('; '), /correlated and ordered/);
const missingReplay = clone(artifact);
missingReplay.replay.pop();
assert.match(validateCandidateRawArtifact(missingReplay, batch).errors.join('; '), /exact public-input cardinality/);
const replayMismatchAllowed = clone(artifact);
replayMismatchAllowed.replay[0].result.selected_workflow_ids = ['small.workflow.other'];
replayMismatchAllowed.replay[0].result.workflow_ranking = [{ id: 'small.workflow.other' }];
assert.deepEqual(validateCandidateRawArtifact(replayMismatchAllowed, batch), { valid: true, errors: [] },
  'the raw contract preserves replay divergence for the host grader instead of hiding it');
const missingPersona = clone(artifact);
missingPersona.persona_probe.observations = [{ category: 'routes', path: 'src/a.ts' }];
missingPersona.persona_probe.observations_sha256 = sha256(Buffer.from(JSON.stringify(missingPersona.persona_probe.observations)));
assert.match(validateCandidateRawArtifact(missingPersona, batch).errors.join('; '), /positive digest-bound personas/);
const badProbeDigest = clone(artifact);
badProbeDigest.persona_probe.observations_sha256 = 'f'.repeat(64);
assert.match(validateCandidateRawArtifact(badProbeDigest, batch).errors.join('; '), /positive digest-bound personas/);

const overflowRequests = Array.from({ length: 32 }, (_, index) => ({
  nonce: sha256(Buffer.from(`nonce-${index}`)), order: index + 1, request: `request ${index}`,
}));
const overflowBatch = createCandidatePublicBatch({ tier: 'small', implementation: adapter, requests: overflowRequests });
const longRelation = 'x'.repeat(2048);
const overflowResult = result();
overflowResult.observations = Array.from({ length: 128 }, () => ({ category: 'routes', relation: longRelation }));
const overflow = clone(artifact);
overflow.public_input_sha256 = overflowBatch.public_input_sha256;
overflow.first = overflowBatch.requests.map((request) => row(request, overflowResult));
overflow.replay = overflowBatch.requests.map((request) => row(request, overflowResult));
assert.ok(Buffer.byteLength(JSON.stringify(overflow)) > CANDIDATE_RAW_MAX_CANONICAL_BYTES);
assert.match(validateCandidateRawArtifact(overflow, overflowBatch).errors.join('; '), /16 MiB canonical byte bound/);
assert.throws(() => parseCandidateRawArtifactBytes(Buffer.from(JSON.stringify(overflow)), overflowBatch), /byte bound/);

const candidateSource = fs.readFileSync(
  new URL('../benchmarks/real-repository-oracle-v1/candidate-contract.mjs', import.meta.url), 'utf8');
const projectionSource = fs.readFileSync(
  new URL('../benchmarks/real-repository-oracle-v1/workflow-seed.mjs', import.meta.url), 'utf8');
const imports = [...candidateSource.matchAll(/^import[\s\S]*?from\s+['"]([^'"]+)['"];$/gm)].map((match) => match[1]);
const projectionImports = [...projectionSource.matchAll(/^import[^\n]+from\s+['"]([^'"]+)['"];$/gm)].map((match) => match[1]);
assert.deepEqual(imports, ['node:crypto', './workflow-seed.mjs']);
assert.deepEqual(projectionImports.sort(), ['node:crypto', 'node:fs']);
for (const source of [...imports, ...projectionImports]) {
  assert.doesNotMatch(source, /fixture|receipt|grade|controller|attestation/);
}

console.log('real repository oracle candidate public contract passed');
