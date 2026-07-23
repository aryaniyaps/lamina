import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildExpectedHarborSkillDigests,
  computeHarborSkillDigest,
  parseAgentSkillLocks,
  validateAgentSkillLocks,
} from '../benchmarks/lb6/pilot/lib/skill-lock.mjs';
import {
  PINNED_SKILL_COMMIT,
  LAMINA_BENCH_SKILLS,
} from '../benchmarks/lb6/pilot/lib/constants.mjs';
import {
  stageSkillBundle,
  stageSkillBundleFromWorkingTree,
  verifyStagedSkillBundle,
} from '../benchmarks/lb6/pilot/lib/skill-bundle.mjs';
import {
  classifyCellFailure,
  classifyFromJobEvidence,
  splitCampaignCells,
} from '../benchmarks/lb6/pilot/scripts/run-three-arm.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stagedRoot = path.join(root, 'benchmarks/lb6/pilot/skill-bundle/staged');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'benchmarks/lb6/pilot/skill-bundle/manifest.json'), 'utf8'),
);

assert.equal(computeHarborSkillDigest(path.join(stagedRoot, 'lamina')), manifest.harbor_skill_digests.lamina);
assert.equal(verifyStagedSkillBundle(root).ok, true);

const expectedDigests = buildExpectedHarborSkillDigests(stagedRoot, manifest.skills);
const goodLocks = manifest.skills.map((name) => ({
  name,
  source: `/tmp/staged/${name}`,
  digest: expectedDigests[name],
}));
const dualShapeLock = {
  agent: { skills: manifest.skills.map((name) => path.join(stagedRoot, name)) },
  skills: goodLocks,
};
assert.equal(parseAgentSkillLocks(dualShapeLock).length, manifest.skills.length);
assert.equal(
  validateAgentSkillLocks({
    locks: goodLocks,
    arm: 'lamina',
    expectedSkillNames: manifest.skills,
    expectedDigests,
  }).passed,
  true,
);

assert.equal(
  validateAgentSkillLocks({
    locks: goodLocks.slice(0, -1),
    arm: 'lamina',
    expectedSkillNames: manifest.skills,
    expectedDigests,
  }).gate,
  'skill_lock_missing',
);

assert.equal(
  validateAgentSkillLocks({
    locks: [...goodLocks, { ...goodLocks[0], source: '/tmp/extra' }],
    arm: 'lamina',
    expectedSkillNames: manifest.skills,
    expectedDigests,
  }).gate,
  'skill_lock_duplicate',
);

assert.equal(
  validateAgentSkillLocks({
    locks: goodLocks.map((entry) => (
      entry.name === goodLocks[0].name
        ? { ...entry, digest: `sha256:${'0'.repeat(64)}` }
        : entry
    )),
    arm: 'lamina',
    expectedSkillNames: manifest.skills,
    expectedDigests,
  }).gate,
  'skill_lock_digest_mismatch',
);

assert.equal(
  validateAgentSkillLocks({
    locks: [{ name: 'lamina', source: '/tmp/lamina' }],
    arm: 'lamina',
    expectedSkillNames: manifest.skills,
    expectedDigests,
  }).gate,
  'skill_lock_schema_invalid',
);

assert.equal(
  validateAgentSkillLocks({
    locks: [{ name: 'lamina', source: '/tmp/lamina', digest: expectedDigests.lamina }],
    arm: 'direct',
    expectedSkillNames: manifest.skills,
    expectedDigests,
  }).gate,
  'baseline_skill_contamination',
);

const trialLock = {
  trials: [{
    skills: goodLocks,
  }],
};
assert.deepEqual(parseAgentSkillLocks(trialLock).length, goodLocks.length);

const archived = stageSkillBundle(root, { pinnedCommit: PINNED_SKILL_COMMIT, write: false });
assert.equal(archived.manifest.source_skill_commit, PINNED_SKILL_COMMIT);
assert.doesNotThrow(() => stageSkillBundle(root, { pinnedCommit: PINNED_SKILL_COMMIT, write: false }));

const skillFile = path.join(root, 'skills/lamina/SKILL.md');
const originalSkill = fs.readFileSync(skillFile);
fs.appendFileSync(skillFile, '\n# tamper\n');
try {
  assert.throws(
    () => stageSkillBundleFromWorkingTree(root, { pinnedCommit: PINNED_SKILL_COMMIT, write: false }),
    /working-tree skill bytes differ/,
  );
} finally {
  fs.writeFileSync(skillFile, originalSkill);
}

assert.equal(
  classifyFromJobEvidence({
    measurementValid: false,
    skillEvidence: { passed: false, gate: 'skill_injection_missing' },
  }).failFast,
  true,
);
assert.equal(
  classifyFromJobEvidence({
    state: 'completed',
    measurementValid: true,
    skillEvidence: { passed: true },
    stepExceptions: [{ message: 'provider resource_exhausted after reconnect' }],
  }).state,
  'rate_limit_failure',
);
assert.equal(
  classifyCellFailure(
    { stdout: '', stderr: '', exitCode: 0 },
    {
      extractedCell: {
        state: 'completed',
        measurementValid: true,
        skillEvidence: { passed: true },
        stepExceptions: [{ message: 'resource_exhausted' }],
      },
    },
  ).failFast,
  true,
);

const cells = [
  { taskId: 'dev-loan-library', arm: 'lamina' },
  { taskId: 'dev-loan-library', arm: 'direct' },
];
const split = splitCampaignCells(cells);
assert.equal(split.hasCanary, true);
assert.equal(split.remaining.length, 1);

console.log('lb6 skill lock and campaign fixup tests passed');
