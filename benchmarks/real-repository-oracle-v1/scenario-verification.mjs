import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateReport } from '../../scripts/safe-runner/report.mjs';
import { spawnTrustedGit } from '../../scripts/safe-runner/git.mjs';
import { assertSafeRunnerContext } from '../../packages/cli/lib/safe-runner-context.mjs';
import {
  realRepositoryOracleSourceClosureIdentity,
} from '../../scripts/safe-runner/real-repository-source-closure.mjs';
import { repositorySourceDigest, runnerBuildDigest } from '../../scripts/safe-runner/source-identity.mjs';
import { withFreshReviewedScenarioRepository } from './materialize.mjs';
import { REVIEWED_INVENTORIES } from './collection-authority.mjs';
import {
  SCENARIO_SELECTION_CANONICAL_SHA256, SCENARIO_SELECTION_RAW_SHA256,
  loadScenarioSelection,
} from './scenario-selection.mjs';

const MODULE_FILE = new URL('./scenario-verification.mjs', import.meta.url);
const ENTRYPOINT = 'benchmarks/real-repository-oracle-v1/workload.mjs';
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const KINDS = Object.freeze(['clean', 'modify', 'rename', 'delete', 'branch', 'logical_worktree']);
const RECORD_KEYS = Object.freeze([
  'order', 'scenario_identity_sha256', 'scratch_lease_sha256', 'kind', 'selection_provenance', 'pre', 'post', 'auxiliary', 'stage', 'checks',
  'internal_cleanup_verified',
]);
const STATE_KEYS = Object.freeze(['head', 'branch', 'upstream', 'changes']);
const STAGE_KEYS = Object.freeze([
  'before_count', 'before_sha256', 'after_count', 'after_sha256',
  'selected_before', 'selected_after', 'physical_before_count', 'physical_before_sha256',
  'physical_after_count', 'physical_after_sha256', 'physical_selected_before',
  'physical_selected_after',
]);
const CHECK_KEYS = Object.freeze([
  'source_blob', 'source_content', 'result_content', 'destination_absence', 'ref_lifecycle',
  'linked_marker', 'linked_admin', 'primary_clean',
  'linked_topology_sha256',
]);
const ROOT_KEYS = Object.freeze([
  'schema', 'workload_id', 'status', 'collection', 'selection_raw_sha256',
  'selection_canonical_sha256', 'bounds', 'records', 'records_sha256', 'source_sha256',
  'workload_sha256', 'expectations_loaded', 'grade_controller_evidence', 'quality_claims',
  'selection_provenance', 'limitation',
]);
const NO_QUALITY_CLAIMS = Object.freeze({
  workflow_selection: false, observation: false, obligations: false,
  source_localization: false, retrieval_ranking: false, end_to_end_runtime: false,
});
const LIMITATION = 'Lexical Git state verification only. Accepted discovery provenance is carried from the digest-locked reviewer selection and is not independently replayed. No Workflow, expectation, retrieval, grade, quality, or end-to-end runtime claim.';
const NO_TEST_HOOKS = Object.freeze({});

export const SCENARIO_VERIFICATION_SCHEMA = 'lamina.real-repository-oracle-scenario-verification/v1';
export const SCENARIO_VERIFICATION_WORKLOAD_ID = 'real-repository-oracle-v1:scenario-verification';
export const SCENARIO_VERIFICATION_EXACT_COMMAND = Object.freeze(['verify-scenarios']);
export const SCENARIO_VERIFICATION_PAYLOAD_PREFIX = 'LAMINA_REAL_REPOSITORY_SCENARIO_VERIFICATION_V1=';
export const SCENARIO_VERIFICATION_BOUNDS = Object.freeze({
  scenarios: 6,
  semantic_bytes: 16 * 1024,
  transport_bytes: 5_680,
  encoded_line_bytes: 7_680,
  git_timeout_ms: 60_000,
  git_output_bytes: 4 * 1024 * 1024,
});
export const SCENARIO_VERIFICATION_REPORT_STDOUT_TAIL_BYTES = 8 * 1024;
export const SCENARIO_VERIFICATION_REPORT_STDERR_TAIL_BYTES = 8 * 1024;

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const canonicalBytes = (value) => Buffer.from(JSON.stringify(canonical(value)));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const digest = (value) => sha256(canonicalBytes(value));

function checkedGit(cwd, args, { input, allowed = [0] } = {}) {
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
    throw new Error('scenario Git arguments must be a fixed string array');
  }
  const result = spawnTrustedGit(cwd, args, {
    input, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: SCENARIO_VERIFICATION_BOUNDS.git_timeout_ms,
    maxBuffer: SCENARIO_VERIFICATION_BOUNDS.git_output_bytes,
  });
  if (result?.error || result?.signal || !allowed.includes(result?.status)
    || Buffer.byteLength(String(result?.stdout || '')) > SCENARIO_VERIFICATION_BOUNDS.git_output_bytes
    || Buffer.byteLength(String(result?.stderr || '')) > SCENARIO_VERIFICATION_BOUNDS.git_output_bytes) {
    throw result?.error || new Error(`trusted scenario Git failed: ${args[0]}`);
  }
  return { status: result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}

export function parseScenarioPorcelainV2Z(output) {
  if (typeof output !== 'string' || !output.endsWith('\0') || output.includes('\r')
    || output.includes('\n')) throw new Error('scenario status must be exact terminal-NUL porcelain v2');
  const fields = output.split('\0');
  fields.pop();
  const headers = new Map();
  const changes = [];
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];
    let match = record.match(/^# (branch\.(?:oid|head|upstream|ab)) (.*)$/s);
    if (match) {
      if (headers.has(match[1])) throw new Error('scenario status contains duplicate branch headers');
      headers.set(match[1], match[2]);
      continue;
    }
    match = record.match(/^1 ([.MADRCU]{2}) (\S+) ([0-7]{6}) ([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40,64}) ([a-f0-9]{40,64}) (.*)$/s);
    if (match) {
      changes.push({ record_type: '1', xy: match[1], sub: match[2], mode_head: match[3],
        mode_index: match[4], mode_worktree: match[5], oid_head: match[6],
        oid_index: match[7], rename_kind: null, rename_score: null,
        path: match[8], original_path: null });
      continue;
    }
    match = record.match(/^2 ([.MADRCU]{2}) (\S+) ([0-7]{6}) ([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40,64}) ([a-f0-9]{40,64}) ([RC])([0-9]{1,3}) (.*)$/s);
    if (match && fields[index + 1] !== undefined) {
      changes.push({ record_type: '2', xy: match[1], sub: match[2], mode_head: match[3],
        mode_index: match[4], mode_worktree: match[5], oid_head: match[6],
        oid_index: match[7], rename_kind: match[8], rename_score: Number(match[9]),
        path: match[10], original_path: fields[index + 1] });
      index += 1;
      continue;
    }
    throw new Error('scenario Git status contains an unsupported porcelain record');
  }
  if (!headers.has('branch.oid') || !headers.has('branch.head')
    || headers.get('branch.oid') === '(initial)'
    || headers.has('branch.upstream') || headers.has('branch.ab')
    || !/^[a-f0-9]{40,64}$/.test(headers.get('branch.oid'))) {
    throw new Error('scenario status branch authority is missing, duplicated, or not standalone');
  }
  return {
    head: headers.get('branch.oid'),
    branch: headers.get('branch.head') === '(detached)' ? null : headers.get('branch.head'),
    upstream: null,
    changes,
  };
}

