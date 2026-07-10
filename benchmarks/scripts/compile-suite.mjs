#!/usr/bin/env node
/**
 * Validate benchmark tasks + goldens; compile suite manifest for run-bench.mjs.
 * Usage: node benchmarks/scripts/compile-suite.mjs [--check] [--out path]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';
import { loadBenchManifest } from './stage-bench-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASKS_DIR = path.join(ROOT, 'benchmarks/tasks');
const GOLDENS_DIR = path.join(ROOT, 'benchmarks/goldens');
const SCHEMAS = path.join(ROOT, 'benchmarks/schemas');

const CATEGORIES = new Set(['greenfield', 'oss_feature', 'oss_audit', 'workflow_edge', 'resilience']);
const WORKFLOWS = new Set(['design', 'audit']);

const errors = [];

function loadJsonSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMAS, name), 'utf8'));
}

function validateAgainstSchema(obj, schema, label) {
  if (schema.required) {
    for (const key of schema.required) {
      if (obj[key] === undefined) {
        errors.push(`${label}: missing required field "${key}"`);
      }
    }
  }
  if (schema.properties?.id?.pattern && obj.id && !new RegExp(schema.properties.id.pattern).test(obj.id)) {
    errors.push(`${label}: id "${obj.id}" does not match pattern`);
  }
  if (schema.properties?.category?.enum && obj.category && !schema.properties.category.enum.includes(obj.category)) {
    errors.push(`${label}: invalid category "${obj.category}"`);
  }
  if (schema.properties?.workflow?.enum && obj.workflow && !schema.properties.workflow.enum.includes(obj.workflow)) {
    errors.push(`${label}: invalid workflow "${obj.workflow}"`);
  }
}

function discoverTasks() {
  if (!fs.existsSync(TASKS_DIR)) {
    errors.push('benchmarks/tasks/ directory missing');
    return [];
  }
  const dirs = fs.readdirSync(TASKS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  const tasks = [];
  for (const dir of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
    const taskDir = path.join(TASKS_DIR, dir.name);
    const taskYaml = path.join(taskDir, 'task.yaml');
    const description = path.join(taskDir, 'description.md');
    const context = path.join(taskDir, 'context.md');

    if (!fs.existsSync(taskYaml)) {
      errors.push(`${dir.name}: missing task.yaml`);
      continue;
    }
    if (!fs.existsSync(description)) {
      errors.push(`${dir.name}: missing description.md`);
      continue;
    }
    if (!fs.existsSync(context)) {
      errors.push(`${dir.name}: missing context.md`);
      continue;
    }

    const task = readYamlSync(taskYaml);
    if (task.id && task.id !== dir.name) {
      errors.push(`${dir.name}: task.yaml id "${task.id}" does not match folder name`);
    }
    task.id = task.id || dir.name;
    validateAgainstSchema(task, loadJsonSchema('task.schema.json'), task.id);

    const goldenPath = path.join(GOLDENS_DIR, task.id, 'golden.yaml');
    if (!fs.existsSync(goldenPath)) {
      errors.push(`${task.id}: missing goldens/${task.id}/golden.yaml`);
    } else {
      const golden = readYamlSync(goldenPath);
      validateAgainstSchema(golden, loadJsonSchema('golden.schema.json'), `${task.id}/golden`);
      if (golden.task_id && golden.task_id !== task.id) {
        errors.push(`${task.id}: golden task_id mismatch`);
      }
      golden.task_id = golden.task_id || task.id;
      task._golden = golden;
    }

    if (task.fixture) {
      try {
        loadBenchManifest(task.fixture);
      } catch (err) {
        errors.push(`${task.id}: fixture error — ${err.message}`);
      }
    }

    task._paths = {
      task_dir: path.relative(ROOT, taskDir),
      description: path.relative(ROOT, description),
      context: path.relative(ROOT, context),
      golden: path.relative(ROOT, goldenPath),
    };
    tasks.push(task);
  }
  return tasks;
}

function buildPrompt(task) {
  const desc = fs.readFileSync(path.join(ROOT, task._paths.description), 'utf8').trim();
  const ctx = fs.readFileSync(path.join(ROOT, task._paths.context), 'utf8').trim();
  return `${desc}\n\n---\n\nContext:\n${ctx}\n\n---\n\n${task.prompt}`;
}

function compileSuite(tasks, release) {
  return {
    version: release.version,
    release_tag: release.release_tag,
    agent: release.agent,
    runs_per_arm: release.runs_per_arm,
    tasks: tasks.map((t) => ({
      id: t.id,
      category: t.category,
      workflow: t.workflow,
      prompt: t.prompt,
      full_prompt: buildPrompt(t),
      fixture: t.fixture ?? null,
      oss: t.oss ?? null,
      human_eval: t.human_eval ?? false,
      paths: t._paths,
    })),
  };
}

function readRelease() {
  const releasePath = path.join(ROOT, 'benchmarks/release.yaml');
  return readYamlSync(releasePath);
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx !== -1
      ? path.resolve(process.argv[outIdx + 1])
      : path.join(ROOT, 'benchmarks/tmp/bench-suite.json');

  const taskSchema = loadJsonSchema('task.schema.json');
  void taskSchema;

  const tasks = discoverTasks();
  const release = readRelease();

  if (tasks.length !== Number(release.tasks_total)) {
    errors.push(`Expected ${release.tasks_total} tasks, found ${tasks.length}`);
  }

  if (errors.length) {
    console.error('LaminaBench validation FAILED:\n');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const suite = compileSuite(tasks, release);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(suite, null, 2) + '\n');

  console.log(`LaminaBench: ${tasks.length} tasks validated`);
  if (!checkOnly) {
    console.log(`Suite manifest → ${outPath}`);
  }

  const byCategory = {};
  for (const t of tasks) {
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
  }
  console.log('Categories:', byCategory);
}

main();
