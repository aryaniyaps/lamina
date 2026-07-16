#!/usr/bin/env node
/**
 * Validate Harbor benchmark tasks + registry + goldens; emit suite manifest.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';
import { loadBenchManifest } from './stage-bench-fixture.mjs';
import {
  HARBOR_TASKS_DIR,
  REGISTRY_PATH,
  harborPath,
  loadRegistry,
  parseHarborDirName,
} from './harbor-tasks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GOLDENS_DIR = path.join(ROOT, 'benchmarks/goldens');
const SCHEMAS = path.join(ROOT, 'benchmarks/schemas');

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

function validateHarborTask(task) {
  for (const arm of ['control', 'treatment']) {
    const dest = harborPath(task.id, arm);
    const label = `${task.id}-${arm}`;
    if (!fs.existsSync(dest)) {
      errors.push(`${label}: missing Harbor task directory`);
      continue;
    }
    const required = [
      'instruction.md',
      'task.toml',
      'environment/Dockerfile',
      'tests/test.sh',
      'tests/golden.yaml',
      'tests/matched-phased-agent.sh',
    ];
    for (const rel of required) {
      if (!fs.existsSync(path.join(dest, rel))) {
        errors.push(`${label}: missing ${rel}`);
      }
    }
    const instruction = fs.readFileSync(path.join(dest, 'instruction.md'), 'utf8');
    if (/\/lamina-init/i.test(instruction) || /lamina-design/i.test(instruction)) {
      errors.push(`${label}: instruction.md must not name Lamina skills or slash commands`);
    }
    if (arm === 'control') {
      const agents = path.join(dest, 'environment/workspace/AGENTS.md');
      if (fs.existsSync(agents)) {
        const text = fs.readFileSync(agents, 'utf8');
        if (/\/lamina-init/i.test(text) || /lamina-design/i.test(text)) {
          errors.push(`${label}: control must not ship Lamina workflow AGENTS.md`);
        }
      }
    }
    if (arm === 'treatment') {
      const agents = path.join(dest, 'environment/workspace/AGENTS.md');
      if (fs.existsSync(agents)) {
        const text = fs.readFileSync(agents, 'utf8');
        // Upstream OSS AGENTS.md is fine; Lamina workflow overlays must not be injected.
        if (/Lamina workflow \(benchmark treatment arm\)/i.test(text)) {
          errors.push(`${label}: treatment must not ship Lamina AGENTS.md workflow overlay`);
        }
      }
      const skillsDir = path.join(dest, 'environment/workspace/.agents/skills');
      if (!fs.existsSync(path.join(skillsDir, 'lamina-init', 'SKILL.md'))) {
        errors.push(`${label}: treatment must install lamina-init skill`);
      }
    }
  }

  const controlInstruction = fs.readFileSync(
    path.join(harborPath(task.id, 'control'), 'instruction.md'),
    'utf8'
  );
  const treatmentInstruction = fs.readFileSync(
    path.join(harborPath(task.id, 'treatment'), 'instruction.md'),
    'utf8'
  );
  if (controlInstruction !== treatmentInstruction) {
    errors.push(`${task.id}: control and treatment instruction.md must be byte-identical`);
  }
  const controlDockerfile = fs.readFileSync(
    path.join(harborPath(task.id, 'control'), 'environment/Dockerfile'),
    'utf8'
  );
  const treatmentDockerfile = fs.readFileSync(
    path.join(harborPath(task.id, 'treatment'), 'environment/Dockerfile'),
    'utf8'
  );
  if (controlDockerfile !== treatmentDockerfile) {
    errors.push(`${task.id}: control and treatment Dockerfiles must be byte-identical`);
  }
  const sharedVerifierFiles = [
    'capture_artifact.py', 'criteria.py', 'finalize_reward.py', 'quality_checks.py',
    'reward.toml', 'run_rewardkit.sh', 'subscription_judge.py', 'test.sh',
    'write_baseline_manifest.py', 'llm_judge/prompt.md',
    'llm_judge/product-behavior.toml', 'golden.yaml', 'judge-context.md',
    'matched-phased-agent.sh',
  ];
  for (const rel of sharedVerifierFiles) {
    const controlFile = fs.readFileSync(path.join(harborPath(task.id, 'control'), 'tests', rel));
    const treatmentFile = fs.readFileSync(path.join(harborPath(task.id, 'treatment'), 'tests', rel));
    if (!controlFile.equals(treatmentFile)) {
      errors.push(`${task.id}: verifier file differs across arms: ${rel}`);
    }
    if (!['golden.yaml', 'judge-context.md'].includes(rel)) {
      const canonicalFile = fs.readFileSync(
        path.join(ROOT, 'benchmarks/harbor/verifier', rel)
      );
      if (!controlFile.equals(canonicalFile)) {
        errors.push(`${task.id}: generated verifier is stale versus canonical file: ${rel}`);
      }
    }
  }

  const goldenPath = path.join(GOLDENS_DIR, task.id, 'golden.yaml');
  if (!fs.existsSync(goldenPath)) {
    errors.push(`${task.id}: missing goldens/${task.id}/golden.yaml`);
  } else {
    const golden = readYamlSync(goldenPath);
    validateAgainstSchema(golden, loadJsonSchema('golden.schema.json'), `${task.id}/golden`);
    if (golden.task_id && golden.task_id !== task.id) {
      errors.push(`${task.id}: golden task_id mismatch`);
    }
  }

  if (task.fixture) {
    try {
      loadBenchManifest(task.fixture);
    } catch (err) {
      errors.push(`${task.id}: fixture error — ${err.message}`);
    }
  }

  validateAgainstSchema(task, loadJsonSchema('task.schema.json'), task.id);

  const instructionPath = path.join(harborPath(task.id, 'control'), 'instruction.md');
  const instruction = fs.readFileSync(instructionPath, 'utf8');
  return {
    ...task,
    _paths: {
      harbor_control: path.relative(ROOT, harborPath(task.id, 'control')),
      harbor_treatment: path.relative(ROOT, harborPath(task.id, 'treatment')),
      instruction: path.relative(ROOT, instructionPath),
      golden: path.relative(ROOT, goldenPath),
    },
    instruction,
  };
}

function discoverHarborTasks() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    errors.push('benchmarks/harbor/registry.yaml missing — run npm run bench:harbor:sync');
    return [];
  }
  if (!fs.existsSync(HARBOR_TASKS_DIR)) {
    errors.push('benchmarks/harbor/tasks/ missing — run npm run bench:harbor:sync');
    return [];
  }

  const dirs = fs
    .readdirSync(HARBOR_TASKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => parseHarborDirName(n));

  const registry = loadRegistry();
  const registryIds = new Set(registry.map((e) => e.id));
  const tasks = [];
  for (const entry of registry) {
    const validated = validateHarborTask(entry);
    tasks.push(validated);
    for (const arm of ['control', 'treatment']) {
      const name = `${entry.id}-${arm}`;
      if (!dirs.includes(name)) {
        errors.push(`${name}: listed in registry but directory missing`);
      }
    }
  }
  for (const name of dirs) {
    const parsed = parseHarborDirName(name);
    if (parsed && !registryIds.has(parsed.id)) {
      errors.push(`${name}: directory exists but not listed in registry`);
    }
  }
  return tasks;
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
      fixture: t.fixture ?? null,
      oss: t.oss ?? null,
      runs: t.runs ?? release.runs_per_arm,
      paths: t._paths,
      instruction: t.instruction,
    })),
  };
}

function readRelease() {
  return readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx !== -1
      ? path.resolve(process.argv[outIdx + 1])
      : path.join(ROOT, 'benchmarks/tmp/bench-suite.json');

  const tasks = discoverHarborTasks();
  const release = readRelease();
  const methodology = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'benchmarks/methodology.json'), 'utf8')
  );
  const coreCount = tasks.filter((t) => t.suite === 'core').length;
  const extendedCount = tasks.filter((t) => t.suite === 'extended').length;
  const expectedPublished = Number(release.tasks_published ?? 5);

  if (coreCount !== expectedPublished) {
    errors.push(`Expected ${expectedPublished} core tasks, found ${coreCount}`);
  }
  if (coreCount + extendedCount !== tasks.length) {
    errors.push('Every task must declare suite: core or suite: extended');
  }
  if (tasks.length !== Number(release.tasks_total)) {
    errors.push(`Expected ${release.tasks_total} tasks, found ${tasks.length}`);
  }
  const coreIds = tasks.filter((t) => t.suite === 'core').map((t) => t.id);
  const declaredCoreIds = methodology.corpus?.published_task_ids || [];
  if (JSON.stringify(coreIds) !== JSON.stringify(declaredCoreIds)) {
    errors.push(
      `Registry core IDs ${coreIds.join(',')} do not match methodology corpus ${declaredCoreIds.join(',')}`
    );
  }
  if ((release.publish_suite || 'core') !== 'core') {
    errors.push('release.publish_suite must be core for the v1 claim');
  }
  const expectedPublishTrials = coreCount * 2 * Number(release.runs_per_arm_publish || 0);
  if (Number(release.trials_total_publish) !== expectedPublishTrials) {
    errors.push(`trials_total_publish must equal ${expectedPublishTrials}`);
  }
  if (!String(release.container_base_image || '').includes('@sha256:')) {
    errors.push('container_base_image must be digest-pinned');
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(release.codex_cli_version || ''))) {
    errors.push('codex_cli_version must be an exact semver pin');
  }

  if (errors.length) {
    console.error('LaminaBench validation FAILED:\n');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const suite = compileSuite(tasks, release);
  suite.published_task_ids = tasks.filter((t) => t.suite === 'core').map((t) => t.id);
  suite.tasks_total = tasks.length;
  suite.tasks_published = suite.published_task_ids.length;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(suite, null, 2) + '\n');

  console.log(`LaminaBench: ${tasks.length} Harbor tasks validated`);
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
