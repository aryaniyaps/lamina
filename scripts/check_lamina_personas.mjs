#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIDENCE = new Set(['low', 'medium', 'high']);

function parseArgs(argv) {
  const args = { root: process.cwd(), json: false };
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--root') args.root = path.resolve(argv[++index]);
    else if (argv[index] === '--json') args.json = true;
  }
  return args;
}

export function checkLaminaPersonas(projectRoot) {
  const filePath = path.join(projectRoot, '.lamina', 'personas.json');
  const errors = [];
  if (!fs.existsSync(filePath)) return { ok: false, errors: ['Missing `.lamina/personas.json`.'], path: filePath };
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) return { ok: false, errors: ['`.lamina/personas.json` is empty.'], path: filePath };

  let data;
  try {
    data = JSON.parse(content);
  } catch (error) {
    return { ok: false, errors: [`Invalid personas.json: ${error.message}`], path: filePath };
  }
  if (data.contract_version !== '2.0') errors.push('personas.json contract_version must be "2.0".');
  if (!Array.isArray(data.personas) || !data.personas.length) errors.push('No personas defined in `personas` list.');
  const ids = new Set();
  for (const [index, persona] of (data.personas || []).entries()) {
    const label = persona.id || `persona[${index}]`;
    for (const key of ['id', 'role', 'goals', 'constraints', 'evidence', 'confidence']) {
      if (persona[key] === undefined || persona[key] === null || persona[key] === '') errors.push(`Persona "${label}" missing required field: ${key}.`);
    }
    for (const key of ['goals', 'constraints', 'evidence']) if (persona[key] !== undefined && !Array.isArray(persona[key])) errors.push(`Persona "${label}" ${key} must be an array.`);
    if (persona.confidence && !CONFIDENCE.has(persona.confidence)) errors.push(`Persona "${label}" has invalid confidence.`);
    if (persona.id && ids.has(persona.id)) errors.push(`Duplicate persona id "${persona.id}".`);
    ids.add(persona.id);
  }
  if (!(data.personas || []).some((persona) => persona.primary === true)) errors.push('Missing a persona with `primary: true`.');
  return { ok: errors.length === 0, errors, path: filePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv);
  const result = checkLaminaPersonas(args.root);
  if (args.json) console.log(JSON.stringify(result));
  else if (result.ok) console.log('personas.json valid');
  else for (const error of result.errors) console.error(error);
  process.exit(result.ok ? 0 : 1);
}
