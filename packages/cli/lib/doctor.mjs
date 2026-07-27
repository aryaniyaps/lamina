import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { CLI_API_VERSION, GRAPH_PROTOCOL_VERSION } from './graph-runtime/constants.mjs';
import { repositoryContext } from './graph-runtime/util.mjs';

const packageMetadata = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

export const CLI_VERSION = packageMetadata.version;

export function platformSupport(platform = process.platform, arch = process.arch) {
  const supported = (
    (platform === 'linux' && ['x64', 'arm64'].includes(arch)) ||
    (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) ||
    (platform === 'win32' && arch === 'x64')
  );
  return {
    os: platform,
    arch,
    supported,
    transport: platform === 'win32' ? 'windows_named_pipe' : 'unix_domain_socket',
  };
}

function toolResult(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  return {
    available: !result.error && result.status === 0,
    output: String(result.stdout || '').trim() || null,
  };
}

function gitProject(cwd) {
  try {
    const context = repositoryContext(cwd);
    return {
      is_project: true,
      root: context.root,
      common_dir: context.common,
      branch: context.branch,
      revision: context.revision,
      source_revision: context.source_revision,
      dirty: context.source_revision.startsWith('dirty:'),
    };
  } catch {
    return {
      is_project: false,
      root: null,
      common_dir: null,
      branch: null,
      revision: null,
      source_revision: null,
      dirty: null,
    };
  }
}

export function doctorReport(cwd = process.cwd()) {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const nodeCompatible = Number.isInteger(nodeMajor) && nodeMajor >= 20;
  const platform = platformSupport();
  const uv = toolResult('uv', ['--version']);
  const python = uv.available
    ? toolResult('uv', ['python', 'find', '3.13'])
    : { available: false, output: null };
  return {
    ok: nodeCompatible && platform.supported,
    cli: {
      package: packageMetadata.name,
      version: CLI_VERSION,
      api_version: CLI_API_VERSION,
    },
    graph: {
      protocol_version: GRAPH_PROTOCOL_VERSION,
    },
    platform,
    node: {
      version: process.versions.node,
      required: packageMetadata.engines.node,
      compatible: nodeCompatible,
    },
    git: gitProject(cwd),
    observation: {
      optional: true,
      required_for_core_graph: false,
      uv_available: uv.available,
      uv_version: uv.output,
      python_3_13_available: python.available,
      python_path: python.output,
      ready: platform.supported && uv.available && python.available,
    },
    host: {
      release: os.release(),
    },
  };
}
