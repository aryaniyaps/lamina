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
    stdout: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--root' && args[i + 1]) opts.root = args[++i];
    else if (arg === '--id' && args[i + 1]) opts.id = args[++i];
    else if (arg === '--out' && args[i + 1]) opts.out = args[++i];
    else if (arg === '--stdout') opts.stdout = true;
  }

  return opts;
}

export async function runExportGraph(args) {
  const opts = parseArgs(args);
  if (!opts.id) {
    throw new Error('Usage: lamina-blueprint export-graph --root <dir> --id <id> [--out file.mmd] [--stdout]');
  }

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

  const mermaid = toMermaid(graph, []);

  if (opts.stdout || !opts.out) {
    console.log(mermaid);
    return;
  }

  const outPath = path.resolve(opts.out);
  fs.writeFileSync(outPath, `${mermaid}\n`);
  console.log(`Wrote ${outPath}`);
}
