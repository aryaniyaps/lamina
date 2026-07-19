#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdapter } from './agent-adapters.mjs';
import { invokeAgent } from './agent-invocation.mjs';
import { prepareRuntimeHome, scrubRuntimeCredentials } from './isolation.mjs';
import { authoredArtifactHash, sha256Bytes, sha256File, verifyPublicBlindedPackage } from './blinded-package.mjs';
import { summarizeRatings } from '../scoring/score-ratings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const V2 = path.join(ROOT, 'benchmarks', 'v2');
const PROMPT_PATH = path.join(V2, 'protocol', 'model-rating-prompt.md');

function parseArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) if (argv[index].startsWith('--')) options[argv[index].slice(2)] = argv[++index];
  return options;
}

function within(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function splitRatingPaths(file) {
  const extension = path.extname(file) || '.json';
  const stem = extension === '.json' ? file.slice(0, -extension.length) : file;
  return { contract: `${stem}.contract.json`, product: `${stem}.product.json` };
}

function validateRating(rating, artifact, judge, rubric) {
  const allowed = new Set(['artifact_id', 'rater_id', 'rating_role', 'dimensions', 'critical_omissions', 'critical_failures', 'confidence', 'notes']);
  const unexpected = Object.keys(rating || {}).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`${artifact.artifact_id}: rating has unexpected fields ${unexpected.join(', ')}`);
  if (rating.artifact_id !== artifact.artifact_id) throw new Error(`${artifact.artifact_id}: model changed artifact_id`);
  if (rating.rater_id !== judge.id) throw new Error(`${artifact.artifact_id}: model changed frozen rater_id`);
  if (rating.rating_role !== 'primary') throw new Error(`${artifact.artifact_id}: model rating_role must be primary`);
  const summary = summarizeRatings([rating], rubric, { minimumPrimaryRaters: 1 });
  if (summary.length !== 1 || !Number.isFinite(summary[0].score)) throw new Error(`${artifact.artifact_id}: model rating did not produce a valid score`);
  return rating;
}

const options = parseArgs(process.argv);
for (const key of ['blinded', 'output', 'evidence']) if (!options[key]) throw new Error(`Missing --${key}`);
const blindedRoot = path.resolve(options.blinded);
const manifestPath = path.join(blindedRoot, 'manifest.json');
const outputPath = path.resolve(options.output);
const splitOutputs = splitRatingPaths(outputPath);
const evidenceRoot = path.resolve(options.evidence);
if (within(blindedRoot, outputPath) || within(blindedRoot, evidenceRoot)) throw new Error('Model ratings and evidence must remain outside the judge-visible blinded package');
const { manifest, packageRoot, manifestFileSha256 } = verifyPublicBlindedPackage(manifestPath);
const release = JSON.parse(fs.readFileSync(path.join(V2, 'release.json'), 'utf8'));
const judge = release.model_judge;
if (!judge?.id || !judge.provider || !(judge.model || judge.resolved_model)) throw new Error('release.json requires a frozen model_judge identity');
const adapter = createAdapter({ provider: judge.provider, model: judge.resolved_model || judge.model, reasoningEffort: judge.reasoning_effort || 'high' });
const prompt = fs.readFileSync(PROMPT_PATH, 'utf8');
const selectedIds = options.artifact ? new Set(options.artifact.split(',').map((item) => item.trim()).filter(Boolean)) : null;
if (selectedIds) for (const id of selectedIds) if (!manifest.artifacts.some((artifact) => artifact.artifact_id === id)) throw new Error(`Unknown --artifact ${id}`);
const artifacts = manifest.artifacts.filter((artifact) => !selectedIds || selectedIds.has(artifact.artifact_id));
let ratings = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, 'utf8')) : [];
if (!Array.isArray(ratings)) throw new Error('Existing model rating output must be a JSON array');
const completed = new Map();
for (const rating of ratings) {
  const artifact = manifest.artifacts.find((item) => item.artifact_id === rating.artifact_id);
  if (!artifact || completed.has(rating.artifact_id)) throw new Error(`Existing model ratings contain an unknown or duplicate artifact ${rating.artifact_id}`);
  const rubric = JSON.parse(fs.readFileSync(path.join(V2, 'scoring', artifact.artifact_kind === 'contract' ? 'product-contract-rubric.json' : 'product-quality-rubric.json'), 'utf8'));
  validateRating(rating, artifact, judge, rubric);
  const evidenceResultPath = path.join(evidenceRoot, rating.artifact_id, 'result.json');
  if (!fs.existsSync(evidenceResultPath)) throw new Error(`${rating.artifact_id}: existing rating has no matching preserved model-judge evidence`);
  const evidenceResult = JSON.parse(fs.readFileSync(evidenceResultPath, 'utf8'));
  if (evidenceResult.status !== 'complete' || evidenceResult.blinded_manifest_file_sha256 !== manifestFileSha256 || evidenceResult.judge?.id !== judge.id || evidenceResult.rating_sha256 !== sha256Bytes(Buffer.from(JSON.stringify(rating)))) throw new Error(`${rating.artifact_id}: existing rating evidence does not match the current package, judge, and rating`);
  completed.set(rating.artifact_id, rating);
}

