import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyRetrievalModel, verifyRetrievalRuntimeAssets } from './assets.mjs';
import { RETRIEVAL_DIMENSIONS } from './constants.mjs';
import { workerThreadEnvironment, retrievalBatchEnvironment } from '../runtime-budget.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function deterministicEmbedding(text) {
  const vector = Array(RETRIEVAL_DIMENSIONS).fill(0);
  const expanded = String(text).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  for (const token of expanded.match(/[a-z][a-z0-9]{1,}/g) || []) {
    const digest = crypto.createHash('sha256').update(token).digest();
    for (let offset = 0; offset < 16; offset += 2) {
      const index = digest.readUInt16BE(offset) % RETRIEVAL_DIMENSIONS;
      vector[index] += digest[offset] & 1 ? 1 : -1;
    }
  }
  const norm = Math.sqrt(vector.reduce((total, item) => total + item * item, 0));
  return norm ? vector.map((item) => item / norm) : vector;
}

function managedWorker() {
  if (process.env.LAMINA_RETRIEVAL_WORKER) return path.resolve(process.env.LAMINA_RETRIEVAL_WORKER);
  const name = process.platform === 'win32' ? 'cocoindex-worker.exe' : 'cocoindex-worker';
  const candidate = path.join(packageRoot, 'observation-runtime', name);
  try {
    fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

export class RetrievalEmbedder {
  constructor() {
    this.child = null;
    this.buffer = '';
    this.pending = [];
    this.identity = null;
  }

  invocation() {
    const worker = managedWorker();
    if (worker) return { command: worker, args: ['retrieval', 'serve'], cwd: process.cwd() };
    if (process.env.LAMINA_STANDALONE === '1') {
      const error = new Error('The installed retrieval worker is missing. Reinstall this Lamina release.');
      error.code = 'LAMINA_RETRIEVAL_UNAVAILABLE';
      throw error;
    }
    const uv = process.env.LAMINA_UV_BINARY || (process.platform === 'win32' ? 'uv.exe' : 'uv');
    return {
      command: uv,
      args: [
        'run', '--locked', '--project', packageRoot, 'python',
        path.join(packageRoot, 'retrieval_worker.py'), 'serve',
      ],
      cwd: packageRoot,
    };
  }

  ensure(modelDigest) {
    if (process.env.LAMINA_TEST_RETRIEVAL_EMBEDDER === 'deterministic') return;
    const model = verifyRetrievalModel();
    if (model.digest !== modelDigest) {
      const error = new Error('The query model digest does not match the active retrieval generation.');
      error.code = 'LAMINA_RETRIEVAL_INTEGRITY';
      error.details = { active: modelDigest, runtime: model.digest };
      throw error;
    }
    if (this.child && this.identity === model.digest && this.child.exitCode === null) return;
    this.close();
    const assets = verifyRetrievalRuntimeAssets();
    const invocation = this.invocation();
    this.identity = model.digest;
    this.child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: {
        ...process.env,
        ...workerThreadEnvironment(),
        ...retrievalBatchEnvironment(),
        LAMINA_RETRIEVAL_MODEL_PATH: model.path,
        LAMINA_RETRIEVAL_MODEL_DIGEST: model.digest,
        LAMINA_RETRIEVAL_TOKENIZER_PATH: assets.tokenizer,
        LAMINA_RETRIEVAL_LEXICAL_ONLY: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const pending = this.pending.shift();
        if (!pending) continue;
        try {
          const response = JSON.parse(line);
          if (response.error) {
            const error = new Error(response.error);
            error.code = 'LAMINA_RETRIEVAL_FAILED';
            pending.reject(error);
          } else {
            pending.resolve(response.embeddings);
          }
        } catch (error) {
          pending.reject(error);
        }
      }
    });
    let diagnostics = '';
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      diagnostics = `${diagnostics}${chunk}`.slice(-8000);
    });
    this.child.on('exit', (code) => {
      const error = new Error(
        `The retrieval embedding worker exited with status ${code ?? 1}.${diagnostics ? ` ${diagnostics}` : ''}`,
      );
      error.code = 'LAMINA_RETRIEVAL_FAILED';
      for (const pending of this.pending.splice(0)) pending.reject(error);
      this.child = null;
    });
  }

  async embed(texts, modelDigest, degradation = null) {
    if (degradation === 'lexical_degraded') {
      return texts.map(() => Array(RETRIEVAL_DIMENSIONS).fill(0));
    }
    if (process.env.LAMINA_TEST_RETRIEVAL_EMBEDDER === 'deterministic') {
      return texts.map(deterministicEmbedding);
    }
    this.ensure(modelDigest);
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ texts })}\n`);
    });
  }

  close() {
    if (this.child?.exitCode === null) {
      try { this.child.stdin.end(); } catch {}
      try { this.child.kill('SIGTERM'); } catch {}
    }
    this.child = null;
    this.identity = null;
    this.buffer = '';
    const error = new Error('Retrieval embedding worker stopped.');
    error.code = 'LAMINA_RETRIEVAL_FAILED';
    for (const pending of this.pending.splice(0)) pending.reject(error);
  }
}
