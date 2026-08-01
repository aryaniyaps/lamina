#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import {
  graphRequest,
  stopIncompatibleServer,
} from '../../packages/cli/lib/graph-runtime/client.mjs';
import { runtimePaths } from '../../packages/cli/lib/graph-runtime/util.mjs';
import { assertSafeRunnerContext } from '../../packages/cli/lib/safe-runner-context.mjs';
import {
  assertScenario,
  COLD_RUNS,
  fixtureById,
  loadManifest,
  MAX_WORKLOAD_OUTPUT_BYTES,
  SCENARIOS,
  sha256,
  summarizeNanoseconds,
  WARM_SAMPLES,
  WARMUP_SAMPLES,
  WORKLOAD_SCHEMA,
} from './contract.mjs';

assertSafeRunnerContext('real-repository runtime baseline');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY = path.resolve(HERE, '../..');
const CLI = path.join(REPOSITORY, 'packages/cli/bin/lamina.mjs');
const PACKAGE_ROOT = path.join(REPOSITORY, 'packages/cli');
const MARKER_SCHEMA = 'lamina.runtime-baseline-scratch/v1';
const MAX_CHILD_OUTPUT = 8 * 1024 * 1024;
const SOURCE_NAMES = new Set(['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml']);

const runnerTemporaryRoot = path.resolve(process.env.LAMINA_SAFE_RUNNER_TEMP_DIR || '');
if (!process.env.LAMINA_SAFE_RUNNER_TEMP_DIR || !path.isAbsolute(runnerTemporaryRoot)) {
  throw new Error('runtime baseline requires the safe runner private temporary authority');
}
const baselineRoot = path.join(runnerTemporaryRoot, 'runtime-baseline-v1');
const markerFile = path.join(baselineRoot, '.lamina-runtime-baseline-owner.json');
let runtimeInputs = null;

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function ensureOwnedRoot() {
  fs.mkdirSync(baselineRoot, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(markerFile)) {
    const entries = fs.readdirSync(baselineRoot);
    if (entries.length) fail('baseline scratch lacks its ownership marker', { entries });
    fs.writeFileSync(markerFile, stableJson({
      schema: MARKER_SCHEMA,
      root: baselineRoot,
      nonce: crypto.randomUUID(),
      owned_entries: ['assets', 'sources', 'runs'],
    }), { flag: 'wx', mode: 0o600 });
  }
  const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  if (marker.schema !== MARKER_SCHEMA || marker.root !== baselineRoot
    || !Array.isArray(marker.owned_entries)
    || marker.owned_entries.join(',') !== 'assets,sources,runs') {
    fail('baseline scratch ownership marker is invalid');
  }
  for (const name of marker.owned_entries) fs.mkdirSync(path.join(baselineRoot, name), { recursive: true, mode: 0o700 });
  return marker;
}

function cleanupOwnedRoot() {
  if (!fs.existsSync(baselineRoot)) return { removed: false, already_absent: true };
  const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  if (marker.schema !== MARKER_SCHEMA || marker.root !== baselineRoot) {
    fail('baseline cleanup requires its exact ownership marker');
  }
  const allowed = new Set([path.basename(markerFile), ...marker.owned_entries]);
  const foreign = fs.readdirSync(baselineRoot).filter((name) => !allowed.has(name));
  if (foreign.length) fail('baseline cleanup refuses foreign entries', { foreign });
  const quarantine = `${baselineRoot}.quarantine-${crypto.randomUUID()}`;
  fs.renameSync(baselineRoot, quarantine);
  fs.rmSync(quarantine, { recursive: true, force: false });
  if (fs.existsSync(baselineRoot) || fs.existsSync(quarantine)) fail('baseline cleanup was incomplete');
  return { removed: true, already_absent: false };
}

function childEnvironment(extra = {}) {
  const assets = path.join(baselineRoot, 'assets');
  return {
    ...process.env,
    LAMINA_RETRIEVAL_MODEL_PATH: runtimeInputs?.model || '',
    LAMINA_RETRIEVAL_RUNTIME: path.join(assets, 'retrieval-runtime'),
    ...extra,
  };
}

