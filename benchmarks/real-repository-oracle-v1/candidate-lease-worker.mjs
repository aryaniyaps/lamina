import crypto from 'node:crypto';
import {
  CANDIDATE_ADAPTER_SCHEMA,
  CANDIDATE_PUBLIC_BATCH_SCHEMA,
  CANDIDATE_RAW_SCHEMA,
  canonicalCandidateValue,
  createCandidatePublicBatch,
} from './candidate-contract.mjs';
import {
  digest, materializationBaseDigest, materializationProvenanceDigest,
} from './contract.mjs';
import { loadReviewedFixture } from './fixture-authority.mjs';
import { readRepositoryState } from './repository-state.mjs';

export const CANDIDATE_LEASE_WORKER_RECORD_SCHEMA =
  'lamina.real-repository-oracle-candidate-lease-worker/v1';
export const CANDIDATE_LEASE_WORKER_ADAPTER = Object.freeze({
  schema: CANDIDATE_ADAPTER_SCHEMA,
  id: 'lamina.candidate-smoke-adversary',
  version: 1,
  input_format: CANDIDATE_PUBLIC_BATCH_SCHEMA,
  output_format: CANDIDATE_RAW_SCHEMA,
});

const TIERS = new Set(['small', 'medium', 'large']);
const PHASES = new Set(['first', 'replay']);
const SLOT = /^slot-[1-9]\d*$/;
const NONCE_DOMAIN = 'lamina.real-repository-candidate-lease-public-nonce/v1';

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

function same(left, right) {
  return JSON.stringify(canonicalCandidateValue(left))
    === JSON.stringify(canonicalCandidateValue(right));
}

export function candidateLeaseWorkerPublicNonce({ tier, slot_id, row_order, request }) {
  if (!TIERS.has(tier) || !SLOT.test(slot_id || '')
    || !Number.isSafeInteger(row_order) || row_order < 1
    || typeof request !== 'string' || request.length === 0) {
    throw new TypeError('candidate lease worker requires exact public nonce inputs');
  }
  const requestDigest = crypto.createHash('sha256').update(request).digest();
  return crypto.createHash('sha256')
    .update([NONCE_DOMAIN, tier, slot_id, String(row_order), ''].join('\0'))
    .update(requestDigest)
    .digest('hex');
}

export function repositoryStateForScenario(collection, scenario) {
  const operation = scenario?.operations?.[0];
  const changes = !operation ? []
    : operation.op === 'modify' ? [{
      kind: 'ordinary', path: operation.path, original_path: null, xy: '.M', submodule: 'N...',
    }]
      : operation.op === 'rename' ? [{
        kind: 'renamed', path: operation.to, original_path: operation.path, xy: 'R.', submodule: 'N...',
      }]
        : operation.op === 'delete' ? [{
          kind: 'deleted', path: operation.path, original_path: null, xy: '.D', submodule: 'N...',
        }] : [];
  return {
    head: collection.commit,
    branch: ['branch', 'worktree'].includes(scenario?.kind) ? operation.branch : '(detached)',
    upstream: null,
    ahead: 0,
    behind: 0,
    worktree_role: scenario?.kind === 'worktree' ? operation.worktree_id : 'primary',
    changes,
  };
}

function expectedRepositoryState(collection, scenario) {
  return repositoryStateForScenario(collection, scenario);
}

export function deriveDeterministicCandidateSlot(tier, slot_id) {
  if (!TIERS.has(tier) || !SLOT.test(slot_id || '')) {
    throw new TypeError('deterministic candidate slot inputs are invalid');
  }
  const reviewed = loadReviewedFixture();
  const collection = reviewed.fixture.collections.find((item) => item.fixture_id === tier);
  if (!collection) throw new Error('deterministic candidate slot collection is missing');
  const cases = reviewed.fixture.cases.filter((item) => item.collection_id === collection.id);
  const groups = new Map();
  for (const reviewedCase of cases) {
    const scenarioDigest = digest(reviewedCase.repository_scenario);
    if (!groups.has(scenarioDigest)) groups.set(scenarioDigest, []);
    groups.get(scenarioDigest).push(reviewedCase);
  }
  const slots = [...groups.entries()].map(([scenarioDigest, groupedCases], index) => {
    const resolvedSlotId = `slot-${index + 1}`;
    const privateRows = groupedCases.map((reviewedCase, rowIndex) => ({
      nonce: candidateLeaseWorkerPublicNonce({
        tier,
        slot_id: resolvedSlotId,
        row_order: rowIndex + 1,
        request: reviewedCase.request,
      }),
      order: rowIndex + 1,
      case_id: reviewedCase.id,
    }));
    return {
      slot_id: resolvedSlotId,
      scenario_digest: scenarioDigest,
      provenance_digest: materializationProvenanceDigest(collection, scenarioDigest),
      base_digest: materializationBaseDigest(collection, scenarioDigest),
      scenario: structuredClone(groupedCases[0].repository_scenario),
      private_rows: privateRows,
      public_batch: createCandidatePublicBatch({
        tier,
        requests: privateRows.map((row, rowIndex) => ({
          nonce: row.nonce,
          order: row.order,
          request: groupedCases[rowIndex].request,
        })),
      }),
    };
  });
  const slot = slots.find((item) => item.slot_id === slot_id);
  if (!slot) throw new Error(`deterministic candidate slot ${slot_id} is unknown for tier ${tier}`);
  return deepFreeze(slot);
}

