#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARBOR_TASKS = path.join(ROOT, 'benchmarks/harbor/tasks');

function walkFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(full) : [full];
  });
}

const r = spawnSync(
  'node',
  ['benchmarks/scripts/harbor-sync.mjs', '--tasks', 'task001,task003', '--tests-only'],
  { cwd: ROOT, encoding: 'utf8' }
);
assert.equal(r.status, 0, `harbor-sync failed: ${r.stderr}`);

const control = path.join(HARBOR_TASKS, 'task001-control');
const treatment = path.join(HARBOR_TASKS, 'task001-treatment');
assert.ok(fs.existsSync(control), 'task001-control missing');
assert.ok(fs.existsSync(treatment), 'task001-treatment missing');

const controlInstr = fs.readFileSync(path.join(control, 'instruction.md'), 'utf8');
assert.ok(!/\/lamina-init/i.test(controlInstr), 'instruction must not name slash commands');
assert.ok(!/lamina-design/i.test(controlInstr), 'instruction must not name skills');

// Design C: no AGENTS.md/CLAUDE.md workflow overlays — harness drives phases.
assert.ok(
  !fs.existsSync(path.join(ROOT, 'benchmarks/harbor/overlays')),
  'legacy AGENTS overlays must be removed'
);

assert.ok(fs.existsSync(path.join(control, 'tests/test.sh')));
assert.ok(fs.existsSync(path.join(control, 'tests/criteria.py')));
assert.ok(fs.existsSync(path.join(control, 'tests/quality_checks.py')));
assert.ok(fs.existsSync(path.join(control, 'tests/baseline-manifest.json')));
assert.ok(fs.existsSync(path.join(control, 'tests/llm_judge/product-behavior.toml')));
assert.ok(fs.existsSync(path.join(control, 'tests/judge-context.md')));
assert.ok(!fs.existsSync(path.join(control, 'tests/harbor-score.mjs')), 'legacy harbor-score.mjs must be removed');
assert.ok(!fs.existsSync(path.join(control, 'tests/golden_coverage')), 'phrase golden_coverage must be removed');
assert.ok(fs.existsSync(path.join(control, 'tests/golden.yaml')));
assert.ok(fs.existsSync(path.join(ROOT, 'benchmarks/harbor/verifier/reward.toml')));
assert.ok(!fs.existsSync(path.join(ROOT, 'benchmarks/harbor/verifier/golden_coverage')));
assert.ok(!fs.existsSync(path.join(ROOT, 'benchmarks/harbor/verifier/clarify_stall/check.py')));
assert.ok(fs.existsSync(path.join(ROOT, 'benchmarks/harbor/registry.yaml')));

const testSh = fs.readFileSync(path.join(control, 'tests/test.sh'), 'utf8');
assert.ok(/rewardkit/.test(testSh), 'test.sh must invoke rewardkit');
assert.ok(fs.existsSync(path.join(control, 'tests/run_rewardkit.sh')), 'run_rewardkit.sh must be synced');

const finalize = fs.readFileSync(path.join(control, 'tests/finalize_reward.py'), 'utf8');
assert.ok(/structured_behavior_v4|item coverage/i.test(finalize), 'finalize must describe structured behavior scoring');
assert.ok(!/score_golden|golden_coverage_pct/.test(finalize), 'finalize must not score phrase golden');

const criteria = fs.readFileSync(path.join(control, 'tests/criteria.py'), 'utf8');
assert.ok(!/def score_golden|ALIASES\s*=/.test(criteria), 'criteria must not keep phrase golden helpers');
assert.ok(
  /Agent-modified application source/.test(criteria) && /delta_plus_context/.test(criteria),
  'large-repo capture must prioritize source changed from the hidden pre-agent baseline'
);

const taskToml = fs.readFileSync(path.join(control, 'task.toml'), 'utf8');
assert.ok(/\[task\]/.test(taskToml), 'task.toml must include [task] section for Harbor publish');
assert.ok(/name = "aryaniyaps\/task001-control"/.test(taskToml), 'task.toml must set Harbor task name');
assert.ok(/ecological-matched-phases/.test(taskToml), 'task.toml must tag ecological matched phases');
assert.ok(/\[verifier\.env\]/.test(taskToml), 'task.toml must pass verifier env for Rewardkit judge');
const taskMeta = JSON.parse(fs.readFileSync(path.join(control, 'tests/task-meta.json'), 'utf8'));
assert.equal(taskMeta.harness_version, '1.7.0');
assert.equal(taskMeta.results_contract_version, '2.3.0');
assert.equal(taskMeta.rubric_version, 'structured-behavior-v4');

const dockerfile = fs.readFileSync(path.join(control, 'environment/Dockerfile'), 'utf8');
assert.ok(/@openai\/codex/.test(dockerfile), 'Dockerfile must install Codex for the subscription-auth runner');
assert.ok(/@openai\/codex@0\.144\.5/.test(dockerfile), 'Dockerfile must pin the Codex CLI');
assert.ok(/node:20-bookworm-slim@sha256:/.test(dockerfile), 'Dockerfile must pin its base image digest');
assert.ok(!/@anthropic-ai\/claude-code/.test(dockerfile), 'Dockerfile must not retain the removed Claude Code agent');