function gitState(repository) {
  return parseScenarioPorcelainV2Z(checkedGit(repository, [
    '--literal-pathspecs', 'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all',
  ]).stdout);
}

function stageIndex(repository) {
  const output = checkedGit(repository, ['ls-files', '--stage', '-z']).stdout;
  if (!output.endsWith('\0')) throw new Error('scenario stage index requires terminal NUL');
  const rows = output.split('\0').slice(0, -1).map((record) => {
    const match = record.match(/^([0-7]{6}) ([a-f0-9]{40,64}) 0\t([\s\S]+)$/);
    if (!match) throw new Error('scenario stage index contains a non-stage-0 row');
    return { mode: match[1], oid: match[2], path: match[3] };
  });
  if (rows.length > 6_000 || rows.some((row, index) => index > 0
    && Buffer.compare(Buffer.from(rows[index - 1].path), Buffer.from(row.path)) >= 0)) {
    throw new Error('scenario stage index is oversized, unordered, or duplicated');
  }
  return { rows, count: rows.length, sha256: digest(rows) };
}

function stageProof(before, after, scenario) {
  let expected = before.rows;
  if (scenario.kind === 'rename') {
    expected = before.rows.map((row) => row.path === scenario.path
      ? { ...row, path: scenario.destination } : row)
      .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  }
  if (JSON.stringify(expected) !== JSON.stringify(after.rows)) {
    throw new Error('scenario stage-0 index has an unexpected delta');
  }
  return {
    before_count: before.count, before_sha256: before.sha256,
    after_count: after.count, after_sha256: after.sha256,
    selected_before: before.rows.filter((row) => row.path === scenario.path),
    selected_after: after.rows.filter((row) =>
      row.path === (scenario.kind === 'rename' ? scenario.destination : scenario.path)),
  };
}

function physicalSurface(repository) {
  const root = fs.realpathSync.native(repository);
  const rows = [];
  const visit = (directory, relative = '') => {
    const names = fs.readdirSync(directory).sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)));
    for (const name of names) {
      if (relative === '' && name === '.git') continue;
      const selectedPath = relative ? `${relative}/${name}` : name;
      const physical = path.join(directory, name);
      const named = fs.lstatSync(physical, { bigint: true });
      if (named.isSymbolicLink()) throw new Error('scenario physical surface contains a symlink');
      if (named.isDirectory()) {
        if (fs.realpathSync.native(physical) !== physical) {
          throw new Error('scenario physical surface directory is not canonical');
        }
        visit(physical, selectedPath);
      } else if (named.isFile()) {
        if (named.nlink !== 1n) throw new Error('scenario physical surface contains a hardlink');
        const file = physicalFile(root, selectedPath);
        rows.push({ mode: (named.mode & 0o111n) === 0n ? '100644' : '100755',
          path: selectedPath, sha256: sha256(file.bytes) });
      } else throw new Error('scenario physical surface contains a special file');
      if (rows.length > 6_000) throw new Error('scenario physical surface exceeds the tracked-file bound');
    }
  };
  visit(root);
  rows.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  return { rows, count: rows.length, sha256: digest(rows) };
}

function physicalProof(before, after, scenario) {
  let expected = before.rows;
  if (scenario.kind === 'modify') {
    expected = before.rows.map((row) => row.path === scenario.path
      ? { ...row, sha256: scenario.result_content_sha256 } : row);
  } else if (scenario.kind === 'rename') {
    expected = before.rows.map((row) => row.path === scenario.path
      ? { ...row, path: scenario.destination } : row)
      .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  } else if (scenario.kind === 'delete') {
    expected = before.rows.filter((row) => row.path !== scenario.path);
  }
  if (JSON.stringify(expected) !== JSON.stringify(after.rows)) {
    throw new Error(`scenario physical checkout has an unexpected ${scenario.kind} delta`);
  }
  const afterPath = scenario.kind === 'rename' ? scenario.destination : scenario.path;
  return {
    physical_before_count: before.count, physical_before_sha256: before.sha256,
    physical_after_count: after.count, physical_after_sha256: after.sha256,
    physical_selected_before: before.rows.filter((row) => row.path === scenario.path),
    physical_selected_after: after.rows.filter((row) => row.path === afterPath),
  };
}

function parseWorktreeList(output) {
  if (typeof output !== 'string' || !output.endsWith('\0\0') || output.includes('\r')
    || output.includes('\n')) throw new Error('worktree topology must be terminal-NUL porcelain');
  return output.slice(0, -2).split('\0\0').map((record) => {
    const fields = record.split('\0');
    const item = {};
    for (const field of fields) {
      const separator = field.indexOf(' ');
      const key = separator === -1 ? field : field.slice(0, separator);
      const value = separator === -1 ? true : field.slice(separator + 1);
      if (!['worktree', 'HEAD', 'branch', 'detached'].includes(key) || key in item) {
        throw new Error('worktree topology contains an unsupported or duplicate field');
      }
      item[key] = value;
    }
    if (typeof item.worktree !== 'string' || !SHA1.test(item.HEAD || '')
      || (item.detached !== true && typeof item.branch !== 'string')
      || (item.detached === true && 'branch' in item)) {
      throw new Error('worktree topology record is incomplete');
    }
    return item;
  });
}

function logicalTopologyDigest(commit, scenario) {
  return digest([
    { role: 'primary', head: commit, branch: null },
    { role: scenario.logical_worktree_id, head: commit, branch: scenario.derived_branch },
  ]);
}

function assertWorktreeTopology(repository, linked, collection, scenario, linkedPresent) {
  const items = parseWorktreeList(checkedGit(repository,
    ['worktree', 'list', '--porcelain', '-z']).stdout);
  const expectedCount = linkedPresent ? 2 : 1;
  if (items.length !== expectedCount) throw new Error('worktree topology has an unexpected role count');
  const primary = items.find((item) => path.resolve(item.worktree) === path.resolve(repository));
  const secondary = items.find((item) => path.resolve(item.worktree) === path.resolve(linked));
  if (!primary || primary.HEAD !== collection.commit || primary.detached !== true
    || (linkedPresent && (!secondary || secondary.HEAD !== collection.commit
      || secondary.branch !== `refs/heads/${scenario.derived_branch}`))
    || (!linkedPresent && secondary)) throw new Error('worktree topology differs from selected roles');
  return linkedPresent ? logicalTopologyDigest(collection.commit, scenario)
    : digest([{ role: 'primary', head: collection.commit, branch: null }]);
}

function assertState(state, { head, branch = null, change = null }) {
  if (state.head !== head || state.branch !== branch || state.upstream !== null
    || (change === null ? state.changes.length !== 0
      : state.changes.length !== 1
        || JSON.stringify(state.changes[0]) !== JSON.stringify(change))) {
    throw new Error('scenario repository state differs from the exact lexical contract');
  }
}

function physicalFile(repository, relative) {
  const target = path.join(repository, ...relative.split('/'));
  const resolvedRepository = fs.realpathSync.native(repository);
  const parent = fs.realpathSync.native(path.dirname(target));
  if (parent !== resolvedRepository && !parent.startsWith(`${resolvedRepository}${path.sep}`)) {
    throw new Error('scenario source parent escapes the owned repository');
  }
  const named = fs.lstatSync(target, { bigint: true });
  const parentStat = fs.lstatSync(parent, { bigint: true });
  if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n) {
    throw new Error('scenario source is not an owned physical single-link file');
  }
  const descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (opened.dev !== named.dev || opened.ino !== named.ino || opened.size !== named.size
      || opened.mode !== named.mode || opened.nlink !== named.nlink) {
      throw new Error('scenario source changed while opening');
    }
    return { target, bytes: fs.readFileSync(descriptor), stat: named, parent, parent_stat: parentStat };
  } finally { fs.closeSync(descriptor); }
}

