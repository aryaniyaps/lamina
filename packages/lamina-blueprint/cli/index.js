#!/usr/bin/env node
import { runPreview } from './preview.js';
import { runRetire } from './retire.js';
import { runValidate } from './validate.js';
import { runExportGraph } from './export-graph.js';

const [command, ...args] = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  lamina-blueprint preview --root <dir> [--id <id>] [--port <port>] [--diff] [--list]
  lamina-blueprint export-graph --root <dir> --id <id> [--out file.mmd] [--diff] [--stdout]
  lamina-blueprint retire <id> [--root <dir>]
  lamina-blueprint validate <blueprint-dir>

Examples:
  lamina-blueprint preview --root .lamina/blueprints --id checkout-v2
  lamina-blueprint preview --root .lamina/blueprints --list
  lamina-blueprint retire checkout-v2 --root .lamina/blueprints
  lamina-blueprint validate .lamina/blueprints/checkout-v2
`);
}

try {
  switch (command) {
    case 'preview':
      await runPreview(args);
      break;
    case 'retire':
      await runRetire(args);
      break;
    case 'validate':
      await runValidate(args);
      break;
    case 'export-graph':
      await runExportGraph(args);
      break;
    default:
      usage();
      process.exit(command ? 1 : 0);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
