#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  CANDIDATE_ADAPTER_SCHEMA,
  CANDIDATE_PUBLIC_BATCH_SCHEMA,
  CANDIDATE_RAW_MAX_CANONICAL_BYTES,
  CANDIDATE_RAW_SCHEMA,
  PERSONA_PROBE_EVIDENCE_SCHEMA,
  canonicalCandidateValue,
  candidatePublicInputDigest,
  candidateRawArtifactDigest,
  createCandidatePublicBatch,
  parseCandidatePublicBatchBytes,
  parseCandidateRawArtifactBytes,
  serializeCandidatePublicBatch,
  serializeCandidateRawArtifact,
  validateCandidateAdapter,
  validateCandidatePublicBatch,
  validateCandidateRawArtifact,
} from '../benchmarks/real-repository-oracle-v1/candidate-contract.mjs';
import {
  WORKFLOW_SEED_CANONICAL_SHA256,
  WORKFLOW_SEED_RAW_SHA256,
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
const batch = createCandidatePublicBatch({ tier: 'small', requests });

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
assert.equal(parsedPublic.canonical_json, publicBytes.toString('utf8'));
assert.equal(parsedPublic.canonical_byte_length, publicBytes.length);
assert.equal('canonical_bytes' in parsedPublic, false, 'parse metadata exposes no mutable canonical Buffer');
assert.equal(parsedPublic.canonical_sha256, sha256(publicBytes));
assert.equal(parsedPublic.batch.requests[0].request, '  Preserve this request exactly.  ');
assert.equal(publicBytes[0], 0x7b, 'canonical transport is direct JSON rather than a compressed envelope');

const parsedProto = JSON.parse('{"z":1,"__proto__":{"polluted":"no"}}');
const canonicalProto = canonicalCandidateValue(parsedProto);
assert.equal(Object.hasOwn(canonicalProto, '__proto__'), true);
assert.equal(Object.getPrototypeOf(canonicalProto), Object.prototype);
assert.deepEqual(canonicalProto.__proto__, { polluted: 'no' });
assert.match(JSON.stringify(canonicalProto), /"__proto__":\{"polluted":"no"\}/);
assert.equal({}.polluted, undefined, 'canonicalization never mutates inherited prototypes');
const protoTierTamper = clone(batch);
Object.defineProperty(protoTierTamper.tier_seed, '__proto__', {
  value: { fixture_claims: 'private' }, enumerable: true, configurable: true, writable: true,
});
protoTierTamper.public_input_sha256 = candidatePublicInputDigest(protoTierTamper);
const serializedProtoTier = JSON.stringify(canonicalCandidateValue(protoTierTamper.tier_seed));
assert.match(serializedProtoTier, /"__proto__":\{"fixture_claims":"private"\}/);
assert.notEqual(protoTierTamper.public_input_sha256, batch.public_input_sha256);
assert.match(validateCandidatePublicBatch(protoTierTamper).errors.join('; '), /frozen Workflow projection/);
assert.throws(() => serializeCandidatePublicBatch(protoTierTamper), /frozen Workflow projection/);
assert.equal({}.fixture_claims, undefined);

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
    input_sha256: batch.persona_probe.content_sha256,
    observations,
    observations_sha256: sha256(Buffer.from(JSON.stringify(observations))),
  },
  rows: batch.requests.map((request) => row(request)),
};

assert.deepEqual(validateCandidateRawArtifact(artifact, batch, adapter), { valid: true, errors: [] });
const rawBytes = serializeCandidateRawArtifact(artifact, batch, adapter);
assert.throws(
  () => parseCandidateRawArtifactBytes(Buffer.from(` ${rawBytes.toString('utf8')} `), batch, adapter),
  /not canonical JSON/,
);
const parsedRaw = parseCandidateRawArtifactBytes(rawBytes, batch, adapter);
assert.deepEqual(parsedRaw.artifact, artifact);
assert.equal(parsedRaw.canonical_json, rawBytes.toString('utf8'));
assert.equal(parsedRaw.canonical_byte_length, rawBytes.length);
assert.equal('canonical_bytes' in parsedRaw, false, 'parse metadata exposes no mutable canonical Buffer');
assert.equal(parsedRaw.canonical_sha256, candidateRawArtifactDigest(artifact, batch, adapter));
assert.equal(parsedRaw.artifact.rows[0].result.source_ranking[0].symbol, '  exactSymbol  ');
assert.equal(rawBytes[0], 0x7b);