function sameNode(expected, actual, { size = true } = {}) {
  return actual.dev === expected.dev && actual.ino === expected.ino
    && actual.mode === expected.mode && actual.uid === expected.uid
    && actual.nlink === expected.nlink && (!size || actual.size === expected.size);
}

function assertPreMutationContinuity(source, label) {
  const named = fs.lstatSync(source.target, { bigint: true });
  const parent = fs.lstatSync(source.parent, { bigint: true });
  if (!named.isFile() || named.isSymbolicLink() || !parent.isDirectory()
    || parent.isSymbolicLink() || !sameNode(source.stat, named)
    || !sameNode(source.parent_stat, parent)) {
    throw new Error(`scenario ${label} pathname or parent changed before mutation`);
  }
}

function appendExact(source, appendUtf8, hooks) {
  const descriptor = fs.openSync(source.target,
    fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
  const bytes = Buffer.from(appendUtf8);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev !== source.stat.dev || opened.ino !== source.stat.ino
      || opened.mode !== source.stat.mode || opened.uid !== source.stat.uid
      || opened.nlink !== source.stat.nlink || opened.size !== source.stat.size) {
      throw new Error('scenario modify target changed between lstat and writable open');
    }
    hooks.after_append_open_before_write?.(Object.freeze({ target: source.target }));
    assertPreMutationContinuity(source, 'modify');
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error('scenario append did not make progress');
      offset += written;
    }
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!after.isFile() || after.dev !== opened.dev || after.ino !== opened.ino
      || after.mode !== opened.mode || after.uid !== opened.uid || after.nlink !== opened.nlink
      || after.size !== opened.size + BigInt(bytes.length)) {
      throw new Error('scenario modify descriptor changed after append');
    }
  } finally { fs.closeSync(descriptor); }
  const reopened = fs.openSync(source.target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const after = fs.fstatSync(reopened, { bigint: true });
    if (!after.isFile() || after.dev !== source.stat.dev || after.ino !== source.stat.ino
      || after.mode !== source.stat.mode || after.uid !== source.stat.uid
      || after.nlink !== source.stat.nlink
      || after.size !== source.stat.size + BigInt(bytes.length)
      || sha256(fs.readFileSync(reopened)) !== sha256(Buffer.concat([source.bytes, bytes]))) {
      throw new Error('scenario modify target changed after fsync and reopen');
    }
    const named = fs.lstatSync(source.target, { bigint: true });
    const parent = fs.lstatSync(source.parent, { bigint: true });
    if (!sameNode(after, named) || !sameNode(source.parent_stat, parent)) {
      throw new Error('scenario modify pathname or parent changed after append');
    }
  } finally { fs.closeSync(reopened); }
}

function unlinkExact(source, hooks) {
  const descriptor = fs.openSync(source.target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev !== source.stat.dev || opened.ino !== source.stat.ino
      || opened.mode !== source.stat.mode || opened.uid !== source.stat.uid
      || opened.nlink !== source.stat.nlink || opened.size !== source.stat.size) {
      throw new Error('scenario delete target changed between lstat and held open');
    }
    hooks.after_delete_open_before_unlink?.(Object.freeze({ target: source.target }));
    assertPreMutationContinuity(source, 'delete');
    fs.unlinkSync(source.target);
    if (fs.fstatSync(descriptor, { bigint: true }).nlink !== 0n) {
      throw new Error('scenario delete held descriptor remains linked');
    }
    try { fs.lstatSync(source.target); throw new Error('scenario delete path remains present'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parentAfter = fs.lstatSync(source.parent, { bigint: true });
    if (!parentAfter.isDirectory() || parentAfter.isSymbolicLink()
      || fs.realpathSync.native(source.parent) !== source.parent
      || parentAfter.dev !== source.parent_stat.dev || parentAfter.ino !== source.parent_stat.ino
      || parentAfter.mode !== source.parent_stat.mode || parentAfter.uid !== source.parent_stat.uid
      || parentAfter.nlink !== source.parent_stat.nlink) {
      throw new Error('scenario delete parent changed');
    }
  } finally { fs.closeSync(descriptor); }
}

function verifySource(repository, scenario) {
  const stage = checkedGit(repository, [
    '--literal-pathspecs', 'ls-files', '--stage', '-z', '--', scenario.path,
  ]).stdout.split('\0').filter(Boolean);
  if (stage.length !== 1) throw new Error('selected scenario source is not one exact stage-0 path');
  const match = stage[0].match(/^([0-7]{6}) ([a-f0-9]{40}) 0\t([\s\S]+)$/);
  if (!match || match[1] !== '100644' || match[2] !== scenario.blob_oid || match[3] !== scenario.path) {
    throw new Error('selected scenario source blob identity drifted');
  }
  const file = physicalFile(repository, scenario.path);
  if (sha256(file.bytes) !== scenario.original_content_sha256) {
    throw new Error('selected scenario source content identity drifted');
  }
  return file;
}

function destinationAbsent(repository, scenario) {
  const destination = path.join(repository, ...scenario.destination.split('/'));
  let parent = path.dirname(destination);
  while (parent !== repository) {
    const named = fs.lstatSync(parent);
    if (!named.isDirectory() || named.isSymbolicLink()
      || fs.realpathSync.native(parent) !== parent) throw new Error('rename destination parent is unsafe');
    parent = path.dirname(parent);
  }
  if (fs.existsSync(destination)
    || checkedGit(repository,
      ['--literal-pathspecs', 'ls-files', '-z', '--', scenario.destination]).stdout !== '') {
    throw new Error('rename destination is not absent');
  }
  const folded = scenario.destination.normalize('NFKC').toLocaleLowerCase('en-US');
  const paths = checkedGit(repository, ['ls-files', '-z']).stdout.split('\0').filter(Boolean);
  if (paths.some((candidate) => candidate.normalize('NFKC').toLocaleLowerCase('en-US') === folded)) {
    throw new Error('rename destination collides under portable casefolding');
  }
  return destination;
}

function baseChecks() {
  return {
    source_blob: null, source_content: null, result_content: null,
    destination_absence: null, ref_lifecycle: null, linked_marker: null,
    linked_admin: null, primary_clean: null, linked_topology_sha256: null,
  };
}

function type1Change(xy, blob, modeWorktree, selectedPath) {
  return { record_type: '1', xy, sub: 'N...', mode_head: '100644', mode_index: '100644',
    mode_worktree: modeWorktree, oid_head: blob, oid_index: blob,
    rename_kind: null, rename_score: null, path: selectedPath, original_path: null };
}

function renameChange(scenario) {
  return { record_type: '2', xy: 'R.', sub: 'N...', mode_head: '100644',
    mode_index: '100644', mode_worktree: '100644', oid_head: scenario.blob_oid,
    oid_index: scenario.blob_oid, rename_kind: 'R', rename_score: 100,
    path: scenario.destination, original_path: scenario.path };
}

function refExists(repository, branch) {
  return checkedGit(repository, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    allowed: [0, 1],
  }).status === 0;
}

