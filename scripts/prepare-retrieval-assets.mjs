#!/usr/bin/env node
/* Fetch build-time-only tokenizer and Ladybug extension inputs for PyInstaller. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'packages/cli');
const cliRequire = createRequire(path.join(cli, 'package.json'));
const { Connection, Database } = cliRequire('@ladybugdb/core');
const destinationInput = process.argv[2] || process.env.LAMINA_RETRIEVAL_ASSET_DIR;
if (!destinationInput) throw new Error('A retrieval asset destination is required.');
const destination = path.resolve(destinationInput);
const model = JSON.parse(fs.readFileSync(path.join(cli, 'retrieval-model-manifest.json'), 'utf8'));
const revisionBase = `${model.origin}/resolve/${model.revision}`;
const tokenizer = {
  path: 'tokenizer.json',
  url: `${revisionBase}/tokenizer.json`,
  sha256: 'b01c78a902aa4facb2f47f95449f48e2f7bbfea5d2472ee2f6ce92323c6f86e5',
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function download(item, output) {
  const response = await fetch(item.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Unable to fetch ${item.url}: HTTP ${response.status}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, Buffer.from(await response.arrayBuffer()));
  const actual = sha256(output);
  if (actual !== item.sha256) {
    throw new Error(`Checksum mismatch for ${item.path}: expected ${item.sha256}, received ${actual}`);
  }
}

fs.mkdirSync(destination, { recursive: true });
const tokenizerOutput = path.join(destination, tokenizer.path);
await download(tokenizer, tokenizerOutput);

const database = new Database(':memory:');
const connection = new Connection(database);
connection.initSync();
for (const extension of ['FTS', 'VECTOR']) {
  // This is release-build preparation. Shipped Lamina never runs INSTALL.
  connection.querySync(`INSTALL ${extension}`);
  connection.querySync(`LOAD ${extension}`);
}
const loaded = connection.querySync('CALL SHOW_LOADED_EXTENSIONS() RETURN *').getAllSync();
connection.closeSync();
database.closeSync();

const files = [{
  role: 'tokenizer',
  path: 'tokenizer.json',
  embedded_path: 'tokenizer.json',
  source: tokenizerOutput,
}];
for (const role of ['fts', 'vector']) {
  const loadedExtension = loaded.find((item) =>
    String(item['extension name']).toLowerCase() === role);
  if (!loadedExtension) throw new Error(`Ladybug did not load ${role}.`);
  const source = loadedExtension['extension path'];
  const relative = `extensions/${role}.lbug_extension`;
  const output = path.join(destination, relative);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(source, output);
  // PyInstaller automatically reclassifies Mach-O-looking DATA as BINARY and
  // rewrites it during macOS collection. Embed an inert textual representation
  // so the checksum-authoritative extension bytes survive every platform.
  const embeddedRelative = `${relative}.base64`;
  fs.writeFileSync(
    path.join(destination, embeddedRelative),
    fs.readFileSync(output).toString('base64'),
  );
  files.push({
    role,
    path: relative,
    embedded_path: embeddedRelative,
    encoding: 'base64',
    source: output,
  });
}

const manifest = {
  schema: 'lamina.retrieval-runtime-assets/v1',
  ladybug_version: JSON.parse(
    fs.readFileSync(path.join(cli, 'node_modules/@ladybugdb/core/package.json'), 'utf8'),
  ).version,
  model_id: model.model_id,
  model_revision: model.revision,
  files: files.map((item) => ({
    role: item.role,
    path: item.path,
    embedded_path: item.embedded_path,
    ...(item.encoding ? { encoding: item.encoding } : {}),
    sha256: sha256(item.source),
    bytes: fs.statSync(item.source).size,
  })),
};
fs.writeFileSync(
  path.join(destination, 'asset-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({ destination, manifest })}\n`);