const schema = JSON.parse(fs.readFileSync(
  new URL('../benchmarks/real-repository-oracle-v1/schema/candidate-raw.schema.json', import.meta.url),
));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
assert.equal(validateSchema(artifact), true, JSON.stringify(validateSchema.errors));

const adapter2048 = { ...adapter, id: 'a'.repeat(2048) };
assert.deepEqual(validateCandidateAdapter(adapter2048), { valid: true, errors: [] });
assert.equal(createCandidatePublicBatch({ tier: 'small', requests }).public_input_sha256,
  batch.public_input_sha256, 'public input identity is independent of the host-expected adapter');
const raw2048 = clone(artifact);
raw2048.adapter = clone(adapter2048);
assert.deepEqual(validateCandidateRawArtifact(raw2048, batch, adapter2048), { valid: true, errors: [] });
assert.equal(validateSchema(raw2048), true, JSON.stringify(validateSchema.errors));
const adapter2049 = { ...adapter, id: 'a'.repeat(2049) };
assert.match(validateCandidateAdapter(adapter2049).errors.join('; '), /descriptor is invalid/);
const raw2049 = clone(raw2048);
raw2049.adapter.id = 'a'.repeat(2049);
assert.match(validateCandidateRawArtifact(raw2049, batch, adapter2048).errors.join('; '), /adapter differs/);
assert.match(validateCandidateRawArtifact(raw2049, batch, adapter2049).errors.join('; '), /Host-expected adapter/);
assert.equal(validateSchema(raw2049), false);
const legacyTwoRunRaw = clone(artifact);
legacyTwoRunRaw.first = clone(artifact.rows);
legacyTwoRunRaw.replay = clone(artifact.rows);
assert.match(validateCandidateRawArtifact(legacyTwoRunRaw, batch, adapter).errors.join('; '), /unexpected/);

function withResultPath(location, value) {
  const candidate = clone(artifact);
  const body = candidate.rows[0].result;
  if (location === 'persona_probe') {
    candidate.persona_probe.observations[0].path = value;
    candidate.persona_probe.observations_sha256 = sha256(Buffer.from(
      JSON.stringify(canonicalCandidateValue(candidate.persona_probe.observations)),
    ));
  } else if (location === 'source_ranking') body.source_ranking[0].path = value;
  else if (location === 'observations') body.observations[0].path = value;
  else if (location === 'obligations') body.obligations[0].path = value;
  else if (location === 'change_path') body.repository_state.changes = [{
    kind: 'renamed', path: value, original_path: 'src/original.ts', xy: 'R.', submodule: 'N...',
  }];
  else if (location === 'change_original_path') body.repository_state.changes = [{
    kind: 'renamed', path: 'src/renamed.ts', original_path: value, xy: 'R.', submodule: 'N...',
  }];
  return candidate;
}

const pathLocations = [
  'persona_probe', 'source_ranking', 'observations', 'obligations', 'change_path', 'change_original_path',
];
const validPaths = [
  'a'.repeat(1024),
  'a'.repeat(4096),
  'é'.repeat(512),
  'é'.repeat(2048),
  'unicode/line-separator- .ts',
  'unicode/paragraph-separator- .ts',
];
for (const location of pathLocations) {
  for (const validPath of validPaths) {
    const candidate = withResultPath(location, validPath);
    assert.equal(Buffer.byteLength(validPath, 'utf8') <= 4096, true);
    assert.deepEqual(validateCandidateRawArtifact(candidate, batch, adapter), { valid: true, errors: [] },
      `${location} must preserve the established 4096-byte path authority`);
    assert.equal(validateSchema(candidate), true,
      `${location} manually valid path must be accepted by the syntactic schema: ${JSON.stringify(validateSchema.errors)}`);
  }
}
function withXy(value) {
  const candidate = clone(artifact);
  candidate.rows[0].result.repository_state.changes = [{
    kind: 'ordinary', path: 'src/change.ts', original_path: null, xy: value, submodule: 'N...',
  }];
  return candidate;
}
const twoByteXy = withXy('é');
assert.deepEqual(validateCandidateRawArtifact(twoByteXy, batch, adapter), { valid: true, errors: [] });
assert.equal(validateSchema(twoByteXy), true, JSON.stringify(validateSchema.errors));
for (const schemaOnlyXy of ['€', 'éa']) {
  const candidate = withXy(schemaOnlyXy);
  assert.match(validateCandidateRawArtifact(candidate, batch, adapter).errors.join('; '), /changes\[0\] is invalid/);
  assert.equal(validateSchema(candidate), true,
    'xy schema remains a character-count syntactic superset of exact two-byte manual authority');
}

