import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  AUDITED_DISCOVERY_IDENTITIES, SCENARIO_SELECTION_CANONICAL_SHA256,
  SCENARIO_SELECTION_KINDS, SCENARIO_SELECTION_RAW_SHA256, SCENARIO_SELECTION_STATUS,
  loadScenarioSelection, parseScenarioSelectionBytes, scenarioSelectionCanonicalDigest,
  scenarioSelectionIdentity, validateScenarioSelection,
} from '../benchmarks/real-repository-oracle-v1/scenario-selection.mjs';

const FILE = new URL('../benchmarks/real-repository-oracle-v1/reviews/scenario-selection-v1.json', import.meta.url);
const bytes = fs.readFileSync(FILE);
const loaded = loadScenarioSelection();
const selection = loaded.selection;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const PREVIOUS_PENDING_RAW_SHA256 = 'f0c5e0bf3105566e714ceba48d234b2d2b183c588fcdaec8377baf6909ae287e';
const PREVIOUS_PENDING_CANONICAL_SHA256 = 'd948112e0ba27e0edca29c258b69597bd56e8e8a02c96c611b8607defd666438';
const PREVIOUS_PENDING_PURPOSE = 'reviewer_selection_pending_selection_only_no_execution_fixture_expectation_grade_or_quality_authority';
const rebind = (tier, scenario) => {
  scenario.identity_sha256 = scenarioSelectionIdentity(tier, scenario);
};

assert.equal(sha256(bytes), SCENARIO_SELECTION_RAW_SHA256);
assert.equal(scenarioSelectionCanonicalDigest(selection), SCENARIO_SELECTION_CANONICAL_SHA256);
assert.deepEqual(loaded, {
  selection,
  raw_sha256: SCENARIO_SELECTION_RAW_SHA256,
  canonical_sha256: SCENARIO_SELECTION_CANONICAL_SHA256,
});
assert.deepEqual(Object.keys(selection), ['schema', 'purpose', 'authority', 'bounds', 'tiers']);
assert.deepEqual(Object.keys(selection.tiers), ['small', 'medium', 'large']);
assert.match(selection.purpose, /reviewer_selected/);
assert.match(selection.purpose, /no_execution_fixture_expectation_grade_or_quality_authority/);
assert.equal(validateScenarioSelection(selection).valid, true);

const pendingBytes = Buffer.from(bytes.toString('utf8')
  .replace(selection.purpose, PREVIOUS_PENDING_PURPOSE)
  .replaceAll('"status": "reviewer_selected"', '"status": "reviewer_selection_pending"'));
const pendingSelection = JSON.parse(pendingBytes);
assert.equal(sha256(pendingBytes), PREVIOUS_PENDING_RAW_SHA256,
  'the selected raw artifact may differ from the reviewed pending artifact only in purpose/status');
assert.equal(scenarioSelectionCanonicalDigest(pendingSelection), PREVIOUS_PENDING_CANONICAL_SHA256,
  'the selected semantic artifact may differ from the reviewed pending artifact only in purpose/status');
for (const tier of ['small', 'medium', 'large']) {
  assert.deepEqual(selection.tiers[tier].pin, pendingSelection.tiers[tier].pin);
  assert.deepEqual(selection.tiers[tier].discovery, pendingSelection.tiers[tier].discovery);
  assert.equal(selection.tiers[tier].reviewed_inventory_sha256,
    pendingSelection.tiers[tier].reviewed_inventory_sha256);
  assert.deepEqual(selection.tiers[tier].scenarios, pendingSelection.tiers[tier].scenarios);
}

