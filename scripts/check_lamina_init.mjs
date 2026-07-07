#!/usr/bin/env node
/**
 * Verify that /lamina-init has been run on a project.
 * Usage: node scripts/check_lamina_init.mjs [--root <path>] [--json]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REQUIRED_SECTIONS = [
  'Problem statement',
  'Business goals',
  'Success metrics',
  'Scope',
  'Users & market',
  'Product posture',
  'Constraints',
  'Stakeholders',
  'Risks & unknowns',
  'Research posture',
  'Triad check',
];

const PLACEHOLDER_ANSWERS = new Set([
  '',
  '…',
  '...',
  'tbd',
  'todo',
  'n/a',
  'na',
  '-',
  '—',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: content };
  return { frontmatter: match[1], body: match[2] };
}

function parseLaminaFrontmatter(frontmatterText) {
  if (!frontmatterText) return null;

  const lamina = {};
  let inLamina = false;
  let laminaIndent = 0;

  for (const line of frontmatterText.split('\n')) {
    if (!inLamina) {
      if (/^lamina:\s*$/.test(line)) {
        inLamina = true;
        laminaIndent = line.search(/\S/);
      }
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.search(/\S/);
    if (indent <= laminaIndent && !/^lamina:/.test(line)) break;

    const kv = line.match(/^\s+([a-z_]+):\s*(.*)$/i);
    if (!kv) continue;

    const [, key, rawValue] = kv;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
    lamina[key] = value;
  }

  return Object.keys(lamina).length ? lamina : null;
}

function isPlaceholderAnswer(answer) {
  const normalized = answer.trim().toLowerCase();
  return PLACEHOLDER_ANSWERS.has(normalized);
}

function extractSectionAnswer(body, sectionName) {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerRe = new RegExp(`^##\\s+${escaped}\\s*$`, 'im');
  const headerMatch = body.match(headerRe);
  if (!headerMatch) return { found: false, answer: null };

  const start = headerMatch.index + headerMatch[0].length;
  const rest = body.slice(start);
  const nextHeader = rest.search(/^##\s+/m);
  const sectionBody = nextHeader === -1 ? rest : rest.slice(0, nextHeader);

  const answerMatch = sectionBody.match(/^\*\*Answer:\*\*\s*(.*)$/im);
  if (!answerMatch) return { found: true, answer: null };

  return { found: true, answer: answerMatch[1].trim() };
}

/**
 * @param {string} projectRoot
 * @returns {{ ok: boolean, errors: string[], path: string }}
 */
export function checkLaminaInit(projectRoot) {
  const filePath = path.join(projectRoot, '.lamina', 'business-context.md');
  const errors = [];

  if (!fs.existsSync(filePath)) {
    errors.push('Missing `.lamina/business-context.md` — run `/lamina-init` first.');
    return { ok: false, errors, path: filePath };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) {
    errors.push('`.lamina/business-context.md` is empty — run `/lamina-init` to establish business context.');
    return { ok: false, errors, path: filePath };
  }

  const { frontmatter, body } = parseFrontmatter(content);
  const lamina = parseLaminaFrontmatter(frontmatter);

  if (!lamina) {
    errors.push('Missing YAML frontmatter block with `lamina:` metadata.');
  } else {
    if (!['greenfield', 'brownfield'].includes(String(lamina.maturity))) {
      errors.push('Frontmatter `lamina.maturity` must be `greenfield` or `brownfield`.');
    }

    const platform = lamina.platform;
    const hasPlatform =
      (Array.isArray(platform) && platform.length > 0) ||
      (typeof platform === 'string' && platform.trim().length > 0);
    if (!hasPlatform) {
      errors.push('Frontmatter `lamina.platform` must list at least one platform.');
    }

    if (!lamina.last_updated || !ISO_DATE.test(String(lamina.last_updated))) {
      errors.push('Frontmatter `lamina.last_updated` must be an ISO date (YYYY-MM-DD).');
    }
  }

  for (const section of REQUIRED_SECTIONS) {
    const { found, answer } = extractSectionAnswer(body, section);
    if (!found) {
      errors.push(`Missing required section: "${section}".`);
      continue;
    }
    if (answer === null) {
      errors.push(`Section "${section}" is missing **Answer:**.`);
      continue;
    }
    if (isPlaceholderAnswer(answer)) {
      errors.push(`Section "${section}" has placeholder or empty **Answer:**.`);
    }
  }

  return { ok: errors.length === 0, errors, path: filePath };
}

function main() {
  const args = parseArgs(process.argv);
  const result = checkLaminaInit(args.root);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`OK — init verified at ${result.path}`);
  } else {
    console.error('Lamina init check FAILED:\n');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
  }

  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
