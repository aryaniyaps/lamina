#!/usr/bin/env node
/**
 * Verify that `.lamina/personas.yaml` is valid.
 * Usage: node scripts/check_lamina_personas.mjs [--root <path>] [--json]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REQUIRED_PERSONA_FIELDS = [
  'id',
  'type',
  'goals',
  'frustrations',
  'motivations',
  'technical_literacy',
  'accessibility',
  'confidence',
];

const REQUIRED_GOAL_KEYS = ['experience', 'end', 'life'];

function parseArgs(argv) {
  const args = { root: process.cwd(), json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--root') {
      args.root = path.resolve(argv[++i]);
    } else if (argv[i] === '--json') {
      args.json = true;
    }
  }
  return args;
}

/**
 * Minimal YAML parser for personas.yaml structure.
 * @param {string} content
 */
function parsePersonasYaml(content) {
  return parsePersonasYamlRobust(content);
}

function parseInlineArray(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function parsePersonasYamlRobust(content) {
  const data = { primary: null, personas: [] };
  let current = null;
  let context = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const primaryMatch = trimmed.match(/^primary:\s*(\S+)/);
    if (primaryMatch) {
      data.primary = primaryMatch[1];
      context = null;
      continue;
    }

    const idMatch = line.match(/^\s*-\s*id:\s*(\S+)/);
    if (idMatch) {
      current = {
        id: idMatch[1],
      };
      data.personas.push(current);
      context = 'persona';
      continue;
    }

    if (!current) continue;

    const sectionMatch = line.match(/^\s+([a-z_]+):\s*$/i);
    if (sectionMatch) {
      const key = sectionMatch[1];
      if (key === 'goals') {
        current.goals = {};
        context = 'goals';
      } else if (key === 'frustrations') {
        current.frustrations = [];
        context = 'frustrations';
      } else if (key === 'motivations') {
        current.motivations = [];
        context = 'motivations';
      } else if (key === 'accessibility') {
        current.accessibility = {};
        context = 'accessibility';
      } else if (REQUIRED_GOAL_KEYS.includes(key)) {
        if (!current.goals) current.goals = {};
        current.goals[key] = [];
        context = `goals.${key}`;
      } else if (key === 'needs') {
        if (!current.accessibility) current.accessibility = {};
        current.accessibility.needs = [];
        context = 'accessibility.needs';
      } else if (key === 'assistive_tech') {
        if (!current.accessibility) current.accessibility = {};
        current.accessibility.assistive_tech = [];
        context = 'accessibility.assistive_tech';
      }
      continue;
    }

    const scalarMatch = line.match(/^\s+([a-z_]+):\s+(.+)$/i);
    if (scalarMatch) {
      const [, key, raw] = scalarMatch;
      const value = raw.trim().replace(/^['"]|['"]$/g, '');
      if (key === 'goals') {
        current.goals = {};
        context = 'goals';
      } else if (key === 'frustrations') {
        context = 'frustrations';
        current.frustrations = parseInlineArray(value) ?? value;
      } else if (key === 'motivations') {
        context = 'motivations';
        current.motivations = parseInlineArray(value) ?? value;
      } else if (key === 'accessibility') {
        current.accessibility = {};
        context = 'accessibility';
      } else if (REQUIRED_GOAL_KEYS.includes(key)) {
        if (!current.goals) current.goals = {};
        context = `goals.${key}`;
        current.goals[key] = parseInlineArray(value) ?? value;
      } else if (key === 'needs') {
        if (!current.accessibility) current.accessibility = {};
        context = 'accessibility.needs';
        current.accessibility.needs = parseInlineArray(value) ?? value;
      } else if (key === 'assistive_tech') {
        if (!current.accessibility) current.accessibility = {};
        context = 'accessibility.assistive_tech';
        current.accessibility.assistive_tech = parseInlineArray(value) ?? value;
      } else {
        current[key] = value;
        context = 'persona';
      }
      continue;
    }

    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch) {
      const item = listMatch[1].trim().replace(/^['"]|['"]$/g, '');
      if (context === 'frustrations') current.frustrations.push(item);
      else if (context === 'motivations') current.motivations.push(item);
      else if (context === 'accessibility.needs') current.accessibility.needs.push(item);
      else if (context === 'accessibility.assistive_tech') current.accessibility.assistive_tech.push(item);
      else if (context?.startsWith('goals.')) {
        const goalKey = context.split('.')[1];
        if (REQUIRED_GOAL_KEYS.includes(goalKey)) current.goals[goalKey].push(item);
      }
    }
  }

  return data;
}

function validatePersona(persona, index) {
  const errors = [];
  const label = persona.id || `persona[${index}]`;

  for (const field of REQUIRED_PERSONA_FIELDS) {
    if (persona[field] === undefined || persona[field] === null || persona[field] === '') {
      errors.push(`Persona "${label}" missing required field: ${field}.`);
    }
  }

  if (persona.goals) {
    for (const key of REQUIRED_GOAL_KEYS) {
      if (!Array.isArray(persona.goals[key])) {
        errors.push(`Persona "${label}" goals.${key} must be an array.`);
      }
    }
  }

  if (persona.accessibility) {
    if (!Array.isArray(persona.accessibility.needs)) {
      errors.push(`Persona "${label}" accessibility.needs must be an array.`);
    }
    if (!Array.isArray(persona.accessibility.assistive_tech)) {
      errors.push(`Persona "${label}" accessibility.assistive_tech must be an array.`);
    }
  }

  return errors;
}

/**
 * @param {string} projectRoot
 * @returns {{ ok: boolean, errors: string[], path: string }}
 */
export function checkLaminaPersonas(projectRoot) {
  const filePath = path.join(projectRoot, '.lamina', 'personas.yaml');
  const errors = [];

  if (!fs.existsSync(filePath)) {
    errors.push('Missing `.lamina/personas.yaml`.');
    return { ok: false, errors, path: filePath };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) {
    errors.push('`.lamina/personas.yaml` is empty.');
    return { ok: false, errors, path: filePath };
  }

  const data = parsePersonasYaml(content);

  if (!data.primary) {
    errors.push('Missing `primary` key in personas.yaml.');
  }

  if (!data.personas.length) {
    errors.push('No personas defined in `personas` list.');
  }

  const ids = new Set();
  for (let i = 0; i < data.personas.length; i++) {
    const persona = data.personas[i];
    errors.push(...validatePersona(persona, i));
    if (persona.id) {
      if (ids.has(persona.id)) {
        errors.push(`Duplicate persona id: "${persona.id}".`);
      }
      ids.add(persona.id);
    }
  }

  if (data.primary && !ids.has(data.primary)) {
    errors.push(`\`primary\` "${data.primary}" does not match any persona id.`);
  }

  return { ok: errors.length === 0, errors, path: filePath };
}

function main() {
  const args = parseArgs(process.argv);
  const result = checkLaminaPersonas(args.root);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`OK — personas verified at ${result.path}`);
  } else {
    console.error('Lamina personas check FAILED:\n');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
  }

  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
