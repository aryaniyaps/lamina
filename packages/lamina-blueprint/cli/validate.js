import fs from 'node:fs';
import path from 'node:path';
import {
  collectScreensFromTransitions,
  inferEntryScreen,
  parseFlowsSource,
  parseScreenIdsFromSource,
  parseTriggersFromScreenSource,
} from '../lib/flow-graph.mjs';

const FORBIDDEN_PATTERNS = [
  { name: 'className', pattern: /\bclassName\s*=/ },
  { name: 'style prop', pattern: /\bstyle\s*=\s*\{/ },
  { name: 'css import', pattern: /import\s+['"][^'"]+\.css['"]/ },
  { name: 'tailwind', pattern: /\bclassName\s*=\s*['"][^'"]*\b(flex|grid|p-|m-|text-|bg-)/ },
];

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function validateStructure(dir, errors) {
  const screensDir = path.join(dir, 'screens');
  if (!fs.existsSync(screensDir)) return;

  const screenIds = [];
  for (const file of fs.readdirSync(screensDir)) {
    if (!file.endsWith('.tsx')) continue;
    const screenId = file.replace(/\.tsx$/, '');
    const content = fs.readFileSync(path.join(screensDir, file), 'utf8');
    const idsInFile = parseScreenIdsFromSource(content);
    if (!idsInFile.length) {
      errors.push(`screens/${file}: missing <Screen id="...">`);
    } else if (idsInFile.length > 1) {
      errors.push(`screens/${file}: multiple Screen ids (${idsInFile.join(', ')})`);
    } else if (idsInFile[0] !== screenId) {
      errors.push(`screens/${file}: Screen id "${idsInFile[0]}" does not match filename`);
    }
    screenIds.push(screenId);
  }

  const dupes = screenIds.filter((id, i) => screenIds.indexOf(id) !== i);
  if (dupes.length) {
    errors.push(`screens/: duplicate screen ids (${[...new Set(dupes)].join(', ')})`);
  }

  const flowsPath = path.join(dir, 'flows.tsx');
  if (!fs.existsSync(flowsPath)) return;

  const flowsSource = fs.readFileSync(flowsPath, 'utf8');
  const { transitions } = parseFlowsSource(flowsSource);
  const knownScreens = new Set(screenIds);

  for (const t of transitions) {
    if (!knownScreens.has(t.target)) {
      errors.push(`flows.tsx: Transition target "${t.target}" has no screen file`);
    }
    if (t.from && !knownScreens.has(t.from)) {
      errors.push(`flows.tsx: Transition from "${t.from}" has no screen file`);
    }
  }

  const entry = inferEntryScreen(transitions);
  for (const file of fs.readdirSync(screensDir)) {
    if (!file.endsWith('.tsx')) continue;
    const screenId = file.replace(/\.tsx$/, '');
    const content = fs.readFileSync(path.join(screensDir, file), 'utf8');
    const triggers = parseTriggersFromScreenSource(content);
    for (const trigger of triggers) {
      const match = transitions.find(
        (t) =>
          t.trigger === trigger &&
          (t.from === screenId || (!t.from && entry === screenId)),
      );
      if (!match) {
        errors.push(
          `screens/${file}: trigger "${trigger}" has no matching Transition from this screen`,
        );
      }
    }
  }

  const reachable = collectScreensFromTransitions(transitions, []);
  for (const id of reachable) {
    if (!knownScreens.has(id)) {
      errors.push(`flows.tsx: references unknown screen "${id}"`);
    }
  }
}

export async function runValidate(args) {
  const target = args[0];
  if (!target) throw new Error('Usage: lamina-blueprint validate <blueprint-dir>');

  const dir = path.resolve(target);
  if (!fs.existsSync(dir)) throw new Error(`Not found: ${dir}`);

  const errors = [];
  const files = walk(dir);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(dir, file);

    for (const { name, pattern } of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        errors.push(`${rel}: forbidden ${name}`);
      }
    }

    if (content.includes('from ') && !content.includes('@lamina/blueprint')) {
      const imports = [...content.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      const bad = imports.filter((i) => !i.startsWith('.') && i !== '@lamina/blueprint');
      if (bad.length) {
        errors.push(`${rel}: only import from @lamina/blueprint (found: ${bad.join(', ')})`);
      }
    }
  }

  validateStructure(dir, errors);

  if (errors.length) {
    console.error('Blueprint validation FAILED:\n');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`OK — ${files.length} file(s) validated`);
}
