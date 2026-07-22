import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultPaths,
  exportWebRelease,
  loadReleaseManifest,
  validateReleaseFile,
  validateWebRelease,
} from '../benchmarks/lib/web-release.mjs';
import { canonicalArtifactUrl, computeProtocolSha256, gitCatFileExists, hasGitMetadata, parseBriefMarkdown, buildTaskFacts } from '../benchmarks/lib/web-release-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaults = defaultPaths(root);
const manifestPath = defaults.manifest;
const outputPath = defaults.output;
const fixturesRoot = path.join(root, 'benchmarks/releases/fixtures');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function assertValidationFails(release, needle, options = {}) {
  const errors = validateWebRelease(release, options);
  assert.ok(errors.length > 0, 'expected validation to fail');
  assert.match(errors.join('\n'), needle, `expected error matching ${needle}, got: ${errors.join('; ')}`);
}

function assertFixtureFails(relativePath, needle) {
  const errors = validateReleaseFile(path.join(fixturesRoot, relativePath));
  assert.ok(errors.length > 0, `expected ${relativePath} to fail validation`);
  assert.match(errors.join('\n'), needle);
}

// Export + validate current running release (writes only the canonical output)
const first = exportWebRelease({ root, manifestPath, outPath: outputPath });
assert.equal(first.release.status, 'running');
assert.equal(Object.hasOwn(first.release, 'results'), false);
assert.doesNotMatch(first.serialized, /"results"/);

const runningErrors = validateWebRelease(first.release, {
  expectedStatus: 'running',
  root,
  verifyGitArtifacts: true,
});
assert.deepEqual(runningErrors, []);

// Determinism: identical inputs → byte-stable output (temp only)
const second = exportWebRelease({
  root,
  manifestPath,
  outPath: path.join(os.tmpdir(), 'lamina-release-determinism.json'),
});
assert.equal(first.serialized, second.serialized);

// Static valid fixtures
assert.deepEqual(validateReleaseFile(path.join(fixturesRoot, 'valid-running.json'), { expectedStatus: 'running' }), []);
assert.deepEqual(validateReleaseFile(path.join(fixturesRoot, 'valid-withheld.json'), { expectedStatus: 'withheld' }), []);

// Static negative fixtures
assertFixtureFails('negative/running-with-results.json', /Unexpected field release\.results/);
assertFixtureFails('negative/missing-provenance.json', /40-character git commit hash/);
assertFixtureFails('negative/moving-source-url.json', /canonical blob URL/);
assertFixtureFails('negative/mismatched-artifact-url.json', /canonical blob URL/);
assertFixtureFails('negative/unsafe-artifact-path.json', /safe repository-relative path/);
assertFixtureFails('negative/duplicate-ids.json', /Duplicate task id/);
assertFixtureFails('negative/published-incomplete.json', /published release requires results/);
assertFixtureFails('negative/running-with-published-at.json', /Unexpected field release\.publishedAt/);
assertFixtureFails('negative/running-with-withheld-fields.json', /Unexpected field release\.(withheldAt|reasonCode)/);
assertFixtureFails('negative/invalid-generated-at.json', /generatedAt must be a valid ISO-8601 instant/);
assertFixtureFails('negative/invalid-methodology-locked-at.json', /methodologyLockedAt must be a valid ISO-8601 instant/);
assertFixtureFails('negative/javascript-repository.json', /trusted GitHub origin/);
assertFixtureFails('negative/published-empty-objects.json', /must be a non-empty object/);
assertFixtureFails('negative/published-invalid-date.json', /publishedAt must be a valid ISO-8601 instant/);
assertFixtureFails('negative/traversal-task-brief-path.json', /briefPath must be a safe repository-relative path/);

// Live negative checks (not committed as fixtures)
const runningWithResults = structuredClone(first.release);
runningWithResults.results = { aggregate: { lamina: 0.5 } };
assertValidationFails(runningWithResults, /Unexpected field release\.results/);

const runningWithMetrics = structuredClone(first.release);
runningWithMetrics.metrics = { score: 0.9 };
assertValidationFails(runningWithMetrics, /Unexpected field release\.metrics/);

const runningWithGoldenTask = structuredClone(first.release);
runningWithGoldenTask.tasks = first.release.tasks.map((task) =>
  task.id === 'pilot-care-circle' ? { ...task, goldenSequences: [] } : task
);
assertValidationFails(runningWithGoldenTask, /Unexpected field tasks\[\d+\]\.goldenSequences/);

const runningWithPublishedAt = structuredClone(first.release);
runningWithPublishedAt.publishedAt = '2026-07-22T00:00:00.000Z';
assertValidationFails(runningWithPublishedAt, /Unexpected field release\.publishedAt/);

