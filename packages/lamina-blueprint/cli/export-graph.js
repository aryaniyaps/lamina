import fs from 'node:fs';
import path from 'node:path';
import {
  collectScreensFromTransitions,
  parseFlowsSource,
  toMermaid,
} from '../lib/flow-graph.mjs';

function parseArgs(args) {
  const opts = {
    root: '.lamina/blueprints',
    id: null,
    out: null,
    diff: false,
    stdout: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--root' && args[i + 1]) opts.root = args[++i];
    else if (arg === '--id' && args[i + 1]) opts.id = args[++i];
    else if (arg === '--out' && args[i + 1]) opts.out = args[++i];
    else if (arg === '--diff') opts.diff = true;
    else if (arg === '--stdout') opts.stdout = true;
  }

  return opts;
}

function listChangedScreens(blueprintDir) {
  const screensDir = path.join(blueprintDir, 'screens');
  if (!fs.existsSync(screensDir)) return [];

  const changed = [];
  for (const file of fs.readdirSync(screensDir)) {
    if (!file.endsWith('.tsx')) continue;
    const screenId = file.replace(/\.tsx$/, '');
    const rel = `screens/${file}`;
    const baseline = path.join(blueprintDir, 'baseline', rel);
    const proposed = path.join(blueprintDir, 'proposed', rel);
    if (fs.existsSync(baseline) && fs.existsSync(proposed)) {
      const b = fs.readFileSync(baseline, 'utf8');
      const p = fs.readFileSync(proposed, 'utf8');
      if (b !== p) changed.push(screenId);
    }
  }
  return changed;
}

export async function runExportGraph(args) {
  const opts = parseArgs(args);
  if (!opts.id) throw new Error('Usage: lamina-blueprint export-graph --root <dir> --id <id> [--out file.mmd] [--diff] [--stdout]');

  const blueprintDir = path.resolve(opts.root, opts.id);
  if (!fs.existsSync(blueprintDir)) {
    throw new Error(`Blueprint not found: ${blueprintDir}`);
  }

  const flowsPath = path.join(blueprintDir, 'flows.tsx');
  let parsed = { flows: [], transitions: [] };
  if (fs.existsSync(flowsPath)) {
    parsed = parseFlowsSource(fs.readFileSync(flowsPath, 'utf8'));
  }

  const screensDir = path.join(blueprintDir, 'screens');
  const screenFiles = fs.existsSync(screensDir)
    ? fs.readdirSync(screensDir).filter((f) => f.endsWith('.tsx')).map((f) => f.replace(/\.tsx$/, ''))
    : [];

  const graph = {
    ...parsed,
    screens: collectScreensFromTransitions(parsed.transitions, screenFiles),
  };

  const changedScreens = opts.diff ? listChangedScreens(blueprintDir) : [];
  const mermaid = toMermaid(graph, changedScreens);

  if (opts.stdout || !opts.out) {
    console.log(mermaid);
    return;
  }

  const outPath = path.resolve(opts.out);
  fs.writeFileSync(outPath, `${mermaid}\n`);
  console.log(`Wrote ${outPath}`);
}
