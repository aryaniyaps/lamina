#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'packages/cli/retrieval-model-manifest.json'), 'utf8'),
);
const outputArgument = process.argv.indexOf('--output');
const output = path.resolve(
  outputArgument >= 0 && process.argv[outputArgument + 1]
    ? process.argv[outputArgument + 1]
    : path.join(root, 'dist', manifest.asset_name),
);
fs.mkdirSync(path.dirname(output), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
const response = await fetch(manifest.source_url, { redirect: 'follow' });
if (!response.ok) throw new Error(`Unable to fetch retrieval model: HTTP ${response.status}`);
fs.writeFileSync(temporary, Buffer.from(await response.arrayBuffer()));
const stat = fs.statSync(temporary);
const digest = crypto.createHash('sha256').update(fs.readFileSync(temporary)).digest('hex');
if (stat.size !== manifest.bytes || digest !== manifest.sha256) {
  fs.rmSync(temporary, { force: true });
  throw new Error(
    `Retrieval model integrity failed: expected ${manifest.sha256}/${manifest.bytes}, ` +
    `received ${digest}/${stat.size}`,
  );
}
fs.renameSync(temporary, output);
process.stdout.write(`${output}\n`);