function assertBranchResidueAbsent(repository, branch) {
  if (refExists(repository, branch)) throw new Error('selected branch ref remains');
  const config = checkedGit(repository, ['config', '--local', '--get-regexp', '^branch\\.'], {
    allowed: [0, 1],
  });
  if (config.status === 0 && config.stdout.split('\n').some((line) => line.includes(branch))) {
    throw new Error('selected branch config remains');
  }
  if (fs.existsSync(path.join(repository, '.git', 'logs', 'refs', 'heads', ...branch.split('/')))) {
    throw new Error('selected branch reflog remains');
  }
}

function executeSelectedScenario(repository, scratch, collection, scenario, hooks = NO_TEST_HOOKS) {
  const pre = gitState(repository);
  assertState(pre, { head: collection.commit });
  const beforeIndex = stageIndex(repository);
  const beforePhysical = physicalSurface(repository);
  const checks = baseChecks();
  let post = pre;
  let auxiliary = null;
  let afterPhysical = null;
  if (scenario.kind !== 'clean') {
    const source = verifySource(repository, scenario);
    checks.source_blob = true;
    checks.source_content = true;
    if (scenario.kind === 'modify') {
      appendExact(source, scenario.append_utf8, hooks);
      const result = physicalFile(repository, scenario.path).bytes;
      if (result.length !== scenario.result_bytes || sha256(result) !== scenario.result_content_sha256) {
        throw new Error('modified scenario result identity drifted');
      }
      checks.result_content = true;
      post = gitState(repository);
      assertState(post, { head: collection.commit,
        change: type1Change('.M', scenario.blob_oid, '100644', scenario.path) });
      afterPhysical = physicalSurface(repository);
    } else if (scenario.kind === 'rename') {
      destinationAbsent(repository, scenario);
      checks.destination_absence = true;
      checkedGit(repository, [
        '--literal-pathspecs', 'mv', '--', scenario.path, scenario.destination,
      ]);
      if (fs.existsSync(source.target)) throw new Error('rename source remains present');
      const result = physicalFile(repository, scenario.destination).bytes;
      if (sha256(result) !== scenario.original_content_sha256) throw new Error('rename content drifted');
      checks.result_content = true;
      post = gitState(repository);
      assertState(post, { head: collection.commit, change: renameChange(scenario) });
      afterPhysical = physicalSurface(repository);
    } else if (scenario.kind === 'delete') {
      unlinkExact(source, hooks);
      post = gitState(repository);
      assertState(post, { head: collection.commit,
        change: type1Change('.D', scenario.blob_oid, '000000', scenario.path) });
      afterPhysical = physicalSurface(repository);
    } else if (scenario.kind === 'branch') {
      if (refExists(repository, scenario.branch)) throw new Error('selected branch already exists');
      checkedGit(repository, [
        'checkout', '--quiet', '--no-track', '-b', scenario.branch, collection.commit,
      ]);
      post = gitState(repository);
      assertState(post, { head: collection.commit, branch: scenario.branch });
      afterPhysical = physicalSurface(repository);
      checkedGit(repository, ['checkout', '--quiet', '--detach', collection.commit]);
      checkedGit(repository, ['update-ref', '-d', `refs/heads/${scenario.branch}`, collection.commit]);
      assertBranchResidueAbsent(repository, scenario.branch);
      hooks.before_branch_final_proof?.(Object.freeze({ repository }));
      const finalState = gitState(repository);
      assertState(finalState, { head: collection.commit });
      const finalIndex = stageIndex(repository);
      const finalPhysical = physicalSurface(repository);
      if (JSON.stringify(finalIndex.rows) !== JSON.stringify(beforeIndex.rows)
        || JSON.stringify(finalPhysical.rows) !== JSON.stringify(beforePhysical.rows)) {
        throw new Error('selected branch cleanup changed the reviewed checkout');
      }
      checks.ref_lifecycle = true;
    } else if (scenario.kind === 'logical_worktree') {
      const branch = scenario.derived_branch;
      const linked = path.join(scratch.linked, scenario.logical_worktree_id);
      const gitAdmin = path.join(repository, '.git', 'worktrees');
      if (refExists(repository, branch) || fs.existsSync(linked)
        || (fs.existsSync(gitAdmin) && fs.readdirSync(gitAdmin).length !== 0)) {
        throw new Error('logical worktree ref, path, or admin authority already exists');
      }
      assertWorktreeTopology(repository, linked, collection, scenario, false);
      checkedGit(repository, [
        'worktree', 'add', '--quiet', '--no-track', '-b', branch, linked, collection.commit,
      ]);
      const marker = path.join(linked, '.git');
      const markerStat = fs.lstatSync(marker);
      if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error('linked worktree marker is not physical');
      const markerText = fs.readFileSync(marker, 'utf8').trim();
      const markerMatch = markerText.match(/^gitdir: (.+)$/);
      const admin = markerMatch ? fs.realpathSync.native(path.resolve(linked, markerMatch[1])) : null;
      const common = fs.realpathSync.native(path.join(repository, '.git'));
      if (!admin || !admin.startsWith(`${common}${path.sep}worktrees${path.sep}`)) {
        throw new Error('linked worktree admin escapes the owned common Git directory');
      }
      if (path.basename(admin) !== scenario.logical_worktree_id) {
        throw new Error('linked worktree admin identity differs from the selected logical role');
      }
      const adminStat = fs.lstatSync(admin, { bigint: true });
      const commonStat = fs.lstatSync(common, { bigint: true });
      if (!adminStat.isDirectory() || adminStat.isSymbolicLink()
        || adminStat.uid !== commonStat.uid) {
        throw new Error('linked worktree admin is not a physical owned directory');
      }
      checks.linked_marker = true;
      checks.linked_admin = true;
      checks.linked_topology_sha256 = assertWorktreeTopology(
        repository, linked, collection, scenario, true,
      );
      post = gitState(linked);
      assertState(post, { head: collection.commit, branch });
      auxiliary = gitState(repository);
      assertState(auxiliary, { head: collection.commit });
      afterPhysical = physicalSurface(linked);
      physicalProof(beforePhysical, physicalSurface(repository), { kind: 'clean' });
      checks.primary_clean = true;
      checkedGit(repository, ['worktree', 'remove', '--', linked]);
      checkedGit(repository, ['update-ref', '-d', `refs/heads/${branch}`, collection.commit]);
      if (fs.existsSync(linked) || fs.existsSync(admin) || refExists(repository, branch)
        || (fs.existsSync(gitAdmin) && fs.readdirSync(gitAdmin).length !== 0)) {
        throw new Error('linked worktree cleanup was incomplete');
      }
      assertWorktreeTopology(repository, linked, collection, scenario, false);
      assertBranchResidueAbsent(repository, branch);
      checks.ref_lifecycle = true;
    }
  }
  afterPhysical ||= physicalSurface(repository);
  const afterIndex = stageIndex(repository);
  const stage = { ...stageProof(beforeIndex, afterIndex, scenario),
    ...physicalProof(beforePhysical, afterPhysical, scenario) };
  return {
    order: scenario.order, scenario_identity_sha256: scenario.identity_sha256, kind: scenario.kind,
    selection_provenance: {
      discovery_operation_kind: scenario.discovery_operation_kind ?? null,
      discovery_index: scenario.discovery_index ?? null,
      authored_operation_kind: scenario.authored_operation_kind ?? null,
    },
    pre, post, auxiliary, stage, checks, internal_cleanup_verified: false,
  };
}

