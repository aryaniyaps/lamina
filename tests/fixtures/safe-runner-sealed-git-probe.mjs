import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  SAFE_INFRASTRUCTURE_PATH, trustedHostBinary,
} from '../../scripts/safe-runner/infrastructure.mjs';

export function sealedSandboxGitProbe(repository) {
  if (process.env.PATH !== SAFE_INFRASTRUCTURE_PATH) {
    throw new Error('sealed sandbox PATH does not match its fixed infrastructure path');
  }
  if (!fs.existsSync('/usr/bin/git')) {
    throw new Error('sealed sandbox is missing /usr/bin/git');
  }
  const gitIdentity = trustedHostBinary('git');
  if (fs.realpathSync.native('/usr/bin/git') !== gitIdentity.path) {
    throw new Error('sealed sandbox /usr/bin/git does not match trusted Git identity');
  }
  const repositoryStat = fs.lstatSync(repository, { bigint: true });
  if (!repositoryStat.isDirectory() || repositoryStat.isSymbolicLink()
    || fs.realpathSync.native(repository) !== repository) {
    throw new Error('sealed sandbox graph repository cwd is not a canonical physical directory');
  }
  const sentinel = path.join(repository, `.lamina-safe-sandbox-probe-${process.pid}`);
  const descriptor = fs.openSync(sentinel,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
    0o600);
  try {
    fs.writeSync(descriptor, 'sealed sandbox writable cwd\n');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(sentinel);
  }
  const invoke = (executable) => {
    const result = spawnSync(executable, ['rev-parse', '--show-toplevel'], {
      cwd: repository,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) {
      throw new Error(`sealed sandbox Git invocation failed: ${result.error?.code || result.status}`);
    }
    return result.stdout.trim();
  };
  const namedGitRoot = invoke('git');
  const absoluteGitRoot = invoke('/usr/bin/git');
  if (namedGitRoot !== repository || absoluteGitRoot !== repository) {
    throw new Error('sealed sandbox Git invocation did not resolve the graph repository cwd');
  }
  return {
    schema: 'lamina.safe-runner-sealed-sandbox-probe/v1',
    path: process.env.PATH,
    expected_path: SAFE_INFRASTRUCTURE_PATH,
    git: { requested_path: '/usr/bin/git', ...gitIdentity },
    repository: {
      path: repository,
      dev: String(repositoryStat.dev),
      ino: String(repositoryStat.ino),
      uid: Number(repositoryStat.uid),
      writable: true,
    },
    named_git_root: namedGitRoot,
    absolute_git_root: absoluteGitRoot,
  };
}
