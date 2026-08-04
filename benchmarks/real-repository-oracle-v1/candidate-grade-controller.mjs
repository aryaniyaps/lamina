import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  ADAPTER_SCHEMA,
  RESULT_SCHEMA,
  digest,
  executeRegisteredMutation,
  materializationBaseDigest,
  materializationProvenanceDigest,
  resultCasesDigest,
  validateResult,
} from './contract.mjs';
import {
  CANDIDATE_PERSONA_PROBE,
  CANDIDATE_RAW_SCHEMA,
  PERSONA_PROBE_EVIDENCE_SCHEMA,
  canonicalCandidateValue,
  createCandidatePublicBatch,
  parseCandidateRawArtifactBytes,
  serializeCandidateRawArtifact,
  validateCandidateAdapter,
} from './candidate-contract.mjs';
import { loadReviewedFixture } from './fixture-authority.mjs';
import { gradeResult } from './grade.mjs';
import { brownfieldSignals } from '../../packages/cli/lib/observation-runtime/node.mjs';
import { verifyIssuedSupervisorCleanupProof } from './supervisor-cleanup-proof.mjs';
import { candidateLeaseWorkerPublicNonce } from './candidate-lease-worker.mjs';
import { CANDIDATE_SMOKE_ADAPTER, reconstructSmokeCandidateArtifact, reconstructSmokeSandboxArtifact } from './candidate-smoke.mjs';
import { hostSmokeCandidateProductionBytes } from './candidate-smoke-host.mjs';

export const CANDIDATE_TIER_PLAN_SCHEMA = 'lamina.real-repository-oracle-candidate-tier-plan/v1';
export const HOST_LEASE_EVIDENCE_SCHEMA = 'lamina.real-repository-oracle-host-lease-evidence/v1';
export const PRODUCTION_OBSERVATION_SOURCE_SHA256 = '2a1de3a0a9a97f695d307f88ee5fe5959c433a815133618cf26c9faf0188906b';

const OBSERVATION_SOURCE = new URL('../../packages/cli/lib/observation-runtime/node.mjs', import.meta.url);
const TIERS = Object.freeze(['small', 'medium', 'large']);
const PHASES = Object.freeze(['first', 'replay']);
const SHA256 = /^[a-f0-9]{64}$/;
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,255}$/;
const ISSUED_PLANS = new WeakSet();
const ISSUED_LEASES = new WeakSet();
const ISSUED_LEASE_AUTHORITY = new WeakMap();
const ISSUED_HANDLE_AUTHORITY = new Map();
const CLEANUP_HOST_INIT = Symbol.for('lamina.supervisor-cleanup-proof.host-init');
const CLEANUP_HOST_MINT = Symbol.for('lamina.supervisor-cleanup-proof.host-mint');
const CLEANUP_HOST = verifyIssuedSupervisorCleanupProof[CLEANUP_HOST_INIT]();

const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

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

function fail(message) {
  throw new Error(`Candidate host reconstruction invalid: ${message}`);
}

function assertObservationSource() {
  const actual = sha256(fs.readFileSync(OBSERVATION_SOURCE));
  if (actual !== PRODUCTION_OBSERVATION_SOURCE_SHA256) {
    fail('production brownfieldSignals source differs from its reviewed identity');
  }
}

function expectedProbeEvidence(publicBatch) {
  assertObservationSource();
  if (JSON.stringify(canonicalCandidateValue(publicBatch.persona_probe))
    !== JSON.stringify(canonicalCandidateValue(CANDIDATE_PERSONA_PROBE))) {
    fail('public Persona probe differs from the fixed candidate-facing input');
  }
  const observed = brownfieldSignals(
    publicBatch.persona_probe.path,
    Buffer.from(publicBatch.persona_probe.content, 'utf8'),
  );
  if (observed.unsupported.length) fail('production Persona probe returned unsupported evidence');
  const observations = observed.categories.map((category) => ({
    category, path: publicBatch.persona_probe.path,
  }));
  return {
    schema: PERSONA_PROBE_EVIDENCE_SCHEMA,
    input_sha256: publicBatch.persona_probe.content_sha256,
    observations,
    observations_sha256: digest(observations),
  };
}

