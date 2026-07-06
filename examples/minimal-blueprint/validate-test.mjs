#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runValidate } from '../../packages/lamina-blueprint/cli/validate.js';
import { runExportGraph } from '../../packages/lamina-blueprint/cli/export-graph.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.lamina/blueprints/demo');
await runValidate([root]);

const blueprintRoot = path.dirname(root);
await runExportGraph(['--root', blueprintRoot, '--id', 'demo', '--stdout']);
