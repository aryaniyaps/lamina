/** Evaluate whether raw rows satisfy the frozen publish protocol. */
import { readYamlSync } from './yaml.mjs';
import { loadRegistryBySuite } from './harbor-tasks.mjs';
import { benchmarkProtocolSha256 } from './benchmark-provenance.mjs';

function uniq(values) {
  return [...new Set(values.filter((value) => value != null))];
}

export function evaluateClaimReadiness(rows, release) {
  const scopeValues = uniq(rows.map((row) => JSON.stringify(row.claim_scope ?? null)));
  const scope = scopeValues.length === 1 ? JSON.parse(scopeValues[0]) : null;
  const registeredTaskIds = new Set(loadRegistryBySuite('full').map((task) => task.id));
  let expectedTasks;
  let expectedSuite;
  if (scope?.type === 'task' && Array.isArray(scope.task_ids) && scope.task_ids.length === 1) {
    expectedTasks = scope.task_ids;
    expectedSuite = `task:${scope.task_ids[0]}`;
  } else {
    expectedTasks = loadRegistryBySuite(release.publish_suite || 'core').map((task) => task.id);
    expectedSuite = release.publish_suite || 'core';
  }
  const requiredRuns = Number(release.runs_per_arm_publish || 3);
  const reasons = [];
  if (scopeValues.length !== 1 || !scope) reasons.push('trials do not share one declared claim scope');
  if (expectedTasks.some((taskId) => !registeredTaskIds.has(taskId))) {
    reasons.push('claim scope contains an unregistered task');
  }
  const expectedCells = new Set();
  for (const taskId of expectedTasks) {
    for (const arm of ['control', 'treatment']) {
      for (let run = 1; run <= requiredRuns; run++) expectedCells.add(`${taskId}:${arm}:${run}`);
    }
  }

  const counts = new Map();
  for (const row of rows) {
    const key = `${row.lamina_task_id}:${row.lamina_arm}:${Number(row.lamina_run || 1)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const observedCells = new Set(counts.keys());
  const missingCells = [...expectedCells].filter((key) => !observedCells.has(key));
  const unexpectedCells = [...observedCells].filter((key) => !expectedCells.has(key));
  const duplicateCells = [...counts].filter(([, count]) => count !== 1).map(([key, count]) => `${key} (${count})`);
  if (missingCells.length) reasons.push(`missing scheduled cells: ${missingCells.join(', ')}`);
  if (unexpectedCells.length) reasons.push(`unexpected cells outside publish scope: ${unexpectedCells.join(', ')}`);
  if (duplicateCells.length) reasons.push(`duplicate scheduled cells: ${duplicateCells.join(', ')}`);

  const incomplete = rows.filter((row) => row.scoring_incomplete || row.llm_judge_degraded);
  if (incomplete.length) reasons.push(`${incomplete.length} trial(s) have incomplete judge scoring`);
  const nonPublish = rows.filter((row) => row.publish_mode !== true);
  if (nonPublish.length) reasons.push(`${nonPublish.length} trial(s) were not executed in publish mode`);
  const dirty = rows.filter((row) => row.worktree_clean !== true);
  if (dirty.length) reasons.push(`${dirty.length} trial(s) lack a clean-worktree attestation`);
  const recovered = rows.filter((row) => row.recovered_metadata === true);
  if (recovered.length) reasons.push(`${recovered.length} trial(s) use reconstructed metadata`);
  const missingSnapshot = rows.filter(
    (row) => !row.agent_failed && row.artifact_valid && row.workspace_snapshot !== true
  );
  if (missingSnapshot.length) reasons.push(`${missingSnapshot.length} valid trial(s) lack a scored workspace snapshot`);
  const unisolatedQuality = rows.filter(
    (row) => !row.agent_failed && row.quality_isolated !== true
  );
  if (unisolatedQuality.length) reasons.push(`${unisolatedQuality.length} trial(s) lack isolated quality-probe attestation`);

  const protocols = uniq(rows.map((row) => row.protocol_sha256));
  if (protocols.length !== 1 || !protocols[0]) reasons.push('trials do not share one recorded protocol SHA-256');
  const currentProtocol = benchmarkProtocolSha256().sha256;
  if (protocols.length === 1 && protocols[0] !== currentProtocol) {
    reasons.push('recorded protocol SHA-256 does not match the current frozen protocol');
  }
  const commits = uniq(rows.map((row) => row.benchmark_git_commit));
  if (commits.length !== 1 || !commits[0]) reasons.push('trials do not share one recorded benchmark git commit');
  const runtimeImages = uniq(rows.map((row) => row.runtime_image_id));
  if (runtimeImages.length !== 1 || !runtimeImages[0]) reasons.push('trials do not share one recorded runtime image ID');
  const schedulePositions = rows.map((row) => row.schedule_position).filter(Number.isInteger);
  if (schedulePositions.length !== rows.length || new Set(schedulePositions).size !== rows.length) {
    reasons.push('schedule positions are missing or duplicated');
  }

  const badContract = rows.filter(
    (row) =>
      row.results_contract_version !== release.results_contract_version ||
      row.harness_version !== release.harness_version ||
      row.rubric_version !== release.rubric_version
  );
  if (badContract.length) reasons.push(`${badContract.length} trial(s) do not match the frozen release contract`);

  return {
    claim_ready: reasons.length === 0,
    claim_status: reasons.length === 0
      ? scope?.type === 'task'
        ? 'publishable_for_declared_task_only'
        : 'publishable_under_declared_core_scope'
      : 'exploratory_only',
    expected_suite: expectedSuite,
    claim_scope: scope,
    expected_task_ids: expectedTasks,
    required_runs_per_arm: requiredRuns,
    scheduled_cells_expected: expectedCells.size,
    scheduled_cells_observed: observedCells.size,
    protocol_sha256: protocols.length === 1 ? protocols[0] : null,
    current_protocol_sha256: currentProtocol,
    benchmark_git_commit: commits.length === 1 ? commits[0] : null,
    reasons,
  };
}

export function loadReleaseForClaim(root) {
  return readYamlSync(`${root}/benchmarks/release.yaml`);
}