function randomNonce(used) {
  let nonce;
  do nonce = crypto.randomBytes(32).toString('hex'); while (used.has(nonce));
  used.add(nonce);
  return nonce;
}

function fixtureContext(tier) {
  if (!TIERS.includes(tier)) fail('tier must be small, medium, or large');
  const reviewed = loadReviewedFixture();
  const collection = reviewed.fixture.collections.find((item) => item.fixture_id === tier);
  if (!collection) fail(`reviewed fixture lacks tier ${tier}`);
  const cases = reviewed.fixture.cases.filter((item) => item.collection_id === collection.id);
  if (cases.length !== 24) fail(`reviewed tier ${tier} does not contain exactly 24 cases`);
  return { ...reviewed, collection, cases };
}

export function createCandidateTierPlan(tier) {
  const context = fixtureContext(tier);
  const groups = new Map();
  for (const reviewedCase of context.cases) {
    const scenarioDigest = digest(reviewedCase.repository_scenario);
    if (!groups.has(scenarioDigest)) groups.set(scenarioDigest, []);
    groups.get(scenarioDigest).push(reviewedCase);
  }
  if (groups.size !== 6) fail(`reviewed tier ${tier} does not contain exactly six scenario groups`);
  const usedNonces = new Set();
  const slots = [...groups.entries()].map(([scenarioDigest, cases], index) => {
    const privateRows = cases.map((reviewedCase, rowIndex) => ({
      nonce: randomNonce(usedNonces),
      order: rowIndex + 1,
      case_id: reviewedCase.id,
    }));
    return {
      slot_id: `slot-${index + 1}`,
      order: index + 1,
      scenario_digest: scenarioDigest,
      provenance_digest: materializationProvenanceDigest(context.collection, scenarioDigest),
      base_digest: materializationBaseDigest(context.collection, scenarioDigest),
      scenario: structuredClone(cases[0].repository_scenario),
      private_rows: privateRows,
      public_batch: createCandidatePublicBatch({
        tier,
        requests: privateRows.map((row) => ({
          nonce: row.nonce,
          order: row.order,
          request: cases[row.order - 1].request,
        })),
      }),
    };
  });
  const plan = deepFreeze({
    schema: CANDIDATE_TIER_PLAN_SCHEMA,
    tier,
    fixture_digest: context.fixture_digest,
    collection_id: context.collection.id,
    collection_digest: context.collection.collection_digest,
    slots,
  });
  ISSUED_PLANS.add(plan);
  return plan;
}

export function createDeterministicCandidateTierPlan(tier) {
  const context = fixtureContext(tier);
  const groups = new Map();
  for (const reviewedCase of context.cases) {
    const scenarioDigest = digest(reviewedCase.repository_scenario);
    if (!groups.has(scenarioDigest)) groups.set(scenarioDigest, []);
    groups.get(scenarioDigest).push(reviewedCase);
  }
  if (groups.size !== 6) fail(`reviewed tier ${tier} does not contain exactly six scenario groups`);
  const slots = [...groups.entries()].map(([scenarioDigest, cases], index) => {
    const slot_id = `slot-${index + 1}`;
    const privateRows = cases.map((reviewedCase, rowIndex) => ({
      nonce: candidateLeaseWorkerPublicNonce({
        tier,
        slot_id,
        row_order: rowIndex + 1,
        request: reviewedCase.request,
      }),
      order: rowIndex + 1,
      case_id: reviewedCase.id,
    }));
    return {
      slot_id,
      order: index + 1,
      scenario_digest: scenarioDigest,
      provenance_digest: materializationProvenanceDigest(context.collection, scenarioDigest),
      base_digest: materializationBaseDigest(context.collection, scenarioDigest),
      scenario: structuredClone(cases[0].repository_scenario),
      private_rows: privateRows,
      public_batch: createCandidatePublicBatch({
        tier,
        requests: privateRows.map((row, rowIndex) => ({
          nonce: row.nonce,
          order: row.order,
          request: cases[rowIndex].request,
        })),
      }),
    };
  });
  const plan = deepFreeze({
    schema: CANDIDATE_TIER_PLAN_SCHEMA,
    tier,
    fixture_digest: context.fixture_digest,
    collection_id: context.collection.id,
    collection_digest: context.collection.collection_digest,
    slots,
  });
  ISSUED_PLANS.add(plan);
  return plan;
}