function run(command, args, { cwd = REPOSITORY, env = childEnvironment(), input = null,
  allowFailure = false, timeout = 20 * 60_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd, env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    timeout, maxBuffer: MAX_CHILD_OUTPUT,
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    fail(`child command failed: ${path.basename(command)} ${args.slice(0, 4).join(' ')}`, {
      status: result.status,
      signal: result.signal || null,
      stdout_tail: String(result.stdout || '').slice(-4000),
      stderr_tail: String(result.stderr || '').slice(-4000),
    });
  }
  return result;
}

function git(cwd, args, options = {}) {
  return run('git', [
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'protocol.file.allow=always',
    ...args,
  ], { cwd, ...options });
}

function assertPinnedInput(file, expected, label) {
  const absolute = path.resolve(file);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.bytes) {
    fail(`${label} is not the pinned physical input`, { file: absolute });
  }
  const bytes = fs.readFileSync(absolute);
  if (sha256(bytes) !== expected.sha256) fail(`${label} checksum does not match the manifest`);
  return absolute;
}

function prepareRuntimeAssets(manifest) {
  const assets = path.join(baselineRoot, 'assets');
  const worker = runtimeInputs.worker;
  const runtime = path.join(assets, 'retrieval-runtime');
  const runtimeManifest = path.join(runtime, 'asset-manifest.json');
  if (!fs.existsSync(runtimeManifest)) {
    run(worker, ['retrieval', 'extract-assets', '--destination', runtime], { env: childEnvironment() });
  }
  return footprint(assets, runtimeInputs);
}

function physicalFiles(root) {
  const output = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) output.push(full);
    }
  };
  visit(root);
  return output;
}

