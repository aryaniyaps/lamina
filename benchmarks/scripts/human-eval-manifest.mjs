/**
 * Build verifiable human-eval manifest and Google Form spec.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import { execSync } from 'node:child_process';
import { CRITERIA, CRITERIA_LABELS, sha256, sha256File } from './human-eval-lib.mjs';
import { readYamlSync } from './yaml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKET_DIR = path.join(ROOT, 'benchmarks/human/review-packet');
const GOOGLE_FORM_DIR = path.join(ROOT, 'benchmarks/human/google-form');
const RUBRIC_PATH = path.join(ROOT, 'benchmarks/judges/rubric.md');

function gitCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function formQuestionTitle(artifact, criterion) {
  return `${artifact} — ${CRITERIA_LABELS[criterion]} (1-5)`;
}

export function buildGoogleFormSpec(evalId, humanTasks) {
  const questions = [
    {
      id: 'eval_id',
      title: 'Evaluation ID (do not edit)',
      type: 'short_answer',
      required: true,
      description: `Must match manifest: ${evalId}`,
    },
    {
      id: 'rater_code',
      title: 'Rater code',
      type: 'short_answer',
      required: true,
      description: 'Assigned code (e.g. R1, R2, R3). Do not use your real name if publishing results.',
    },
    {
      id: 'task_id',
      title: 'Task ID',
      type: 'multiple_choice',
      required: true,
      options: humanTasks,
      description: 'Submit once per task. Complete all 10 tasks before finishing.',
    },
  ];

  for (const artifact of ['A', 'B']) {
    for (const c of CRITERIA) {
      questions.push({
        id: `${artifact.toLowerCase()}_${c}`,
        title: formQuestionTitle(artifact, c),
        type: 'linear_scale',
        required: true,
        scale_min: 1,
        scale_max: 5,
      });
    }
    questions.push({
      id: `${artifact.toLowerCase()}_notes`,
      title: `${artifact} — Notes (optional; required if any score ≤2 or ≥4)`,
      type: 'paragraph',
      required: false,
    });
  }

  return {
    eval_id: evalId,
    form_mode: 'one_submission_per_task',
    instructions: [
      'Open the blind review packet (packet.html) for implementation source.',
      'Do not guess which implementation used Lamina.',
      'Submit this form once per task (10 submissions total per rater).',
      'Use the same Evaluation ID and Rater code on every submission.',
    ],
    questions,
  };
}

export function writeHumanEvalManifest({ answerKey, artifactPairs }) {
  const release = readYamlSync(path.join(ROOT, 'benchmarks/release.yaml'));
  const evalId = randomUUID();
  const rubricSha = sha256File(RUBRIC_PATH);

  const tasks = answerKey.map((key) => {
    const pair = artifactPairs.find((p) => p.task_id === key.task_id);
    return {
      task_id: key.task_id,
      artifact_a_sha256: pair?.a_sha256,
      artifact_b_sha256: pair?.b_sha256,
      // answer-key mapping is private until study closes
    };
  });

  const manifest = {
    eval_id: evalId,
    generated_at: new Date().toISOString(),
    release_version: release.version,
    release_tag: release.release_tag,
    git_commit: gitCommit(),
    rubric_sha256: rubricSha,
    human_eval_tasks: answerKey.map((k) => k.task_id),
    n_raters_expected: release.human_raters ?? 3,
    tasks,
    verification_note:
      'Publish this manifest before raters start. After import, publish human-eval-audit.json and optionally a read-only Google Sheet link.',
  };

  fs.mkdirSync(PACKET_DIR, { recursive: true });
  fs.mkdirSync(GOOGLE_FORM_DIR, { recursive: true });

  const manifestPath = path.join(PACKET_DIR, 'human-eval-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const formSpec = buildGoogleFormSpec(evalId, answerKey.map((k) => k.task_id));
  fs.writeFileSync(
    path.join(GOOGLE_FORM_DIR, 'form-spec.json'),
    JSON.stringify(formSpec, null, 2) + '\n'
  );

  // Plain-text checklist for manual Google Form creation
  const checklist = [
    '# Google Form question checklist',
    '',
    `Evaluation ID (short answer, required): default text ${evalId}`,
    'Rater code (short answer, required)',
    `Task ID (dropdown, required): ${answerKey.map((k) => k.task_id).join(', ')}`,
    '',
    'For each implementation A and B, add linear scale 1-5:',
    ...CRITERIA.map((c) => `  - A — ${CRITERIA_LABELS[c]} (1-5)`),
    '  - A — Notes (optional)',
    ...CRITERIA.map((c) => `  - B — ${CRITERIA_LABELS[c]} (1-5)`),
    '  - B — Notes (optional)',
    '',
    'Form settings: collect email addresses OFF (or ON if you need audit trail internally).',
    'Link responses to Google Sheets. Publish manifest eval_id before sharing form.',
  ].join('\n');
  fs.writeFileSync(path.join(GOOGLE_FORM_DIR, 'form-checklist.txt'), checklist + '\n');

  return { manifest, manifestPath, evalId };
}

export function hashArtifactContent(text) {
  return sha256(text);
}