const runningWithWithheldFields = structuredClone(first.release);
runningWithWithheldFields.withheldAt = '2026-07-22T00:00:00.000Z';
runningWithWithheldFields.reasonCode = 'x';
assertValidationFails(runningWithWithheldFields, /Unexpected field release\.(withheldAt|reasonCode)/);

const invalidGeneratedAt = structuredClone(first.release);
invalidGeneratedAt.generatedAt = 'not-a-date';
assertValidationFails(invalidGeneratedAt, /generatedAt must be a valid ISO-8601 instant/);

const invalidMethodologyLockedAt = structuredClone(first.release);
invalidMethodologyLockedAt.methodologyLockedAt = 'yesterday';
assertValidationFails(invalidMethodologyLockedAt, /methodologyLockedAt must be a valid ISO-8601 instant/);

const javascriptRepository = structuredClone(first.release);
javascriptRepository.source.repository = 'javascript:alert(1)';
assertValidationFails(javascriptRepository, /trusted GitHub origin/);

const publishedEmpty = structuredClone(first.release);
publishedEmpty.status = 'published';
publishedEmpty.publishedAt = '2026-07-22T00:00:00.000Z';
publishedEmpty.coverage = {};
publishedEmpty.results = {};
delete publishedEmpty.methodologyLockedAt;
assertValidationFails(publishedEmpty, /must be a non-empty object/);

const publishedInvalidDate = structuredClone(first.release);
publishedInvalidDate.status = 'published';
publishedInvalidDate.publishedAt = 'not-a-date';
publishedInvalidDate.coverage = { tasks: 4, arms: 4, attemptsPerArm: 2, completeCells: 32 };
publishedInvalidDate.results = { aggregate: { lamina: 0.5 }, perTask: [{ taskId: 'x', arm: 'direct', rate: 0.5 }] };
delete publishedInvalidDate.methodologyLockedAt;
assertValidationFails(publishedInvalidDate, /publishedAt must be a valid ISO-8601 instant/);

// Canonical URL must match declared path even when URL is trusted and commit-pinned
const mismatchedArtifactUrl = structuredClone(first.release);
mismatchedArtifactUrl.artifacts = first.release.artifacts.map((artifact) =>
  artifact.id === 'corpus-manifest'
    ? {
        ...artifact,
        url: `https://github.com/aryaniyaps/lamina/blob/${first.release.source.commit}/README.md`,
      }
    : artifact
);
assertValidationFails(
  mismatchedArtifactUrl,
  /canonical blob URL/,
  { root, verifyGitArtifacts: true }
);

const traversalArtifactPath = structuredClone(first.release);
traversalArtifactPath.artifacts = first.release.artifacts.map((artifact) =>
  artifact.id === 'corpus-manifest'
    ? {
        ...artifact,
        path: '../README.md',
        url: `https://github.com/aryaniyaps/lamina/blob/${first.release.source.commit}/../README.md`,
      }
    : artifact
);
assertValidationFails(traversalArtifactPath, /safe repository-relative path/);

const traversalTaskBrief = structuredClone(first.release);
traversalTaskBrief.tasks = first.release.tasks.map((task) =>
  task.id === 'pilot-care-circle'
    ? { ...task, briefPath: 'benchmarks/corpus/../golden/brief.md' }
    : task
);
assertValidationFails(traversalTaskBrief, /briefPath must be a safe repository-relative path/);

const wrongTaskBriefShape = structuredClone(first.release);
wrongTaskBriefShape.tasks = first.release.tasks.map((task) =>
  task.id === 'pilot-care-circle'
    ? { ...task, briefPath: 'benchmarks/corpus/pilot-loan-library/brief.md' }
    : task
);
assertValidationFails(
  wrongTaskBriefShape,
  /briefPath must be benchmarks\/corpus\/pilot-care-circle\/brief\.md/
);

const unsortedTasks = structuredClone(first.release);
unsortedTasks.tasks = [...first.release.tasks].reverse();
assertValidationFails(unsortedTasks, /tasks must be sorted by id/);

const mismatchedArmSteps = structuredClone(first.release);
mismatchedArmSteps.arms = first.release.arms.map((arm) =>
  arm.id === 'direct'
    ? { ...arm, stepBudgets: arm.stepBudgets.map((step) => ({ ...step, step: 'wrong_step' })) }
    : arm
);
assertValidationFails(mismatchedArmSteps, /stepBudgets must align with workflowSteps/);

const unevenArmBudget = structuredClone(first.release);
unevenArmBudget.arms = first.release.arms.map((arm) =>
  arm.id === 'lamina' ? { ...arm, totalBudgetSeconds: 1000 } : arm
);
assertValidationFails(unevenArmBudget, /must match other arms/);

