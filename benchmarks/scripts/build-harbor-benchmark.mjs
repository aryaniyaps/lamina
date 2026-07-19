#!/usr/bin/env node
/** Generate the canonical Harbor task variants from the authored corpus. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const corpusRoot = path.join(ROOT, 'benchmarks/corpus');
const tasksRoot = path.join(ROOT, 'benchmarks/harbor/tasks');
const arms = ['raw', 'plan', 'lamina'];

const corpus = JSON.parse(fs.readFileSync(path.join(corpusRoot, 'manifest.json'), 'utf8'));

const armPhases = {
  raw: [
    ['discover', 'Analyze the brief and write product-discovery.md. Record assumptions and unresolved decisions. Do not implement application source yet.'],
    ['contract', 'Create product-contract.md from the brief and discovery. Keep it concise, actionable, and method-neutral. Do not implement application source yet.'],
    ['implement', 'Implement the product completely from product-contract.md and the brief. Build the smallest coherent product slice and run relevant checks.'],
    ['review', 'Review the implementation against the brief and product-contract.md. Write product-review.md and product-fix-list.md. Do not edit application source in this step.'],
    ['fix', 'Implement product-fix-list.md completely in application source. Run the most relevant validation and leave the workspace in a usable final state.'],
  ],
  plan: [
    ['plan', 'Write a product plan and acceptance criteria in product-plan.md. Defer application source to a later step.'],
    ['build-order', 'Expand product-plan.md into product-build-order.md with an ordered implementation plan. Defer application source to the next step.'],
    ['implement', 'Implement product-plan.md and product-build-order.md completely in application source. Run relevant validation.'],
    ['review', 'Review the implementation against the brief, product-plan.md, and product-build-order.md. Write product-review.md and product-fix-list.md. Do not edit application source in this step.'],
    ['fix', 'Implement product-fix-list.md completely in application source. Run relevant validation and leave the workspace in a usable final state.'],
  ],
  lamina: [
    ['discover', 'Analyze the brief and record labeled assumptions in product-discovery.md. Do not invoke Lamina or implement application source yet.'],
    ['initialize', '/lamina-init\nEstablish minimum business context and evidence-labeled personas from the brief. This is an unattended benchmark turn; continue with labeled assumptions when answers are absent. Do not design or implement yet.'],
    ['design', '/lamina-design\nCreate and validate the minimum sufficient implementation contract from the brief and context. Defer application source until the implementation step.'],
    ['implement', 'Implement the frozen Lamina implementation contract completely in application source. Run the named proof checks and keep product artifacts method-neutral.'],
    ['verify', '/lamina-verify\nVerify the implementation against the brief and generated contract. Produce the canonical report and fix artifacts without editing application source in this step.'],
    ['fix', 'Implement the Lamina fix artifact completely without adding product scope. Run relevant validation repeatedly and leave the workspace in a usable final state.'],
  ],
};

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function fixtureSetup(task) {
  if (!task.fixture) return 'mkdir -p /app';
  return [
    'rm -rf /app',
    `git clone --depth 1 ${shellQuote(task.fixture_repo)} /app`,
    `cd /app && git fetch --depth 1 origin ${task.fixture_commit} && git checkout --detach ${task.fixture_commit}`,
    'if [ -f package.json ]; then corepack enable || true; fi',
  ].join(' && ');
}

function dockerfile(task) {
  return `FROM node:22-bookworm-slim\n\nRUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates git jq python3 && rm -rf /var/lib/apt/lists/*\nWORKDIR /app\nRUN ${fixtureSetup(task)}\n`;
}

function taskToml(task, arm) {
  const phases = armPhases[arm];
  const stepLines = phases.flatMap(([name], index) => [
    '[[steps]]',
    `name = ${JSON.stringify(name)}`,
    `min_reward = ${index === phases.length - 1 ? 0.1 : 0.0}`,
    '[steps.agent]',
    `timeout_sec = ${index === phases.length - 1 ? 3600 : 1800}.0`,
    '[steps.verifier]',
    'timeout_sec = 600.0',
    '',
  ]);
  return [
    'schema_version = "1.3"',
    'multi_step_reward_strategy = "final"',
    'artifacts = ["/app"]',
    '',
    '[task]',
    `name = "aryaniyaps/${task.id}-${arm}"`,
    `description = "LaminaBench ${task.id} ${arm} arm (${task.kind})"`,
    'authors = [{ name = "LaminaBench" }]',
    `keywords = ["lamina", "harbor", "claude-code", "sonnet", "${arm}", "${task.kind}"]`,
    '',
    '[metadata]',
    'benchmark = "lamina-bench"',
    'benchmark_version = "harbor-v1"',
    `task_id = "${task.id}"`,
    `arm = "${arm}"`,
    `kind = "${task.kind}"`,
    `fixture = ${JSON.stringify(task.fixture || "")}`,
    '',
    '[agent]',
    'timeout_sec = 3600.0',
    '',
    '[environment]',
    'network_mode = "public"',
    'build_timeout_sec = 900.0',
    'os = "linux"',
    'cpus = 4',
    'memory_mb = 8192',
    'storage_mb = 20480',
    '',
    ...stepLines,
  ].join('\n');
}

function gradeScript(task, arm, phase, isFinal) {
  const expected = {
    raw: { discover: 'product-discovery.md', contract: 'product-contract.md', review: 'product-fix-list.md' },
    plan: { plan: 'product-plan.md', 'build-order': 'product-build-order.md', review: 'product-fix-list.md' },
    lamina: { discover: 'product-discovery.md', initialize: '.lamina/business-context.md', design: '.lamina', verify: '.lamina' },
  }[arm];
  const marker = expected[phase] || null;
  return `#!/usr/bin/env python3\nimport json, os, pathlib, subprocess\nroot = pathlib.Path('/app')\nmarker = ${JSON.stringify(marker)}\nvalid = True\nif marker == '.lamina':\n    valid = (root / '.lamina').exists()\nelse:\n    valid = bool(marker and (root / marker).exists() and (root / marker).stat().st_size > 0)\nsource = []\nfor path in root.rglob('*'):\n    if path.is_file() and path.suffix in {'.ts','.tsx','.js','.jsx','.mjs','.py','.html','.css'} and 'node_modules' not in path.parts and '.git' not in path.parts:\n        source.append(path)\nif ${JSON.stringify(isFinal)}:\n    valid = valid and bool(source)\nresult = {'step': ${JSON.stringify(phase)}, 'arm': ${JSON.stringify(arm)}, 'marker': marker, 'artifact_valid': bool(valid), 'source_files': len(source)}\npathlib.Path('/logs/verifier').mkdir(parents=True, exist_ok=True)\npathlib.Path('/logs/verifier/reward.json').write_text(json.dumps({'reward': 1.0 if valid else 0.0, **result}, indent=2) + '\\n')\nprint(json.dumps(result))\nraise SystemExit(0 if valid else 1)\n`;
}

function writeTask(task, arm) {
  const dir = path.join(tasksRoot, `${task.id}-${arm}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'environment'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.toml'), `${taskToml(task, arm)}\n`);
  fs.writeFileSync(path.join(dir, 'environment', 'Dockerfile'), dockerfile(task));
  for (const [phase, prompt] of armPhases[arm]) {
    const step = path.join(dir, 'steps', phase);
    fs.mkdirSync(path.join(step, 'tests'), { recursive: true });
    const isFinal = phase === armPhases[arm].at(-1)[0];
    fs.writeFileSync(path.join(step, 'instruction.md'), `# ${task.id} — ${arm} — ${phase}\n\n${prompt}\n\n## Authoritative brief\n\n${fs.readFileSync(path.join(corpusRoot, task.brief), 'utf8')}\n\nThis is an unattended benchmark step. Continue with labeled assumptions when the brief is incomplete. Keep application artifacts method-neutral.\n`);
    fs.writeFileSync(path.join(step, 'tests', 'test.sh'), '#!/usr/bin/env bash\nset -euo pipefail\npython3 /tests/grade.py\n');
    fs.chmodSync(path.join(step, 'tests', 'test.sh'), 0o755);
    fs.writeFileSync(path.join(step, 'tests', 'grade.py'), gradeScript(task, arm, phase, isFinal));
  }
}

fs.mkdirSync(tasksRoot, { recursive: true });
for (const entry of fs.readdirSync(tasksRoot, { withFileTypes: true })) fs.rmSync(path.join(tasksRoot, entry.name), { recursive: true, force: true });
for (const task of corpus.tasks) for (const arm of arms) writeTask(task, arm);
console.log(`Generated ${corpus.tasks.length * arms.length} Harbor tasks from ${corpus.tasks.length} authored corpus tasks.`);
