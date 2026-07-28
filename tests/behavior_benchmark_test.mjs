import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradePilotBehavior as gradeBehavior } from '../benchmarks/lb6/pilot/lib/pilot-behavior-grade.mjs';
import { checkPilotLaminaTreatment as checkLaminaTreatment } from '../benchmarks/lb6/pilot/lib/pilot-treatment.mjs';
import { buildActionSchema } from '../benchmarks/lib/action-schema.mjs';
import { runBehaviorSelfcheck } from '../benchmarks/lib/behavior-selfcheck.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusManifest = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/corpus/manifest.json'), 'utf8'));
const pilotManifest = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/lb6/pilot/corpus/manifest.json'), 'utf8'));

assert.equal(corpusManifest.version, 'harbor-v4');

const currentSkillManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'benchmarks/lb6/pilot/skill-bundle/manifest-v3.json'), 'utf8'),
);
assert.equal(currentSkillManifest.skills.length, 59);
assert.ok(currentSkillManifest.skills.includes('lamina'));
assert.equal(currentSkillManifest.skills.filter((name) => name.startsWith('lamina-')).length, 58);
assert.equal('contained_module_count' in currentSkillManifest, false);

const lb6TaskRoot = path.join(root, 'benchmarks/lb6/pilot/harbor/tasks-v3/dev-loan-library-lamina-v3');
const simpleList = pilotManifest.tasks.find((task) => task.id === 'dev-simple-list');
const schema = buildActionSchema(simpleList.golden);
assert.match(schema, /add_item/);
assert.match(schema, /complete_item/);

const PERFECT_REWARD = Number(((10 + 1) / (10 + 2)).toFixed(4));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-bench-'));

function writeApp(dir, body) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.mjs'), body);
}

const goodApp = `export function createInitialState(){return{items:{}}}
export function reduce(state,action){
  const s=structuredClone(state);
  if(action.type==='add_item'){s.items[action.id]={id:action.id,title:action.title,completed:false,status:'open'};return s}
  if(action.type==='complete_item'){if(s.items[action.id]){s.items[action.id].completed=true;s.items[action.id].status='completed'};return s}
  if(action.type==='clear_completed'){for(const [id,it] of Object.entries(s.items)){if(it.completed) delete s.items[id]};return s}
  return s;
}
export function project(state,actor){return{items:state.items}}`;

writeApp(path.join(tmp, 'noop'), 'export function createInitialState(){return{}} export function reduce(s){return s} export function project(){return{}}');
let noop = await gradeBehavior({ root: path.join(tmp, 'noop'), golden: simpleList.golden, arm: 'direct', phase: 'verify_fix', taskId: 'dev-simple-list' });
assert.ok(noop.reward < PERFECT_REWARD);
assert.ok(noop.scores.raw_behavior <= 0.1);

writeApp(
  path.join(tmp, 'keywords'),
  `export function createInitialState(){return{}}
export function reduce(s,a){return s}
export function project(){return{persona:'x',assumption:'y',edge:'z',recovery:'r',invariant:'i',state:'s'}}`
);
let keywords = await gradeBehavior({ root: path.join(tmp, 'keywords'), golden: simpleList.golden, arm: 'direct', phase: 'verify_fix', taskId: 'dev-simple-list' });
assert.ok(keywords.reward < PERFECT_REWARD);
assert.ok(keywords.scores.raw_behavior <= 0.1);

writeApp(
  path.join(tmp, 'static-projection'),
  `export function createInitialState(){return{}}
export function reduce(s,a){return s}
export function project(){
  return {'item-1':'completed done',items:{},completed:true};
}`
);
let staticProjection = await gradeBehavior({
  root: path.join(tmp, 'static-projection'),
  golden: simpleList.golden,
  arm: 'direct',
  phase: 'verify_fix',
  taskId: 'dev-simple-list',
});
assert.ok(staticProjection.reward < PERFECT_REWARD);
assert.ok(staticProjection.scores.raw_behavior <= 0.1);

writeApp(path.join(tmp, 'good'), goodApp);
let good = await gradeBehavior({ root: path.join(tmp, 'good'), golden: simpleList.golden, arm: 'direct', phase: 'verify_fix', taskId: 'dev-simple-list' });
assert.equal(good.reward, PERFECT_REWARD);

let gated = await gradeBehavior({ root: path.join(tmp, 'good'), golden: simpleList.golden, arm: 'lamina', phase: 'fix', taskId: 'dev-simple-list' });
assert.equal(gated.reward, 0);
assert.equal(gated.invalid_treatment, true);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function backupIntegrity(body) {
  return `backup_${crypto.createHash('sha256')
    .update(JSON.stringify(canonical(body)))
    .digest('hex')
    .slice(0, 32)}`;
}