export function executeScenario(repository, scratch, collection, scenario) {
  if (!KINDS.includes(scenario?.kind) || !SHA256.test(scenario?.identity_sha256 || '')
    || !Number.isSafeInteger(scenario?.order)) throw new Error('selected scenario is invalid');
  return executeSelectedScenario(repository, scratch, collection, scenario);
}

export function executeScenarioForTest(repository, scratch, collection, scenario, hooks) {
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    throw new Error('scenario test hooks must be a private hook object');
  }
  if (!KINDS.includes(scenario?.kind) || !SHA256.test(scenario?.identity_sha256 || '')
    || !Number.isSafeInteger(scenario?.order)) throw new Error('selected scenario is invalid');
  return executeSelectedScenario(repository, scratch, collection, scenario, hooks);
}

function defaultLease({ tier, scenario, run }) {
  let leaseIdentity = null;
  const value = withFreshReviewedScenarioRepository(
    tier, `real-repository lexical scenario verification ${scenario.kind}`,
    ({ repository, collection, scratch }) => {
      leaseIdentity = fs.readFileSync(scratch.marker, 'utf8');
      return run({ repository, collection, scratch });
    },
  );
  return { value, lease_identity: sha256(leaseIdentity), cleanup_verified: true };
}

function collectionIdentity(collection) {
  return {
    fixture_id: collection.fixture_id, repository_url: collection.repository_url,
    commit: collection.commit, tree_oid: collection.tree_oid,
  };
}

export function verifySelectedScenarios() {
  const contextTier = assertSafeRunnerContext('real-repository scenario verification').tier;
  const loaded = loadScenarioSelection();
  const tierSelection = loaded.selection.tiers[contextTier];
  if (!tierSelection || tierSelection.status !== 'reviewer_selected') {
    throw new Error(`reviewer scenario selection is not accepted for ${contextTier || 'unknown tier'}`);
  }
  const records = [];
  const leases = new Set();
  let collection = null;
  for (const scenario of tierSelection.scenarios) {
    const leased = defaultLease({ tier: contextTier, scenario, run: ({ repository, collection: value, scratch }) => {
      collection ||= value;
      if (JSON.stringify(collectionIdentity(collection)) !== JSON.stringify(collectionIdentity(value))) {
        throw new Error('scenario leases do not share the exact selected collection identity');
      }
      return executeScenario(repository, scratch, value, scenario);
    } });
    if (!leased || leased.cleanup_verified !== true || typeof leased.lease_identity !== 'string'
      || leases.has(leased.lease_identity)) throw new Error('scenario lease was reused or cleanup was not verified');
    leases.add(leased.lease_identity);
    records.push({ ...leased.value, scratch_lease_sha256: leased.lease_identity,
      internal_cleanup_verified: true });
  }
  if (records.length !== KINDS.length || records.some((record, index) =>
    record.order !== index || record.kind !== KINDS[index])) throw new Error('scenario verification order drifted');
  const sourceSha256 = sha256(fs.readFileSync(MODULE_FILE));
  const recordsSha256 = digest(records);
  const workloadSha256 = digest({
    workload_id: SCENARIO_VERIFICATION_WORKLOAD_ID, source_sha256: sourceSha256,
    selection_raw_sha256: loaded.raw_sha256, selection_canonical_sha256: loaded.canonical_sha256,
    records_sha256: recordsSha256,
  });
  const result = {
    schema: SCENARIO_VERIFICATION_SCHEMA,
    workload_id: SCENARIO_VERIFICATION_WORKLOAD_ID,
    status: 'reviewer_selected_scenarios_verified_lexically',
    collection: collectionIdentity(collection),
    selection_raw_sha256: loaded.raw_sha256,
    selection_canonical_sha256: loaded.canonical_sha256,
    bounds: SCENARIO_VERIFICATION_BOUNDS,
    records,
    records_sha256: recordsSha256,
    source_sha256: sourceSha256,
    workload_sha256: workloadSha256,
    expectations_loaded: false,
    grade_controller_evidence: false,
    quality_claims: NO_QUALITY_CLAIMS,
    selection_provenance: {
      status: 'selection_provenance_not_replayed',
      report_sha256: tierSelection.discovery.report_sha256,
      semantic_sha256: tierSelection.discovery.semantic_sha256,
      index_sha256: tierSelection.discovery.index_sha256,
    },
    limitation: LIMITATION,
  };
  const validation = validateScenarioVerification(result);
  if (!validation.valid) {
    throw new Error(`scenario verification result is invalid: ${validation.errors.join('; ')}`);
  }
  return Object.freeze(result);
}

