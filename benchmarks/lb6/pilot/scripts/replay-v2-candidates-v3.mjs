#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeBehavior } from '../../../lib/behavior-grade.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export async function replayV2Candidates({ root = ROOT, write = false } = {}) {
  const pilotRoot = path.join(root, 'benchmarks/lb6/pilot');
  const manifest = JSON.parse(fs.readFileSync(path.join(pilotRoot, 'corpus/manifest.json'), 'utf8'));
  const input = JSON.parse(fs.readFileSync(path.join(pilotRoot, 'reports/v2-accepted-candidates.json'), 'utf8'));
  const cells = [];
  for (const cell of input.cells) {
    const task = manifest.tasks.find((entry) => entry.id === cell.taskId);
    if (!task) throw new Error(`v2 replay task missing from v3 manifest: ${cell.taskId}`);
    const candidateRoot = path.join(
      pilotRoot,
      'sealed-store/objects',
      `candidate-${cell.candidateDigest}`,
      'candidate',
    );
    if (!fs.existsSync(path.join(candidateRoot, 'app.mjs'))) {
      throw new Error(`sealed v2 candidate missing: ${cell.candidateDigest}`);
    }
    const result = await gradeBehavior({
      root: candidateRoot,
      golden: task.golden,
      arm: 'direct',
      phase: 'verify_fix',
      taskId: cell.taskId,
    });
    cells.push({
      ...cell,
      v3Reward: result.reward,
      rawBehavior: result.raw_behavior,
      earned: result.earned,
      possible: result.possible,
      measurementInvalid: result.measurement_invalid,
      measurementInvalidReason: result.measurement_invalid_reason,
      criteria: result.criteria.map(({ id, earned, possible, passed, reason }) => ({ id, earned, possible, passed, reason })),
    });
  }
  const report = {
    kind: 'lb6_v2_candidates_v3_semantic_replay',
    diagnostic_only: true,
    not_v3_benchmark_evidence: true,
    source_campaign_id: input.source_campaign_id,
    target_rubric: 'semantic_criteria_v3',
    generated_at: new Date().toISOString(),
    cells,
  };
  if (write) {
    fs.writeFileSync(
      path.join(pilotRoot, 'reports/v2-semantic-replay-v3.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  return report;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const report = await replayV2Candidates({ write: process.argv.includes('--write') });
  console.log(JSON.stringify(report, null, 2));
}
