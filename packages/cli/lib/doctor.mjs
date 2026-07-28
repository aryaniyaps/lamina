import fs from 'node:fs';
import os from 'node:os';
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
      dirty: context.dirty,
      unborn: context.unborn,
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
  return {
    ok: nodeCompatible && platform.supported,
    cli: {
      package: 'lamina',
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
      backend: 'cocoindex',
      managed: true,
      external_runtime_required: false,
      runtime: 'native_cocoindex_worker',
      ready: platform.supported,
    },
    host: {
      release: os.release(),
    },
  };
}
