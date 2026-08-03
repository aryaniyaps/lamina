import crypto from 'node:crypto';
import {
  CANDIDATE_ADAPTER_SCHEMA,
  CANDIDATE_PERSONA_PROBE,
  CANDIDATE_PUBLIC_BATCH_SCHEMA,
  CANDIDATE_RAW_SCHEMA,
  PERSONA_PROBE_EVIDENCE_SCHEMA,
  candidateRawArtifactDigest,
  canonicalCandidateValue,
  createCandidatePublicBatch,
  validateCandidateRawArtifact,
} from './candidate-contract.mjs';
import {
  digest,
  materializationBaseDigest,
  materializationProvenanceDigest,
} from './contract.mjs';
import { loadReviewedFixture } from './fixture-authority.mjs';

export const CANDIDATE_SMOKE_RECORD_MAX_BYTES = 4 * 1024;
export const CANDIDATE_SMOKE_RECORD_SCHEMA =
  'lamina.real-repository-oracle-candidate-smoke/v1';
export const CANDIDATE_SMOKE_ADAPTER = deepFreeze({
  schema: CANDIDATE_ADAPTER_SCHEMA,
  id: 'lamina.candidate-smoke-adversary',
  version: 1,
  input_format: CANDIDATE_PUBLIC_BATCH_SCHEMA,
  output_format: CANDIDATE_RAW_SCHEMA,
});

const NONCE_DOMAIN = 'lamina.real-repository-candidate-smoke-public-nonce/v1';
export const CANDIDATE_SMOKE_SANDBOX_CHECKS = Object.freeze([
  'private-controller-read-denied',
  'proc-metadata-read-denied',
  'command-line-controller-paths-absent',
  'high-inherited-fd-closed',
  'repository-mutation-denied',
  'child-process-denied',
  'tcp-network-denied',
  'udp-network-denied',
  'control-socket-denied',
  'extra-executable-denied',
]);

function deepFreeze(value) {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || Object.isFrozen(current)) continue;
    for (const child of Object.values(current)) pending.push(child);
    Object.freeze(current);
  }
  return value;
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function same(left, right) {
  return JSON.stringify(canonicalCandidateValue(left))
    === JSON.stringify(canonicalCandidateValue(right));
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonicalCandidateValue(value)), 'utf8');
}

export function candidateSmokePublicNonce(value) {
  if (!exactKeys(value, ['tier', 'slot', 'row_order', 'request'])
    || value.tier !== 'small' || value.slot !== 'clean-1'
    || !Number.isSafeInteger(value.row_order) || value.row_order < 1
    || typeof value.request !== 'string' || value.request.length === 0) {
    throw new TypeError('candidate smoke requires exact public nonce inputs');
  }
  const requestDigest = crypto.createHash('sha256').update(value.request).digest();
  return crypto.createHash('sha256')
    .update([NONCE_DOMAIN, value.tier, value.slot, String(value.row_order), ''].join('\0'))
    .update(requestDigest)
    .digest('hex');
}

function artifactFor(publicBatch, collection) {
  const observations = [{ category: 'personas', path: CANDIDATE_PERSONA_PROBE.path }];
  const repositoryState = {
    head: collection.commit,
    branch: '(detached)',
    upstream: null,
    ahead: 0,
    behind: 0,
    worktree_role: 'primary',
    changes: [],
  };
  const artifact = {
    schema: CANDIDATE_RAW_SCHEMA,
    public_input_sha256: publicBatch.public_input_sha256,
    adapter: structuredClone(CANDIDATE_SMOKE_ADAPTER),
    persona_probe: {
      schema: PERSONA_PROBE_EVIDENCE_SCHEMA,
      input_sha256: publicBatch.persona_probe.content_sha256,
      observations,
      observations_sha256: digest(observations),
    },
    rows: publicBatch.requests.map((row) => ({
      nonce: row.nonce,
      order: row.order,
      result: {
        workflow_outcome: 'ambiguous',
        selected_workflow_ids: [],
        workflow_ranking: [],
        source_ranking: [],
        observations: [],
        obligations: [],
        repository_state: structuredClone(repositoryState),
      },
    })),
  };
  const validation = validateCandidateRawArtifact(
    artifact, publicBatch, CANDIDATE_SMOKE_ADAPTER,
  );
  if (!validation.valid) {
    throw new Error(`candidate smoke expected artifact is invalid: ${validation.errors.join('; ')}`);
  }
  return deepFreeze(canonicalCandidateValue(artifact));
}

