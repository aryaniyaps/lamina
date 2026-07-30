import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const packageRoot = path.resolve(import.meta.dirname, '../..');
const modelManifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'retrieval-model-manifest.json'), 'utf8'),
);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function integrity(message, details = {}) {
  const error = new Error(message);
  error.code = 'LAMINA_RETRIEVAL_INTEGRITY';
  error.details = details;
  throw error;
}

export function retrievalRuntimeDirectory() {
  return path.resolve(
    process.env.LAMINA_RETRIEVAL_RUNTIME || path.join(packageRoot, 'retrieval-runtime'),
  );
}

export function retrievalModelManifest() {
  return structuredClone(modelManifest);
}

export function verifyRetrievalModel() {
  if (process.env.LAMINA_TEST_RETRIEVAL_EMBEDDER === 'deterministic') {
    return {
      path: null,
      digest: `test-${modelManifest.sha256}`,
      manifest: retrievalModelManifest(),
      test_only: true,
    };
  }
  const file = path.resolve(
    process.env.LAMINA_RETRIEVAL_MODEL_PATH ||
      path.join(retrievalRuntimeDirectory(), 'model.onnx'),
  );
  let stat;
  try { stat = fs.statSync(file); } catch {}
  if (!stat?.isFile()) {
    integrity(
      'The checksum-managed retrieval model is missing. Reinstall this Lamina release; runtime downloads are disabled.',
      { expected: file, asset: modelManifest.asset_name },
    );
  }
  if (stat.size !== modelManifest.bytes) {
    integrity('The retrieval model has an unexpected size. Reinstall this Lamina release.', {
      file,
      expected_bytes: modelManifest.bytes,
      actual_bytes: stat.size,
    });
  }
  const digest = sha256(file);
  if (digest !== modelManifest.sha256) {
    integrity('The retrieval model checksum is invalid. Reinstall this Lamina release.', {
      file,
      expected_sha256: modelManifest.sha256,
      actual_sha256: digest,
    });
  }
  return { path: file, digest, manifest: retrievalModelManifest(), test_only: false };
}

function assetManifest() {
  const runtime = retrievalRuntimeDirectory();
  const manifestPath = path.join(runtime, 'asset-manifest.json');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (error) {
    integrity(
      'The managed retrieval runtime is missing or corrupt. Reinstall this Lamina release; extensions are never downloaded at runtime.',
      { expected: manifestPath, cause: error.message },
    );
  }
  if (manifest.schema !== 'lamina.retrieval-runtime-assets/v1' || !Array.isArray(manifest.files)) {
    integrity('The managed retrieval runtime manifest is invalid. Reinstall this Lamina release.', {
      manifest: manifestPath,
    });
  }
  return { runtime, manifest };
}

export function verifyRetrievalRuntimeAssets() {
  if (process.env.LAMINA_TEST_RETRIEVAL_NO_EXTENSIONS === '1') {
    return { test_only: true, tokenizer: null, fts: null, vector: null };
  }
  const explicit = {
    tokenizer: process.env.LAMINA_RETRIEVAL_TOKENIZER_PATH,
    fts: process.env.LAMINA_RETRIEVAL_FTS_EXTENSION_PATH,
    vector: process.env.LAMINA_RETRIEVAL_VECTOR_EXTENSION_PATH,
  };
  if (Object.values(explicit).every(Boolean)) {
    for (const [name, file] of Object.entries(explicit)) {
      if (!fs.statSync(path.resolve(file)).isFile()) {
        integrity(`The configured retrieval ${name} asset is not a file.`, { file });
      }
    }
    return Object.fromEntries(Object.entries(explicit).map(([key, value]) => [key, path.resolve(value)]));
  }
  const { runtime, manifest } = assetManifest();
  const resolved = {};
  for (const item of manifest.files) {
    const file = path.resolve(runtime, item.path);
    if (!file.startsWith(`${runtime}${path.sep}`)) {
      integrity('The managed retrieval runtime manifest contains an unsafe path.', { path: item.path });
    }
    let stat;
    try { stat = fs.statSync(file); } catch {}
    if (!stat?.isFile() || stat.size !== item.bytes || sha256(file) !== item.sha256) {
      integrity('A managed retrieval runtime asset failed integrity verification. Reinstall this Lamina release.', {
        path: item.path,
      });
    }
    resolved[item.role] = file;
  }
  for (const role of ['tokenizer', 'fts', 'vector']) {
    if (!resolved[role]) integrity(`The managed retrieval runtime does not contain ${role}.`);
  }
  return resolved;
}
