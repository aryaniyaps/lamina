import { spawnSync } from 'node:child_process';

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
    state.ahead = Number(divergence[1]);
    state.behind = Number(divergence[2]);
  }
}

function change(kind, path, originalPath = null, xy = null, submodule = null) {
  return { kind, path, original_path: originalPath, xy, submodule };
}

export function parsePorcelainV2Z(input, { worktree = 'main' } = {}) {
  const records = Buffer.isBuffer(input) ? input.toString('utf8').split('\0') : String(input).split('\0');
  if (records.at(-1) === '') records.pop();
  const state = {
    head: null, branch: null, upstream: null, ahead: 0, behind: 0,
    worktree, changes: [],
  };
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) throw new Error('porcelain v2 contains an empty record');
    if (record.startsWith('# ')) {
      parseBranch(record, state);
      continue;
    }
    let match;
    if ((match = /^1 ([^ ]{2}) ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.+)$/.exec(record))) {
      const deleted = match[1].includes('D');
      state.changes.push(change(deleted ? 'deleted' : 'ordinary', match[3], null, match[1], match[2]));
    } else if ((match = /^2 ([^ ]{2}) ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.+)$/.exec(record))) {
      const originalPath = records[++index];
      if (!originalPath) throw new Error(`porcelain v2 rename lacks original path: ${record}`);
      state.changes.push(change('renamed', match[3], originalPath, match[1], match[2]));
    } else if ((match = /^u ([^ ]{2}) ([^ ]+) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.+)$/.exec(record))) {
      state.changes.push(change('unmerged', match[3], null, match[1], match[2]));
    } else if ((match = /^\? (.+)$/.exec(record))) {
      state.changes.push(change('untracked', match[1]));
    } else if (record.startsWith('! ')) {
      // Ignored entries are outside the observation contract.
    } else {
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

export function readRepositoryState(cwd, { worktree = 'main' } = {}) {
  const result = spawnSync('git', [
    '-c', 'core.hooksPath=/dev/null', 'status', '--porcelain=v2', '-z',
    '--branch', '--untracked-files=all',
  ], { cwd, encoding: null, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git status failed: ${String(result.stderr).trim()}`);
  return parsePorcelainV2Z(result.stdout, { worktree });
}
