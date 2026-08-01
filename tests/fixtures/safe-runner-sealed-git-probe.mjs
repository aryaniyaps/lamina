import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  SAFE_INFRASTRUCTURE_PATH, trustedHostBinary,
} from '../../scripts/safe-runner/infrastructure.mjs';
import {
  inertGitEnvironment, trustedGitArguments,
} from '../../scripts/safe-runner/git.mjs';

function firstSafePathExecutable(name) {
  for (const directory of SAFE_INFRASTRUCTURE_PATH.split(path.delimiter)) {
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const physical = fs.realpathSync.native(candidate);
      if (fs.lstatSync(physical).isFile()) return physical;
    } catch {}
  }
  throw new Error(`sealed sandbox PATH is missing ${name}`);
}

export function sealedSandboxGitProbe(repository) {
  if (process.env.PATH !== SAFE_INFRASTRUCTURE_PATH) {
    throw new Error('sealed sandbox PATH does not match its fixed infrastructure path');
  }
  const gitIdentity = trustedHostBinary('git');
  const namedGit = firstSafePathExecutable('git');
  if (namedGit !== gitIdentity.path) {
    throw new Error('sealed sandbox PATH Git does not match trusted Git identity');
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
    const result = spawnSync(
      executable,
      trustedGitArguments(['rev-parse', '--show-toplevel']),
      {
        cwd: repository,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 2_000,
        maxBuffer: 16 * 1024,
        env: { ...inertGitEnvironment(), PATH: SAFE_INFRASTRUCTURE_PATH },
      },
    );
    if (result.error || result.status !== 0) {
      throw new Error(`sealed sandbox Git invocation failed: ${result.error?.code || result.status}`);
    }
    return result.stdout.trim();
  };
  const namedGitRoot = invoke('git');
  const absoluteGitRoot = invoke(gitIdentity.path);
  if (namedGitRoot !== repository || absoluteGitRoot !== repository) {
    throw new Error('sealed sandbox Git invocation did not resolve the graph repository cwd');
  }
  return {
    schema: 'lamina.safe-runner-sealed-sandbox-probe/v1',
    path: process.env.PATH,
    expected_path: SAFE_INFRASTRUCTURE_PATH,
    git: { named_request: 'git', requested_path: gitIdentity.path, ...gitIdentity },
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