export function candidateLeaseWorkerAuthority({ tier, slot_id, phase }) {
  if (!TIERS.has(tier) || !SLOT.test(slot_id || '') || !PHASES.has(phase)) {
    throw new TypeError('candidate lease worker authority inputs are invalid');
  }
  const slot = deriveDeterministicCandidateSlot(tier, slot_id);
  const reviewed = loadReviewedFixture();
  const collection = reviewed.fixture.collections.find((item) => item.fixture_id === tier);
  if (!collection) throw new Error('candidate lease worker reviewed collection is missing');
  const cases = slot.private_rows.map((row) => {
    const reviewedCase = reviewed.fixture.cases.find((item) => item.id === row.case_id);
    if (!reviewedCase) throw new Error('candidate lease worker slot row case is missing');
    return reviewedCase;
  });
  const repositoryState = expectedRepositoryState(collection, slot.scenario);
  return deepFreeze({
    tier,
    slot_id,
    phase,
    collection: structuredClone(collection),
    scenario: structuredClone(slot.scenario),
    scenario_digest: slot.scenario_digest,
    provenance_digest: slot.provenance_digest,
    base_digest: slot.base_digest,
    public_batch: structuredClone(slot.public_batch),
    expected_repository_state: repositoryState,
    private_rows: structuredClone(slot.private_rows),
    cases: cases.map((item) => structuredClone(item)),
    scenario_digest_authority: digest(slot.scenario),
  });
}

export function candidateLeaseWorkerRecord({
  authority,
  candidate_result_sha256: resultDigest,
  lease,
  release,
  repository_unchanged: unchanged,
  oracle_worker: oracleWorker,
}) {
  if (!authority || typeof authority !== 'object' || !TIERS.has(authority.tier)
    || !SLOT.test(authority.slot_id || '') || !PHASES.has(authority.phase)
    || typeof resultDigest !== 'string' || !/^[a-f0-9]{64}$/.test(resultDigest)
    || !lease || !release || unchanged !== true) {
    throw new Error('candidate lease worker runtime evidence is incomplete');
  }
  if (oracleWorker !== undefined
    && (oracleWorker?.keeper_mount_proven !== true
      || oracleWorker?.broker_finish_verified !== true)) {
    throw new Error('candidate lease worker oracle lifecycle evidence is incomplete');
  }
  const record = canonicalCandidateValue({
    schema: CANDIDATE_LEASE_WORKER_RECORD_SCHEMA,
    workload_id: 'real-repository-oracle-v1:candidate-lease-worker',
    tier: authority.tier,
    slot_id: authority.slot_id,
    phase: authority.phase,
    non_gradeable: true,
    grading_reachable: false,
    cleanup_proof_issued: false,
    public_input_sha256: authority.public_batch.public_input_sha256,
    candidate_result_sha256: resultDigest,
    lease: {
      provenance_digest: lease.provenance_digest,
      start_digest: lease.start_digest,
      end_digest: release.end_digest,
    },
    repository_unchanged: true,
    materializer: {
      cleanup_verified: release.cleanup_verified === true,
      terminal_disposition: release.terminal_disposition,
    },
    ...(oracleWorker ? { oracle_worker: oracleWorker } : {}),
  });
  return deepFreeze(record);
}

export function parseCandidateLeaseWorkerRecordLine(value, authority) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  if (bytes.length < 2 || bytes.length > 16 * 1024
    || bytes.at(-1) !== 0x0a || bytes.subarray(0, -1).includes(0x0a)
    || bytes.includes(0x0d) || bytes.includes(0)) {
    throw new Error('candidate lease worker output must be one bounded LF-terminated line');
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, -1)));
  } catch {
    throw new Error('candidate lease worker output is not exact UTF-8 JSON');
  }
  const expected = candidateLeaseWorkerRecord({
    authority,
    candidate_result_sha256: parsed.candidate_result_sha256,
    lease: parsed.lease,
    release: {
      end_digest: parsed.lease.end_digest,
      cleanup_verified: parsed.materializer.cleanup_verified,
      terminal_disposition: parsed.materializer.terminal_disposition,
    },
    repository_unchanged: parsed.repository_unchanged,
    oracle_worker: parsed.oracle_worker,
  });
  if (!same(parsed, expected)) {
    throw new Error('candidate lease worker output differs from its exact contract');
  }
  return expected;
}