const syntacticallyUnsafePaths = [
  '', 'a'.repeat(4097), '/absolute.ts', 'C:/drive.ts', 'C:drive.ts', 'a\\b.ts', 'a//b.ts',
  '.', '..', './a.ts', '../a.ts', 'a/./b.ts', 'a/../b.ts', 'trailing/',
  'line\nbreak.ts', 'tab\tpath.ts', `nul${String.fromCharCode(0)}path.ts`,
  `del${String.fromCharCode(0x7f)}path.ts`,
];
for (const location of pathLocations) {
  for (const unsafePath of syntacticallyUnsafePaths) {
    const candidate = withResultPath(location, unsafePath);
    assert.match(validateCandidateRawArtifact(candidate, batch, adapter).errors.join('; '), /unsafe|invalid/,
      `${location} must reject unsafe path ${JSON.stringify(unsafePath)}`);
    assert.equal(validateSchema(candidate), false,
      `${location} syntactically unsafe path must also fail the schema`);
  }
}
const overByteMultibytePath = `${'é'.repeat(2048)}a`;
assert.equal(Buffer.byteLength(overByteMultibytePath, 'utf8'), 4097);
for (const location of pathLocations) {
  const candidate = withResultPath(location, overByteMultibytePath);
  assert.match(validateCandidateRawArtifact(candidate, batch, adapter).errors.join('; '), /unsafe|invalid/);
  assert.equal(validateSchema(candidate), true,
    'the schema is intentionally a character-count syntactic superset of byte-aware manual authority');
}

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
  'gradingResult', 'qualityClaims', 'runnerAttestation', 'phase', 'slot_id',
  'leaseEvidence', 'materializationTruth', 'provenanceDigest',
]) {
  const leaked = clone(artifact);
  leaked.rows[0].result[privateName] = 'hidden';
  assert.match(validateCandidateRawArtifact(leaked, batch, adapter).errors.join('; '), /private controller key/,
    `${privateName} must be rejected after recursive normalized-key inspection`);
}
const rowId = clone(artifact);
rowId.rows[0].id = 'private-case';
assert.match(validateCandidateRawArtifact(rowId, batch, adapter).errors.join('; '), /unexpected|exactly correlated/);
const bodyId = clone(artifact);
bodyId.rows[0].result.id = 'private-case';
assert.match(validateCandidateRawArtifact(bodyId, batch, adapter).errors.join('; '), /exact normalized result case body/);
const duplicateRanking = clone(artifact);
duplicateRanking.rows[0].result.workflow_ranking.push({ id: duplicateRanking.rows[0].result.workflow_ranking[0].id });
assert.match(validateCandidateRawArtifact(duplicateRanking, batch, adapter).errors.join('; '), /workflow_ranking is invalid/);
const reorderedRows = clone(artifact);
reorderedRows.rows.reverse();
assert.match(validateCandidateRawArtifact(reorderedRows, batch, adapter).errors.join('; '), /correlated and ordered/);
const missingRow = clone(artifact);
missingRow.rows.pop();
assert.match(validateCandidateRawArtifact(missingRow, batch, adapter).errors.join('; '), /exact public-input cardinality/);
const missingPersona = clone(artifact);
missingPersona.persona_probe.observations = [{ category: 'routes', path: 'src/a.ts' }];
missingPersona.persona_probe.observations_sha256 = sha256(Buffer.from(JSON.stringify(missingPersona.persona_probe.observations)));
assert.match(validateCandidateRawArtifact(missingPersona, batch, adapter).errors.join('; '), /positive digest-bound personas/);
const badProbeDigest = clone(artifact);
badProbeDigest.persona_probe.observations_sha256 = 'f'.repeat(64);
assert.match(validateCandidateRawArtifact(badProbeDigest, batch, adapter).errors.join('; '), /positive digest-bound personas/);