export function hostSmokeCandidateRawBytes(plan, slot, collection) {
  return hostSmokeCandidateProductionBytes(slot.public_batch, collection, slot.scenario);
}

export function hostSmokeSandboxRawBytes(plan, slot, collection) {
  const artifact = reconstructSmokeSandboxArtifact(
    slot.public_batch, collection, slot.scenario,
  );
  return serializeCandidateRawArtifact(artifact, slot.public_batch, CANDIDATE_SMOKE_ADAPTER);
}

export function hostCurrentLeaseOpaqueHandle(tier, slot_id, phase) {
  return `candidate-current-${tier}-${slot_id}-${phase}`;
}

function requireIssuedPlan(plan) {
  if (!plan || !ISSUED_PLANS.has(plan)) fail('plan was not issued by this host controller');
  return fixtureContext(plan.tier);
}

export function issueHostLeaseEvidenceFromOuterReport(plan, evidence, outerReport) {
  const proof = verifyIssuedSupervisorCleanupProof[CLEANUP_HOST_MINT](
    CLEANUP_HOST, outerReport, {
      plan,
      slot_id: evidence.slot_id,
      phase: evidence.phase,
      opaque_handle: evidence.opaque_handle,
      end_digest: evidence.end_digest,
    },
  );
  return issueHostLeaseEvidence(plan, evidence, proof);
}

export function issueHostLeaseEvidence(plan, evidence, supervisorCleanupProof) {
  requireIssuedPlan(plan);
  if (!exactKeys(evidence, [
    'schema', 'slot_id', 'phase', 'opaque_handle', 'repository_url', 'resolved_commit',
    'tree_oid', 'candidate_policy_sha256', 'scenario_digest', 'provenance_digest',
    'base_digest', 'start_digest', 'end_digest',
  ]) || evidence.schema !== HOST_LEASE_EVIDENCE_SCHEMA
    || !plan.slots.some((slot) => slot.slot_id === evidence.slot_id)
    || !PHASES.includes(evidence.phase) || !HANDLE.test(evidence.opaque_handle || '')) {
    fail('host lease evidence has invalid identity, slot, phase, or fields');
  }
  if (ISSUED_HANDLE_AUTHORITY.has(evidence.opaque_handle)) {
    fail(`lease handle ${evidence.opaque_handle} was already issued by this host controller`);
  }
  verifyIssuedSupervisorCleanupProof(supervisorCleanupProof, {
    plan, slot_id: evidence.slot_id, phase: evidence.phase,
    opaque_handle: evidence.opaque_handle, end_digest: evidence.end_digest,
  });
  const issued = deepFreeze({ ...structuredClone(evidence), cleanup_verified: true });
  const authority = {
    plan, slot_id: issued.slot_id, phase: issued.phase,
  };
  ISSUED_LEASES.add(issued);
  ISSUED_LEASE_AUTHORITY.set(issued, authority);
  ISSUED_HANDLE_AUTHORITY.set(issued.opaque_handle, authority);
  return issued;
}

