import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedPhysicalFile } from './physical-files.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, 'fixture/manifest.json');
const MAX_MANIFEST_BYTES = 32 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function fixtureMetadata() {
  const manifestBytes = readBoundedPhysicalFile(MANIFEST, MAX_MANIFEST_BYTES);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest?.schema !== 'lamina.runtime-benchmark-fixture-manifest/v1'
    || manifest.id !== 'tiny-runtime-lifecycle' || manifest.version !== 1
    || !Array.isArray(manifest.tracked_files) || !Array.isArray(manifest.indexed_files)
    || !Number.isSafeInteger(manifest.child_processes) || manifest.child_processes < 1) {
    throw new Error('unsupported runtime benchmark fixture manifest');
  }
  const readDeclared = (relative) => {
    if (typeof relative !== 'string' || path.isAbsolute(relative)
      || relative.split('/').includes('..')) throw new Error('fixture path escapes runtime-v1');
    return { relative, bytes: readBoundedPhysicalFile(path.resolve(HERE, relative), MAX_SOURCE_BYTES) };
  };
  const tracked = manifest.tracked_files.map(readDeclared);
  const uniqueTracked = new Set(tracked.map((item) => item.relative));
  const indexedNames = new Set(manifest.indexed_files);
  const indexed = tracked.filter((item) => indexedNames.has(item.relative));
  if (uniqueTracked.size !== tracked.length || indexed.length !== indexedNames.size) {
    throw new Error('fixture paths must be unique and indexed files must be tracked');
  }
  const digestInput = [manifestBytes, ...tracked.flatMap((item) => [Buffer.from(item.relative), item.bytes])];
  return {
    id: manifest.id,
    version: manifest.version,
    digest: sha256(Buffer.concat(digestInput)),
    tracked_files: tracked.length,
    indexed_files: indexed.length,
    source_bytes: tracked.reduce((sum, item) => sum + item.bytes.length, 0),
    indexed_bytes: indexed.reduce((sum, item) => sum + item.bytes.length, 0),
    source_loc: tracked.reduce((sum, item) => sum
      + item.bytes.toString('utf8').split('\n').filter((line) => line.trim().length > 0).length, 0),
    child_processes: manifest.child_processes,
  };
}