assert.ok(
  !fs.existsSync(path.join(ROOT, 'benchmarks/harbor/prompt_template.j2')),
  'legacy Harbor prompt templates must be removed'
);
assert.ok(
  !fs.existsSync(path.join(ROOT, 'benchmarks/README.md')),
  'benchmarks README must be removed'
);

const methodology = JSON.parse(fs.readFileSync(path.join(ROOT, 'benchmarks/methodology.json'), 'utf8'));
assert.equal(methodology.id, 'design_c_ecological_matched_phases');

const release = fs.readFileSync(path.join(ROOT, 'benchmarks/release.yaml'), 'utf8');
assert.ok(release.includes('results_contract_version: "2.3.0"'));
assert.ok(release.includes('harness_version: "1.7.0"'));
assert.ok(release.includes('phases_per_trial: 5'));
assert.ok(!/golden_field_weights|golden_coverage:|harbor_prompt_template/.test(release));

// Shared treatment/verifier instructions must not leak benchmark task identities or
// exact hidden-checklist identifiers. The judge receives checklist data dynamically
// after the agent exits; agent-visible skills must remain domain-neutral.
const noLeakTargets = [
  ...walkFiles(path.join(ROOT, 'skills')).filter((file) => /\.(md|yaml|yml|toml|mjs|js|py)$/.test(file)),
  ...walkFiles(path.join(ROOT, 'benchmarks/harbor/verifier')).filter((file) => /\.(md|toml|sh|py)$/.test(file)),
];
const noLeakText = noLeakTargets.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
assert.ok(!/\btask\d{3}\b/i.test(noLeakText), 'shared skills/verifier must not hardcode task ids');
assert.ok(
  !/benchmarks\/goldens|golden\.yaml/i.test(noLeakText),
  'shared skills/verifier must not reference hidden golden files'
);
const goldenIdentifiers = new Set(
  walkFiles(path.join(ROOT, 'benchmarks/goldens'))
    .filter((file) => file.endsWith('golden.yaml'))
    .flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.match(/^\s+-\s+([a-z0-9_-]+)\s*$/)?.[1])
        .filter((identifier) => identifier?.includes('_'))
    )
);
for (const identifier of goldenIdentifiers) {
  assert.ok(
    !noLeakText.includes(identifier),
    `shared skills/verifier must not hardcode hidden checklist identifier: ${identifier}`
  );
}

assert.ok(fs.existsSync(path.join(control, 'tests/matched-phased-agent.sh')));
const harness = fs.readFileSync(path.join(ROOT, 'benchmarks/harbor/verifier/matched-phased-agent.sh'), 'utf8');
assert.ok(harness.includes('product-plan.md'), 'harness must use product-plan.md for control');
assert.ok(harness.includes('BRIEF_BLOCK'), 'harness must inject brief block into control phases');
assert.ok(harness.includes('unattended trial'), 'harness must say unattended trial not benchmark');
const judgePrompt = fs.readFileSync(path.join(ROOT, 'benchmarks/harbor/verifier/llm_judge/prompt.md'), 'utf8');
assert.ok(!/control\s*=|treatment\s*=|Lamina init/i.test(judgePrompt), 'judge prompt must be blind to arm workflow');
const runner = fs.readFileSync(path.join(ROOT, 'benchmarks/scripts/run-phased.mjs'), 'utf8');
assert.ok(
  runner.includes("{ stdio: ['pipe', 'inherit', 'inherit'], input: agentDriver }") &&
    !runner.includes(':/tmp/matched-phased-agent.sh:ro'),
  'agent harness must be streamed over stdin, not left readable as a cross-arm file'
);
const syncSource = fs.readFileSync(path.join(ROOT, 'benchmarks/scripts/harbor-sync.mjs'), 'utf8');
assert.ok(!syncSource.includes('bestEffortClear'), 'workspace cleanup must never continue partially');
assert.ok(syncSource.includes('Refusing to reuse uncleared benchmark workspace'));
assert.equal(
  runner.match(/\$\{path\.join\(taskDir, 'tests'\)\}:\/tests:ro/g)?.length,
  1,
  'only the post-agent verifier container may receive hidden verifier files'
);
assert.ok(
  runner.includes("${path.join(envDir, 'workspace')}:/app:ro") &&
    runner.includes("${qualityDir}:/logs/verifier") &&
    runner.includes('LAMINA_BENCH_QUALITY_PRECOMPUTED=1'),
  'agent-authored quality commands must run separately from the read-only scoring container'
);
assert.ok(!fs.existsSync(path.join(ROOT, 'benchmarks/harbor/verifier/treatment-phased-agent.sh')));
const ingestSource = fs.readFileSync(path.join(ROOT, 'benchmarks/scripts/ingest-harbor-results.mjs'), 'utf8');
assert.ok(
  ingestSource.includes('rewardFile?.rubric_version === release.rubric_version') &&
    ingestSource.includes('rewardFile?.results_contract_version === release.results_contract_version &&'),
  'ingest must require the exact current contract and rubric together'
);

console.log('harbor_sync_test: ok');
