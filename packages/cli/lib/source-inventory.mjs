/** Git-aware source inventory for observation and runtime-baseline authority (#71).
 *
 * Observation inventory emits rebuildable source-derived facts only. It never
 * writes canonical product truth or approved graph statements.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isExcludedPath, loadManifest, sha256 as contractSha256 } from '../../../benchmarks/runtime-baseline-v1/contract.mjs';

export const SOURCE_INVENTORY_SCHEMA = 'lamina.source-inventory/v1';
export const SOURCE_CONFIG_NAMES = new Set(['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml']);
export const MAX_SOURCE_LOC_BYTES = 4 * 1024 * 1024;

export const OBSERVATION_COVERAGE_CATEGORIES = Object.freeze([
  'entry_points', 'commands', 'routes', 'handlers', 'schemas', 'entities',
  'state_transitions', 'permissions', 'events', 'tests', 'documentation',
  'personas', 'feature_flags', 'dependencies',
]);

export const OBSERVATION_IGNORE_PATTERNS = Object.freeze([
  '**/.git/**', '**/.lamina/runs/**', '**/.lamina/runtime/**', '**/.lamina/runtime-cli/**',
  '**/.agents/skills/**', '**/.codex/skills/**', '**/.claude/skills/**', '**/.opencode/skills/**',
  '**/node_modules/**', '**/.venv*/**',
  '**/__pycache__/**', '**/.next/**', '**/dist/**', '**/build/**', '**/coverage/**',
  '**/benchmarks/results/**', '**/evals/fixtures/.vendor-tmp*/**',
]);

const EXCLUSION_REASON_BY_RULE = Object.freeze({
  '.git': 'git_metadata',
  '.agents/skills': 'agent_skill_mirror',
  '.claude/skills': 'agent_skill_mirror',
  '.codex/skills': 'agent_skill_mirror',
  '.opencode/skills': 'agent_skill_mirror',
  '.lamina/runs': 'lamina_run_artifacts',
  '.lamina/runtime': 'lamina_runtime_state',
  '.lamina/runtime-cli': 'lamina_runtime_cli',
  node_modules: 'dependency_root',
  __pycache__: 'python_cache',
  '.venv*': 'python_virtualenv',
  '.next': 'frontend_build_cache',
  dist: 'build_output',
  build: 'build_output',
  coverage: 'test_coverage_output',
  'benchmarks/results': 'benchmark_results',
  'evals/fixtures/.vendor-tmp*': 'vendored_eval_scratch',
});

export const BASELINE_EXCLUSION_RULES = Object.freeze(loadManifest().manifest.exclusions);

export const gitByteCompare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));

export function safeRepositoryPath(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0')
    && !value.includes('\\') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value)
    && value.split('/').every((piece) => piece && piece !== '.' && piece !== '..');
}

function trustedGit(repository, args, { encoding = 'utf8' } = {}) {
  return execFileSync('git', args, {
    cwd: repository,
    encoding,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function listGitPaths(repository, args) {
  try {
    const output = trustedGit(repository, args, { encoding: 'utf8' });
    return output.split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

export function classifyExclusion(relative, exclusions = BASELINE_EXCLUSION_RULES) {
  if (!safeRepositoryPath(relative)) return 'unsafe_path';
  if (!isExcludedPath(relative, exclusions)) return null;
  const pieces = relative.split('/');
  for (const rule of exclusions) {
    const normalized = rule.replace(/\*$/, '');
    const matches = relative === normalized || relative.startsWith(`${normalized}/`)
      || (rule.endsWith('*') && relative.startsWith(normalized));
    if (!matches) continue;
    if (EXCLUSION_REASON_BY_RULE[rule]) return EXCLUSION_REASON_BY_RULE[rule];
    if (pieces.includes(rule.replace(/\*$/, ''))) return EXCLUSION_REASON_BY_RULE[rule] || rule;
    return rule;
  }
  if (pieces.includes('.git')) return EXCLUSION_REASON_BY_RULE['.git'];
  if (pieces.includes('node_modules')) return EXCLUSION_REASON_BY_RULE.node_modules;
  if (pieces.includes('__pycache__')) return EXCLUSION_REASON_BY_RULE.__pycache__;
  if (pieces.some((piece) => /^\.venv/.test(piece))) return EXCLUSION_REASON_BY_RULE['.venv*'];
  return 'excluded';
}

export function isInventoryExcluded(relative, exclusions = BASELINE_EXCLUSION_RULES) {
  return classifyExclusion(relative, exclusions) !== null;
}

export function enumerateGitInventoryPaths(repository, {
  includeUntracked = true,
  includeTracked = true,
} = {}) {
  const physical = fs.realpathSync.native(repository);
  const paths = new Set();
  if (includeTracked) {
    for (const relative of listGitPaths(physical, ['ls-files', '-z'])) paths.add(relative);
  }
  if (includeUntracked) {
    for (const relative of listGitPaths(physical, ['ls-files', '--others', '--exclude-standard', '-z'])) {
      paths.add(relative);
    }
  }
  return [...paths].sort(gitByteCompare);
}

export function enumerateObservationPaths(repository, {
  exclusions = BASELINE_EXCLUSION_RULES,
  includeUntracked = true,
} = {}) {
  const physical = fs.realpathSync.native(repository);
  return enumerateGitInventoryPaths(physical, { includeUntracked }).flatMap((relative) => {
    const reason = classifyExclusion(relative, exclusions);
    if (reason) return [];
    const absolute = path.join(physical, relative);
    let stat;
    try { stat = fs.lstatSync(absolute); } catch { return []; }
    if (!stat.isFile()) return [];
    return [Object.freeze({
      path: relative,
      bytes: stat.size,
      content_sha256: null,
      exclusion: null,
    })];
  });
}

export function sourcePathIdentity(relative, content) {
  if (!safeRepositoryPath(relative)) throw new Error('source path identity requires a safe repository-relative path');
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const contentDigest = crypto.createHash('sha256').update(bytes).digest('hex');
  const blobOid = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  return Object.freeze({
    schema: SOURCE_INVENTORY_SCHEMA,
    source_key: relative,
    logical_key: relative,
    content_sha256: contentDigest,
    blob_oid: blobOid,
    byte_length: bytes.length,
    identity_digest: contractSha256(JSON.stringify({
      source_key: relative,
      content_sha256: contentDigest,
      byte_length: bytes.length,
    })),
  });
}

export function inventoryPathsDigest(paths) {
  return contractSha256([...paths].sort(gitByteCompare).join('\n'));
}

export function summarizePathInventory(paths, repository, manifest, fixture, {
  exclusions = manifest.exclusions,
  sourceNames = SOURCE_CONFIG_NAMES,
  maxSourceLocBytes = MAX_SOURCE_LOC_BYTES,
} = {}) {
  const physical = fs.realpathSync.native(repository);
  const sourceExtensions = new Set(manifest.source_extensions);
  const retrievalExtensions = new Set(manifest.retrieval_extensions);
  const observationPaths = [];
  const retrievalPaths = [];
  const entries = [];
  let trackedBytes = 0;
  let observationBytes = 0;
  let retrievalBytes = 0;
  let sourceFiles = 0;
  let sourceBytes = 0;
  let sourceLoc = 0;

  for (const relative of [...paths].sort(gitByteCompare)) {
    if (!safeRepositoryPath(relative)) continue;
    const absolute = path.join(physical, relative);
    let stat;
    try { stat = fs.statSync(absolute); } catch { continue; }
    if (!stat.isFile()) continue;
    trackedBytes += stat.size;
    const exclusion = classifyExclusion(relative, exclusions);
    const contribution = {
      tracked_bytes: stat.size,
      observation_included: false,
      observation_bytes: 0,
      retrieval_included: false,
      retrieval_bytes: 0,
      source_included: false,
      source_bytes: 0,
      source_loc: 0,
      exclusion_reason: exclusion,
    };
    let content = null;
    if (!exclusion) {
      observationPaths.push(relative);
      observationBytes += stat.size;
      contribution.observation_included = true;
      contribution.observation_bytes = stat.size;
    }
    const extension = path.posix.extname(relative).toLowerCase();
    if (!exclusion && retrievalExtensions.has(extension) && stat.size <= manifest.retrieval_max_file_bytes) {
      try {
        content = fs.readFileSync(absolute);
        new TextDecoder('utf-8', { fatal: true }).decode(content);
        retrievalPaths.push(relative);
        retrievalBytes += stat.size;
        contribution.retrieval_included = true;
        contribution.retrieval_bytes = stat.size;
      } catch {}
    }
    if (sourceExtensions.has(extension) || sourceNames.has(path.posix.basename(relative))) {
      sourceFiles += 1;
      sourceBytes += stat.size;
      contribution.source_included = true;
      contribution.source_bytes = stat.size;
      if (stat.size <= maxSourceLocBytes) {
        if (!content) {
          try { content = fs.readFileSync(absolute); } catch { content = null; }
        }
        if (content) {
          const lines = content.toString('utf8').split(/\r?\n/).filter((line) => line.trim()).length;
          sourceLoc += lines;
          contribution.source_loc = lines;
        }
      }
    }
    entries.push(Object.freeze({ path: relative, ...contribution }));
  }

  if (fixture?.source_loc) {
    if (sourceLoc < fixture.source_loc.minimum || sourceLoc > fixture.source_loc.maximum) {
      throw new Error(`fixture ${fixture.id} source LOC ${sourceLoc} is outside its frozen class`);
    }
  }

  const inventory = Object.freeze({
    tracked_files: paths.length,
    tracked_bytes: trackedBytes,
    tracked_source_files: sourceFiles,
    tracked_source_bytes: sourceBytes,
    tracked_source_loc: sourceLoc,
    observation_indexed_files: observationPaths.length,
    observation_indexed_bytes: observationBytes,
    observation_paths_digest: inventoryPathsDigest(observationPaths),
    retrieval_candidate_files: retrievalPaths.length,
    retrieval_candidate_bytes: retrievalBytes,
    retrieval_paths_digest: inventoryPathsDigest(retrievalPaths),
  });
  return Object.freeze({
    inventory,
    entries,
    observation_paths: Object.freeze(observationPaths),
    retrieval_paths: Object.freeze(retrievalPaths),
    inventory_digest: contractSha256(JSON.stringify(Object.fromEntries(
      Object.keys(inventory).sort().map((key) => [key, inventory[key]]),
    ))),
    non_canonical: true,
    writes_product_truth: false,
  });
}

export function summarizeRepositoryInventory(repository, { manifest, fixture } = {}) {
  const loaded = manifest ? { manifest } : loadManifest();
  const resolvedManifest = manifest || loaded.manifest;
  const paths = enumerateGitInventoryPaths(repository, { includeUntracked: false });
  const summary = summarizePathInventory(paths, repository, resolvedManifest, fixture);
  return Object.freeze({
    ...summary.inventory,
    commit: fixture?.commit || null,
    exclusion_rules: resolvedManifest.exclusions,
    _retrieval_paths: summary.retrieval_paths,
  });
}

export function buildCoverageFoundation(entries, {
  readContent = true,
  repository = null,
  extractSignals,
} = {}) {
  if (typeof extractSignals !== 'function') {
    throw new Error('buildCoverageFoundation requires the production brownfield signal extractor');
  }
  const coverage = Object.fromEntries(OBSERVATION_COVERAGE_CATEGORIES.map((category) => [category, []]));
  const physical = repository ? fs.realpathSync.native(repository) : null;
  for (const entry of entries) {
    if (!entry.observation_included) continue;
    let content;
    if (readContent && physical) {
      try { content = fs.readFileSync(path.join(physical, entry.path)); } catch { continue; }
    } else {
      continue;
    }
    const observed = extractSignals(entry.path, content);
    for (const category of observed.categories) {
      if (!coverage[category]) continue;
      for (const signal of observed.signals?.[category] || []) {
        if (!coverage[category].includes(signal)) coverage[category].push(signal);
      }
      if (!coverage[category].includes(entry.path) && category !== 'commands') {
        coverage[category].push(entry.path);
      }
    }
  }
  const normalized = Object.fromEntries(Object.entries(coverage).map(([key, values]) => [
    key,
    [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort().slice(0, 100),
  ]));
  const populated = Object.fromEntries(
    Object.entries(normalized).filter(([, values]) => values.length),
  );
  return Object.freeze({
    schema: 'lamina.source-inventory-coverage/v1',
    categories: Object.freeze(populated),
    category_counts: Object.freeze(Object.fromEntries(
      Object.entries(populated).map(([key, values]) => [key, values.length]),
    )),
    non_canonical: true,
    writes_product_truth: false,
  });
}

export function observationInventorySnapshot(repository, {
  manifest = loadManifest().manifest,
  exclusions = manifest.exclusions,
  sourceRevision = null,
  sourceRoot = null,
  extractSignals,
} = {}) {
  const physical = fs.realpathSync.native(repository);
  const paths = enumerateObservationPaths(physical, { exclusions });
  const entries = paths.map((item) => Object.freeze({
    path: item.path,
    tracked_bytes: item.bytes,
    observation_included: true,
    observation_bytes: item.bytes,
    retrieval_included: false,
    retrieval_bytes: 0,
    source_included: false,
    source_bytes: 0,
    source_loc: 0,
    exclusion_reason: null,
  }));
  const summary = summarizePathInventory(
    paths.map((item) => item.path),
    physical,
    manifest,
    null,
    { exclusions },
  );
  return Object.freeze({
    schema: SOURCE_INVENTORY_SCHEMA,
    source_revision: sourceRevision,
    source_root: sourceRoot || physical,
    exclusion_rules: exclusions,
    exclusion_roots: Object.freeze([...new Set(
      entries.map((entry) => classifyExclusion(entry.path, exclusions)).filter(Boolean),
    )].sort()),
    paths: Object.freeze(paths),
    inventory: summary.inventory,
    coverage: buildCoverageFoundation(entries, { repository: physical, extractSignals }),
    non_canonical: true,
    writes_product_truth: false,
  });
}