const expectedTuples = {
  small: [
    '0|clean|9506629ed003a561c6627735480cce4994244bb4',
    '1|modify|apps/nextjs-app/.storybook/preview.tsx|9d181d43cce5b51b538d452653ec42fb4d8c7bd3|28|218|87e1f3026c0df28243b0b7ddf5f01b54cb468eb9addc8fe97649097a1ee7f85c',
    '2|rename|.github/workflows/nextjs-app-ci.yml|3d641fca6655dfd7c84c89393cd4bb0ed342f0f6|lamina-oracle-rename-7604c69c4e3d.yml|535|751',
    '3|delete|apps/nextjs-app/.vscode/extensions.json|1cd1faf73b1cdd9f35f3d9c3d0178971cd6ebb9e',
    '4|branch|apps/nextjs-app/README.md|8000580d48dc839746f45c773264ebc2c608f81d|8ff0401ab8ba|lamina-oracle/8ff0401ab8ba',
    '5|logical_worktree|apps/nextjs-app/README.md|8000580d48dc839746f45c773264ebc2c608f81d|8ff0401ab8ba|oracle-worktree-8ff0401ab8ba|lamina-oracle/worktree-8ff0401ab8ba',
  ],
  medium: [
    '0|clean|30730179b852d42da5078a9294f7d05a44f516b7',
    '1|modify|.github/actions/install/action.yml|3cd311d5015c6fde715deed942b74400f9dbaa24|27|439|802be5a90ac17567a6edbbe804beb63c2bc4609898f5807bb776fc4d061c1eac',
    '2|rename|.github/ISSUE_TEMPLATE/bug_report.yml|eedb16f6463ca5d2b7089a5c653b5bc507c68429|lamina-oracle-rename-635386adcc25.yml|2539|2888',
    '3|delete|.github/auto_assign.yml|d1bba1ba5db80c3d9cf0df6cf5ddfa503233eecf',
    '4|branch|.github/dependabot.yml|8f02575b7bc3ef455a3b5bfe0add12fb86213e17|2d9c3c1ed208|lamina-oracle/2d9c3c1ed208',
    '5|logical_worktree|.github/dependabot.yml|8f02575b7bc3ef455a3b5bfe0add12fb86213e17|2d9c3c1ed208|oracle-worktree-2d9c3c1ed208|lamina-oracle/worktree-2d9c3c1ed208',
  ],
  large: [
    '0|clean|dc9d80b2d2a499b967f0b541e083b283f463719f',
    '1|modify|apps/admin/app/(all)/(dashboard)/ai/form.tsx|affbda4808b24bf13fd502e65ffbe9f89554be33|28|4340|4249b6af4d8f2924aafc733aef1793c93ec577a39d95f4489df89c3f4c04d5d6',
    '2|rename|.github/ISSUE_TEMPLATE/--bug-report.yaml|277a3bdfa8999d263e1577fb6a625261773e0a80|lamina-oracle-rename-e45179571675.yaml|5405|6569',
    '3|delete|.github/workflows/build-branch.yml|8ad71e7d68ab8a369fdabc2f4ca1638dfb83054b',
    '4|branch|.github/workflows/copyright-check.yml|b406833a8277e8f0c716bd014ee8cdc3797829e4|4c959686de6e|lamina-oracle/4c959686de6e',
    '5|logical_worktree|.github/workflows/copyright-check.yml|b406833a8277e8f0c716bd014ee8cdc3797829e4|4c959686de6e|oracle-worktree-4c959686de6e|lamina-oracle/worktree-4c959686de6e',
  ],
};
const expectedProvenance = {
  small: [['delete', 0, 'modify'], ['rename', 0, 'rename'], ['delete', 1, 'delete'],
    ['branch', 0, 'branch'], ['logical_worktree', 0, 'logical_worktree']],
  medium: [['delete', 0, 'modify'], ['rename', 1, 'rename'], ['delete', 1, 'delete'],
    ['branch', 0, 'branch'], ['logical_worktree', 0, 'logical_worktree']],
  large: [['modify', 0, 'modify'], ['rename', 0, 'rename'], ['delete', 0, 'delete'],
    ['branch', 0, 'branch'], ['logical_worktree', 0, 'logical_worktree']],
};
const tuple = (scenario) => {
  const base = [scenario.order, scenario.kind];
  if (scenario.kind === 'clean') return [...base, scenario.source_commit].join('|');
  base.push(scenario.path, scenario.blob_oid);
  if (scenario.kind === 'modify') base.push(scenario.append_bytes, scenario.result_bytes, scenario.result_content_sha256);
  if (scenario.kind === 'rename') base.push(scenario.destination,
    scenario.destination_absence.tracked_path_count,
    scenario.destination_absence.occupied_destination_count);
  if (scenario.kind === 'branch') base.push(scenario.pair_id, scenario.branch);
  if (scenario.kind === 'logical_worktree') base.push(scenario.pair_id,
    scenario.logical_worktree_id, scenario.derived_branch);
  return base.join('|');
};