function validateLease(plan, slot, phase, lease, collection, handles) {
  if (!lease || !ISSUED_LEASES.has(lease)) fail(`${slot.slot_id}/${phase} lease evidence was not issued by the host`);
  const authority = ISSUED_LEASE_AUTHORITY.get(lease);
  const handleAuthority = ISSUED_HANDLE_AUTHORITY.get(lease.opaque_handle);
  if (handleAuthority !== authority || authority?.plan !== plan
    || authority.slot_id !== slot.slot_id || authority.phase !== phase) {
    fail(`${slot.slot_id}/${phase} lease evidence was issued for different host authority`);
  }
  if (lease.slot_id !== slot.slot_id || lease.phase !== phase) fail(`${slot.slot_id}/${phase} lease correlation differs`);
  if (handles.has(lease.opaque_handle)) fail(`lease handle ${lease.opaque_handle} was reused`);
  handles.add(lease.opaque_handle);
  const expected = {
    repository_url: collection.repository_url,
    resolved_commit: collection.commit,
    tree_oid: collection.tree_oid,
    candidate_policy_sha256: collection.candidate_policy_sha256,
    scenario_digest: slot.scenario_digest,
    provenance_digest: slot.provenance_digest,
    base_digest: slot.base_digest,
    start_digest: slot.base_digest,
    end_digest: slot.base_digest,
    cleanup_verified: true,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (lease[field] !== value) fail(`${slot.slot_id}/${phase} lease ${field} differs from reviewed host authority`);
  }
}

function validateProbe(raw, publicBatch) {
  const expected = expectedProbeEvidence(publicBatch);
  if (JSON.stringify(canonicalCandidateValue(raw.persona_probe))
    !== JSON.stringify(canonicalCandidateValue(expected))) {
    fail('candidate Persona self-report differs from independently recomputed production evidence');
  }
}

function resultAdapter(expectedAdapter) {
  return {
    schema: ADAPTER_SCHEMA,
    id: expectedAdapter.id,
    version: expectedAdapter.version,
    input_format: 'lamina.real-repository-oracle-input/v1',
    output_format: CANDIDATE_RAW_SCHEMA,
  };
}

function normalizedCases(plan, recordsByKey, phase, reviewedCases) {
  const byCase = new Map();
  for (const slot of plan.slots) {
    const raw = recordsByKey.get(`${slot.slot_id}:${phase}`).raw;
    for (const [index, privateRow] of slot.private_rows.entries()) {
      byCase.set(privateRow.case_id, { id: privateRow.case_id, ...structuredClone(raw.rows[index].result) });
    }
  }
  return reviewedCases.map((reviewedCase) => byCase.get(reviewedCase.id));
}

function materializations(plan, recordsByKey, context) {
  const output = [];
  for (const slot of plan.slots) {
    const first = recordsByKey.get(`${slot.slot_id}:first`).lease;
    const replay = recordsByKey.get(`${slot.slot_id}:replay`).lease;
    for (const privateRow of slot.private_rows) output.push({
      case_id: privateRow.case_id,
      repository_url: context.collection.repository_url,
      resolved_commit: context.collection.commit,
      tree_oid: context.collection.tree_oid,
      candidate_policy_sha256: context.collection.candidate_policy_sha256,
      scenario_digest: slot.scenario_digest,
      provenance_digest: slot.provenance_digest,
      base_digest: slot.base_digest,
      first_start_digest: first.start_digest,
      first_end_digest: first.end_digest,
      replay_start_digest: replay.start_digest,
      replay_end_digest: replay.end_digest,
    });
  }
  return output;
}

function mutationEvidence(context, result) {
  const caseIds = new Set(context.cases.map((item) => item.id));
  const registered = context.fixture.mutations.filter((item) => caseIds.has(item.case_id));
  const records = registered.map((mutation) => {
    const mutated = executeRegisteredMutation(context.fixture, result, mutation);
    const grade = gradeResult(context.fixture, mutated);
    const missing = mutation.diagnostic_includes.filter((part) =>
      !grade.diagnostics.some((diagnostic) => diagnostic.includes(part)));
    if (grade.passed || missing.length) {
      fail(`registered mutation ${mutation.id} was not caught with ${JSON.stringify(mutation.diagnostic_includes)}`);
    }
    return {
      id: mutation.id,
      kind: mutation.kind,
      classification: grade.classification,
      diagnostic_includes: [...mutation.diagnostic_includes],
      diagnostics: [...grade.diagnostics],
    };
  });
  return deepFreeze({ registered: registered.length, detected: records.length, records });
}

