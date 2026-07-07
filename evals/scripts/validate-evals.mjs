#!/usr/bin/env node
/**
 * Validate evals.json files (schema + fixture existence).
 * Node fallback when agent-skill-eval CLI is unavailable.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadManifest } from './stage-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const errors = [];

const suites = [
  'evals/lamina/evals.json',
  'evals/smoke/evals.json',
  'skills/lamina/evals/evals.json',
  'skills/lamina-init/evals/evals.json',
  'skills/lamina-design/evals/evals.json',
  'skills/lamina-audit/evals/evals.json',
];

function validateSuite(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    errors.push(`Missing suite: ${relPath}`);
    return;
  }

  const baseDir = path.dirname(abs);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    errors.push(`${relPath}: invalid JSON — ${err.message}`);
    return;
  }

  if (!data.skill_name || typeof data.skill_name !== 'string') {
    errors.push(`${relPath}: missing skill_name`);
  }
  if (!Array.isArray(data.evals)) {
    errors.push(`${relPath}: evals must be an array`);
    return;
  }

  const ids = new Set();
  for (const ev of data.evals) {
    if (!ev.id) {
      errors.push(`${relPath}: eval missing id`);
      continue;
    }
    if (ids.has(ev.id)) {
      errors.push(`${relPath}: duplicate id ${ev.id}`);
    }
    ids.add(ev.id);
    if (!ev.prompt || typeof ev.prompt !== 'string') {
      errors.push(`${relPath}: ${ev.id} missing prompt`);
    }
    if (ev.fixture) {
      try {
        const manifest = loadManifest(ev.fixture);
        for (const layer of manifest.layers) {
          const layerPath = path.join(ROOT, 'evals/fixtures', layer);
          if (!fs.existsSync(layerPath)) {
            errors.push(`${relPath}: ${ev.id} missing fixture layer ${layer}`);
          }
        }
      } catch (err) {
        errors.push(`${relPath}: ${ev.id} fixture error — ${err.message}`);
      }
    }
    if (ev.files) {
      for (const file of ev.files) {
        const resolved = path.resolve(baseDir, file);
        if (!fs.existsSync(resolved)) {
          errors.push(`${relPath}: ${ev.id} missing fixture ${file}`);
        }
      }
    }
  }
}

for (const suite of suites) {
  validateSuite(suite);
}

if (errors.length) {
  console.error('Eval validation FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`OK — validated ${suites.length} eval suites`);
