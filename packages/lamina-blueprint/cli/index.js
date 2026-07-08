#!/usr/bin/env node
import { runPreview } from './preview.js';
import { runRetire } from './retire.js';
import { runValidate } from './validate.js';
import { runValidateRun } from './validate-run.js';
import { runExportGraph } from './export-graph.js';

const [command, ...args] = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  lamina-blueprint preview --root <dir> [--id <id>] [--port <port>] [--list] [--ensure] [--open] [--state-file <path>]
  lamina-blueprint export-graph --root <dir> --id <id> [--out file.mmd] [--stdout]
  lamina-blueprint retire <id> [--root <dir>]
  lamina-blueprint validate <blueprint-dir>
  lamina-blueprint validate run <run.yaml>

Examples:
  lamina-blueprint preview --root .lamina/blueprints --id checkout-v2
  lamina-blueprint preview --root .lamina/blueprints --ensure --open
  lamina-blueprint preview --root .lamina/blueprints --list
  lamina-blueprint retire checkout-v2 --root .lamina/blueprints
  lamina-blueprint validate .lamina/blueprints/checkout-v2
  lamina-blueprint validate run .lamina/runs/wishlist-feature-2026-07-08/run.yaml
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
      if (args[0] === 'run') {
        await runValidateRun(args.slice(1));
      } else {
        await runValidate(args);
      }
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