function writeGraphEvidence(rootDir, { phase = 'design', omitKind = null, legacyRuns = false } = {}) {
  const laminaRoot = path.join(rootDir, '.lamina');
  fs.mkdirSync(path.join(laminaRoot, 'benchmark'), { recursive: true });
  fs.mkdirSync(path.join(laminaRoot, 'projections'), { recursive: true });
  fs.writeFileSync(path.join(laminaRoot, 'business-context.md'), '# Product evidence\n');
  fs.writeFileSync(path.join(laminaRoot, 'personas.json'), JSON.stringify({
    contract_version: '2.0',
    personas: [{ id: 'owner' }, { id: 'caregiver' }],
  }));
  if (legacyRuns) fs.mkdirSync(path.join(laminaRoot, 'runs/legacy'), { recursive: true });

  const requiredKinds = phase === 'init'
    ? ['product', 'persona', 'persona', 'actor']
    : [
        'product', 'persona', 'persona', 'actor',
        'workflow', 'operation', 'invariant', 'scenario', 'proof', 'mission',
      ];
  const resources = requiredKinds
    .filter((kind) => kind !== omitKind)
    .map((kind, index) => ({
      id: `res_${kind}_${index}`,
      kind,
      data: { epistemic_class: kind === 'proof' ? 'runtime_evidence' : 'inferred' },
    }));
  const statements = phase === 'init' ? [] : [{
    id: 'stmt_workflow_step',
    subject: resources.find((item) => item.kind === 'workflow')?.id,
    predicate: 'lamina:hasStep',
    object: resources.find((item) => item.kind === 'operation')?.id,
    literal: null,
    qualifiers: { position: 1, epistemic_class: 'inferred' },
    evidence: [],
    generated_by: [],
  }].filter((item) => item.subject && item.object);
  const graphVersion = phase === 'init' ? 'version_init' : 'version_design';
  const sourceRevision = phase === 'init' ? 'source_init' : 'source_design';
  const body = {
    format: 'lamina-graph-backup-v1',
    resources,
    aliases: [],
    statements,
    versions: [{
      id: graphVersion,
      source_revision: sourceRevision,
      receipt: {
        validation: { ok: true, errors: [], contradictions: [] },
        active_resources: resources.map((item) => item.id),
        active_statements: statements.map((item) => item.id),
      },
      parents: [],
      add_resources: resources.map((item) => item.id),
      add_statements: statements.map((item) => item.id),
      retire_resources: [],
      retire_statements: [],
    }],
    views: [{
      id: 'branch:main',
      kind: 'branch',
      name: 'main',
      status: 'active',
      head: graphVersion,
      base: null,
      resources: resources.map((item) => item.id),
      statements: statements.map((item) => item.id),
      pending_evidence: [],
    }],
  };
  const file = path.join(
    laminaRoot,
    'benchmark',
    phase === 'init' ? 'init-graph.json' : 'design-graph.json',
  );
  fs.writeFileSync(file, `${JSON.stringify({ ...body, integrity: backupIntegrity(body) }, null, 2)}\n`);
  if (phase !== 'init') {
    fs.writeFileSync(
      path.join(laminaRoot, 'projections/implement.md'),
      `# Implementation projection\n\nGraphVersion: ${graphVersion}\nSource revision: ${sourceRevision}\n`,
    );
  }
}

writeGraphEvidence(path.join(tmp, 'lamina-valid'), { phase: 'design' });
writeApp(path.join(tmp, 'lamina-valid'), goodApp);
let treatment = checkLaminaTreatment(path.join(tmp, 'lamina-valid'), 'fix');
assert.equal(treatment.valid, true);
let laminaGood = await gradeBehavior({ root: path.join(tmp, 'lamina-valid'), golden: simpleList.golden, arm: 'lamina', phase: 'fix', taskId: 'dev-simple-list' });
assert.equal(laminaGood.reward, PERFECT_REWARD);
assert.equal(laminaGood.invalid_treatment, false);

writeGraphEvidence(path.join(tmp, 'lamina-no-audit'), { phase: 'design', omitKind: 'mission' });
writeApp(path.join(tmp, 'lamina-no-audit'), goodApp);
let noAudit = checkLaminaTreatment(path.join(tmp, 'lamina-no-audit'), 'lamina_verify');
assert.equal(noAudit.valid, false);
assert.ok(noAudit.missing.some((m) => /mission/i.test(m)));
let noAuditGrade = await gradeBehavior({
  root: path.join(tmp, 'lamina-no-audit'),
  golden: simpleList.golden,
  arm: 'lamina',
  phase: 'fix',
  taskId: 'dev-simple-list',
});
assert.equal(noAuditGrade.reward, 0);
assert.equal(noAuditGrade.invalid_treatment, true);

let noopSelf = await runBehaviorSelfcheck({ root: path.join(tmp, 'noop'), golden: simpleList.golden });
assert.equal(noopSelf.ok, false);
assert.ok(noopSelf.errors.some((e) => /no-op|mutate/i.test(e)));
let goodSelf = await runBehaviorSelfcheck({ root: path.join(tmp, 'good'), golden: simpleList.golden });
assert.equal(goodSelf.ok, true);
assert.ok(!JSON.stringify(goodSelf).includes('Buy milk'));

const builtSelfcheckEntry = fs.readFileSync(
  path.join(lb6TaskRoot, 'steps/implement/workdir/.lb6-abi/selfcheck.mjs'),
  'utf8'
);
assert.doesNotMatch(builtSelfcheckEntry, /"expect"\s*:|must_not_include|"criteria"\s*:/);
const publicAbi = fs.readFileSync(
  path.join(lb6TaskRoot, 'steps/implement/workdir/.lb6-abi/public-abi.json'),
  'utf8'
);
assert.doesNotMatch(publicAbi, /"expect"\s*:|must_not_include|"criteria"\s*:/);

writeGraphEvidence(path.join(tmp, 'lamina-init-valid'), { phase: 'init' });
let initOnly = checkLaminaTreatment(path.join(tmp, 'lamina-init-valid'), 'lamina_init');
assert.equal(initOnly.valid, true);
let designGate = checkLaminaTreatment(path.join(tmp, 'lamina-init-valid'), 'lamina_design');
assert.equal(designGate.valid, false);

writeGraphEvidence(path.join(tmp, 'lamina-legacy-run'), { phase: 'design', legacyRuns: true });
let legacyRun = checkLaminaTreatment(path.join(tmp, 'lamina-legacy-run'), 'fix');
assert.equal(legacyRun.valid, false);
assert.ok(legacyRun.missing.some((item) => item.includes('.lamina/runs')));

console.log('Behavior benchmark test passed: complete skill-set allowlist, ABC attacks, graph treatment gates, and verifier hygiene.');
