import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SAFE_INFRASTRUCTURE_PATH } from '../../scripts/safe-runner/infrastructure.mjs';
import {
  inertGitEnvironment, trustedGitArguments,
} from '../../scripts/safe-runner/git.mjs';

const IDENTITY_FIELDS = Object.freeze(['path', 'dev', 'ino', 'uid', 'mode', 'size', 'digest']);
const MAX_GIT_BINARY_BYTES = 256 * 1024 * 1024;

function sealedGitIdentity(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096
    || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('sealed sandbox Git identity environment is missing or malformed');
  }
  let identity;
  try { identity = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { throw new Error('sealed sandbox Git identity environment is missing or malformed'); }
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)
    || Object.keys(identity).sort().join(',') !== [...IDENTITY_FIELDS].sort().join(',')
    || !path.isAbsolute(identity.path)
    || typeof identity.dev !== 'string' || typeof identity.ino !== 'string'
    || !Number.isInteger(identity.uid) || !Number.isInteger(identity.mode)
    || typeof identity.size !== 'string' || !/^[a-f0-9]{64}$/.test(identity.digest)) {
    throw new Error('sealed sandbox Git identity environment is missing or malformed');
  }
  return identity;
}

function namespaceGitIdentity(expected) {
  const descriptor = fs.openSync(expected.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || (before.mode & 0o111n) === 0n || (before.mode & 0o022n) !== 0n
      || before.size > BigInt(MAX_GIT_BINARY_BYTES) || String(before.size) !== expected.size) {
      throw new Error('sealed sandbox Git executable is not an immutable executable file');
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error('sealed sandbox Git executable ended while hashing');
      offset += count;
    }
    if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, offset) !== 0) {
      throw new Error('sealed sandbox Git executable exceeded its bounded identity size');
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    for (const field of ['dev', 'ino', 'uid', 'mode', 'size']) {
      if (after[field] !== before[field]) {
        throw new Error('sealed sandbox Git identity changed while hashing');
      }
    }
    const actual = {
      path: expected.path,
      dev: String(after.dev),
      ino: String(after.ino),
      mode: Number(after.mode & 0o777n),
      size: String(after.size),
      digest: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
    for (const field of ['path', 'dev', 'ino', 'mode', 'size', 'digest']) {
      if (actual[field] !== expected[field]) {
        throw new Error('sealed sandbox Git immutable identity changed inside namespace');
      }
    }
    return {
      ...actual,
      controller_uid: expected.uid,
      namespace_uid: Number(after.uid),
    };
  } finally { fs.closeSync(descriptor); }
}

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
  const encodedGitIdentity = process.env.LAMINA_SAFE_GIT_IDENTITY;
  delete process.env.LAMINA_SAFE_GIT_IDENTITY;
  if (process.env.PATH !== SAFE_INFRASTRUCTURE_PATH) {
    throw new Error('sealed sandbox PATH does not match its fixed infrastructure path');
  }
  const expectedGitIdentity = sealedGitIdentity(encodedGitIdentity);
  const namedGit = firstSafePathExecutable('git');
  if (namedGit !== expectedGitIdentity.path) {
    throw new Error('sealed sandbox PATH Git does not match trusted Git identity');
  }
  const gitIdentity = namespaceGitIdentity(expectedGitIdentity);
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
  const absoluteGitRoot = invoke(expectedGitIdentity.path);
  if (namedGitRoot !== repository || absoluteGitRoot !== repository) {
    throw new Error('sealed sandbox Git invocation did not resolve the graph repository cwd');
  }
  return {
    schema: 'lamina.safe-runner-sealed-sandbox-probe/v1',
    path: process.env.PATH,
    expected_path: SAFE_INFRASTRUCTURE_PATH,
    git: { named_request: 'git', requested_path: expectedGitIdentity.path, ...gitIdentity },
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