let deeplyNested = { leaf: 'bounded' };
for (let depth = 0; depth < 3_100; depth += 1) deeplyNested = { next: deeplyNested };
const deepPublic = clone(batch);
deepPublic.persona_probe = deeplyNested;
assert.doesNotThrow(() => validateCandidatePublicBatch(deepPublic));
assert.match(validateCandidatePublicBatch(deepPublic).errors.join('; '), /structure depth/);
assert.throws(() => candidatePublicInputDigest(deepPublic), /structure depth/);
assert.throws(() => canonicalCandidateValue(deeplyNested), /structure depth/);
const deepRaw = clone(artifact);
deepRaw.rows = deeplyNested;
assert.doesNotThrow(() => validateCandidateRawArtifact(deepRaw, batch, adapter));
assert.match(validateCandidateRawArtifact(deepRaw, batch, adapter).errors.join('; '), /structure depth/);

const flatBatch = createCandidatePublicBatch({
  tier: 'small',
  requests: [{ nonce: '3'.repeat(64), order: 1, request: 'Exercise declared flat result geometry.' }],
});
const flatResult = result();
flatResult.source_ranking = Array.from({ length: 6_000 }, (_, index) => ({
  path: `src/ranked-${index}.ts`, symbol: null,
}));
flatResult.observations = Array.from({ length: 84_000 }, () => ({ category: 'routes', id: 'route' }));
flatResult.obligations = Array.from({ length: 256 }, () => ({ category: 'implementation', id: 'work' }));
const flatArtifact = clone(artifact);
flatArtifact.public_input_sha256 = flatBatch.public_input_sha256;
flatArtifact.rows = [row(flatBatch.requests[0], flatResult)];
assert.deepEqual(validateCandidateRawArtifact(flatArtifact, flatBatch, adapter), { valid: true, errors: [] },
  'large flat data remains accepted through every declared array maximum');
assert.ok(serializeCandidateRawArtifact(flatArtifact, flatBatch, adapter).length < CANDIDATE_RAW_MAX_CANONICAL_BYTES);
const overSourceCap = clone(artifact);
overSourceCap.public_input_sha256 = flatBatch.public_input_sha256;
const overSourceResult = result();
overSourceResult.source_ranking = Array.from({ length: 6_001 }, (_, index) => ({
  path: `src/over-${index}.ts`, symbol: null,
}));
overSourceCap.rows = [row(flatBatch.requests[0], overSourceResult)];
assert.match(validateCandidateRawArtifact(overSourceCap, flatBatch, adapter).errors.join('; '), /source_ranking is invalid/);

const overflowRequests = Array.from({ length: 64 }, (_, index) => ({
  nonce: sha256(Buffer.from(`nonce-${index}`)), order: index + 1, request: `request ${index}`,
}));
const overflowBatch = createCandidatePublicBatch({ tier: 'small', requests: overflowRequests });
const longRelation = 'x'.repeat(2048);
const overflowResult = result();
overflowResult.observations = Array.from({ length: 128 }, () => ({ category: 'routes', relation: longRelation }));
const overflow = clone(artifact);
overflow.public_input_sha256 = overflowBatch.public_input_sha256;
overflow.rows = overflowBatch.requests.map((request) => row(request, overflowResult));
assert.ok(Buffer.byteLength(JSON.stringify(overflow)) > CANDIDATE_RAW_MAX_CANONICAL_BYTES);
assert.match(validateCandidateRawArtifact(overflow, overflowBatch, adapter).errors.join('; '), /16 MiB canonical byte bound/);
assert.throws(() => parseCandidateRawArtifactBytes(Buffer.from(JSON.stringify(overflow)), overflowBatch, adapter), /byte bound/);

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicEntry = 'benchmarks/real-repository-oracle-v1/candidate-contract.mjs';
const allowedPublicClosure = new Set([
  publicEntry,
  'benchmarks/real-repository-oracle-v1/workflow-seed.mjs',
  'benchmarks/real-repository-oracle-v1/workflows-v1.json',
]);
const auditedPublicBytes = new Map([
  [publicEntry, '2525c5a65a525d9946bbe23d906e7f4d3c3aa5655108077cbdad8bc31dc7bf22'],
  ['benchmarks/real-repository-oracle-v1/workflow-seed.mjs',
    'c2afa8a92c833cc3fa4bd2e36c00ace98bab1e44eace2ea14b444c21f71d075b'],
  ['benchmarks/real-repository-oracle-v1/workflows-v1.json',
    'adada5586cc3b0ccc2dd2f1de377a654de4793d5ede33de44bff4d91cf45499d'],
]);
assert.deepEqual([...auditedPublicBytes.keys()].sort(), [...allowedPublicClosure].sort());
const attributesBytes = fs.readFileSync(path.join(repositoryRoot, '.gitattributes'));
assert.ok(attributesBytes.length > 0 && attributesBytes.length <= 64 * 1024,
  '.gitattributes must remain within its audited byte bound');