export function validateScenarioVerification(result) {
  const errors = [];
  if (!exactKeys(result, ROOT_KEYS) || result.schema !== SCENARIO_VERIFICATION_SCHEMA
    || result.workload_id !== SCENARIO_VERIFICATION_WORKLOAD_ID
    || result.status !== 'reviewer_selected_scenarios_verified_lexically') {
    return { valid: false, errors: ['scenario verification root schema is invalid'] };
  }
  if (!exactKeys(result.collection, ['fixture_id', 'repository_url', 'commit', 'tree_oid'])
    || !['small', 'medium', 'large'].includes(result.collection.fixture_id)
    || !SHA1.test(result.collection.commit || '') || !SHA1.test(result.collection.tree_oid || '')
    || result.selection_raw_sha256 !== SCENARIO_SELECTION_RAW_SHA256
    || result.selection_canonical_sha256 !== SCENARIO_SELECTION_CANONICAL_SHA256
    || JSON.stringify(result.bounds) !== JSON.stringify(SCENARIO_VERIFICATION_BOUNDS)
    || !Array.isArray(result.records) || result.records.length !== KINDS.length) {
    errors.push('scenario verification authority or bounds are invalid');
  }
  const selected = loadScenarioSelection().selection.tiers[result.collection.fixture_id];
  const reviewedBase = REVIEWED_INVENTORIES[result.collection.fixture_id];
  if (!selected || JSON.stringify(result.collection) !== JSON.stringify({
    fixture_id: result.collection.fixture_id, repository_url: selected.pin.repository_url,
    commit: selected.pin.commit, tree_oid: selected.pin.tree_oid,
  })) errors.push('scenario verification collection does not match the selected tier pin');
  if (!exactKeys(result.selection_provenance,
    ['status', 'report_sha256', 'semantic_sha256', 'index_sha256'])
    || result.selection_provenance.status !== 'selection_provenance_not_replayed'
    || !selected || result.selection_provenance.report_sha256 !== selected.discovery.report_sha256
    || result.selection_provenance.semantic_sha256 !== selected.discovery.semantic_sha256
    || result.selection_provenance.index_sha256 !== selected.discovery.index_sha256) {
    errors.push('scenario verification does not bind accepted selection provenance');
  }
  const leases = new Set();
  let sharedBase = null;
  for (const [index, record] of (result.records || []).entries()) {
    const scenario = selected?.scenarios?.[index];
    const expectedChange = scenario?.kind === 'modify'
      ? type1Change('.M', scenario.blob_oid, '100644', scenario.path)
      : scenario?.kind === 'rename' ? renameChange(scenario)
        : scenario?.kind === 'delete'
          ? type1Change('.D', scenario.blob_oid, '000000', scenario.path) : null;
    const expectedPostBranch = scenario?.kind === 'branch' ? scenario.branch
      : scenario?.kind === 'logical_worktree' ? scenario.derived_branch : null;
    const expectedChecks = baseChecks();
    if (scenario?.kind !== 'clean') {
      expectedChecks.source_blob = true;
      expectedChecks.source_content = true;
    }
    if (['modify', 'rename'].includes(scenario?.kind)) expectedChecks.result_content = true;
    if (scenario?.kind === 'rename') expectedChecks.destination_absence = true;
    if (['branch', 'logical_worktree'].includes(scenario?.kind)) expectedChecks.ref_lifecycle = true;
    if (scenario?.kind === 'logical_worktree') {
      expectedChecks.linked_marker = true;
      expectedChecks.linked_admin = true;
      expectedChecks.primary_clean = true;
    }
    const preExpected = { head: result.collection.commit, branch: null, upstream: null, changes: [] };
    const postExpected = { head: result.collection.commit, branch: expectedPostBranch,
      upstream: null, changes: expectedChange ? [expectedChange] : [] };
    const auxiliaryExpected = scenario?.kind === 'logical_worktree' ? preExpected : null;
    const selectedBefore = scenario?.kind === 'clean' ? []
      : [{ mode: '100644', oid: scenario?.blob_oid, path: scenario?.path }];
    const selectedAfter = scenario?.kind === 'clean' ? []
      : [{ mode: '100644', oid: scenario?.blob_oid,
        path: scenario?.kind === 'rename' ? scenario.destination : scenario?.path }];
    const physicalBefore = scenario?.kind === 'clean' ? []
      : [{ mode: '100644', path: scenario?.path, sha256: scenario?.original_content_sha256 }];
    const physicalAfter = scenario?.kind === 'clean' || scenario?.kind === 'delete' ? []
      : [{ mode: '100644', path: scenario?.kind === 'rename' ? scenario.destination : scenario?.path,
        sha256: scenario?.kind === 'modify'
          ? scenario.result_content_sha256 : scenario?.original_content_sha256 }];
    const stage = record?.stage;
    const stageShape = exactKeys(stage, STAGE_KEYS)
      && Number.isSafeInteger(stage.before_count)
      && stage.before_count === reviewedBase?.tracked_files
      && Number.isSafeInteger(stage.after_count) && stage.after_count > 0
      && SHA256.test(stage.before_sha256 || '') && SHA256.test(stage.after_sha256 || '')
      && JSON.stringify(stage.selected_before) === JSON.stringify(selectedBefore)
      && JSON.stringify(stage.selected_after) === JSON.stringify(selectedAfter)
      && Number.isSafeInteger(stage.physical_before_count)
      && stage.physical_before_count === reviewedBase?.tracked_files
      && Number.isSafeInteger(stage.physical_after_count) && stage.physical_after_count >= 0
      && SHA256.test(stage.physical_before_sha256 || '') && SHA256.test(stage.physical_after_sha256 || '')
      && JSON.stringify(stage.physical_selected_before) === JSON.stringify(physicalBefore)
      && JSON.stringify(stage.physical_selected_after) === JSON.stringify(physicalAfter)
      && stage.before_count === stage.after_count
      && stage.physical_after_count === stage.physical_before_count
        + (scenario?.kind === 'delete' ? -1 : 0)
      && (scenario?.kind === 'rename'
        ? stage.before_sha256 !== stage.after_sha256
        : stage.before_sha256 === stage.after_sha256)
      && (['clean', 'branch', 'logical_worktree'].includes(scenario?.kind)
        ? stage.physical_before_sha256 === stage.physical_after_sha256
        : stage.physical_before_sha256 !== stage.physical_after_sha256);
    const base = stage && {
      stage_count: stage.before_count, stage_sha256: stage.before_sha256,
      physical_count: stage.physical_before_count,
      physical_sha256: stage.physical_before_sha256,
    };
    sharedBase ||= base;
    if (!exactKeys(record, RECORD_KEYS) || record.order !== index || record.kind !== KINDS[index]
      || !SHA256.test(record.scenario_identity_sha256 || '')
      || !SHA256.test(record.scratch_lease_sha256 || '') || leases.has(record.scratch_lease_sha256)
      || record.internal_cleanup_verified !== true
      || !exactKeys(record.pre, STATE_KEYS) || !exactKeys(record.post, STATE_KEYS)
      || JSON.stringify(record.pre) !== JSON.stringify(preExpected)
      || JSON.stringify(record.post) !== JSON.stringify(postExpected)
      || JSON.stringify(record.auxiliary) !== JSON.stringify(auxiliaryExpected)
      || !stageShape
      || !exactKeys(record.checks, CHECK_KEYS)
      || JSON.stringify({ ...record.checks, linked_topology_sha256: null })
        !== JSON.stringify({ ...expectedChecks, linked_topology_sha256: null })
      || (scenario?.kind === 'logical_worktree'
        ? record.checks.linked_topology_sha256
          !== logicalTopologyDigest(result.collection.commit, scenario)
        : record.checks.linked_topology_sha256 !== null)
      || !exactKeys(record.selection_provenance,
        ['discovery_operation_kind', 'discovery_index', 'authored_operation_kind'])
      || !selected?.scenarios?.[index]
      || record.scenario_identity_sha256 !== selected.scenarios[index].identity_sha256
      || record.selection_provenance.discovery_operation_kind
        !== (selected.scenarios[index].discovery_operation_kind ?? null)
      || record.selection_provenance.discovery_index !== (selected.scenarios[index].discovery_index ?? null)
      || record.selection_provenance.authored_operation_kind
        !== (selected.scenarios[index].authored_operation_kind ?? null)
      || JSON.stringify(base) !== JSON.stringify(sharedBase)) {
      errors.push(`scenario verification record ${index} is invalid`);
    }
    if (SHA256.test(record?.scratch_lease_sha256 || '')) leases.add(record.scratch_lease_sha256);
  }
  if (result.records_sha256 !== digest(result.records)
    || result.source_sha256 !== sha256(fs.readFileSync(MODULE_FILE))
    || result.workload_sha256 !== digest({
      workload_id: result.workload_id, source_sha256: result.source_sha256,
      selection_raw_sha256: result.selection_raw_sha256,
      selection_canonical_sha256: result.selection_canonical_sha256,
      records_sha256: result.records_sha256,
    })) errors.push('scenario verification source or record identity drifted');
  if (result.expectations_loaded !== false || result.grade_controller_evidence !== false
    || JSON.stringify(result.quality_claims) !== JSON.stringify(NO_QUALITY_CLAIMS)
    || result.limitation !== LIMITATION) {
    errors.push('scenario verification claims later-stage authority');
  }
  const absoluteLeak = (value, key = '') => {
    if (typeof value === 'string') return key !== 'repository_url'
      && (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value));
    if (Array.isArray(value)) return value.some((child) => absoluteLeak(child, key));
    return value && typeof value === 'object'
      && Object.entries(value).some(([childKey, child]) => absoluteLeak(child, childKey));
  };
  if (absoluteLeak(result)) errors.push('scenario verification exposes a physical path');
  return { valid: errors.length === 0, errors };
}

