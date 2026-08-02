import { ADAPTER_SCHEMA, RESULT_SCHEMA, resultCasesDigest } from './contract.mjs';

function frozenClone(value) {
  const clone = structuredClone(value);
  const freeze = (item) => {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      Object.freeze(item);
      for (const value of Object.values(item)) freeze(value);
    }
    return item;
  };
  return freeze(clone);
}

function assertMaterialized(value) {
  const keys = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort() : [];
  if (JSON.stringify(keys) !== JSON.stringify([
    'materialization_digest', 'opaque_handle', 'schema',
  ]) || value.schema !== 'lamina.materialized-repository/v1'
    || typeof value.opaque_handle !== 'string' || !value.opaque_handle
    || !/^[a-f0-9]{64}$/.test(value.materialization_digest)) {
    throw new Error('trusted materializer returned an invalid content-addressed descriptor');
  }
  return frozenClone(value);
}

export async function materializeCases({ fixture, collection, materializer }) {
  if (!materializer || typeof materializer.materialize !== 'function') {
    throw new Error('trusted materializer contract is invalid');
  }
  const output = new Map();
  for (const reviewedCase of fixture.cases.filter((item) => item.collection_id === collection.id)) {
    const materialized = await materializer.materialize(
      frozenClone(reviewedCase.repository_scenario), frozenClone(collection),
    );
    output.set(reviewedCase.id, assertMaterialized(materialized));
  }
  return output;
}

export function adapterInput(reviewedCase, collection, materialized) {
  return frozenClone({
    schema: 'lamina.real-repository-oracle-input/v1',
    case_id: reviewedCase.id,
    collection: {
      id: collection.id,
      fixture_id: collection.fixture_id,
      repository_url: collection.repository_url,
      commit: collection.commit,
      collection_digest: collection.collection_digest,
    },
    request: reviewedCase.request,
    materialized_repository: materialized,
  });
}

export async function evaluateAdapter({
  fixture, collection, adapter, materializer, evidenceMode = 'oracle_validation',
  materializations = null, claims = null, safetyEvidence = null,
}) {
  if (!adapter || typeof adapter.id !== 'string' || !Number.isInteger(adapter.version)
    || adapter.inputFormat !== 'lamina.real-repository-oracle-input/v1'
    || typeof adapter.outputFormat !== 'string' || !adapter.outputFormat
    || typeof adapter.evaluate !== 'function'
    || !(adapter.normalize === undefined || typeof adapter.normalize === 'function')) {
    throw new Error('adapter contract is invalid');
  }
  if (evidenceMode !== 'oracle_validation' && !safetyEvidence) {
    throw new Error('measured evaluation requires trusted safety evidence');
  }
  const reviewedCases = fixture.cases.filter((item) => item.collection_id === collection.id);
  const snapshots = materializations || await materializeCases({ fixture, collection, materializer });
  const evaluate = async () => {
    const output = [];
    for (const reviewedCase of reviewedCases) {
      const materialized = snapshots.get(reviewedCase.id);
      if (!materialized) throw new Error(`materialized repository is missing for ${reviewedCase.id}`);
      const input = adapterInput(reviewedCase, collection, materialized);
      const raw = await adapter.evaluate(input);
      output.push(typeof adapter.normalize === 'function'
        ? await adapter.normalize(raw, input) : raw);
    }
    return output;
  };
  const cases = await evaluate();
  const replay = await evaluate();
  return {
    schema: RESULT_SCHEMA,
    adapter: {
      schema: ADAPTER_SCHEMA, id: adapter.id, version: adapter.version,
      input_format: adapter.inputFormat, output_format: adapter.outputFormat,
    },
    collection_id: collection.id,
    collection_digest: collection.collection_digest,
    evidence_mode: evidenceMode,
    claims: claims || {
      end_to_end_runtime: false,
      observation: 'not_measured',
      obligations: 'not_measured',
      source_localization: 'not_measured',
    },
    safety: evidenceMode === 'oracle_validation'
      ? { outcome: 'not_applicable', reason: null, cleanup_verified: false }
      : structuredClone(safetyEvidence),
    cases,
    replay_digest: resultCasesDigest(replay),
  };
}

export async function evaluateSideBySide({ fixture, collection, current, candidate, materializer }) {
  const materializations = await materializeCases({ fixture, collection, materializer });
  const currentResult = await evaluateAdapter({
    fixture, collection, adapter: current, materializations,
  });
  const candidateResult = await evaluateAdapter({
    fixture, collection, adapter: candidate, materializations,
  });
  return { current: currentResult, candidate: candidateResult };
}

export function safetyBlockedResult({
  collection, adapterId, reason, cleanupVerified, evidenceMode = 'public_cli',
}) {
  if (typeof cleanupVerified !== 'boolean') {
    throw new Error('blocked result requires caller-supplied cleanup evidence');
  }
  return {
    schema: RESULT_SCHEMA,
    adapter: {
      schema: ADAPTER_SCHEMA, id: adapterId, version: 1,
      input_format: 'lamina.real-repository-oracle-input/v1',
      output_format: 'lamina.real-repository-oracle-result-case/v1',
    },
    collection_id: collection.id,
    collection_digest: collection.collection_digest,
    evidence_mode: evidenceMode,
    claims: {
      end_to_end_runtime: false,
      observation: 'not_measured',
      obligations: 'not_measured',
      source_localization: 'not_measured',
    },
    safety: { outcome: 'blocked', reason, cleanup_verified: cleanupVerified },
    cases: [],
    replay_digest: null,
  };
}
