import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const socketDirectoryFds = new Map();
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function digest(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex').slice(0, 32)}`;
}

export function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function optionalGit(args, cwd) {
  try { return git(args, cwd); } catch { return null; }
}

function workingTreeDigest(root, files) {
  const hash = crypto.createHash('sha256');
  for (const relative of [...new Set(files)].sort()) {
    const absolute = path.join(root, relative);
    hash.update('\0');
    hash.update(relative);
    hash.update('\0');
    try {
      const stat = fs.lstatSync(absolute);
      hash.update(stat.isSymbolicLink() ? `symlink:${fs.readlinkSync(absolute)}` : fs.readFileSync(absolute));
    } catch {
      // The status stream below still records a deletion or a racing file.
      hash.update('missing');
    }
  }
  return hash.digest('hex').slice(0, 32);
}

export function repositoryContext(cwd = process.cwd()) {
  const root = git(['rev-parse', '--show-toplevel'], cwd);
  const common = path.resolve(root, git(['rev-parse', '--git-common-dir'], root));
  const revision = optionalGit(['rev-parse', '--verify', '--quiet', 'HEAD'], root);
  const unborn = !revision;
  const symbolicBranch = optionalGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], root);
  const branch = symbolicBranch || (revision
    ? `detached/${git(['rev-parse', '--short', 'HEAD'], root)}`
    : 'main');
  const dirty = git(['status', '--porcelain=v1', '--untracked-files=all'], root);
  let sourceRevision = revision;
  if (unborn) {
    const indexed = (optionalGit(['ls-files', '-z'], root) || '').split('\0').filter(Boolean);
    const untracked = (optionalGit(['ls-files', '--others', '--exclude-standard', '-z'], root) || '').split('\0').filter(Boolean);
    sourceRevision = `unborn:tree_${workingTreeDigest(root, [...indexed, ...untracked, dirty])}`;
  }
  if (dirty && !unborn) {
    const trackedPatch = execFileSync('git', ['diff', '--binary', 'HEAD', '--'], {
      cwd: root,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      cwd: root,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8').split('\0').filter(Boolean).sort();
    const hash = crypto.createHash('sha256');
    hash.update(trackedPatch);
    for (const relative of untracked) {
      hash.update('\0');
      hash.update(relative);
      hash.update('\0');
      const absolute = path.join(root, relative);
      const stat = fs.lstatSync(absolute);
      hash.update(stat.isSymbolicLink() ? `symlink:${fs.readlinkSync(absolute)}` : fs.readFileSync(absolute));
    }
    sourceRevision = `dirty:${revision}:tree_${hash.digest('hex').slice(0, 32)}`;
  }
  return {
    root,
    common,
    branch,
    revision,
    unborn,
    dirty: Boolean(dirty) || unborn,
    source_revision: sourceRevision,
    runtime_dir: path.join(common, 'lamina'),
    product: path.basename(path.dirname(common)),
  };
}

export function runtimePaths(cwd = process.cwd()) {
  const context = repositoryContext(cwd);
  return {
    ...context,
    database: path.join(context.runtime_dir, 'graph.lbdb'),
    socket: path.join(context.runtime_dir, 'graphd.sock'),
    lock: path.join(context.runtime_dir, 'graphd.lock'),
    token: path.join(context.runtime_dir, 'graphd.token'),
    evidence: path.join(context.runtime_dir, 'evidence'),
    cocoindex: path.join(context.runtime_dir, 'cocoindex'),
  };
}

function normalizedRepositoryPath(value, platform = process.platform) {
  let normalized = path.resolve(value);
  try { normalized = fs.realpathSync.native(normalized); } catch {}
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function graphSocketPath(paths, platform = process.platform) {
  if (platform === 'win32') {
    const hash = crypto.createHash('sha256')
      .update(normalizedRepositoryPath(paths.common, platform))
      .digest('hex')
      .slice(0, 24);
    return `\\\\.\\pipe\\laminadev-${hash}`;
  }
  if (Buffer.byteLength(paths.socket) < 100) return paths.socket;
  fs.mkdirSync(paths.runtime_dir, { recursive: true });
  // Linux resolves a Unix socket path through an open directory descriptor
  // before applying the sockaddr length limit. This keeps the socket itself at
  // the canonical clone-local path and, unlike /tmp aliases, remains reachable
  // when a caller has an isolated filesystem view (for example Codex's
  // workspace sandbox).
  if (fs.existsSync('/proc/self/fd')) {
    let fd = socketDirectoryFds.get(paths.runtime_dir);
    if (fd === undefined) {
      fd = fs.openSync(paths.runtime_dir, fs.constants.O_RDONLY);
      socketDirectoryFds.set(paths.runtime_dir, fd);
    }
    return `/proc/self/fd/${fd}/graphd.sock`;
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const aliases = path.join(os.tmpdir(), `lamina-graphd-${uid}`);
  fs.mkdirSync(aliases, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(aliases);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      (typeof process.getuid === 'function' && stat.uid !== uid)) {
    fail('LAMINA_INTERNAL', `Unsafe graphd socket alias directory: ${aliases}`);
  }
  fs.chmodSync(aliases, 0o700);
  const alias = path.join(aliases, crypto.createHash('sha256').update(paths.runtime_dir).digest('hex').slice(0, 24));
  if (!fs.existsSync(alias)) {
    fs.symlinkSync(paths.runtime_dir, alias, 'dir');
  } else if (fs.realpathSync(alias) !== fs.realpathSync(paths.runtime_dir)) {
    fail('LAMINA_INTERNAL', `graphd socket alias collision: ${alias}`);
  }
  return path.join(alias, 'graphd.sock');
}

export function ensureRuntime(paths) {
  fs.mkdirSync(paths.runtime_dir, { recursive: true });
  fs.mkdirSync(paths.evidence, { recursive: true });
  fs.mkdirSync(paths.cocoindex, { recursive: true });
}

export function ensureAuthToken(paths, platform = process.platform) {
  ensureRuntime(paths);
  let token;
  try {
    token = fs.readFileSync(paths.token, 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const candidate = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(paths.token, `${candidate}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
      token = candidate;
    } catch (writeError) {
      if (writeError.code !== 'EEXIST') throw writeError;
      token = fs.readFileSync(paths.token, 'utf8').trim();
    }
  }
  if (!TOKEN_PATTERN.test(token || '')) {
    fail('LAMINA_INTERNAL', `Invalid graphd authentication token at ${paths.token}`);
  }
  if (platform !== 'win32') {
    try { fs.chmodSync(paths.token, 0o600); } catch {}
  }
  return token;
}

export function parseDaemonLock(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return { pid: Number(raw), protocol_version: null };
  try {
    const parsed = JSON.parse(raw);
    return {
      pid: Number(parsed.pid),
      protocol_version: Number(parsed.protocol_version) || null,
      runtime_version: typeof parsed.runtime_version === 'string' ? parsed.runtime_version : null,
      capabilities: Array.isArray(parsed.capabilities)
        ? parsed.capabilities.filter((item) => typeof item === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

export function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

export function safeJson(value) {
  return value === undefined ? null : value;
}
