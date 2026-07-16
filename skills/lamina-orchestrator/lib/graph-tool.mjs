#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRun, coverageReport, deriveScenarioSuggestions, renderImplementMarkdown, renderRunMarkdown, scopeRun } from './graph.mjs';
import { loadRunJson, validateRunJson } from './run.mjs';

const [command, runPath, ...args] = process.argv.slice(2);
const usage = 'Usage: graph-tool.mjs <create|validate|derive|render|scope|coverage> <run.json> [args]';
if (!command || !runPath) {
  console.error(usage);
  process.exit(1);
}

if (command === 'create') {
  if (fs.existsSync(runPath)) throw new Error(`Refusing to overwrite ${runPath}`);
  const options = Object.fromEntries(args.map((arg) => arg.split(/=(.*)/s).slice(0, 2)));
  const run = createRun({
    id: options.id || path.basename(path.dirname(path.resolve(runPath))),
    target: options.target || options.id || 'product behavior',
    problem: options.problem || 'Describe the user problem',
    outcome: options.outcome || 'Describe the desired outcome',
    users: (options.users || 'primary-user').split(','),
    stage: options.stage || 'spark',
  });
  fs.mkdirSync(path.dirname(path.resolve(runPath)), { recursive: true });
  fs.writeFileSync(runPath, `${JSON.stringify(run, null, 2)}\n`);
} else if (command === 'validate') {
  const result = validateRunJson(runPath);
  if (!result.ok) {
    for (const error of result.errors) console.error(error);
    process.exit(1);
  }
  console.log('run.json valid');
} else {
  const run = loadRunJson(runPath);
  if (command === 'derive') {
    const suggestions = deriveScenarioSuggestions(run);
    if (args.includes('--write')) {
      run.scenarios = [...(run.scenarios || []), ...suggestions];
      fs.writeFileSync(runPath, `${JSON.stringify(run, null, 2)}\n`);
    } else console.log(JSON.stringify(suggestions, null, 2));
  } else if (command === 'render') {
    const dir = path.dirname(path.resolve(runPath));
    fs.writeFileSync(path.join(dir, 'run.md'), renderRunMarkdown(run));
    if (run.status === 'ready_to_build') fs.writeFileSync(path.join(dir, 'implement.md'), renderImplementMarkdown(run));
  } else if (command === 'scope') {
    const refs = args.filter((arg) => !arg.startsWith('--'));
    console.log(JSON.stringify(scopeRun(run, refs), null, 2));
  } else if (command === 'coverage') console.log(JSON.stringify(coverageReport(run), null, 2));
  else {
    console.error(usage);
    process.exit(1);
  }
}