fs.mkdirSync(evidenceRoot, { recursive: true });
for (const artifact of artifacts) {
  if (completed.has(artifact.artifact_id)) continue;
  verifyPublicBlindedPackage(manifestPath);
  const artifactEvidence = path.join(evidenceRoot, artifact.artifact_id);
  if (fs.existsSync(artifactEvidence)) throw new Error(`${artifact.artifact_id}: evidence directory already exists without a completed rating; preserve it and choose a new evidence root`);
  const workspace = path.join(artifactEvidence, 'workspace');
  const runtimeHome = path.join(artifactEvidence, 'runtime-home');
  fs.mkdirSync(workspace, { recursive: true });
  const task = manifest.tasks.find((item) => item.task_blind_id === artifact.task_blind_id);
  const source = path.resolve(packageRoot, artifact.path);
  const taskSource = path.resolve(packageRoot, task.path);
  const rubricPath = path.join(V2, 'scoring', artifact.artifact_kind === 'contract' ? 'product-contract-rubric.json' : 'product-quality-rubric.json');
  const schemaPath = path.join(V2, 'schemas', artifact.artifact_kind === 'contract' ? 'human-rating.schema.json' : 'product-rating.schema.json');
  const templatePath = path.join(packageRoot, 'rating-templates', `${artifact.artifact_id}.json`);
  const destination = path.join(workspace, 'artifact');
  fs.cpSync(source, destination, { recursive: true, dereference: false });
  fs.copyFileSync(taskSource, path.join(workspace, 'TASK.md'));
  fs.copyFileSync(rubricPath, path.join(workspace, 'RUBRIC.json'));
  fs.copyFileSync(schemaPath, path.join(workspace, 'RATING-SCHEMA.json'));
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  template.rater_id = judge.id;
  template.rating_role = 'primary';
  writeJson(path.join(workspace, 'RATING-TEMPLATE.json'), template);
  writeJson(path.join(workspace, 'ARTIFACT-META.json'), { artifact_id: artifact.artifact_id, task_blind_id: artifact.task_blind_id, artifact_kind: artifact.artifact_kind, stage: artifact.stage, native_format: artifact.native_format });
  const protectedFiles = ['TASK.md', 'RUBRIC.json', 'RATING-SCHEMA.json', 'RATING-TEMPLATE.json', 'ARTIFACT-META.json'];
  const protectedHashes = Object.fromEntries(protectedFiles.map((file) => [file, sha256File(path.join(workspace, file))]));
  const workspaceArtifactHash = authoredArtifactHash(destination);
  const runtime = prepareRuntimeHome(judge.provider, runtimeHome);
  let result;
  try {
    result = invokeAgent({
      adapter,
      sessionId: null,
      prompt,
      workspace,
      timeout: Number(release.judge_timeout_sec || 900) * 1000,
      phase: 'model_rating',
      evidenceRoot: path.join(artifactEvidence, 'agent-evidence'),
      evidenceBase: evidenceRoot,
      runtimeHome: runtime,
      maxTransientRetries: Number(release.agent_transient_retries || 0),
    });
    const ratingPath = path.join(workspace, 'rating.json');
    if (!fs.existsSync(ratingPath)) throw new Error(`${artifact.artifact_id}: model judge did not write rating.json`);
    for (const [file, hash] of Object.entries(protectedHashes)) if (sha256File(path.join(workspace, file)) !== hash) throw new Error(`${artifact.artifact_id}: model judge modified ${file}`);
    if (authoredArtifactHash(destination) !== workspaceArtifactHash) throw new Error(`${artifact.artifact_id}: model judge modified authored artifact content`);
    const rubric = JSON.parse(fs.readFileSync(path.join(workspace, 'RUBRIC.json'), 'utf8'));
    const rating = validateRating(JSON.parse(fs.readFileSync(ratingPath, 'utf8')), artifact, judge, rubric);
    ratings.push(rating);
    completed.set(artifact.artifact_id, rating);
    writeJson(outputPath, ratings);
    writeJson(splitOutputs.contract, ratings.filter((item) => manifest.artifacts.find((artifactRecord) => artifactRecord.artifact_id === item.artifact_id)?.artifact_kind === 'contract'));
    writeJson(splitOutputs.product, ratings.filter((item) => manifest.artifacts.find((artifactRecord) => artifactRecord.artifact_id === item.artifact_id)?.artifact_kind !== 'contract'));
    writeJson(path.join(artifactEvidence, 'result.json'), {
      status: 'complete',
      artifact_id: artifact.artifact_id,
      artifact_sha256: artifact.sha256,
      task_brief_sha256: task.sha256,
      blinded_manifest_file_sha256: manifestFileSha256,
      prompt_sha256: sha256File(PROMPT_PATH),
      rubric_sha256: sha256File(rubricPath),
      schema_sha256: sha256File(schemaPath),
      rating_sha256: sha256Bytes(Buffer.from(JSON.stringify(rating))),
      judge: { id: judge.id, provider: judge.provider, requested_model: judge.model || null, resolved_model: result.telemetry.resolved_model, reasoning_effort: judge.reasoning_effort || 'high' },
      telemetry: result.telemetry,
    });
    fs.rmSync(workspace, { recursive: true, force: true });
  } finally {
    scrubRuntimeCredentials(runtimeHome);
  }
}

writeJson(outputPath, ratings);
writeJson(splitOutputs.contract, ratings.filter((item) => manifest.artifacts.find((artifactRecord) => artifactRecord.artifact_id === item.artifact_id)?.artifact_kind === 'contract'));
writeJson(splitOutputs.product, ratings.filter((item) => manifest.artifacts.find((artifactRecord) => artifactRecord.artifact_id === item.artifact_id)?.artifact_kind !== 'contract'));
console.log(`Model-rated ${artifacts.filter((artifact) => completed.has(artifact.artifact_id)).length}/${artifacts.length} selected blinded artifacts with ${judge.id}; split raw ratings: ${splitOutputs.contract}, ${splitOutputs.product}`);
