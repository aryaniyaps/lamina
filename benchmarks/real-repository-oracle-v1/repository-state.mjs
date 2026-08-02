import fs from 'node:fs';
import { digest } from './contract.mjs';
import { spawnTrustedGit } from '../../scripts/safe-runner/git.mjs';

const MAX_STATUS_BYTES = 4 * 1024 * 1024;
const MAX_RECORDS = 100_000;
const MAX_PATH_BYTES = 4096;

function parseBranch(record, state) {
  const match = /^# ([^ ]+) (.*)$/.exec(record);
  if (!match) throw new Error(`malformed porcelain v2 branch header: ${record}`);
  const [, key, value] = match;
  if (key === 'branch.oid') state.head = value === '(initial)' ? null : value;
  else if (key === 'branch.head') state.branch = value;
  else if (key === 'branch.upstream') state.upstream = value;
  else if (key === 'branch.ab') {
    const divergence = /^\+(\d+) -(\d+)$/.exec(value);
    if (!divergence) throw new Error(`malformed porcelain v2 branch divergence: ${record}`);
    state.ahead = Number(divergence[1]); state.behind = Number(divergence[2]);
  }
}
const change = (kind, candidate, originalPath = null, xy = null, submodule = null) => ({
  kind, path: candidate, original_path: originalPath, xy, submodule,
});
function boundedPath(candidate) {
  if (!candidate || Buffer.byteLength(candidate) > MAX_PATH_BYTES) throw new Error('porcelain v2 path exceeds the admitted bound');
  return candidate;
}

export function parsePorcelainV2Z(input, { worktree } = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  if (bytes.length > MAX_STATUS_BYTES) throw new Error('porcelain v2 output exceeds the admitted bound');
  const text = bytes.toString('utf8');
  if (text.includes('\uFFFD')) throw new Error('porcelain v2 output is not valid UTF-8');
  const records = text.split('\0');
  if (records.at(-1) === '') records.pop();
  if (records.length > MAX_RECORDS) throw new Error('porcelain v2 record count exceeds the admitted bound');
  if (!/^[a-f0-9]{64}$/.test(worktree || '')) throw new Error('physical worktree identity is required');
  const state = { head: null, branch: null, upstream: null, ahead: 0, behind: 0, worktree, changes: [] };
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) throw new Error('porcelain v2 contains an empty record');
    if (record.startsWith('# ')) { parseBranch(record, state); continue; }
    let match;
    if ((match = /^1 ([^ ]{2}) ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/.exec(record))) {
      state.changes.push(change(match[1].includes('D') ? 'deleted' : 'ordinary', boundedPath(match[3]), null, match[1], match[2]));
    } else if ((match = /^2 ([^ ]{2}) ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ ([RC][0-9]+) (.*)$/.exec(record))) {
      const originalPath = boundedPath(records[++index]);
      state.changes.push(change(match[3].startsWith('C') ? 'copied' : 'renamed', boundedPath(match[4]), originalPath, match[1], match[2]));
    } else if ((match = /^u ([^ ]{2}) ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/.exec(record))) {
      state.changes.push(change('unmerged', boundedPath(match[3]), null, match[1], match[2]));
    } else if ((match = /^\? (.*)$/.exec(record))) {
      state.changes.push(change('untracked', boundedPath(match[1])));
    } else if (!record.startsWith('! ')) {
      throw new Error(`unknown porcelain v2 record: ${record}`);
    }
  }
  if (!state.branch) throw new Error('porcelain v2 branch header is missing');
  state.changes.sort((left, right) => {
    const leftKey = `${left.path}\0${left.original_path || ''}\0${left.kind}`;
    const rightKey = `${right.path}\0${right.original_path || ''}\0${right.kind}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return state;
}

function runGit(cwd, args, encoding = 'utf8') {
  const result = spawnTrustedGit(cwd, args, { encoding, timeout: 5_000, maxBuffer: MAX_STATUS_BYTES });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`trusted Git ${args[0]} failed: ${String(result.stderr).trim()}`);
  return result.stdout;
}
function physicalIdentity(candidate) {
  const resolved = fs.realpathSync.native(candidate);
  const stat = fs.lstatSync(resolved, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Git repository identity must be a physical directory');
  return { path: resolved, dev: String(stat.dev), ino: String(stat.ino) };
}

export function readRepositoryState(cwd) {
  const lines = String(runGit(cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'])).trimEnd().split('\n');
  if (lines.length !== 3 || lines.some((line) => !line)) throw new Error('trusted Git returned an incomplete repository identity');
  const [root, gitDirectory, commonDirectory] = lines.map(physicalIdentity);
  const status = runGit(cwd, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--find-renames=50%'], null);
  const provisional = parsePorcelainV2Z(status, { worktree: '0'.repeat(64) });
  const worktree = digest({ root, git_directory: gitDirectory, common_directory: commonDirectory, head: provisional.head });
  return { ...provisional, worktree };
}
