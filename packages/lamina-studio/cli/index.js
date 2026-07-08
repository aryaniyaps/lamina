#!/usr/bin/env node
import { runPreview } from './preview.js';
import { runRetire } from './retire.js';
import { runValidate } from './validate.js';
import { runValidateRun } from './validate-run.js';
import { runExportGraph } from './export-graph.js';

const [command, ...args] = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  lamina-studio preview|review --root <dir> [--run <run_id>] [--id <id>] [--port <port>] [--list] [--ensure] [--open] [--state-file <path>]
  lamina-studio export-graph --root <dir> --id <id> [--out file.mmd] [--stdout]
  lamina-studio retire <id> [--root <dir>]
  lamina-studio validate <blueprint-dir>
  lamina-studio validate run <run.yaml>

Examples:
  lamina-studio review --root .lamina/blueprints --run demo --open
  lamina-studio preview --root .lamina/blueprints --id checkout-v2
  lamina-studio preview --root .lamina/blueprints --ensure --open
  lamina-studio preview --root .lamina/blueprints --list
  lamina-studio retire checkout-v2 --root .lamina/blueprints
  lamina-studio validate .lamina/blueprints/checkout-v2
  lamina-studio validate run .lamina/runs/wishlist-feature-2026-07-08/run.yaml
`);
}

try {
  switch (command) {
    case 'preview':
    case 'review':
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
