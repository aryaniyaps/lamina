import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { indexTree } from './trial-validation.mjs';
import { isReviewSourcePath } from './workspace-snapshot.mjs';

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

export function treeHash(root) {
  const hash = createHash('sha256');
  for (const file of indexTree(root)) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function artifactHash(source) {
  return fs.statSync(source).isDirectory() ? treeHash(source) : sha256File(source);
}

export function authoredArtifactHash(source) {
  if (!fs.statSync(source).isDirectory()) return sha256File(source);
  const hash = createHash('sha256');
  for (const file of indexTree(source).filter((item) => isReviewSourcePath(item.path))) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function safePackagePath(packageRoot, relative, label) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error(`${label}: path must be a nonempty package-relative path`);
  const resolved = path.resolve(packageRoot, relative);
  if (resolved === packageRoot || !resolved.startsWith(`${packageRoot}${path.sep}`)) throw new Error(`${label}: path escapes the blinded package`);
  return resolved;
}

function uniqueRecords(records, key, label) {
  const values = records.map((record) => record?.[key]);
  if (values.some((value) => typeof value !== 'string' || !value)) throw new Error(`${label}: every record requires ${key}`);
  if (new Set(values).size !== values.length) throw new Error(`${label}: duplicate ${key}`);
}

export function verifyPublicBlindedPackage(manifestPath) {
  const resolvedManifest = path.resolve(manifestPath);
  const packageRoot = path.dirname(resolvedManifest);
  const manifestBytes = fs.readFileSync(resolvedManifest);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.version !== 2 || manifest.blinded !== true) throw new Error('Blinded manifest must be version 2 and marked blinded');
  if (!Array.isArray(manifest.tasks) || !Array.isArray(manifest.artifacts)) throw new Error('Blinded manifest requires task and artifact arrays');
  if (manifest.task_count !== manifest.tasks.length || manifest.artifact_count !== manifest.artifacts.length) throw new Error('Blinded manifest counts do not match its records');
  uniqueRecords(manifest.tasks, 'task_blind_id', 'blinded tasks');
  uniqueRecords(manifest.artifacts, 'artifact_id', 'blinded artifacts');
  const taskIds = new Set(manifest.tasks.map((task) => task.task_blind_id));
  for (const task of manifest.tasks) {
    const source = safePackagePath(packageRoot, task.path, task.task_blind_id);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`${task.task_blind_id}: blinded task brief is missing`);
    if (sha256File(source) !== task.sha256) throw new Error(`${task.task_blind_id}: blinded task brief hash mismatch`);
  }
  for (const artifact of manifest.artifacts) {
    if (!taskIds.has(artifact.task_blind_id)) throw new Error(`${artifact.artifact_id}: unknown task_blind_id`);
    if (!['contract', 'main_product', 'transfer_product'].includes(artifact.artifact_kind)) throw new Error(`${artifact.artifact_id}: invalid artifact_kind`);
    if (!['frozen', 'after_implement', 'after_fix'].includes(artifact.stage)) throw new Error(`${artifact.artifact_id}: invalid stage`);
    const source = safePackagePath(packageRoot, artifact.path, artifact.artifact_id);
    if (!fs.existsSync(source)) throw new Error(`${artifact.artifact_id}: blinded artifact is missing`);
    if (artifactHash(source) !== artifact.sha256) throw new Error(`${artifact.artifact_id}: blinded artifact hash mismatch`);
    const count = fs.statSync(source).isDirectory() ? indexTree(source).length : 1;
    if (count !== artifact.file_count) throw new Error(`${artifact.artifact_id}: blinded artifact file count mismatch`);
    if (artifact.method_identifier_scan_passed !== true || (artifact.method_identifier_leaks || []).length) throw new Error(`${artifact.artifact_id}: method identifier scan is not clean`);
  }
  return { manifest, manifestPath: resolvedManifest, packageRoot, manifestFileSha256: sha256Bytes(manifestBytes) };
}

function publicMappingRecord(mapping) {
  return Object.fromEntries(['artifact_id', 'task_blind_id', 'artifact_kind', 'stage', 'native_format', 'path', 'sha256', 'file_count', 'method_identifier_scan_passed', 'method_identifier_leaks'].map((key) => [key, mapping[key]]));
}

export function verifyBlindedKey({ manifestPath, keyPath, resultsRoot }) {
  const verified = verifyPublicBlindedPackage(manifestPath);
  const resolvedKey = path.resolve(keyPath);
  if ((fs.statSync(resolvedKey).mode & 0o077) !== 0) throw new Error('Blind key permissions must exclude group and other access');
  const key = JSON.parse(fs.readFileSync(resolvedKey, 'utf8'));
  if (key.version !== 2) throw new Error('Blind key must be version 2');
  if (key.blinded_manifest_file_sha256 !== verified.manifestFileSha256) throw new Error('Blind key does not match the exact blinded manifest file bytes');
  if (resultsRoot && path.resolve(key.results_root) !== path.resolve(resultsRoot)) throw new Error('Blind key results_root does not match --results');
  if (!Array.isArray(key.mappings)) throw new Error('Blind key has no mappings array');
  if (!key.selection?.protocol_hash || !key.selection.track || !key.selection.cohort_id || !Array.isArray(key.selection.tasks) || !Array.isArray(key.selection.arms) || !Array.isArray(key.selection.repeats)) throw new Error('Blind key has no complete explicit selection');
  uniqueRecords(key.mappings, 'artifact_id', 'blind key mappings');
  const publicById = new Map(verified.manifest.artifacts.map((artifact) => [artifact.artifact_id, artifact]));
  if (publicById.size !== key.mappings.length) throw new Error('Blind key and public manifest contain different artifact counts');
  for (const mapping of key.mappings) {
    const publicRecord = publicById.get(mapping.artifact_id);
    if (!publicRecord) throw new Error(`${mapping.artifact_id}: blind key mapping is absent from public manifest`);
    if (JSON.stringify(publicMappingRecord(mapping)) !== JSON.stringify(publicMappingRecord(publicRecord))) throw new Error(`${mapping.artifact_id}: blind key public fields do not match manifest`);
    for (const field of ['cell_id', 'task_id', 'arm', 'track', 'cohort_id', 'protocol_hash', 'cell_input_hash', 'source_path']) {
      if (mapping[field] === undefined || mapping[field] === null || mapping[field] === '') throw new Error(`${mapping.artifact_id}: blind key mapping lacks ${field}`);
    }
    if (!Number.isInteger(mapping.repeat) || mapping.repeat < 1) throw new Error(`${mapping.artifact_id}: invalid repeat`);
    if (mapping.protocol_hash !== key.selection.protocol_hash || mapping.track !== key.selection.track || mapping.cohort_id !== key.selection.cohort_id || !key.selection.tasks.includes(mapping.task_id) || !key.selection.arms.includes(mapping.arm) || !key.selection.repeats.includes(mapping.repeat)) throw new Error(`${mapping.artifact_id}: mapping falls outside the blind key selection`);
  }
  return { ...verified, key, keyPath: resolvedKey };
}