export function candidateSmokeAuthority() {
  const reviewed = loadReviewedFixture();
  const collection = reviewed.fixture.collections.find((item) => item.fixture_id === 'small');
  if (!collection) throw new Error('candidate smoke requires the reviewed small collection');
  const cases = reviewed.fixture.cases.filter((item) =>
    item.collection_id === collection.id && item.repository_scenario.kind === 'clean');
  if (cases.length !== 19 || cases.some((item) => !same(item.repository_scenario, cases[0].repository_scenario))) {
    throw new Error('candidate smoke requires the exact 19-row small clean scenario group');
  }
  const privateRows = cases.map((item, index) => ({
    case_id: item.id,
    nonce: candidateSmokePublicNonce({
      tier: 'small', slot: 'clean-1', row_order: index + 1, request: item.request,
    }),
    order: index + 1,
  }));
  const publicBatch = createCandidatePublicBatch({
    tier: 'small',
    requests: privateRows.map((row, index) => ({
      nonce: row.nonce, order: row.order, request: cases[index].request,
    })),
  });
  const scenario = structuredClone(cases[0].repository_scenario);
  const scenarioDigest = digest(scenario);
  const expectedArtifact = artifactFor(publicBatch, collection);
  return deepFreeze({
    tier: 'small',
    slot: 'clean-1',
    slot_order: 1,
    phase: 'first',
    collection: structuredClone(collection),
    scenario,
    scenario_digest: scenarioDigest,
    private_rows: privateRows,
    public_batch: structuredClone(publicBatch),
    expected_artifact: structuredClone(expectedArtifact),
    expected_result_sha256: candidateRawArtifactDigest(
      expectedArtifact, publicBatch, CANDIDATE_SMOKE_ADAPTER,
    ),
    expected_lease: {
      provenance_digest: materializationProvenanceDigest(collection, scenarioDigest),
      start_digest: materializationBaseDigest(collection, scenarioDigest),
      end_digest: materializationBaseDigest(collection, scenarioDigest),
    },
    sandbox_checks_sha256: digest(CANDIDATE_SMOKE_SANDBOX_CHECKS),
  });
}

export function expectedCandidateSmokeArtifact(authority) {
  const expected = candidateSmokeAuthority();
  if (!same(authority, expected)) throw new Error('candidate smoke authority differs from reviewed authority');
  return expected.expected_artifact;
}

export function candidateSmokeRecord({
  authority, candidate_result_sha256: resultDigest, lease, release, repository_unchanged: unchanged,
}) {
  const expected = candidateSmokeAuthority();
  if (!same(authority, expected)
    || resultDigest !== expected.expected_result_sha256
    || !same(lease, {
      provenance_digest: expected.expected_lease.provenance_digest,
      start_digest: expected.expected_lease.start_digest,
    })
    || !same(release, {
      end_digest: expected.expected_lease.end_digest,
      cleanup_verified: false,
      terminal_disposition: 'awaiting_supervisor_cleanup',
    })
    || unchanged !== true) {
    throw new Error('candidate smoke runtime evidence differs from its exact non-gradeable contract');
  }
  const record = canonicalCandidateValue({
    schema: CANDIDATE_SMOKE_RECORD_SCHEMA,
    workload_id: 'real-repository-oracle-v1:candidate-smoke-small',
    tier: 'small',
    slot: 'clean-1',
    phase: 'first',
    non_gradeable: true,
    grading_reachable: false,
    cleanup_proof_issued: false,
    public_input_sha256: expected.public_batch.public_input_sha256,
    candidate_result_sha256: expected.expected_result_sha256,
    lease: {
      provenance_digest: expected.expected_lease.provenance_digest,
      start_digest: expected.expected_lease.start_digest,
      end_digest: expected.expected_lease.end_digest,
    },
    sandbox_checks_sha256: expected.sandbox_checks_sha256,
    repository_unchanged: true,
    materializer: {
      cleanup_verified: false,
      terminal_disposition: 'awaiting_supervisor_cleanup',
    },
  });
  const bytes = canonicalBytes(record);
  if (bytes.length + 1 > CANDIDATE_SMOKE_RECORD_MAX_BYTES) {
    throw new Error('candidate smoke record exceeds its canonical output bound');
  }
  return deepFreeze(record);
}

export function parseCandidateSmokeRecordLine(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  if (bytes.length < 2 || bytes.length > CANDIDATE_SMOKE_RECORD_MAX_BYTES
    || bytes.at(-1) !== 0x0a || bytes.subarray(0, -1).includes(0x0a)
    || bytes.includes(0x0d) || bytes.includes(0)) {
    throw new Error('candidate smoke output must be one bounded LF-terminated line');
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, -1)));
  } catch {
    throw new Error('candidate smoke output is not exact UTF-8 JSON');
  }
  const authority = candidateSmokeAuthority();
  const expected = candidateSmokeRecord({
    authority,
    candidate_result_sha256: authority.expected_result_sha256,
    lease: {
      provenance_digest: authority.expected_lease.provenance_digest,
      start_digest: authority.expected_lease.start_digest,
    },
    release: {
      end_digest: authority.expected_lease.end_digest,
      cleanup_verified: false,
      terminal_disposition: 'awaiting_supervisor_cleanup',
    },
    repository_unchanged: true,
  });
  if (!same(parsed, expected) || !bytes.subarray(0, -1).equals(canonicalBytes(expected))) {
    throw new Error('candidate smoke output differs from the exact canonical record');
  }
  return expected;
}
