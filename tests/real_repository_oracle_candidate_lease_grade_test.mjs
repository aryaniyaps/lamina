#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createDeterministicCandidateTierPlan,
  hostCurrentLeaseOpaqueHandle,
  hostSmokeCandidateRawBytes,
  hostSmokeSandboxRawBytes,
  HOST_LEASE_EVIDENCE_SCHEMA,
  issueHostLeaseEvidenceFromOuterReport,
} from '../benchmarks/real-repository-oracle-v1/candidate-grade-controller.mjs';
import {
  gradeCandidateLeaseWorkerTierFromRuns,
} from '../benchmarks/real-repository-oracle-v1/candidate-lease-worker-controller.mjs';
import { candidateLeaseWorkerAuthority } from '../benchmarks/real-repository-oracle-v1/candidate-lease-worker.mjs';
import { loadReviewedFixture } from '../benchmarks/real-repository-oracle-v1/fixture-authority.mjs';
import { baseReport } from '../scripts/safe-runner/report.mjs';

const PHASES = ['first', 'replay'];

function outerReportFixture() {
  const report = baseReport({
    tier: 'small',
    command: [process.execPath, 'candidate-lease-grade-test'],
    cwd: process.cwd(),
  });
  report.outcome = 'success';
  report.started_at = '2026-08-02T00:00:00.000Z';
  report.finished_at = '2026-08-02T00:00:01.000Z';
  report.duration_ms = 1000;
  report.adapter = {
    id: 'linux-systemd-cgroup-v2',
    production_enforcement: true,
    aggregate_memory: true,
    aggregate_pids: true,
    complete_descendant_ownership: true,
    temporary_quota: true,
  };
  report.limits = {
    memory_max_bytes: 512 * 1024 * 1024,
    memory_high_bytes: 384 * 1024 * 1024,
    pids_max: 32,
    timeout_ms: 180_000,
    temporary_max_bytes: 512 * 1024 * 1024,
    temporary_max_inodes: 8192,
    output_max_bytes: 256 * 1024,
    stdout_tail_max_bytes: 8 * 1024,
    stderr_tail_max_bytes: 8 * 1024,
    graceful_stop_ms: 5000,
  };
  report.preflight = { ok: true, workload_id: 'test', launch_profile: 'production' };
  report.samples = [{
    elapsed_ms: 1,
    aggregate_rss_bytes: 1,
    cgroup_memory_bytes: 1,
    pids: 1,
    temporary_bytes: 1,
    temporary_inodes: 1,
  }];
  report.peaks = {
    aggregate_rss_bytes: 1,
    cgroup_memory_bytes: 1,
    pids: 1,
    temporary_bytes: 1,
    temporary_inodes: 1,
  };
  report.descendants = [];
  report.output = {
    stdout_bytes: 0,
    stderr_bytes: 0,
    total_bytes: 0,
    stdout_tail: '',
    stderr_tail: '',
    truncated: false,
  };
  report.termination = {
    reason: 'completed',
    limit: null,
    requested_signals: [],
    child_exit_code: 0,
    child_signal: null,
    cgroup_events: {},
  };
  report.cleanup = {
    attempted: true,
    descendants_remaining: [],
    managed_paths_remaining: [],
    scope_removed: true,
    temporary_directory_removed: true,
    lock_released: null,
    errors: [],
  };
  report.error = null;
  return report;
}

const tier = 'small';
const plan = createDeterministicCandidateTierPlan(tier);
const collection = loadReviewedFixture().fixture.collections.find((item) => item.id === plan.collection_id);
const runs = [];
for (const slot of plan.slots) {
  for (const phase of PHASES) {
    const authority = candidateLeaseWorkerAuthority({ tier, slot_id: slot.slot_id, phase });
    const raw_bytes = hostSmokeSandboxRawBytes(plan, slot, collection);
    const digest = crypto.createHash('sha256').update(raw_bytes).digest('hex');
    const report = outerReportFixture();
    const lease_evidence = issueHostLeaseEvidenceFromOuterReport(plan, {
      schema: HOST_LEASE_EVIDENCE_SCHEMA,
      slot_id: slot.slot_id,
      phase,
      opaque_handle: `candidate-lease-${tier}-${slot.slot_id}-${phase}`,
      repository_url: collection.repository_url,
      resolved_commit: collection.commit,
      tree_oid: collection.tree_oid,
      candidate_policy_sha256: collection.candidate_policy_sha256,
      scenario_digest: slot.scenario_digest,
      provenance_digest: slot.provenance_digest,
      base_digest: slot.base_digest,
      start_digest: slot.base_digest,
      end_digest: slot.base_digest,
    }, report);
    runs.push({
      slot_id: slot.slot_id,
      phase,
      authority,
      report,
      worker: {
        candidate_result_sha256: digest,
        lease: {
          provenance_digest: authority.provenance_digest,
          start_digest: authority.base_digest,
          end_digest: authority.base_digest,
        },
      },
      lease_evidence,
    });
  }
}

await assert.rejects(
  () => gradeCandidateLeaseWorkerTierFromRuns({ tier, runs, plan, collection }),
  /registered mutation/,
  'smoke placeholder reaches mutation evidence before quality gates',
);
assert.equal(createDeterministicCandidateTierPlan('small').slots.length, 6);
assert.equal(hostCurrentLeaseOpaqueHandle('small', 'slot-1', 'first'),
  'candidate-current-small-slot-1-first');

console.log('real repository oracle candidate lease grade matrix wiring passed');
