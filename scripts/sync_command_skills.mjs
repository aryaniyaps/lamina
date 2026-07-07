#!/usr/bin/env node
/**
 * Sync repo-root commands/*.md into skills/<name>/SKILL.md so the skills CLI
 * installs them as slash commands (disable-model-invocation skills).
 *
 * commands/ remains the authoring source for Cursor plugin manifests.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'commands');
const SKILLS_DIR = path.join(ROOT, 'skills');

const COMMAND_SKILL_NAMES = new Set([
  'lamina',
  'lamina-init',
  'lamina-design',
  'lamina-audit',
]);

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };
  const data = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, body: match[2] };
}

function rewriteInstallPaths(text) {
  return text
    .replace(/`skills\/([^/`]+)\/([^`]+)`/g, '`../$1/$2`')
    .replace(
      /`skills\/lamina-orchestrator\/prompts\/([^`]+)`/g,
      '`../lamina-orchestrator/prompts/$1`'
    )
    .replace(
      /`skills\/lamina-orchestrator\/agents\/([^`]+)`/g,
      '`../lamina-orchestrator/agents/$1`'
    )
    .replace(/`prompts\/([^`]+)`/g, '`../lamina-orchestrator/prompts/$1`')
    .replace(/`agents\/([^`]+)`/g, '`../lamina-orchestrator/agents/$1`')
    .replace(/see `prompts\//g, 'see `../lamina-orchestrator/prompts/')
    .replace(/from `prompts\//g, 'from `../lamina-orchestrator/prompts/');
}

function buildSkillMd(commandName, sourceContent) {
  const { data, body } = parseFrontmatter(sourceContent);
  const description =
    data.description ||
    `Lamina workflow command /${commandName.replace(/^lamina-?/, 'lamina ')}`;
  const frontmatter = [
    '---',
    `name: ${commandName}`,
    `description: "${description.replace(/"/g, '\\"')}"`,
    'disable-model-invocation: true',
    '---',
    '',
  ].join('\n');

  return frontmatter + rewriteInstallPaths(body).trimEnd() + '\n';
}

function main() {
  const commandFiles = fs
    .readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const synced = [];

  for (const file of commandFiles) {
    const commandName = path.basename(file, '.md');
    if (!COMMAND_SKILL_NAMES.has(commandName)) continue;

    const source = fs.readFileSync(path.join(COMMANDS_DIR, file), 'utf8');
    const skillDir = path.join(SKILLS_DIR, commandName);
    const skillPath = path.join(skillDir, 'SKILL.md');

    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillPath, buildSkillMd(commandName, source));
    synced.push(commandName);
  }

  if (synced.length !== COMMAND_SKILL_NAMES.size) {
    const missing = [...COMMAND_SKILL_NAMES].filter((n) => !synced.includes(n));
    console.error(`Missing command sources for: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log(`Synced ${synced.length} command skills: ${synced.join(', ')}`);
}

main();
