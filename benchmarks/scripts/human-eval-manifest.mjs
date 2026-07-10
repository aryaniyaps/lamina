/**
 * Build verifiable human-eval manifest for optional qualitative review.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import { execSync } from 'node:child_process';
import { sha256, sha256File } from './human-eval-lib.mjs';
import { readYamlSync } from './yaml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKET_DIR = path.join(ROOT, 'benchmarks/human/review-packet');
const RUBRIC_PATH = path.join(ROOT, 'benchmarks/judges/rubric.md');

function gitCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function writeHumanEvalManifest({ answerKey, artifactPairs }) {
  const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
  const evalId = randomUUID();

  const tasks = answerKey.map((key) => {
    const pair = artifactPairs.find((p) => p.task_id === key.task_id);
    return {
      task_id: key.task_id,
      artifact_a_sha256: pair?.a_sha256,
      artifact_b_sha256: pair?.b_sha256,
    };
  });

  const manifest = {
    eval_id: evalId,
    generated_at: new Date().toISOString(),
    release_version: release.version,
    release_tag: release.release_tag,
    git_commit: gitCommit(),
    rubric_sha256: sha256File(RUBRIC_PATH),
    human_eval_tasks: answerKey.map((k) => k.task_id),
    tasks,
    verification_note: 'Publish this manifest before raters start.',
  };

  fs.mkdirSync(PACKET_DIR, { recursive: true });
  const manifestPath = path.join(PACKET_DIR, 'human-eval-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, manifestPath, evalId };
}

export function hashArtifactContent(text) {
  return sha256(text);
}