function footprint(assets, inputs) {
  const assetFiles = physicalFiles(assets);
  const sourceFiles = physicalFiles(PACKAGE_ROOT).filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`));
  const summarize = (files) => ({
    files: files.length,
    bytes: files.reduce((sum, file) => sum + fs.statSync(file).size, 0),
  });
  return {
    source_cli: summarize(sourceFiles),
    prepared_assets: summarize(assetFiles),
    sealed_model: { files: 1, bytes: fs.statSync(inputs.model).size },
    sealed_worker: { files: 1, bytes: fs.statSync(inputs.worker).size },
  };
}

function ensureSource(fixture) {
  const source = path.join(baselineRoot, 'sources', fixture.id);
  if (!fs.existsSync(path.join(source, '.git'))) {
    fs.rmSync(source, { recursive: true, force: true });
    git(baselineRoot, ['clone', '--filter=blob:none', '--no-checkout', fixture.url, source], {
      timeout: 20 * 60_000,
    });
    git(source, ['checkout', '--detach', fixture.commit], { timeout: 20 * 60_000 });
  }
  const head = git(source, ['rev-parse', 'HEAD']).stdout.trim();
  const dirty = git(source, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout;
  if (head !== fixture.commit || dirty.length) fail('pinned fixture source changed', { head, dirty: dirty.length });
  return source;
}

function ignored(relative, exclusions) {
  const pieces = relative.split('/');
  if (pieces.includes('.git') || pieces.includes('node_modules') || pieces.includes('__pycache__')
    || pieces.includes('.next') || pieces.includes('dist') || pieces.includes('build')
    || pieces.includes('coverage') || pieces.some((piece) => /^\.venv/.test(piece))) return true;
  return exclusions.some((rule) => {
    const normalized = rule.replace(/\*$/, '');
    return relative === normalized || relative.startsWith(`${normalized}/`);
  });
}

function repositoryMetadata(repository, manifest, fixture) {
  const tracked = git(repository, ['ls-files', '-z']).stdout.split('\0').filter(Boolean);
  const sourceExtensions = new Set(manifest.source_extensions);
  let trackedBytes = 0;
  let sourceBytes = 0;
  let sourceLoc = 0;
  let sourceFiles = 0;
  let indexedBytes = 0;
  let indexedFiles = 0;
  const indexed = [];
  for (const relative of tracked) {
    const file = path.join(repository, relative);
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (!stat.isFile()) continue;
    trackedBytes += stat.size;
    if (!ignored(relative, manifest.exclusions)) {
      indexedFiles += 1;
      indexedBytes += stat.size;
      indexed.push(relative);
    }
    const extension = path.extname(relative).toLowerCase();
    if (sourceExtensions.has(extension) || SOURCE_NAMES.has(path.basename(relative))) {
      sourceFiles += 1;
      sourceBytes += stat.size;
      if (stat.size <= 4 * 1024 * 1024) {
        const text = fs.readFileSync(file, 'utf8');
        sourceLoc += text.split(/\r?\n/).filter((line) => line.trim()).length;
      }
    }
  }
  if (sourceLoc < fixture.source_loc.minimum || sourceLoc > fixture.source_loc.maximum) {
    fail('fixture source LOC is outside its pinned class', { sourceLoc, range: fixture.source_loc });
  }
  return {
    commit: fixture.commit,
    tracked_files: tracked.length,
    tracked_bytes: trackedBytes,
    tracked_source_files: sourceFiles,
    tracked_source_bytes: sourceBytes,
    tracked_source_loc: sourceLoc,
    indexed_candidate_files: indexedFiles,
    indexed_candidate_bytes: indexedBytes,
    exclusion_rules: manifest.exclusions,
    indexed_paths_digest: sha256(indexed.join('\n')),
  };
}

function freshRepository(source, fixture, scenario, index) {
  const parent = path.join(baselineRoot, 'runs', fixture.id, scenario);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const repository = path.join(parent, `sample-${index}`);
  fs.rmSync(repository, { recursive: true, force: true });
  git(parent, ['clone', '--shared', '--no-checkout', source, repository]);
  git(repository, ['checkout', '--detach', fixture.commit]);
  return repository;
}

function cli(repository, args, options = {}) {
  const result = run(process.execPath, [CLI, ...args], { cwd: repository, env: childEnvironment(), ...options });
  try { return JSON.parse(result.stdout); } catch {
    fail('Lamina CLI returned invalid JSON', { args, stdout_tail: result.stdout.slice(-2000) });
  }
}

async function seedGraph(repository) {
  const workflow = 'workflow.baseline';
  const operation = 'operation.baseline.inspect';
  const actor = 'actor.baseline.maintainer';
  const persona = 'persona.baseline.maintainer';
  const invariant = 'invariant.baseline.preserve-source';
  const scenario = 'scenario.baseline.failed-change';
  const resources = [
    { id: workflow, kind: 'workflow', alias: 'baseline-change', data: { name: 'Implement a bounded repository change', objective: 'Prepare one safe, reviewable repository change.' } },
    { id: operation, kind: 'operation', data: { name: 'Inspect and change one source file', description: 'Inspect current source, make a bounded change, and preserve repository behavior.' } },
    { id: actor, kind: 'actor', data: { name: 'Repository maintainer' } },
    { id: persona, kind: 'persona', data: { name: 'Repository maintainer', goal: 'Prepare a bounded source change without losing existing behavior.' } },
    { id: invariant, kind: 'invariant', data: { name: 'Existing source behavior remains preserved outside the requested change.' } },
    { id: scenario, kind: 'scenario', data: { name: 'The proposed change cannot be prepared safely.' } },
  ];
  const session = await graphRequest('session.start', {}, repository);
  for (const resource of resources) await graphRequest('resource.propose', { session: session.id, resource }, repository);
  for (const statement of [
    { subject: workflow, predicate: 'lamina:hasStep', object: operation, qualifiers: { position: 1 } },
    { subject: actor, predicate: 'lamina:authorizedFor', object: operation },
    { subject: persona, predicate: 'lamina:canAssume', object: actor },
    { subject: workflow, predicate: 'lamina:constrainedBy', object: invariant },
    { subject: workflow, predicate: 'lamina:hasScenario', object: scenario },
  ]) await graphRequest('statement.propose', { session: session.id, statement }, repository);
  await graphRequest('session.publish', { id: session.id }, repository);
  const task = await graphRequest('design.walk.prepare', {
    workflow, persona, request: 'Prepare one bounded source change.',
  }, repository);
  await graphRequest('design.walk.record', {
    task,
    result: {
      schema: 'lamina.persona-walk/v1', task_id: task.task_id,
      workflow_ref: workflow, persona_ref: persona, mode: 'isolated_context',
      isolation_ref: 'runtime-baseline-v1', goal: 'Prepare a bounded source change safely.',
      actor_refs: [actor],
      nodes: [{
        id: 'node.baseline.inspect', operation_ref: operation,
        intent: 'Inspect current source and prepare a bounded change.',
        permission: { decision: 'allowed', actor_ref: actor, rationale: 'The repository maintainer owns this bounded change.' },
        inputs: [{ id: 'change-request', source: 'actor', required: true, rationale: 'The maintainer supplies the requested change.' }],
        input_policy: { mode: 'actor_provided', rationale: 'The request is supplied by the maintainer.' },
        relationship_policy: { mode: 'none', rationale: 'The operation creates no identity relationship.' },
        surface_refs: [],
        state_coverage: [
          { kind: 'entry', applicable: true, visible_state: 'The current source is available for inspection.' },
          { kind: 'in_progress', applicable: true, visible_state: 'Preparation progress is visible.' },
          { kind: 'empty', applicable: false, rationale: 'The pinned repository is non-empty.' },
          { kind: 'success', applicable: true, visible_state: 'A bounded preparation packet is available.' },
          { kind: 'failure', applicable: true, visible_state: 'The preparation failure is visible.' },
          { kind: 'denied', applicable: false, rationale: 'The seeded maintainer is authorized.' },
          { kind: 'recovery', applicable: true, visible_state: 'The request can be corrected and retried.' },
        ],
        scenario_coverage: [{ scenario_ref: scenario, applicable: true, trigger: 'Preparation cannot preserve the invariant.', expected: 'Preparation fails closed.', recovery: 'Refine the bounded request and retry.', preserves_input: true }],
        edge_case_coverage: [
          ['validation', true], ['authorization', true], ['duplicate', false], ['self_reference', false],
          ['concurrency', true], ['stale_data', true], ['interruption', true], ['retry', true], ['connectivity', true],
        ].map(([kind, applicable]) => applicable ? {
          kind, applicable, trigger: `${kind} affects preparation.`, expected: 'No unsafe source edit is authorized.', recovery: 'Refresh the source or request and retry.',
        } : { kind, applicable, rationale: 'This bounded preparation creates no relationship or duplicate effect.' }),
        invariant_probes: [{ invariant_ref: invariant, applicable: true, attempt: 'Prepare a change that would overwrite unrelated behavior.', expected: 'Preparation fails closed.' }],
        transitions: [
          { outcome: 'success', terminal: true, expected: 'A useful packet is returned.' },
          { outcome: `scenario:${scenario}`, terminal: true, expected: 'The failure and recovery are visible.' },
        ],
      }],
      discoveries: { personas: [], actors: [], operations: [], scenarios: [], invariants: [], surfaces: [], branches: [], open_decisions: [] },
    },
  }, repository);
  const request = path.join(repository, '.git', 'lamina', 'work', 'baseline-request.txt');
  fs.mkdirSync(path.dirname(request), { recursive: true, mode: 0o700 });
  fs.writeFileSync(request, 'Prepare one bounded source change while preserving existing behavior.\n', { mode: 0o600 });
  return { workflow, request };
}

function timeSync(callback) {
  const started = process.hrtime.bigint();
  const value = callback();
  return { wall_time_ns: Number(process.hrtime.bigint() - started), value };
}

async function disposeRepository(repository) {
  const paths = runtimePaths(repository);
  await stopIncompatibleServer(paths).catch(() => {});
  fs.rmSync(repository, { recursive: true, force: false });
  return {
    repository_removed: !fs.existsSync(repository),
    socket_removed: !fs.existsSync(paths.socket),
    lock_removed: !fs.existsSync(paths.lock),
  };
}

function compactDiagnostics(value) {
  return {
    backend: value?.backend || null,
    mode: value?.mode || null,
    generation: value?.generation || value?.status?.generation || null,
    expected: value?.expected ?? value?.counts?.expected ?? null,
    observed: value?.observed?.count ?? value?.counts?.committed ?? null,
    source_key_count: value?.observed?.source_key_count ?? null,
    counts: value?.counts || value?.status?.counts || null,
    freshness: value?.freshness || value?.status?.freshness || null,
    index_digest: value?.index_digest || value?.status?.index_digest || null,
    packet_id: value?.packet_id || null,
    obligation_count: Array.isArray(value?.obligations) ? value.obligations.length : null,
    experience_case_count: Array.isArray(value?.experience_cases) ? value.experience_cases.length : null,
  };
}

function changeFiles(repository, count) {
  const candidates = git(repository, ['ls-files', '-z']).stdout.split('\0').filter(Boolean)
    .filter((relative) => /\.(?:js|jsx|mjs|ts|tsx|py)$/.test(relative))
    .filter((relative) => !relative.includes('node_modules/'))
    .sort((left, right) => fs.statSync(path.join(repository, left)).size - fs.statSync(path.join(repository, right)).size)
    .slice(0, count);
  if (candidates.length !== count) fail('fixture lacks enough mutable source files');
  for (const relative of candidates) fs.appendFileSync(path.join(repository, relative), '\n// lamina runtime baseline bounded change\n');
  git(repository, ['add', '--', ...candidates]);
  git(repository, ['-c', 'user.name=Lamina Baseline', '-c', 'user.email=baseline@lamina.invalid', 'commit', '-m', `baseline ${count}-file change`]);
  return candidates;
}

async function runSample({ fixture, manifest, source, scenario, index }) {
  const repository = freshRepository(source, fixture, scenario, index);
  const metadata = repositoryMetadata(repository, manifest, fixture);
  let seeded = null;
  let measurement;
  let diagnostics = {};
  try {
    if (!['doctor-status-startup'].includes(scenario)) seeded = await seedGraph(repository);
    if (scenario === 'doctor-status-startup') {
      measurement = timeSync(() => ({
        doctor: cli(repository, ['doctor', '--json']),
        status: cli(repository, ['graph', 'status']),
      }));
      diagnostics = { graph_version: measurement.value.status.graph_version || null };
    } else if (scenario === 'initial-observation') {
      measurement = timeSync(() => cli(repository, ['graph', 'observe']));
      diagnostics = compactDiagnostics(measurement.value);
      if (diagnostics.source_key_count !== metadata.indexed_candidate_files) {
        fail('observation indexed count contradicts the pinned candidate set', { diagnostics, metadata });
      }
    } else if (scenario === 'initial-retrieval-readiness') {
      measurement = timeSync(() => cli(repository, ['context', 'rebuild']));
      diagnostics = compactDiagnostics(measurement.value);
    } else if (scenario === 'first-useful-preparation') {
      const output = path.join(repository, '.git', 'lamina', 'work', 'packet.json');
      measurement = timeSync(() => cli(repository, ['work', 'prepare', '--request-file', seeded.request, '--workflow', seeded.workflow, '--output', output]));
      diagnostics = compactDiagnostics(measurement.value);
    } else if (scenario === 'one-file-change' || scenario === 'multi-file-change') {
      const changed = changeFiles(repository, scenario === 'one-file-change' ? 1 : 5);
      measurement = timeSync(() => cli(repository, ['graph', 'observe']));
      diagnostics = { ...compactDiagnostics(measurement.value), changed_files: changed };
    } else if (scenario === 'full-derived-state-rebuild') {
      cli(repository, ['graph', 'observe']);
      cli(repository, ['context', 'rebuild']);
      measurement = timeSync(() => ({
        observation: cli(repository, ['graph', 'rebuild-observations']),
        retrieval: cli(repository, ['context', 'rebuild']),
      }));
      diagnostics = {
        observation: compactDiagnostics(measurement.value.observation),
        retrieval: compactDiagnostics(measurement.value.retrieval),
      };
    } else if (scenario === 'post-command-idle-rss') {
      const status = cli(repository, ['graph', 'status']);
      const pid = status.pid || runtimePaths(repository).daemon?.pid;
      const readRss = () => {
        try {
          const line = fs.readFileSync(`/proc/${pid}/status`, 'utf8').split('\n').find((item) => item.startsWith('VmRSS:'));
          return Number(line?.match(/\d+/)?.[0] || 0) * 1024;
        } catch { return 0; }
      };
      const before = readRss();
      measurement = timeSync(() => run('/bin/sh', ['-c', 'read _ || exit 0'], { input: '', timeout: 5_000 }));
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      diagnostics = { graphd_pid: pid || null, idle_rss_before_bytes: before, idle_rss_after_bytes: readRss(), idle_window_ms: 2000 };
    } else {
      fail('scenario is not a cold sample', { scenario });
    }
    return {
      index,
      wall_time_ns: measurement.wall_time_ns,
      repository: metadata,
      diagnostics,
      cleanup: await disposeRepository(repository),
    };
  } catch (error) {
    await disposeRepository(repository).catch(() => {});
    throw error;
  }
}

async function warmScenario({ fixture, manifest, source, scenario }) {
  const repository = freshRepository(source, fixture, scenario, 0);
  const metadata = repositoryMetadata(repository, manifest, fixture);
  const seeded = await seedGraph(repository);
  const samples = [];
  const diagnostics = [];
  const total = scenario === 'warm-preparation' ? WARMUP_SAMPLES + WARM_SAMPLES : COLD_RUNS;
  try {
    for (let index = 0; index < total; index += 1) {
      let measured;
      if (scenario === 'warm-preparation') {
        const output = path.join(repository, '.git', 'lamina', 'work', `packet-${index}.json`);
        measured = timeSync(() => cli(repository, ['work', 'prepare', '--request-file', seeded.request, '--workflow', seeded.workflow, '--output', output]));
      } else {
        measured = timeSync(() => cli(repository, ['graph', 'observe']));
      }
      if (scenario !== 'warm-preparation' || index >= WARMUP_SAMPLES) samples.push(measured.wall_time_ns);
      diagnostics.push(compactDiagnostics(measured.value));
    }
    return {
      samples,
      statistics: summarizeNanoseconds(samples, scenario === 'warm-preparation'),
      classification: scenario === 'warm-preparation' ? 'warm' : 'repeated-expensive',
      warmups_excluded: scenario === 'warm-preparation' ? WARMUP_SAMPLES : 0,
      p95_omitted_reason: scenario === 'noop-synchronization'
        ? 'A no-op observation still scans the real repository; 30 repetitions are materially expensive at medium and large scale.' : null,
      repository: metadata,
      diagnostics: diagnostics.slice(-3),
      cleanup: await disposeRepository(repository),
    };
  } catch (error) {
    await disposeRepository(repository).catch(() => {});
    throw error;
  }
}

async function cancellationScenario({ fixture, manifest, source, scenario }) {
  const repository = freshRepository(source, fixture, scenario, 0);
  const metadata = repositoryMetadata(repository, manifest, fixture);
  await seedGraph(repository);
  const child = spawn(process.execPath, [CLI, 'graph', 'observe', '--live'], {
    cwd: repository, env: childEnvironment(), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-4000); });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
  const [code, signal] = await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(() => resolve([null, 'TIMEOUT']), 10_000)),
  ]);
  if (signal === 'TIMEOUT') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    await once(child, 'exit').catch(() => {});
  }
  const cleanup = await disposeRepository(repository);
  return {
    samples: [],
    statistics: null,
    classification: 'expected-cancellation',
    repository: metadata,
    diagnostics: { exit_code: code, exit_signal: signal, stdout_tail: stdout, stderr_tail: stderr },
    cleanup,
  };
}

async function execute(fixtureId, scenario, modelFile, workerFile) {
  ensureOwnedRoot();
  const { manifest, digest: manifestDigest } = loadManifest();
  const fixture = fixtureById(fixtureId);
  assertScenario(scenario);
  if (process.platform !== 'linux' || process.arch !== 'x64') fail('baseline v1 is pinned to Linux x64');
  runtimeInputs = {
    model: assertPinnedInput(modelFile, manifest.runtime_assets.model, 'retrieval model'),
    worker: assertPinnedInput(workerFile, manifest.runtime_assets.worker_linux_x64, 'CocoIndex worker'),
  };
  const runtimeFootprint = prepareRuntimeAssets(manifest);
  const source = ensureSource(fixture);
  let payload;
  if (scenario === 'footprint') {
    const repository = freshRepository(source, fixture, scenario, 0);
    const metadata = repositoryMetadata(repository, manifest, fixture);
    const cleanup = await disposeRepository(repository);
    payload = { samples: [], statistics: null, classification: 'static', repository: metadata, diagnostics: runtimeFootprint, cleanup };
  } else if (['warm-preparation', 'noop-synchronization'].includes(scenario)) {
    payload = await warmScenario({ fixture, manifest, source, scenario });
  } else if (scenario === 'cancellation-shutdown-cleanup') {
    payload = await cancellationScenario({ fixture, manifest, source, scenario });
  } else {
    const samples = [];
    for (let index = 0; index < COLD_RUNS; index += 1) {
      samples.push(await runSample({ fixture, manifest, source, scenario, index }));
    }
    const latencies = samples.map((sample) => sample.wall_time_ns);
    payload = {
      samples: samples.map(({ repository: _repository, ...sample }) => sample),
      statistics: summarizeNanoseconds(latencies, false),
      classification: 'cold',
      repository: samples[0].repository,
      diagnostics: samples.map((sample) => sample.diagnostics),
      cleanup: {
        repository_removed: samples.every((sample) => sample.cleanup.repository_removed),
        socket_removed: samples.every((sample) => sample.cleanup.socket_removed),
        lock_removed: samples.every((sample) => sample.cleanup.lock_removed),
      },
    };
  }
  const record = {
    schema: WORKLOAD_SCHEMA,
    manifest_digest: manifestDigest,
    fixture: { id: fixture.id, name: fixture.name, url: fixture.url, commit: fixture.commit, class: fixture.class, languages: fixture.languages, polyglot: fixture.polyglot === true },
    scenario,
    runtime: { node: process.version, lamina_commit: git(REPOSITORY, ['rev-parse', 'HEAD']).stdout.trim(), assets_release: manifest.runtime_assets.release },
    ...payload,
  };
  const output = JSON.stringify(record);
  if (Buffer.byteLength(output) > MAX_WORKLOAD_OUTPUT_BYTES) fail('workload record exceeds its bounded output contract');
  process.stdout.write(`${output}\n`);
}

const [command, first, second, third, fourth] = process.argv.slice(2);
try {
  if (command === 'run') {
    if (!first || !second || !third || !fourth || process.argv.length !== 7) {
      fail('run requires exactly <fixture> <scenario> <model-file> <worker-file>');
    }
    await execute(first, second, third, fourth);
  } else if (command === 'cleanup') {
    if (first || second) fail('cleanup accepts no arguments');
    process.stdout.write(`${JSON.stringify({ schema: WORKLOAD_SCHEMA, cleanup: cleanupOwnedRoot() })}\n`);
  } else if (command === 'list') {
    process.stdout.write(`${JSON.stringify({ fixtures: loadManifest().manifest.fixtures.map((item) => item.id), scenarios: SCENARIOS })}\n`);
  } else {
    fail('usage: workload.mjs <run FIXTURE SCENARIO|cleanup|list>');
  }
} catch (error) {
  process.stderr.write(`${stableJson({
    schema: 'lamina.runtime-baseline-error/v1',
    error: { message: error.message, details: error.details || {} },
  })}`);
  process.exitCode = 1;
}