const attributesText = new TextDecoder('utf-8', { fatal: true }).decode(attributesBytes);
assert.ok(Buffer.from(attributesText, 'utf8').equals(attributesBytes)
  && attributesText.endsWith('\n') && !attributesText.includes('\r'),
  '.gitattributes must be canonical UTF-8 with LF line endings');
const attributeLines = attributesText.slice(0, -1).split('\n');
for (const relative of auditedPublicBytes.keys()) {
  const expected = `${relative} text eol=lf`;
  assert.equal(attributeLines.filter((line) => line === expected).length, 1,
    `${relative} must have one exact text eol=lf rule`);
}
for (const [relative, expectedSha256] of auditedPublicBytes) {
  const exactBytes = fs.readFileSync(path.join(repositoryRoot, relative));
  assert.equal(sha256(exactBytes), expectedSha256, `${relative} differs from its audited public byte identity`);
}
assert.equal(auditedPublicBytes.get('benchmarks/real-repository-oracle-v1/workflows-v1.json'),
  WORKFLOW_SEED_RAW_SHA256, 'unchanged reviewed Workflow JSON bytes remain the public data authority');
const allowedBuiltins = new Map([
  [publicEntry, ['node:crypto']],
  ['benchmarks/real-repository-oracle-v1/workflow-seed.mjs', ['node:crypto', 'node:fs']],
]);
const discovered = new Set();
const pendingSources = [publicEntry];
while (pendingSources.length) {
  const relative = pendingSources.pop();
  if (discovered.has(relative)) continue;
  discovered.add(relative);
  const source = fs.readFileSync(path.join(repositoryRoot, relative), 'utf8');
  const staticImports = [...source.matchAll(/^import[\s\S]*?from\s+['"]([^'"]+)['"];$/gm)]
    .map((match) => match[1]);
  const sideEffectImports = [...source.matchAll(/^import\s+['"]([^'"]+)['"];$/gm)]
    .map((match) => match[1]);
  const dynamicImports = [...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((match) => match[1]);
  const reexports = [...source.matchAll(/^export[\s\S]*?from\s+['"]([^'"]+)['"];$/gm)]
    .map((match) => match[1]);
  const imports = [...staticImports, ...sideEffectImports, ...dynamicImports, ...reexports];
  const builtins = imports.filter((specifier) => specifier.startsWith('node:')).sort();
  assert.deepEqual(builtins, allowedBuiltins.get(relative) || [], `${relative} builtin closure changed`);
  for (const specifier of imports.filter((item) => item.startsWith('.'))) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
    assert.equal(allowedPublicClosure.has(resolved), true, `${relative} imports unreviewed local source ${resolved}`);
    pendingSources.push(resolved);
  }
  assert.equal(imports.some((item) => !item.startsWith('.') && !item.startsWith('node:')), false,
    `${relative} imports an unreviewed package dependency`);
  const urlTargets = [...source.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)]
    .map((match) => path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])));
  if (relative === 'benchmarks/real-repository-oracle-v1/workflow-seed.mjs') {
    assert.deepEqual(urlTargets, ['benchmarks/real-repository-oracle-v1/workflows-v1.json']);
  } else {
    assert.deepEqual(urlTargets, [], `${relative} gained an unreviewed local URL target`);
  }
  assert.doesNotMatch(source, /\brequire\s*\(/, `${relative} gained an unreviewed CommonJS dependency`);
  for (const target of urlTargets) {
    assert.equal(allowedPublicClosure.has(target), true, `${relative} reads unreviewed local data ${target}`);
    discovered.add(target);
  }
}
assert.deepEqual([...discovered].sort(), [...allowedPublicClosure].sort(),
  'enumerated imports and URL data targets must match the exact byte-audited public closure');
for (const resolved of discovered) {
  assert.doesNotMatch(resolved.normalize('NFKC').toLocaleLowerCase('en-US'),
    /fixture|receipt|grade|controller|attestation/,
    `candidate public closure contains private authority ${resolved}`);
}

console.log('real repository oracle candidate public contract passed');
