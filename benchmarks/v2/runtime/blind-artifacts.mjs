#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { indexTree } from './trial-validation.mjs';
import { artifactHash, sha256Bytes, sha256File } from './blinded-package.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const V2 = path.join(ROOT, 'benchmarks', 'v2');
const TEXT_EXTENSIONS = new Set(['.c', '.cc', '.css', '.csv', '.go', '.h', '.html', '.java', '.js', '.json', '.jsx', '.md', '.mjs', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.svg', '.toml', '.ts', '.tsx', '.txt', '.vue', '.yaml', '.yml']);
const METHOD_IDENTIFIER_PATTERN = /(\.lamina(?:[\\/][^"'\s]*)?|\blamina(?:[_-][a-z0-9_-]+)?\b|\.benchmark-reviewers(?:[\\/][^"'\s]*)?|\bbenchmark(?:[_-][a-z0-9_-]+)?\b|\boracle(?:[_-][a-z0-9_-]+)?\b|oracle-answers\.json|\breviewer(?:s)?\b|\breview_hypothesis\b|\bcritic-\d+\b|\bgraph-perspective-\d+\b)/gi;
const METHOD_NEUTRALIZATIONS = [
  [/\.benchmark-reviewers(?:[\\/][^"'\s]*)?/gi, '[review-artifact]'],
  [/\.lamina(?:[\\/][^"'\s]*)?/gi, '[method-artifact]'],
  [/\boracle-answers\.json\b/gi, '[input-artifact]'],
  [/\boracle(?:[_-][a-z0-9_-]+)?\b/gi, 'task_input'],
  [/\blamina(?:[_-][a-z0-9_-]+)?\b/gi, 'product_method'],
  [/\breview_hypothesis\b/gi, 'validation_hypothesis'],
  [/\bpersona_perspective\b/gi, 'stakeholder_perspective'],
  [/\bpersona_hypothesis\b/gi, 'stakeholder_hypothesis'],
  [/\bgraph-perspective-\d+\b/gi, 'independent-analysis'],
  [/\bcritic-\d+\b/gi, 'independent-analysis'],
  [/\breviewers\b/gi, 'independent analyses'],
  [/\breviewer\b/gi, 'independent analysis'],
  [/\breview-/gi, 'evidence-'],
  [/\bbenchmark prompt\b/gi, 'task brief'],
  [/\bbenchmark\b/gi, 'evaluation'],
];

function parseArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) if (argv[index].startsWith('--')) options[argv[index].slice(2)] = argv[++index];
  return options;
}

function sanitizeText(source) {
  let sanitized = source
    .replaceAll(ROOT, '[repository]')
    .replaceAll('/workspace', '[workspace]');
  for (const [pattern, replacement] of METHOD_NEUTRALIZATIONS) sanitized = sanitized.replace(pattern, replacement);
  return sanitized;
}

function sanitizeRelative(relative) {
  return relative.split(path.sep).map((part) => sanitizeText(part).replaceAll('[method-artifact]', 'method-artifact').replaceAll('[review-artifact]', 'review-artifact').replaceAll('[input-artifact]', 'input-artifact')).join(path.sep);
}

function copySanitized(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) copySanitized(path.join(source, entry.name), path.join(destination, sanitizeRelative(entry.name)));
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const extension = path.extname(source).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension) && stat.size <= 8 * 1024 * 1024) fs.writeFileSync(destination, sanitizeText(fs.readFileSync(source, 'utf8')));
  else fs.copyFileSync(source, destination);
}

function scanMethodIdentifiers(root) {
  const leaks = [];
  const files = fs.statSync(root).isDirectory() ? indexTree(root).map((item) => path.join(root, item.path)) : [root];
  for (const file of files) {
    const stat = fs.statSync(file);
    if (stat.size > 8 * 1024 * 1024 || !TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    METHOD_IDENTIFIER_PATTERN.lastIndex = 0;
    if (METHOD_IDENTIFIER_PATTERN.test(fs.readFileSync(file, 'utf8'))) leaks.push(path.relative(root, file) || path.basename(file));
  }
  METHOD_IDENTIFIER_PATTERN.lastIndex = 0;
  return leaks;
}

function artifactId() {
  return `artifact-${randomBytes(10).toString('hex')}`;
}

function ratingTemplate(artifact, dimensions) {
  return {
    artifact_id: artifact.artifact_id,
    rater_id: 'REPLACE_WITH_INDEPENDENT_RATER_ID',
    rating_role: 'primary',
    dimensions: Object.fromEntries(dimensions.map((dimension) => [dimension, null])),
    critical_omissions: [],
    critical_failures: [],
    confidence: 'medium',
    notes: '',
  };
}

const options = parseArgs(process.argv);
for (const key of ['results', 'output', 'key-output', 'protocol-hash', 'track', 'cohort']) if (!options[key]) throw new Error(`Missing --${key}`);
const resultsRoot = path.resolve(options.results);
const output = path.resolve(options.output);
const keyOutput = path.resolve(options['key-output']);
if (keyOutput === output || keyOutput.startsWith(`${output}${path.sep}`)) throw new Error('The secret blind key must be outside the judge-visible blinded directory');
if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Blinded output directory must be new or empty so prior packages are preserved');

const contractRubric = JSON.parse(fs.readFileSync(path.join(V2, 'scoring', 'product-contract-rubric.json'), 'utf8'));
const productRubric = JSON.parse(fs.readFileSync(path.join(V2, 'scoring', 'product-quality-rubric.json'), 'utf8'));
const csv = (value, transform = (item) => item) => value ? new Set(value.split(',').map((item) => transform(item.trim())).filter((item) => item !== '')) : null;
const selectedTasks = csv(options.task);
const selectedArms = csv(options.arm);
const selectedRepeats = csv(options.repeat, (item) => Number(item));
if (selectedRepeats && [...selectedRepeats].some((repeat) => !Number.isInteger(repeat) || repeat < 1)) throw new Error('--repeat must be a comma-separated list of positive integers');
const cellResults = [];
const matchingIncomplete = [];
const cellsRoot = path.join(resultsRoot, 'cells');
if (fs.existsSync(cellsRoot)) {
  for (const cell of fs.readdirSync(cellsRoot).toSorted()) {
    const resultPath = path.join(cellsRoot, cell, 'result.json');
    if (!fs.existsSync(resultPath)) continue;
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    if (result.protocol_hash !== options['protocol-hash'] || result.track !== options.track || result.cohort_id !== options.cohort) continue;
    if (selectedTasks && !selectedTasks.has(result.task_id)) continue;
    if (selectedArms && !selectedArms.has(result.arm)) continue;
    if (selectedRepeats && !selectedRepeats.has(result.repeat)) continue;
    if (result.status === 'complete') cellResults.push(result);
    else matchingIncomplete.push(`${result.id || cell}:${result.status || 'unknown'}`);
  }
}
if (matchingIncomplete.length) throw new Error(`Refusing an incomplete selected package: ${matchingIncomplete.join(', ')}`);
if (!cellResults.length) throw new Error('No complete benchmark cells matched the explicit blinding selection');
const cellIds = cellResults.map((result) => result.id);
if (cellIds.some((id) => !id) || new Set(cellIds).size !== cellIds.length) throw new Error('Selected results require unique cell IDs');
const tasks = [...new Set(cellResults.map((result) => result.task_id))].toSorted();
const arms = [...new Set(cellResults.map((result) => result.arm))].toSorted();
const repeats = [...new Set(cellResults.map((result) => result.repeat))].toSorted((a, b) => a - b);
const sameSet = (expected, actual) => !expected || (expected.size === actual.length && actual.every((item) => expected.has(item)));
if (!sameSet(selectedTasks, tasks)) throw new Error('One or more explicitly selected tasks has no complete matching cell');
if (!sameSet(selectedArms, arms)) throw new Error('One or more explicitly selected arms has no complete matching cell');
if (!sameSet(selectedRepeats, repeats)) throw new Error('One or more explicitly selected repeats has no complete matching cell');
for (const task of tasks) {
  const packages = new Set(cellResults.filter((result) => result.task_id === task).map((result) => result.task_package));
  if (packages.size !== 1 || [...packages].some((item) => !item)) throw new Error(`${task}: selected cells disagree on task_package`);
}
for (const task of tasks) for (const arm of arms) for (const repeat of repeats) {
  const matches = cellResults.filter((result) => result.task_id === task && result.arm === arm && result.repeat === repeat);
  if (matches.length !== 1) throw new Error(`Selected package is not a complete rectangular task x arm x repeat matrix: ${task}/${arm}/r${repeat} has ${matches.length} cells`);
}
fs.mkdirSync(path.join(output, 'artifacts'), { recursive: true });
fs.mkdirSync(path.join(output, 'tasks'), { recursive: true });
fs.mkdirSync(path.join(output, 'rating-templates'), { recursive: true });

const taskBlindIds = new Map();
const publicTasks = [];
const publicArtifacts = [];
const secretMappings = [];
for (const result of cellResults) {
  if (!taskBlindIds.has(result.task_id)) {
    const taskBlindId = `task-${randomBytes(8).toString('hex')}`;
    taskBlindIds.set(result.task_id, taskBlindId);
    const briefSource = path.join(V2, 'corpus', result.task_package, 'brief.md');
    const taskRelative = path.join('tasks', `${taskBlindId}.md`);
    const taskDestination = path.join(output, taskRelative);
    fs.writeFileSync(taskDestination, sanitizeText(fs.readFileSync(briefSource, 'utf8')));
    publicTasks.push({ task_blind_id: taskBlindId, path: taskRelative.split(path.sep).join('/'), sha256: sha256File(taskDestination) });
  }
  const attemptRoot = path.resolve(resultsRoot, result.attempt_path);
  const sources = [
    { kind: 'contract', stage: 'frozen', source: path.join(attemptRoot, 'main-output', result.arm === 'raw' ? 'product-contract.md' : result.arm === 'structured' ? 'benchmark-contract.json' : 'run.json') },
    { kind: 'main_product', stage: 'after_implement', source: path.join(attemptRoot, 'main-output', 'product-stages', 'after-implement') },
    { kind: 'main_product', stage: 'after_fix', source: path.join(attemptRoot, 'main-output', 'product-stages', 'after-fix') },
    { kind: 'transfer_product', stage: 'after_implement', source: path.join(attemptRoot, 'transfer-output', 'product-stages', 'after-implement') },
    { kind: 'transfer_product', stage: 'after_fix', source: path.join(attemptRoot, 'transfer-output', 'product-stages', 'after-fix') },
  ];
  for (const item of sources) {
    if (!fs.existsSync(item.source)) throw new Error(`${result.id}: missing source for ${item.kind}/${item.stage}`);
    const id = artifactId();
    const extension = fs.statSync(item.source).isFile() ? path.extname(item.source) : '';
    const relativeDestination = path.join('artifacts', `${id}${extension}`);
    const destination = path.join(output, relativeDestination);
    copySanitized(item.source, destination);
    const methodLeaks = scanMethodIdentifiers(destination);
    const publicRecord = {
      artifact_id: id,
      task_blind_id: taskBlindIds.get(result.task_id),
      artifact_kind: item.kind,
      stage: item.stage,
      native_format: extension || 'directory',
      path: relativeDestination.split(path.sep).join('/'),
      sha256: artifactHash(destination),
      file_count: fs.statSync(destination).isDirectory() ? indexTree(destination).length : 1,
      method_identifier_scan_passed: methodLeaks.length === 0,
      method_identifier_leaks: methodLeaks,
    };
    publicArtifacts.push(publicRecord);
    secretMappings.push({ ...publicRecord, cell_id: result.id, task_id: result.task_id, arm: result.arm, track: result.track, cohort_id: result.cohort_id, repeat: result.repeat, protocol_hash: result.protocol_hash, cell_input_hash: result.cell_input_hash, source_path: path.relative(resultsRoot, item.source) });
  }
}

for (let index = publicArtifacts.length - 1; index > 0; index -= 1) {
  const swap = randomBytes(4).readUInt32BE(0) % (index + 1);
  [publicArtifacts[index], publicArtifacts[swap]] = [publicArtifacts[swap], publicArtifacts[index]];
}
const manifest = { version: 2, generated_at: new Date().toISOString(), blinded: true, artifact_count: publicArtifacts.length, task_count: taskBlindIds.size, tasks: publicTasks.toSorted((a, b) => a.task_blind_id.localeCompare(b.task_blind_id)), artifacts: publicArtifacts };
if (publicArtifacts.some((artifact) => !artifact.method_identifier_scan_passed)) throw new Error('Blinding failed: method identifiers remain in one or more artifacts');
const manifestPath = path.join(output, 'manifest.json');
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(manifestPath, manifestBytes);
for (const artifact of publicArtifacts) {
  const rubric = artifact.artifact_kind === 'contract' ? contractRubric : productRubric;
  fs.writeFileSync(path.join(output, 'rating-templates', `${artifact.artifact_id}.json`), `${JSON.stringify(ratingTemplate(artifact, Object.keys(rubric.dimensions)), null, 2)}\n`);
}
fs.mkdirSync(path.dirname(keyOutput), { recursive: true });
fs.writeFileSync(keyOutput, `${JSON.stringify({ version: 2, generated_at: manifest.generated_at, results_root: resultsRoot, selection: { protocol_hash: options['protocol-hash'], track: options.track, cohort_id: options.cohort, tasks, arms, repeats }, blinded_manifest_file_sha256: sha256Bytes(manifestBytes), mappings: secretMappings }, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(keyOutput, 0o600);
console.log(`Blinded ${publicArtifacts.length} artifacts across ${taskBlindIds.size} tasks; secret key written outside judge package`);