export function gradeCandidateTierRuns({ plan, expected_adapter: expectedAdapter, records }) {
  const context = requireIssuedPlan(plan);
  const adapterValidation = validateCandidateAdapter(expectedAdapter);
  if (!adapterValidation.valid) fail(adapterValidation.errors.join('; '));
  if (!Array.isArray(records) || records.length !== plan.slots.length * PHASES.length) {
    fail('records do not exactly cover six slots and two independent phases');
  }
  const recordsByKey = new Map();
  const handles = new Set();
  const expectedOrder = plan.slots.flatMap((slot) => PHASES.map((phase) => ({
    slot_id: slot.slot_id, phase,
  })));
  for (const [recordIndex, record] of records.entries()) {
    if (!exactKeys(record, ['slot_id', 'phase', 'raw_bytes', 'lease']) || !PHASES.includes(record.phase)) {
      fail('run record has unexpected fields or phase');
    }
    if (record.slot_id !== expectedOrder[recordIndex].slot_id
      || record.phase !== expectedOrder[recordIndex].phase) {
      fail(`run record ${recordIndex} is reordered or miscorrelated`);
    }
    const slot = plan.slots.find((item) => item.slot_id === record.slot_id);
    if (!slot) fail(`run record references unknown slot ${record.slot_id}`);
    const key = `${record.slot_id}:${record.phase}`;
    if (recordsByKey.has(key)) fail(`duplicate run record ${key}`);
    validateLease(plan, slot, record.phase, record.lease, context.collection, handles);
    let parsed;
    try {
      parsed = parseCandidateRawArtifactBytes(record.raw_bytes, slot.public_batch, expectedAdapter);
    } catch (error) {
      fail(`${key} raw artifact refused: ${error.message}`);
    }
    validateProbe(parsed.artifact, slot.public_batch);
    recordsByKey.set(key, { raw: parsed.artifact, lease: record.lease });
  }
  for (const slot of plan.slots) for (const phase of PHASES) {
    if (!recordsByKey.has(`${slot.slot_id}:${phase}`)) fail(`missing run record ${slot.slot_id}:${phase}`);
  }
  const firstCases = normalizedCases(plan, recordsByKey, 'first', context.cases);
  const replayCases = normalizedCases(plan, recordsByKey, 'replay', context.cases);
  const result = {
    schema: RESULT_SCHEMA,
    adapter: resultAdapter(expectedAdapter),
    fixture_digest: context.fixture_digest,
    collection_id: context.collection.id,
    collection_digest: context.collection.collection_digest,
    evidence_mode: 'oracle_validation',
    claims: {
      end_to_end_runtime: false,
      observation: 'not_measured',
      obligations: 'not_measured',
      source_localization: 'not_measured',
    },
    safety: { mode: 'not_applicable', outcome: 'not_applicable', reason: null, attestation: null },
    cases: firstCases,
    materializations: materializations(plan, recordsByKey, context),
    replay_digest: resultCasesDigest(replayCases),
  };
  const validation = validateResult(result);
  if (!validation.valid) fail(`host-reconstructed Result is invalid: ${validation.errors.join('; ')}`);
  const grade = gradeResult(context.fixture, result);
  return deepFreeze({
    result,
    grade,
    mutations: mutationEvidence(context, result),
  });
}

export function gradeCandidateSideBySide({ plan, current, candidate }) {
  requireIssuedPlan(plan);
  const currentHandles = new Set((current.records || []).map((record) => record?.lease?.opaque_handle));
  if ((candidate.records || []).some((record) => currentHandles.has(record?.lease?.opaque_handle))) {
    fail('side-by-side current and candidate reused a lease handle');
  }
  const currentGrade = gradeCandidateTierRuns({
    plan, expected_adapter: current.adapter, records: current.records,
  });
  const candidateGrade = gradeCandidateTierRuns({
    plan, expected_adapter: candidate.adapter, records: candidate.records,
  });
  return deepFreeze({
    tier: plan.tier,
    public_input_sha256: plan.slots.map((slot) => slot.public_batch.public_input_sha256),
    scenario_digests: plan.slots.map((slot) => slot.scenario_digest),
    base_digests: plan.slots.map((slot) => slot.base_digest),
    current: currentGrade,
    candidate: candidateGrade,
  });
}