export function encodeScenarioVerificationPayload(result) {
  const validation = validateScenarioVerification(result);
  if (!validation.valid) throw new Error(`scenario verification is invalid: ${validation.errors.join('; ')}`);
  if (canonicalBytes(result).length > SCENARIO_VERIFICATION_BOUNDS.semantic_bytes) {
    throw new Error('scenario verification exceeds its expanded semantic bound');
  }
  const compactChanges = (changes) => changes.map((change) => [change.record_type, change.xy,
    change.sub, change.mode_head, change.mode_index, change.mode_worktree, change.oid_head,
    change.oid_index, change.rename_kind, change.rename_score, change.path, change.original_path]);
  const compactRows = (rows) => rows.map((row) => [row.mode, row.oid ?? row.sha256, row.path]);
  const checkBits = (checks) => CHECK_KEYS.slice(0, -1).reduce((bits, key, index) =>
    checks[key] === true ? bits | (1 << index) : bits, 0);
  const wire = {
    v: 1,
    t: result.collection.fixture_id,
    h: [result.records_sha256, result.source_sha256, result.workload_sha256],
    p: [result.selection_provenance.report_sha256,
      result.selection_provenance.semantic_sha256, result.selection_provenance.index_sha256],
    r: result.records.map((record) => [
      record.scratch_lease_sha256, record.post.branch, compactChanges(record.post.changes),
      record.auxiliary !== null, [record.stage.before_count, record.stage.before_sha256,
        record.stage.after_count, record.stage.after_sha256, compactRows(record.stage.selected_before),
        compactRows(record.stage.selected_after), record.stage.physical_before_count,
        record.stage.physical_before_sha256, record.stage.physical_after_count,
        record.stage.physical_after_sha256, compactRows(record.stage.physical_selected_before),
        compactRows(record.stage.physical_selected_after)], checkBits(record.checks),
      record.checks.linked_topology_sha256,
    ]),
  };
  const bytes = canonicalBytes(wire);
  if (bytes.length > SCENARIO_VERIFICATION_BOUNDS.transport_bytes) {
    throw new Error(`scenario verification exceeds its transport bound: ${bytes.length} bytes`);
  }
  const line = `${SCENARIO_VERIFICATION_PAYLOAD_PREFIX}${bytes.toString('base64url')}`;
  if (Buffer.byteLength(line) > SCENARIO_VERIFICATION_BOUNDS.encoded_line_bytes) {
    throw new Error('scenario verification exceeds the retained line bound');
  }
  return line;
}

export function decodeScenarioVerificationPayload(line) {
  if (typeof line !== 'string' || !line.startsWith(SCENARIO_VERIFICATION_PAYLOAD_PREFIX)
    || Buffer.byteLength(line) > SCENARIO_VERIFICATION_BOUNDS.encoded_line_bytes) {
    throw new Error('scenario verification payload is outside the retained-output contract');
  }
  try {
    const encoded = line.slice(SCENARIO_VERIFICATION_PAYLOAD_PREFIX.length);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('invalid base64url');
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.length > SCENARIO_VERIFICATION_BOUNDS.transport_bytes
      || bytes.toString('base64url') !== encoded) throw new Error('noncanonical base64url');
    const wire = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!canonicalBytes(wire).equals(bytes) || !exactKeys(wire, ['v', 't', 'h', 'p', 'r'])
      || wire.v !== 1 || typeof wire.t !== 'string'
      || !Array.isArray(wire.h) || wire.h.length !== 3
      || !Array.isArray(wire.p) || wire.p.length !== 3
      || !Array.isArray(wire.r) || wire.r.length !== KINDS.length) throw new Error('invalid wire schema');
    const tier = wire.t;
    const selected = loadScenarioSelection().selection.tiers[tier];
    if (!selected) throw new Error('invalid wire tier');
    const expandChanges = (changes) => {
      if (!Array.isArray(changes)) throw new Error('invalid wire changes');
      return changes.map((change) => {
        if (!Array.isArray(change) || change.length !== 12) throw new Error('invalid wire change');
        return { record_type: change[0], xy: change[1], sub: change[2], mode_head: change[3],
          mode_index: change[4], mode_worktree: change[5], oid_head: change[6],
          oid_index: change[7], rename_kind: change[8], rename_score: change[9],
          path: change[10], original_path: change[11] };
      });
    };
    const expandRows = (rows, physical) => {
      if (!Array.isArray(rows)) throw new Error('invalid wire rows');
      return rows.map((row) => {
        if (!Array.isArray(row) || row.length !== 3) throw new Error('invalid wire row');
        return physical ? { mode: row[0], path: row[2], sha256: row[1] }
          : { mode: row[0], oid: row[1], path: row[2] };
      });
    };
    const records = wire.r.map((record, order) => {
      if (!Array.isArray(record) || record.length !== 7 || !Array.isArray(record[2])
        || typeof record[3] !== 'boolean' || !Array.isArray(record[4])
        || record[4].length !== 12 || !Number.isSafeInteger(record[5])
        || record[5] < 0 || record[5] > 255) {
        throw new Error('invalid wire record');
      }
      const scenario = selected.scenarios[order];
      const stage = record[4];
      const valueChecks = baseChecks();
      CHECK_KEYS.slice(0, -1).forEach((key, index) => {
        valueChecks[key] = (record[5] & (1 << index)) !== 0 ? true : null;
      });
      valueChecks.linked_topology_sha256 = record[6];
      return {
        order, scenario_identity_sha256: scenario.identity_sha256,
        scratch_lease_sha256: record[0], kind: scenario.kind,
        selection_provenance: {
          discovery_operation_kind: scenario.discovery_operation_kind ?? null,
          discovery_index: scenario.discovery_index ?? null,
          authored_operation_kind: scenario.authored_operation_kind ?? null,
        },
        pre: { head: selected.pin.commit, branch: null, upstream: null, changes: [] },
        post: { head: selected.pin.commit, branch: record[1], upstream: null,
          changes: expandChanges(record[2]) },
        auxiliary: record[3]
          ? { head: selected.pin.commit, branch: null, upstream: null, changes: [] } : null,
        stage: { before_count: stage[0], before_sha256: stage[1], after_count: stage[2],
          after_sha256: stage[3], selected_before: expandRows(stage[4], false),
          selected_after: expandRows(stage[5], false), physical_before_count: stage[6],
          physical_before_sha256: stage[7], physical_after_count: stage[8],
          physical_after_sha256: stage[9], physical_selected_before: expandRows(stage[10], true),
          physical_selected_after: expandRows(stage[11], true) },
        checks: valueChecks, internal_cleanup_verified: true,
      };
    });
    const result = {
      schema: SCENARIO_VERIFICATION_SCHEMA, workload_id: SCENARIO_VERIFICATION_WORKLOAD_ID,
      status: 'reviewer_selected_scenarios_verified_lexically',
      collection: { fixture_id: tier, repository_url: selected.pin.repository_url,
        commit: selected.pin.commit, tree_oid: selected.pin.tree_oid },
      selection_raw_sha256: SCENARIO_SELECTION_RAW_SHA256,
      selection_canonical_sha256: SCENARIO_SELECTION_CANONICAL_SHA256,
      bounds: SCENARIO_VERIFICATION_BOUNDS,
      records, records_sha256: wire.h[0], source_sha256: wire.h[1], workload_sha256: wire.h[2],
      expectations_loaded: false, grade_controller_evidence: false,
      quality_claims: NO_QUALITY_CLAIMS,
      selection_provenance: { status: 'selection_provenance_not_replayed',
        report_sha256: wire.p[0], semantic_sha256: wire.p[1], index_sha256: wire.p[2] },
      limitation: LIMITATION,
    };
    const validation = validateScenarioVerification(result);
    if (!validation.valid) throw new Error(validation.errors.join('; '));
    if (canonicalBytes(result).length > SCENARIO_VERIFICATION_BOUNDS.semantic_bytes) {
      throw new Error('expanded semantic bound exceeded');
    }
    return result;
  } catch { throw new Error('scenario verification payload line is malformed'); }
}

