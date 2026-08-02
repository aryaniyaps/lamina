import { ADAPTER_SCHEMA, RESULT_SCHEMA, resultCasesDigest } from './contract.mjs';
import { createMaterializationRegistry } from './materialization-registry.mjs';

function frozenClone(value) {
  const clone = structuredClone(value);
  const freeze = (item) => {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      Object.freeze(item);
      Object.values(item).forEach(freeze);
    }
    return item;
  };
  return freeze(clone);
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter.id !== 'string' || !adapter.id
    || !Number.isInteger(adapter.version) || adapter.version < 1
    || adapter.inputFormat !== 'lamina.real-repository-oracle-input/v1'
    || typeof adapter.outputFormat !== 'string' || !adapter.outputFormat
    || typeof adapter.evaluate !== 'function'
    || !(adapter.normalize === undefined || typeof adapter.normalize === 'function')) {
    throw new Error('adapter contract is invalid');
  }
}

export function adapterInput(reviewedCase, collection, lease) {
  return frozenClone({
    schema: 'lamina.real-repository-oracle-input/v1',
    collection: {
      fixture_id: collection.fixture_id,
      repository_url: collection.repository_url,
      commit: collection.commit,
      collection_digest: collection.collection_digest,
    },
    request: reviewedCase.request,
    materialized_repository: {
      schema: lease.schema,
      opaque_handle: lease.opaque_handle,
      provenance_digest: lease.provenance_digest,
      start_digest: lease.start_digest,
    },
  });
}

async function prepareBases(fixture, collection, registry) {
  const bases = new Map();
  for (const reviewedCase of fixture.cases.filter((item) => item.collection_id === collection.id)) {
    bases.set(reviewedCase.id, await registry.prepare(reviewedCase.repository_scenario, collection));
  }
  return bases;
}

async function runOnce({ reviewedCases, collection, adapter, registry, bases, replay }) {
  const cases = [];
  const leases = new Map();
  for (const reviewedCase of reviewedCases) {
    const base = bases.get(reviewedCase.id);
    if (!base) throw new Error(`immutable repository base is missing for ${reviewedCase.id}`);
    const lease = await registry.lease(base, { adapter_id: adapter.id, replay });
    const input = adapterInput(reviewedCase, collection, lease);
    let normalized;
    let release;
    try {
      const raw = await adapter.evaluate(input, Object.freeze({ resolveRepository: registry.resolve }));
      normalized = typeof adapter.normalize === 'function' ? await adapter.normalize(raw, input) : raw;
    } finally {
      release = await registry.verifyAndRelease(lease);
    }
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) throw new Error('adapter returned an invalid case payload');
    if (Object.hasOwn(normalized, 'id')) throw new Error('adapter output must not supply the private case correlation id');
    cases.push({ id: reviewedCase.id, ...structuredClone(normalized) });
    leases.set(reviewedCase.id, { base, lease, release });
  }
  registry.assertEmpty();
  return { cases, leases };
}

async function evaluateWithPrepared({ fixture, collection, adapter, registry, bases, evidenceMode, claims }) {
  assertAdapter(adapter);
  const reviewedCases = fixture.cases.filter((item) => item.collection_id === collection.id);
  const first = await runOnce({ reviewedCases, collection, adapter, registry, bases, replay: false });
  const replay = await runOnce({ reviewedCases, collection, adapter, registry, bases, replay: true });
  const materializations = reviewedCases.map((reviewedCase) => {
    const left = first.leases.get(reviewedCase.id);
    const right = replay.leases.get(reviewedCase.id);
    if (left.base.content_digest !== right.base.content_digest
      || left.base.provenance_digest !== right.base.provenance_digest) {
      throw new Error('replay did not begin from the same immutable repository base');
    }
    return {
      case_id: reviewedCase.id,
      provenance_digest: left.base.provenance_digest,
      base_digest: left.base.content_digest,
      first_start_digest: left.lease.start_digest,
      first_end_digest: left.release.end_digest,
      replay_start_digest: right.lease.start_digest,
      replay_end_digest: right.release.end_digest,
    };
  });
  return {
    schema: RESULT_SCHEMA,
    adapter: { schema: ADAPTER_SCHEMA, id: adapter.id, version: adapter.version, input_format: adapter.inputFormat, output_format: adapter.outputFormat },
    collection_id: collection.id,
    collection_digest: collection.collection_digest,
    evidence_mode: evidenceMode,
    claims: claims || { end_to_end_runtime: false, observation: 'not_measured', obligations: 'not_measured', source_localization: 'not_measured' },
    safety: evidenceMode === 'oracle_validation'
      ? { mode: 'not_applicable', outcome: 'not_applicable', reason: null, attestation: null }
      : { mode: 'unattested', outcome: 'pending', reason: null, attestation: null },
    cases: first.cases,
    materializations,
    replay_digest: resultCasesDigest(replay.cases),
  };
}

export async function evaluateAdapter({
  fixture, collection, adapter, materializer, evidenceMode = 'oracle_validation', claims = null,
}) {
  const registry = createMaterializationRegistry(materializer);
  const bases = await prepareBases(fixture, collection, registry);
  return evaluateWithPrepared({ fixture, collection, adapter, registry, bases, evidenceMode, claims });
}

export async function evaluateSideBySide({ fixture, collection, current, candidate, materializer }) {
  const registry = createMaterializationRegistry(materializer);
  const bases = await prepareBases(fixture, collection, registry);
  const currentResult = await evaluateWithPrepared({ fixture, collection, adapter: current, registry, bases, evidenceMode: 'oracle_validation', claims: null });
  const candidateResult = await evaluateWithPrepared({ fixture, collection, adapter: candidate, registry, bases, evidenceMode: 'oracle_validation', claims: null });
  return { current: currentResult, candidate: candidateResult };
}
