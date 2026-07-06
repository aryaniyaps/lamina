import fs from 'node:fs';
import path from 'node:path';
import {
  collectScreensFromTransitions,
  inferEntryScreen,
  parseFlowsSource,
  parseScreenIdsFromSource,
  parseTriggersFromScreenSource,
} from '../lib/flow-graph.mjs';
import { loadScenariosFromBlueprintDir, scenarioScreenPathInBlueprint } from '../lib/scenarios.mjs';

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

function effectiveScreenPath(dir, flowId, screenId) {
  const flowPath = path.join(dir, 'flows', flowId, 'screens', `${screenId}.tsx`);
  if (fs.existsSync(flowPath)) return flowPath;
  return path.join(dir, 'screens', `${screenId}.tsx`);
}

function collectKnownScreens(dir, screenIds) {
  const known = new Set(screenIds);
  const flowsRoot = path.join(dir, 'flows');
  if (!fs.existsSync(flowsRoot)) return known;

  for (const entry of fs.readdirSync(flowsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const screensDir = path.join(flowsRoot, entry.name, 'screens');
    if (!fs.existsSync(screensDir)) continue;
    for (const file of fs.readdirSync(screensDir)) {
      if (!file.endsWith('.tsx')) continue;
      known.add(file.replace(/\.tsx$/, ''));
    }
  }
  return known;
}

function validateFlowOverrideScreens(dir, errors) {
  const flowsRoot = path.join(dir, 'flows');
  if (!fs.existsSync(flowsRoot)) return;

  for (const entry of fs.readdirSync(flowsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const screensDir = path.join(flowsRoot, entry.name, 'screens');
    if (!fs.existsSync(screensDir)) continue;
    for (const file of fs.readdirSync(screensDir)) {
      if (!file.endsWith('.tsx')) continue;
      const screenId = file.replace(/\.tsx$/, '');
      const rel = path.relative(dir, path.join(screensDir, file));
      const content = fs.readFileSync(path.join(screensDir, file), 'utf8');
      const idsInFile = parseScreenIdsFromSource(content);
      if (!idsInFile.length) {
        errors.push(`${rel}: missing <Screen id="...">`);
      } else if (idsInFile.length > 1) {
        errors.push(`${rel}: multiple Screen ids (${idsInFile.join(', ')})`);
      } else if (idsInFile[0] !== screenId) {
        errors.push(`${rel}: Screen id "${idsInFile[0]}" does not match filename`);
      }
    }
  }
}

function screensInFlow(transitions) {
  const screens = new Set();
  for (const t of transitions) {
    if (t.from) screens.add(t.from);
    screens.add(t.target);
  }
  return screens;
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

  validateFlowOverrideScreens(dir, errors);

  const flowsPath = path.join(dir, 'flows.tsx');
  if (!fs.existsSync(flowsPath)) return;

  const flowsSource = fs.readFileSync(flowsPath, 'utf8');
  const { flows } = parseFlowsSource(flowsSource);
  const knownScreens = collectKnownScreens(dir, screenIds);

  for (const flow of flows) {
    const { id: flowId, transitions } = flow;
    const entry = inferEntryScreen(transitions);

    for (const t of transitions) {
      if (!knownScreens.has(t.target)) {
        errors.push(`flows.tsx: flow "${flowId}" target "${t.target}" has no screen file`);
      }
      if (t.from && !knownScreens.has(t.from)) {
        errors.push(`flows.tsx: flow "${flowId}" from "${t.from}" has no screen file`);
      }
    }

    for (const screenId of screensInFlow(transitions)) {
      const filePath = effectiveScreenPath(dir, flowId, screenId);
      const rel = path.relative(dir, filePath);
      if (!fs.existsSync(filePath)) {
        errors.push(`${rel}: screen file not found for flow "${flowId}"`);
        continue;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      const triggers = parseTriggersFromScreenSource(content);
      for (const trigger of triggers) {
        const match = transitions.find(
          (t) =>
            t.trigger === trigger &&
            (t.from === screenId || (!t.from && entry === screenId)),
        );
        if (!match) {
          errors.push(
            `${rel}: trigger "${trigger}" has no matching Transition in flow "${flowId}"`,
          );
        }
      }
    }

    const reachable = collectScreensFromTransitions(transitions, []);
    for (const id of reachable) {
      if (!knownScreens.has(id)) {
        errors.push(`flows.tsx: flow "${flowId}" references unknown screen "${id}"`);
      }
    }
  }
}

function validateScenarios(dir, errors) {
  const scenarios = loadScenariosFromBlueprintDir(dir);
  if (!scenarios.length) return;

  for (const s of scenarios) {
    if (!s.id) errors.push('scenarios.yaml: scenario missing id');
    if (!s.title) errors.push(`scenarios.yaml: scenario "${s.id}" missing title`);
    if (!s.screen) errors.push(`scenarios.yaml: scenario "${s.id}" missing screen`);

    if (!s.id || !s.screen) continue;

    const variantPath = scenarioScreenPathInBlueprint(dir, s.id, s.screen);
    const rel = path.relative(dir, variantPath);
    if (!fs.existsSync(variantPath)) {
      errors.push(`${rel}: scenario variant screen not found for "${s.id}"`);
      continue;
    }

    const content = fs.readFileSync(variantPath, 'utf8');
    const idsInFile = parseScreenIdsFromSource(content);
    if (!idsInFile.length) {
      errors.push(`${rel}: missing <Screen id="...">`);
    } else if (idsInFile[0] !== s.screen) {
      errors.push(`${rel}: Screen id "${idsInFile[0]}" does not match scenario screen "${s.screen}"`);
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
  validateScenarios(dir, errors);

  if (errors.length) {
    console.error('Blueprint validation FAILED:\n');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`OK — ${files.length} file(s) validated`);
}