export function decodeScenarioVerificationReport(report) {
  const validation = validateReport(report || {});
  const preflight = report?.preflight;
  const source = preflight?.source_identity;
  const snapshot = preflight?.execution_snapshot;
  const execution = preflight?.execution_identity;
  const command = report?.command;
  const executionCommand = preflight?.execution_command;
  const repository = path.resolve(String(report?.cwd || ''));
  const expectedEntrypoint = path.join(repository, ENTRYPOINT);
  const sourceValue = source && {
    repository: source.repository, command: source.command, executable: source.executable,
    workload_inputs: source.workload_inputs, retrieval_authority: source.retrieval_authority,
    runtime_baseline_inputs: source.runtime_baseline_inputs,
    repository_source: source.repository_source, runner_build: source.runner_build,
  };
  const sourceDigest = sourceValue ? sha256(JSON.stringify(sourceValue)) : null;
  const executionDigest = execution ? sha256(JSON.stringify({
    source_identity_digest: execution.source_identity_digest,
    execution_snapshot_digest: execution.execution_snapshot_digest,
  })) : null;
  const entrypointInput = Array.isArray(source?.workload_inputs)
    ? source.workload_inputs.find((item) => path.resolve(String(item?.path || '')) === expectedEntrypoint)
    : null;
  let currentRepositorySource = null;
  let currentRunnerBuild = null;
  let currentSourceClosure = null;
  let physicalRepository = null;
  try {
    physicalRepository = fs.realpathSync.native(repository);
    currentRepositorySource = repositorySourceDigest(repository);
    currentRunnerBuild = runnerBuildDigest();
    currentSourceClosure = realRepositoryOracleSourceClosureIdentity(
      repository, 'verify-scenarios',
    );
  } catch {}
  const cleanup = report?.cleanup;
  const termination = report?.termination;
  const promotionRequired = report?.tier === 'small' ? []
    : report?.tier === 'medium' ? ['small'] : ['small', 'medium'];
  const promotion = preflight?.promotion;
  const authorityValid = validation.valid && ['small', 'medium', 'large'].includes(report?.tier)
    && Array.isArray(command) && command.length === 3 && command[2] === 'verify-scenarios'
    && /^node(?:\.exe)?$/.test(path.basename(String(command[0] || '')).toLowerCase())
    && path.resolve(repository, String(command[1] || '')) === expectedEntrypoint
    && Array.isArray(executionCommand) && executionCommand.length === 3
    && executionCommand[2] === 'verify-scenarios'
    && path.resolve(repository, String(executionCommand[1] || '')) === expectedEntrypoint
    && preflight?.ok === true && preflight.workload_id === SCENARIO_VERIFICATION_WORKLOAD_ID
    && preflight.retry?.ok === true && preflight.retry.signature === source?.digest
    && exactKeys(promotion,
      ['ok', 'required', 'missing', 'completed', 'deferred_to_execution_snapshot'])
    && promotion.ok === true && promotion.deferred_to_execution_snapshot === false
    && JSON.stringify(promotion.required) === JSON.stringify(promotionRequired)
    && JSON.stringify(promotion.completed) === JSON.stringify(promotionRequired)
    && Array.isArray(promotion.missing) && promotion.missing.length === 0
    && preflight.ownership?.proven === true && preflight.ownership?.audited_entrypoint === ENTRYPOINT
    && executionCommand[0] === preflight.ownership.executable
    && preflight.scope_proof?.production_enforcement === true
    && report.adapter?.production_enforcement === true
    && physicalRepository === repository
    && source?.repository === repository && JSON.stringify(source.command) === JSON.stringify(executionCommand)
    && source.executable?.path === executionCommand[0]
    && SHA256.test(source.executable?.digest || '')
    && Array.isArray(source.workload_inputs) && source.workload_inputs.length === 1
    && exactKeys(entrypointInput, ['path', 'size', 'digest'])
    && entrypointInput?.digest === currentSourceClosure?.entrypoint_sha256
    && entrypointInput?.size === String(currentSourceClosure?.entrypoint_bytes)
    && source.repository_source === currentRepositorySource
    && source.runner_build === currentRunnerBuild
    && source.digest === sourceDigest && snapshot?.schema === 'lamina.safe-runner-execution-snapshot/v1'
    && exactKeys(snapshot.source_closure,
      ['schema', 'command', 'file_count', 'total_bytes', 'paths_sha256', 'files_sha256',
        'entrypoint_bytes', 'entrypoint_sha256'])
    && JSON.stringify(snapshot.source_closure) === JSON.stringify(currentSourceClosure)
    && Number.isSafeInteger(snapshot.file_count)
    && snapshot.file_count >= currentSourceClosure.file_count
    && Number.isSafeInteger(snapshot.total_bytes)
    && snapshot.total_bytes >= currentSourceClosure.total_bytes
    && SHA256.test(snapshot.digest || '') && execution?.source_identity_digest === source.digest
    && execution?.execution_snapshot_digest === snapshot.digest && execution?.digest === executionDigest
    && JSON.stringify(execution.command) === JSON.stringify(source.command)
    && execution.repository === source.repository
    && termination?.reason === 'completed' && termination.limit === null
    && termination.child_exit_code === 0 && termination.child_signal === null
    && cleanup?.attempted === true && Array.isArray(cleanup.descendants_remaining)
    && cleanup.descendants_remaining.length === 0 && Array.isArray(cleanup.managed_paths_remaining)
    && cleanup.managed_paths_remaining.length === 0 && cleanup.scope_removed === true
    && cleanup.temporary_directory_removed === true && Array.isArray(cleanup.errors)
    && cleanup.errors.length === 0
    && (report.tier === 'small' ? cleanup.lock_released === null : cleanup.lock_released === true);
  if (!authorityValid) throw new Error('scenario verification report does not bind exact safe-runner authority');
  const output = report.output;
  if (report.outcome !== 'success' || output?.truncated !== false
    || typeof output.stdout_tail !== 'string' || output.stderr_bytes !== 0 || output.stderr_tail !== ''
    || output.total_bytes !== output.stdout_bytes + output.stderr_bytes
    || output.stdout_bytes !== Buffer.byteLength(output.stdout_tail)
    || report.limits.stdout_tail_max_bytes !== SCENARIO_VERIFICATION_REPORT_STDOUT_TAIL_BYTES
    || report.limits.stderr_tail_max_bytes !== SCENARIO_VERIFICATION_REPORT_STDERR_TAIL_BYTES
    || output.stdout_bytes > SCENARIO_VERIFICATION_REPORT_STDOUT_TAIL_BYTES
    || !output.stdout_tail.endsWith('\n')) {
    throw new Error('scenario verification report did not retain complete output');
  }
  const line = output.stdout_tail.slice(0, -1);
  if (line.includes('\n') || line.includes('\r')) throw new Error('scenario verification report must contain one line');
  const result = decodeScenarioVerificationPayload(line);
  if (result.collection.fixture_id !== report.tier) throw new Error('scenario verification report tier drifted');
  return result;
}