const zeroRuntimeAttempts = structuredClone(first.release);
zeroRuntimeAttempts.runtime = { ...first.release.runtime, attemptsPerArm: 0 };
assertValidationFails(zeroRuntimeAttempts, /attemptsPerArm must be a positive number/);

const emptyControlDescription = structuredClone(first.release);
emptyControlDescription.controls = first.release.controls.map((control) =>
  control.id === 'matched-arm-budget' ? { ...control, description: '   ' } : control
);
assertValidationFails(emptyControlDescription, /requires a non-empty description/);

const emptyArtifactRole = structuredClone(first.release);
emptyArtifactRole.artifacts = first.release.artifacts.map((artifact) =>
  artifact.id === 'corpus-manifest' ? { ...artifact, role: '' } : artifact
);
assertValidationFails(emptyArtifactRole, /requires a non-empty role/);

// Git metadata distinguishes missing commit paths from absent local Git metadata
assert.equal(hasGitMetadata(root), true);
assert.equal(
  gitCatFileExists(root, first.release.source.commit, 'benchmarks/corpus/manifest.json'),
  true
);
assert.equal(
  gitCatFileExists(root, first.release.source.commit, 'benchmarks/releases/contract.md'),
  false
);
const noGitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-no-git-'));
assert.equal(hasGitMetadata(noGitRoot), false);
assert.equal(gitCatFileExists(noGitRoot, first.release.source.commit, 'README.md'), null);

const missingAtCommit = structuredClone(first.release);
const commit = first.release.source.commit;
missingAtCommit.artifacts = first.release.artifacts.map((artifact) =>
  artifact.id === 'corpus-manifest'
    ? {
        ...artifact,
        path: 'benchmarks/releases/contract.md',
        url: canonicalArtifactUrl(first.release.source.repository, commit, 'benchmarks/releases/contract.md'),
      }
    : artifact
);
const errorsWithoutGit = validateWebRelease(missingAtCommit, {
  root: noGitRoot,
  verifyGitArtifacts: true,
});
assert.doesNotMatch(errorsWithoutGit.join('\n'), /path missing at commit/);
const errorsWithGit = validateWebRelease(missingAtCommit, { root, verifyGitArtifacts: true });
assert.match(errorsWithGit.join('\n'), /path missing at commit/);

// Protocol mismatch via manifest tampering (temp manifest only)
const tamperedManifest = readJson(manifestPath);
tamperedManifest.protocol.expectedSha256 = '0'.repeat(64);
const tmpManifest = path.join(os.tmpdir(), 'lamina-release-bad-manifest.json');
writeJson(tmpManifest, tamperedManifest);
assert.throws(
  () => exportWebRelease({ root, manifestPath: tmpManifest, outPath: path.join(os.tmpdir(), 'out.json') }),
  /Protocol hash mismatch/
);

// Export failure must not overwrite current public artifact
const beforeFailure = fs.readFileSync(outputPath, 'utf8');
assert.throws(
  () => exportWebRelease({ root, manifestPath: tmpManifest, outPath: outputPath }),
  /Protocol hash mismatch/
);
assert.equal(fs.readFileSync(outputPath, 'utf8'), beforeFailure);

// Manifest loads; protocol paths hash to expected value; expected IDs frozen
const manifest = loadReleaseManifest(manifestPath);
const protocol = computeProtocolSha256(root, manifest.protocol.paths);
assert.equal(protocol.sha256, manifest.protocol.expectedSha256);
assert.deepEqual(manifest.expectedTasks, [
  'pilot-care-circle',
  'pilot-loan-library',
  'pilot-review-room',
  'control-simple-list',
]);
assert.deepEqual(manifest.expectedArms, ['direct', 'plan', 'checklist', 'lamina']);

// Public artifact has commit-pinned links, no golden expects, corpus brief paths and display facts
const expectedTasks = {
  'control-simple-list': {
    title: 'A tiny household list',
    summary:
      'I want a pleasant little list for one person to capture a few things, mark them done, and clear completed items. Keep it simple and friendly. Please shape the product and build the next coherent version.',
  },
  'pilot-care-circle': {
    title: 'Shared care coordination',
    summary:
      'I want a small product that helps a family coordinate care for an older relative. People should know what was done and what still needs attention without turning the experience into project-management software. Please shape the product and build the next coherent version.',
  },
  'pilot-loan-library': {
    title: 'Borrowing things among neighbors',
    summary:
      'I want a friendly way for a small neighborhood group to lend useful things to one another. People should know who has what and whether it is safe to lend again, without making it feel like a logistics system. Please shape the product and build the next coherent version.',
  },
  'pilot-review-room': {
    title: 'Lightweight document review',
    summary:
      'I want a small product where someone can invite a trusted person to review one document and leave useful comments. It should feel safe and focused rather than like giving away access to a whole workspace. Please shape the product and build the next coherent version.',
  },
};