for (const tier of ['small', 'medium', 'large']) {
  const item = selection.tiers[tier];
  assert.equal(item.status, SCENARIO_SELECTION_STATUS);
  assert.deepEqual(item.discovery, AUDITED_DISCOVERY_IDENTITIES[tier]);
  assert.deepEqual(item.scenarios.map((scenario) => scenario.kind), SCENARIO_SELECTION_KINDS);
  assert.deepEqual(item.scenarios.map(tuple), expectedTuples[tier]);
  assert.deepEqual(item.scenarios.slice(1).map((scenario) => [
    scenario.discovery_operation_kind, scenario.discovery_index, scenario.authored_operation_kind,
  ]), expectedProvenance[tier]);
  assert.equal(new Set(item.scenarios.map((scenario) => scenario.identity_sha256)).size, 6);
  for (const scenario of item.scenarios) {
    assert.equal(scenario.identity_sha256, scenarioSelectionIdentity(tier, scenario));
    assert.equal('operations' in scenario, false);
  }
  const [clean, modify, rename, remove, branch, worktree] = item.scenarios;
  assert.notEqual(scenarioSelectionIdentity(tier, { ...clean, order: 1 }), clean.identity_sha256,
    'scenario identity must bind order');
  assert.equal(Buffer.byteLength(modify.append_utf8), modify.append_bytes);
  assert.equal(new Set([modify.path, rename.path, remove.path]).size, 3);
  assert.equal(branch.pair_id, worktree.pair_id);
  assert.equal(branch.path, worktree.path);
  assert.equal(branch.executed, false);
  assert.equal(worktree.executed, false);
  assert.notEqual(branch.branch, worktree.derived_branch);
}

assert.throws(() => parseScenarioSelectionBytes(Buffer.from(bytes.toString().replace(
  'reviewer_selected', 'reviewer_selection_pending'))), /reviewed source identity/);
assert.throws(() => parseScenarioSelectionBytes(Buffer.alloc(131_073), { requireReviewedBytes: false }),
  /reviewed source identity/);
assert.throws(() => parseScenarioSelectionBytes(Buffer.from([0xff]), { requireReviewedBytes: false }),
  /UTF-8 JSON/);

const semanticTamper = structuredClone(selection);
semanticTamper.tiers.small.pin.commit = '0'.repeat(40);
assert.equal(validateScenarioSelection(semanticTamper).valid, false);

const duplicate = structuredClone(selection);
duplicate.tiers.small.scenarios[1].identity_sha256 = duplicate.tiers.small.scenarios[0].identity_sha256;
assert.equal(validateScenarioSelection(duplicate).valid, false);

const sourceConflict = structuredClone(selection);
sourceConflict.tiers.small.scenarios[2].path = sourceConflict.tiers.small.scenarios[1].path;
rebind('small', sourceConflict.tiers.small.scenarios[2]);
assert.match(validateScenarioSelection(sourceConflict).errors.join('; '), /distinct sources/);

for (const unsafe of [
  '../outside', '.git/config', '.GiT/config', 'GIT~1/config', 'con/file',
  'safe\\unsafe', 'colon:file', 'trailing./file', 'fullwidth-\uff41/file', 'control\u0001/file',
]) {
  const changed = structuredClone(selection);
  changed.tiers.small.scenarios[1].path = unsafe;
  rebind('small', changed.tiers.small.scenarios[1]);
  assert.equal(validateScenarioSelection(changed).valid, false, `unsafe portable path accepted: ${JSON.stringify(unsafe)}`);
}

const casefoldConflict = structuredClone(selection);
casefoldConflict.tiers.small.scenarios[2].destination = 'APPS/NEXTJS-APP/.STORYBOOK/PREVIEW.TSX';
rebind('small', casefoldConflict.tiers.small.scenarios[2]);
assert.match(validateScenarioSelection(casefoldConflict).errors.join('; '), /portable normalization/);

for (const badRef of ['lamina-oracle/../escape', 'lamina-oracle/a.lock',
  'lamina-oracle/ABCDEF123456', 'lamina-oracle/8ff0401ab8ba@{1}']) {
  const changed = structuredClone(selection);
  changed.tiers.small.scenarios[4].branch = badRef;
  rebind('small', changed.tiers.small.scenarios[4]);
  assert.equal(validateScenarioSelection(changed).valid, false, `unsafe Git ref accepted: ${badRef}`);
}

const leakedAuthority = structuredClone(selection);
leakedAuthority.tiers.small.scenarios[0].expected = 'later-stage answer';
rebind('small', leakedAuthority.tiers.small.scenarios[0]);
assert.match(validateScenarioSelection(leakedAuthority).errors.join('; '), /later-stage or execution authority/);

const branchConflict = structuredClone(selection);
branchConflict.tiers.small.scenarios[5].derived_branch = branchConflict.tiers.small.scenarios[4].branch;
rebind('small', branchConflict.tiers.small.scenarios[5]);
assert.equal(validateScenarioSelection(branchConflict).valid, false);

const forbiddenKey = /^(?:argv|env|environment|expected|expectation|git_argv|gold|golden|grade|grader|lease|operation|operations|physical_path|quality|request|scenario_after)$/i;
const walk = (value) => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(forbiddenKey.test(key), false, `selection leaks forbidden authority key: ${key}`);
    walk(child);
  }
};
walk(selection.tiers);

console.log('real repository oracle scenario-selection tests passed');
