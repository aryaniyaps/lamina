#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { verifyBlindedKey } from '../runtime/blinded-package.mjs';

function parseArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) if (argv[index].startsWith('--')) options[argv[index].slice(2)] = argv[++index];
  return options;
}

function readScoreFiles(value) {
  if (!value) return [];
  return value.split(',').flatMap((file) => {
    const document = JSON.parse(fs.readFileSync(path.resolve(file.trim()), 'utf8'));
    return Array.isArray(document) ? document : document.ratings || document.scores || [];
  });
}

function scoreMap(items, label) {
  const map = new Map();
  for (const item of items) {
    if (!item.artifact_id || map.has(item.artifact_id)) throw new Error(`${label}: missing or duplicate artifact_id ${item.artifact_id || '(missing)'}`);
    if (item.adjudication_complete === false || !Number.isFinite(item.score)) throw new Error(`${label}: ${item.artifact_id} has no final adjudicated score`);
    map.set(item.artifact_id, item);
  }
  return map;
}

function elapsedThrough(telemetry, terminalPhase) {
  let elapsed = 0;
  for (const phase of telemetry) {
    if (Number.isFinite(phase.duration_ms)) elapsed += phase.duration_ms;
    if (phase.phase === terminalPhase) return elapsed / 1000;
  }
  return null;
}

function sumPhase(telemetry, phaseName, field) {
  const phases = telemetry.filter((item) => item.phase === phaseName);
  for (const item of phases) {
    if (!['session_delta', 'phase_total'].includes(item.usage_accounting)) throw new Error(`${phaseName}: missing explicit usage accounting`);
  }
  const values = phases.map((item) => item[field]);
  return values.length && values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : null;
}

const options = parseArgs(process.argv);
for (const key of ['results', 'blind-key', 'blinded-manifest', 'human-scores', 'thresholds', 'output']) if (!options[key]) throw new Error(`Missing --${key}`);
const resultsRoot = path.resolve(options.results);
const { key: blindKey, manifest } = verifyBlindedKey({ manifestPath: options['blinded-manifest'], keyPath: options['blind-key'], resultsRoot });
const thresholds = JSON.parse(fs.readFileSync(path.resolve(options.thresholds), 'utf8'));
if (!Number.isFinite(thresholds.product_quality_threshold)) throw new Error('Thresholds require product_quality_threshold');
const human = scoreMap(readScoreFiles(options['human-scores']), 'human scores');
const model = scoreMap(readScoreFiles(options['model-scores']), 'model scores');
const selectedArtifactIds = new Set(manifest.artifacts.map((artifact) => artifact.artifact_id));
const unexpectedHuman = [...human.keys()].filter((id) => !selectedArtifactIds.has(id));
if (unexpectedHuman.length) throw new Error(`human scores: artifacts are not in the verified blinded package: ${unexpectedHuman.join(', ')}`);
const missingHuman = [...selectedArtifactIds].filter((id) => !human.has(id));
if (missingHuman.length) throw new Error(`human scores: verified blinded artifacts are missing: ${missingHuman.join(', ')}`);
if (model.size) {
  const unexpectedModel = [...model.keys()].filter((id) => !selectedArtifactIds.has(id));
  const missingModel = [...selectedArtifactIds].filter((id) => !model.has(id));
  if (unexpectedModel.length || missingModel.length) throw new Error(`model scores must cover exactly the verified blinded package; unexpected=${unexpectedModel.join(',') || 'none'} missing=${missingModel.join(',') || 'none'}`);
}
const byCell = new Map();
for (const mapping of blindKey.mappings || []) {
  if (!byCell.has(mapping.cell_id)) byCell.set(mapping.cell_id, []);
  byCell.get(mapping.cell_id).push(mapping);
}

