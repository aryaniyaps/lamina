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
  'evals/suites/lamina/evals.json',
  'evals/suites/lamina-init/evals.json',
  'evals/suites/lamina-design/evals.json',
  'evals/suites/lamina-verify/evals.json',
  'evals/suites/lamina-capabilities/evals.json',
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
    if (!ev.prompt && (!Array.isArray(ev.prompts) || ev.prompts.length < 2)) {
      errors.push(`${relPath}: ${ev.id} requires prompt (string) or prompts (string[], 2+)`);
    }
    if (!ev.expected_output || typeof ev.expected_output !== 'string') {
      errors.push(`${relPath}: ${ev.id} missing expected_output`);
    }
    if (ev.prompts && (!Array.isArray(ev.prompts) || ev.prompts.length < 2)) {
      errors.push(`${relPath}: ${ev.id} prompts must be an array with 2+ entries`);
    }
    if (ev.prompt && ev.prompts && ev.prompt !== ev.prompts[0]) {
      errors.push(`${relPath}: ${ev.id} prompt must match prompts[0] when both are set`);
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

  return ids;
}

const mergedIds = new Set();
for (const suite of suites) {
  const ids = validateSuite(suite);
  if (suite === 'evals/lamina/evals.json' && ids) {
    for (const id of ids) mergedIds.add(id);
  }
}

const smokeIdsPath = path.join(ROOT, 'evals/smoke/ids.json');
if (!fs.existsSync(smokeIdsPath)) {
  errors.push('Missing evals/smoke/ids.json');
} else if (mergedIds.size > 0) {
  let smoke;
  try {
    smoke = JSON.parse(fs.readFileSync(smokeIdsPath, 'utf8'));
  } catch (err) {
    errors.push(`evals/smoke/ids.json: invalid JSON — ${err.message}`);
  }
  if (smoke && Array.isArray(smoke.ids)) {
    for (const id of smoke.ids) {
      if (!mergedIds.has(id)) {
        errors.push(`evals/smoke/ids.json: unknown smoke id ${id}`);
      }
    }
  } else if (smoke) {
    errors.push('evals/smoke/ids.json: ids must be an array');
  }
}

if (errors.length) {
  console.error('Eval validation FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`OK — validated ${suites.length} eval suites + smoke ids`);
