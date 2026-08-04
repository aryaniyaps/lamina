import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { graphRequest, ensureGraphd } from '../graph-runtime/client.mjs';
import { graphSocketChildPath, repositoryContext, runtimePaths } from '../graph-runtime/util.mjs';
import { RETRIEVAL_SCHEMA_VERSION } from './constants.mjs';
import { verifyRetrievalModel, verifyRetrievalRuntimeAssets } from './assets.mjs';
import { retrievalIdentity, workflowDocuments } from './documents.mjs';
import { workerThreadEnvironment } from '../runtime-budget.mjs';
import {
  assertCompatibleRuntimeIdentity,
  releaseGraphdBeforeObservation,
  runWithRuntimeLifecycle,
} from '../runtime-lifecycle.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function unavailable(message, details = {}) {
  const error = new Error(message);
  error.code = 'LAMINA_RETRIEVAL_UNAVAILABLE';
  error.details = details;
  return error;
}

function managedWorker() {
  if (process.env.LAMINA_RETRIEVAL_WORKER) return path.resolve(process.env.LAMINA_RETRIEVAL_WORKER);
  const executable = process.platform === 'win32' ? 'cocoindex-worker.exe' : 'cocoindex-worker';
  const candidate = path.join(packageRoot, 'observation-runtime', executable);
  try {
    fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

function workerInvocation(args, cwd) {
  const worker = managedWorker();
  if (worker) return { command: worker, args: ['retrieval', ...args] };
  if (process.env.LAMINA_STANDALONE === '1') {
    throw unavailable(
      'The installed retrieval worker is missing or not executable. Reinstall this Lamina release.',
      { expected: path.join(packageRoot, 'observation-runtime') },
    );
  }
  const uv = process.env.LAMINA_UV_BINARY || (process.platform === 'win32' ? 'uv.exe' : 'uv');
  return {
    command: uv,
    args: [
      'run', '--locked', '--project', packageRoot, 'python',
      path.join(packageRoot, 'retrieval_worker.py'),
      ...args,
    ],
    cwd,
  };
}

function workerEnvironment(cwd, graphd, model) {
  const paths = runtimePaths(cwd);
  const assets = process.env.LAMINA_TEST_RETRIEVAL_EMBEDDER === 'deterministic'
    ? { tokenizer: null }
    : verifyRetrievalRuntimeAssets();
  return {
    ...process.env,
    ...workerThreadEnvironment(),
    LAMINA_SOURCE_ROOT: paths.root,
    LAMINA_GRAPHD_ENDPOINT: graphSocketChildPath(paths),
    LAMINA_GRAPHD_TOKEN: graphd.auth_token,
    LAMINA_RETRIEVAL_MODEL_PATH: model.path || '',
    LAMINA_RETRIEVAL_MODEL_DIGEST: model.digest,
    LAMINA_RETRIEVAL_TOKENIZER_PATH: assets.tokenizer || '',
    LAMINA_RETRIEVAL_LEXICAL_ONLY: model.lexical_degraded ? '1' : '0',
  };
}

function runWorker(args, { cwd, input = null, graphd, model }) {
  const invocation = workerInvocation(args, cwd);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: invocation.cwd || cwd,
    env: workerEnvironment(cwd, graphd, model),
    encoding: 'utf8',
    input,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) {
    throw unavailable('The retrieval worker could not start.', { cause: result.error.message });
  }
  if (result.status !== 0) {
    const error = unavailable(`The retrieval worker exited with status ${result.status ?? 1}.`, {
      diagnostics: (result.stderr || result.stdout || '').trim().slice(-8000),
    });
    error.code = 'LAMINA_RETRIEVAL_FAILED';
    throw error;
  }
  try { return JSON.parse(result.stdout); } catch (error) {
    throw unavailable('The retrieval worker returned invalid JSON.', {
      cause: error.message,
      output: result.stdout.slice(-2000),
    });
  }
}

async function retrievalSnapshot(cwd, model) {
  const repository = repositoryContext(cwd);
  const status = await graphRequest('status', {}, cwd);
  const workflowQuery = await graphRequest('graph.query', { at: 'HEAD', kind: 'workflow' }, cwd);
  const workflowIds = workflowQuery.resources.map((item) => item.id);
  const graph = workflowIds.length
    ? await graphRequest('work.context', { workflows: workflowIds, request: '' }, cwd)
    : { graph_version: { id: status.graph_version }, workflows: [] };
  const identity = retrievalIdentity(cwd);
  return {
    schema: 'lamina.retrieval-snapshot/v1',
    ...identity,
    graph_version: graph.graph_version?.id || status.graph_version,
    source_revision: repository.source_revision,
    model_digest: model.digest,
    schema_version: RETRIEVAL_SCHEMA_VERSION,
    workflows: workflowDocuments(graph.workflows),
  };
}

function statusParams(snapshot, includeDocuments = false) {
  return {
    identity: snapshot.identity,
    graph_version: snapshot.graph_version,
    source_revision: snapshot.source_revision,
    repository_revision: snapshot.repository_revision,
    branch: snapshot.branch,
    worktree: snapshot.worktree,
    model_digest: snapshot.model_digest,
    schema_version: snapshot.schema_version,
    include_documents: includeDocuments,
  };
}

export async function ensureRetrieval(
  cwd = process.cwd(),
  { force = false, allowLexicalDegraded = false } = {},
) {
  return runWithRuntimeLifecycle(cwd, async () => {
  assertCompatibleRuntimeIdentity(cwd);
  await releaseGraphdBeforeObservation(cwd);
  let model;
  try {
    model = verifyRetrievalModel();
  } catch (error) {
    if (!allowLexicalDegraded) throw error;
    const manifest = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'retrieval-model-manifest.json'), 'utf8'),
    );
    model = {
      path: null,
      digest: `lexical-degraded:${manifest.sha256}`,
      manifest,
      lexical_degraded: true,
      failure: { code: error.code, message: error.message, details: error.details || {} },
    };
  }
  const graphd = await ensureGraphd(cwd);
  const snapshot = await retrievalSnapshot(cwd, model);
  let status = await graphRequest('retrieval.status', statusParams(snapshot, true), cwd);
  if (force) {
    await graphRequest('retrieval.invalidate', { identity: snapshot.identity }, cwd);
    status = await graphRequest('retrieval.status', statusParams(snapshot, true), cwd);
  }
  if (!status.fresh) {
    const paths = runtimePaths(cwd);
    fs.mkdirSync(paths.context, { recursive: true, mode: 0o700 });
    const inputFile = path.join(paths.context, `retrieval-input-${process.pid}.json`);
    fs.writeFileSync(inputFile, `${JSON.stringify({ ...snapshot, previous: status.documents || {} })}\n`, {
      mode: 0o600,
    });
    try {
      runWorker(['index', '--input', inputFile], { cwd, graphd, model });
    } finally {
      fs.rmSync(inputFile, { force: true });
    }
    status = await graphRequest('retrieval.status', statusParams(snapshot, false), cwd);
    if (!status.fresh || status.counts.committed !== status.counts.expected) {
      const error = unavailable('The retrieval worker did not commit a complete current generation.', status);
      error.code = 'LAMINA_RETRIEVAL_INCOMPLETE';
      throw error;
    }
  }
  return { snapshot, status, model, graphd };
  }, { mutation: true });
}

export async function queryRetrieval(query, prepared, cwd = process.cwd()) {
  return graphRequest('retrieval.query', {
    ...statusParams(prepared.snapshot, false),
    query,
    degradation: prepared.model.lexical_degraded ? 'lexical_degraded' : null,
  }, cwd);
}

export async function retrievalStatus(cwd = process.cwd()) {
  let model;
  let modelFailure = null;
  try { model = verifyRetrievalModel(); } catch (error) {
    modelFailure = { code: error.code, message: error.message, details: error.details || {} };
    const manifest = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'retrieval-model-manifest.json'), 'utf8'),
    );
    model = { digest: manifest.sha256, manifest, path: null };
  }
  const snapshot = await retrievalSnapshot(cwd, model);
  const status = await graphRequest('retrieval.status', statusParams(snapshot, false), cwd);
  return {
    ...status,
    model: {
      id: model.manifest.model_id,
      revision: model.manifest.revision,
      digest: model.digest,
      asset: model.manifest.asset_name,
      integrity: modelFailure ? 'failed' : 'verified',
    },
    ...(modelFailure ? { last_failure: modelFailure } : {}),
  };
}

export async function rebuildRetrieval(cwd = process.cwd()) {
  return ensureRetrieval(cwd, { force: true });
}