const records = [];
for (const [cellId, mappings] of byCell) {
  const resultPath = path.join(resultsRoot, 'cells', cellId, 'result.json');
  if (!fs.existsSync(resultPath)) throw new Error(`${cellId}: result.json missing`);
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  if (result.status !== 'complete') throw new Error(`${cellId}: cannot score non-complete cell`);
  if (mappings.some((item) => item.cell_id !== result.id || item.task_id !== result.task_id || item.arm !== result.arm || item.track !== result.track || item.cohort_id !== result.cohort_id || item.repeat !== result.repeat)) throw new Error(`${cellId}: blind key cell identity mismatch`);
  if (mappings.some((item) => item.protocol_hash !== result.protocol_hash)) throw new Error(`${cellId}: blind key protocol hash mismatch`);
  if (mappings.some((item) => item.cell_input_hash !== result.cell_input_hash)) throw new Error(`${cellId}: blind key cell input hash mismatch`);
  const find = (kind, stage) => {
    const mapping = mappings.find((item) => item.artifact_kind === kind && item.stage === stage);
    if (!mapping) throw new Error(`${cellId}: missing blinded ${kind}/${stage}`);
    const score = human.get(mapping.artifact_id);
    if (!score) throw new Error(`${cellId}: missing human score for ${mapping.artifact_id}`);
    return { mapping, score };
  };
  const contract = find('contract', 'frozen');
  const mainImplement = find('main_product', 'after_implement');
  const mainFix = find('main_product', 'after_fix');
  const transferImplement = find('transfer_product', 'after_implement');
  const transferFix = find('transfer_product', 'after_fix');
  const attemptRoot = path.resolve(resultsRoot, result.attempt_path);
  const mainTelemetry = JSON.parse(fs.readFileSync(path.join(attemptRoot, 'main-output', 'telemetry.json'), 'utf8'));
  const transferTelemetry = JSON.parse(fs.readFileSync(path.join(attemptRoot, 'transfer-output', 'telemetry.json'), 'utf8'));
  const firstThreshold = mainImplement.score.score >= thresholds.product_quality_threshold
    ? elapsedThrough(mainTelemetry, 'implement')
    : mainFix.score.score >= thresholds.product_quality_threshold
      ? elapsedThrough(mainTelemetry, 'fix')
      : null;
  const modelContract = model.get(contract.mapping.artifact_id)?.score ?? null;
  records.push({
    task_id: result.task_id,
    arm: result.arm,
    track: result.track,
    cohort_id: result.cohort_id,
    repeat: result.repeat,
    protocol_hash: result.protocol_hash,
    cell_input_hash: result.cell_input_hash,
    contract_score: contract.score.score,
    contract_model_score: modelContract,
    main_after_implement_score: mainImplement.score.score,
    main_after_fix_score: mainFix.score.score,
    transfer_after_implement_score: transferImplement.score.score,
    transfer_after_fix_score: transferFix.score.score,
    transfer_score: transferFix.score.score,
    contract_critical_omissions: contract.score.critical_omissions,
    contract_critical_failures: contract.score.critical_failures,
    transfer_critical_omissions: transferFix.score.critical_omissions,
    transfer_critical_failures: transferFix.score.critical_failures,
    incomplete: firstThreshold === null,
    time_to_threshold: firstThreshold,
    rework_tokens: sumPhase(mainTelemetry, 'fix', 'input_tokens') === null || sumPhase(mainTelemetry, 'fix', 'output_tokens') === null ? null : sumPhase(mainTelemetry, 'fix', 'input_tokens') + sumPhase(mainTelemetry, 'fix', 'output_tokens'),
    rework_tool_calls: sumPhase(mainTelemetry, 'fix', 'tool_calls'),
    transfer_rework_tokens: sumPhase(transferTelemetry, 'transfer_fix', 'input_tokens') === null || sumPhase(transferTelemetry, 'transfer_fix', 'output_tokens') === null ? null : sumPhase(transferTelemetry, 'transfer_fix', 'input_tokens') + sumPhase(transferTelemetry, 'transfer_fix', 'output_tokens'),
    artifact_ids: { contract: contract.mapping.artifact_id, main_after_implement: mainImplement.mapping.artifact_id, main_after_fix: mainFix.mapping.artifact_id, transfer_after_implement: transferImplement.mapping.artifact_id, transfer_after_fix: transferFix.mapping.artifact_id },
    evidence_path: result.attempt_path,
  });
}

const hashes = new Set(records.map((record) => record.protocol_hash));
if (hashes.size !== 1) throw new Error(`Refusing to combine ${hashes.size} incompatible protocol hashes`);
fs.writeFileSync(path.resolve(options.output), records.map((record) => JSON.stringify(record)).join('\n') + '\n');
console.log(`Assembled ${records.length} reconstructable scored trials under protocol ${[...hashes][0]}`);
