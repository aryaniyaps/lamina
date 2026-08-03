#!/usr/bin/env node
import fs from 'node:fs';
import { buildOracleTierPackedBareCache } from
  '../../benchmarks/real-repository-oracle-v1/persistent-materializer.mjs';

const [inputFile, bytesFile, metaFile] = process.argv.slice(2);
if (!inputFile || !bytesFile || !metaFile) {
  throw new Error('oracle tier packed cache build requires input, bytes, and meta paths');
}
const options = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const sealed = buildOracleTierPackedBareCache(options);
fs.writeFileSync(bytesFile, sealed.bytes);
fs.writeFileSync(metaFile, JSON.stringify({
  digest: sealed.digest,
  size: sealed.size,
  manifest: sealed.manifest,
  pack_closure_digest: sealed.pack_closure_digest,
}));
