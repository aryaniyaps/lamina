import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeBehavior, checkLaminaTreatment } from '../benchmarks/lib/behavior-grade.mjs';
import { buildActionSchema } from '../benchmarks/lib/action-schema.mjs';
import { runBehaviorSelfcheck } from '../benchmarks/lib/behavior-selfcheck.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusManifest = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/corpus/manifest.json'), 'utf8'));
const pilotManifest = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/lb6/pilot/corpus/manifest.json'), 'utf8'));

assert.equal(corpusManifest.version, 'harbor-v4');

const skillsManifest = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/corpus/lamina-bench-skills.json'), 'utf8'));
assert.ok(skillsManifest.skills.length <= 40, 'bench skill allowlist should stay focused on loop + risk capabilities');
assert.ok(skillsManifest.skills.includes('lamina-accessibility'));
assert.ok(skillsManifest.skills.includes('lamina-trust'));
assert.ok(skillsManifest.skills.includes('lamina-consistency-guarantees'));
assert.ok(!skillsManifest.skills.includes('lamina-competitive-analysis'));

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

function writeVerifyAudit(runDir, { status = 'complete' } = {}) {
  const walkDir = path.join(runDir, 'walkthrough');
  fs.mkdirSync(path.join(walkDir, 'steps'), { recursive: true });
  fs.writeFileSync(
    path.join(walkDir, 'index.yaml'),
    ['mode: live_app', 'source: product', 'steps:', '  - id: home', '    screenshot: steps/home.png', '    a11y: steps/home.a11y.json'].join('\n') + '\n'
  );
  fs.writeFileSync(path.join(walkDir, 'steps/home.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(walkDir, 'steps/home.a11y.json'), JSON.stringify({ role: 'main', name: 'Care circle' }));
  fs.writeFileSync(
    path.join(runDir, 'run.json'),
    JSON.stringify({
      status,
      persona_findings: [
        {
          id: 'pf-owner',
          persona_ref: 'persona.owner',
          classification: 'structural_defect',
          finding: 'owner cannot see escalation after miss',
          source: 'persona_hypothesis',
        },
        {
          id: 'pf-caregiver',
          persona_ref: 'persona.caregiver',
          classification: 'missing_recovery',
          finding: 'caregiver lacks recovery after revoke',
          source: 'persona_hypothesis',
        },
      ],
      evidence: [{ kind: 'visual_walkthrough', path: 'walkthrough/index.yaml' }],
      findings: [],
    })
  );
}

const laminaRoot = path.join(tmp, 'lamina-valid', '.lamina');
fs.mkdirSync(path.join(laminaRoot, 'runs/run-1'), { recursive: true });
fs.writeFileSync(path.join(laminaRoot, 'business-context.md'), '# charter');
fs.writeFileSync(path.join(laminaRoot, 'personas.json'), '{"contract_version":"2.0","personas":[]}');
fs.writeFileSync(path.join(laminaRoot, 'runs/run-1/fix.md'), '# fix');
fs.writeFileSync(path.join(laminaRoot, 'runs/run-1/report.md'), '# report');
writeVerifyAudit(path.join(laminaRoot, 'runs/run-1'), { status: 'complete' });
writeApp(path.join(tmp, 'lamina-valid'), goodApp);
let treatment = checkLaminaTreatment(path.join(tmp, 'lamina-valid'), 'fix');
assert.equal(treatment.valid, true);
let laminaGood = await gradeBehavior({ root: path.join(tmp, 'lamina-valid'), golden: simpleList.golden, arm: 'lamina', phase: 'fix', taskId: 'dev-simple-list' });
assert.equal(laminaGood.reward, PERFECT_REWARD);
assert.equal(laminaGood.invalid_treatment, false);

const noAuditRoot = path.join(tmp, 'lamina-no-audit', '.lamina');
fs.mkdirSync(path.join(noAuditRoot, 'runs/run-1'), { recursive: true });
fs.writeFileSync(path.join(noAuditRoot, 'business-context.md'), '# charter');
fs.writeFileSync(path.join(noAuditRoot, 'personas.json'), '{"contract_version":"2.0","personas":[]}');
fs.writeFileSync(path.join(noAuditRoot, 'runs/run-1/run.json'), JSON.stringify({ status: 'complete', persona_findings: [] }));
fs.writeFileSync(path.join(noAuditRoot, 'runs/run-1/fix.md'), '# fix');
fs.writeFileSync(path.join(noAuditRoot, 'runs/run-1/report.md'), '# report');
writeApp(path.join(tmp, 'lamina-no-audit'), goodApp);
let noAudit = checkLaminaTreatment(path.join(tmp, 'lamina-no-audit'), 'lamina_verify');
assert.equal(noAudit.valid, false);
assert.ok(noAudit.missing.some((m) => /walkthrough|persona_findings/i.test(m)));
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

let initOnly = checkLaminaTreatment(path.join(tmp, 'lamina-valid'), 'lamina_init');
assert.equal(initOnly.valid, true);
fs.rmSync(path.join(tmp, 'lamina-valid', '.lamina', 'runs'), { recursive: true, force: true });
let designGate = checkLaminaTreatment(path.join(tmp, 'lamina-valid'), 'lamina_design');
assert.equal(designGate.valid, false);

const relaxedRoot = path.join(tmp, 'lamina-relaxed', '.lamina');
fs.mkdirSync(path.join(relaxedRoot, 'runs/run-1'), { recursive: true });
fs.writeFileSync(path.join(relaxedRoot, 'business-context.md'), '# charter');
fs.writeFileSync(path.join(relaxedRoot, 'personas.json'), '{"contract_version":"2.0","personas":[]}');
fs.writeFileSync(path.join(relaxedRoot, 'runs/run-1/fix.md'), '# fix');
fs.writeFileSync(path.join(relaxedRoot, 'runs/run-1/report.md'), '# report');
writeVerifyAudit(path.join(relaxedRoot, 'runs/run-1'), { status: 'ready_to_build' });
let relaxed = checkLaminaTreatment(path.join(tmp, 'lamina-relaxed'), 'fix');
assert.equal(relaxed.valid, true);

console.log('Behavior benchmark test passed: corpus allowlist, ABC attacks, treatment gates, and LB6 verifier hygiene.');