for (const task of first.release.tasks) {
  assert.equal(Object.hasOwn(task, 'golden'), false);
  assert.match(task.briefPath, /^benchmarks\/corpus\/.+\/brief\.md$/);
  const expected = expectedTasks[task.id];
  assert.ok(expected, `unexpected task id ${task.id}`);
  assert.equal(task.title, expected.title);
  assert.equal(task.summary, expected.summary);
}
for (const artifact of first.release.artifacts) {
  assert.match(artifact.url, /e851d037199b189a9b98b7d807bbcfd427bf0c5c/);
  assert.doesNotMatch(artifact.url, /\/main\//);
  assert.doesNotMatch(artifact.url, /contract\.md/);
}

// Brief parsing helper regressions (temp fixtures only)
assert.deepEqual(parseBriefMarkdown('# Title\n\nFirst paragraph.\n\nSecond paragraph.'), {
  title: 'Title',
  summary: 'First paragraph.',
});
assert.deepEqual(parseBriefMarkdown('No heading\n\nStill no heading.'), {
  title: '',
  summary: 'No heading',
});
assert.deepEqual(parseBriefMarkdown('# Only Title'), {
  title: 'Only Title',
  summary: '',
});

const tempCorpusRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-brief-corpus-'));
const tempTaskRoot = path.join(tempCorpusRoot, 'benchmarks/corpus/temp-task');
fs.mkdirSync(tempTaskRoot, { recursive: true });
fs.writeFileSync(
  path.join(tempTaskRoot, 'brief.md'),
  '# Good brief\n\nFounder premise for the thin slice.\n'
);
const goodFacts = buildTaskFacts(
  [{ id: 'temp-task', kind: 'greenfield-low-risk', stage: 'spark', brief: 'temp-task/brief.md' }],
  tempCorpusRoot,
  'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
);
assert.equal(goodFacts[0].title, 'Good brief');
assert.equal(goodFacts[0].summary, 'Founder premise for the thin slice.');

const missingBriefRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-brief-missing-'));
assert.throws(
  () =>
    buildTaskFacts(
      [{ id: 'missing-task', kind: 'greenfield-low-risk', stage: 'spark', brief: 'missing-task/brief.md' }],
      missingBriefRoot,
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    ),
  /brief file missing|missing at source commit/
);

const blankTitleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-brief-blank-'));
const blankTaskRoot = path.join(blankTitleRoot, 'benchmarks/corpus/blank-task');
fs.mkdirSync(blankTaskRoot, { recursive: true });
fs.writeFileSync(path.join(blankTaskRoot, 'brief.md'), 'No heading here.\n\nBody only.\n');
assert.throws(
  () =>
    buildTaskFacts(
      [{ id: 'blank-task', kind: 'greenfield-low-risk', stage: 'spark', brief: 'blank-task/brief.md' }],
      blankTitleRoot,
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    ),
  /no Markdown H1 title/
);

const blankSummaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-brief-summary-'));
const blankSummaryTaskRoot = path.join(blankSummaryRoot, 'benchmarks/corpus/title-only');
fs.mkdirSync(blankSummaryTaskRoot, { recursive: true });
fs.writeFileSync(path.join(blankSummaryTaskRoot, 'brief.md'), '# Title only\n');
assert.throws(
  () =>
    buildTaskFacts(
      [{ id: 'title-only', kind: 'greenfield-low-risk', stage: 'spark', brief: 'title-only/brief.md' }],
      blankSummaryRoot,
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    ),
  /no summary paragraph/
);

const validationMissingTitle = structuredClone(first.release);
validationMissingTitle.tasks = first.release.tasks.map((task) =>
  task.id === 'pilot-care-circle' ? { ...task, title: '   ' } : task
);
assertValidationFails(validationMissingTitle, /requires a non-empty title/);

if (hasGitMetadata(root)) {
  const briefPath = path.join(root, 'benchmarks/corpus/pilot-care-circle/brief.md');
  const originalBrief = fs.readFileSync(briefPath, 'utf8');
  fs.writeFileSync(briefPath, `${originalBrief}\nDrift line.\n`);
  try {
    assert.throws(
      () => exportWebRelease({ root, manifestPath, outPath: path.join(os.tmpdir(), 'drift-release.json') }),
      /Working tree drift from source\.commit/
    );
  } finally {
    fs.writeFileSync(briefPath, originalBrief);
  }
}

console.log('web_release_test: all checks passed');
