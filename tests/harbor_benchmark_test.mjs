import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeBehavior, checkLaminaTreatment } from '../benchmarks/lib/behavior-grade.mjs';
import { buildActionSchema } from '../benchmarks/lib/action-schema.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/corpus/manifest.json'), 'utf8'));

assert.equal(manifest.version, 'harbor-v4');
assert.deepEqual(manifest.pilot.tasks, ['pilot-care-circle', 'control-simple-list']);
assert.equal(manifest.pilot.attempts_per_arm, 2);
assert.equal(manifest.pilot.model, 'sonnet');

const skillsManifest = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/corpus/lamina-bench-skills.json'), 'utf8'));
assert.ok(skillsManifest.skills.length <= 40, 'bench skill allowlist should stay focused on loop + risk capabilities');
assert.ok(skillsManifest.skills.includes('lamina-accessibility'));
assert.ok(skillsManifest.skills.includes('lamina-trust'));
assert.ok(skillsManifest.skills.includes('lamina-consistency-guarantees'));
assert.ok(!skillsManifest.skills.includes('lamina-competitive-analysis'));

const taskRoot = path.join(root, 'benchmarks/harbor/tasks');
const laminaSteps = ['lamina_init', 'lamina_design', 'implement', 'lamina_verify', 'fix'];

for (const task of manifest.tasks) {
  for (const arm of manifest.arms) {
    const dir = path.join(taskRoot, task.id + '-' + arm);
    if (arm === 'lamina') {
      for (const step of laminaSteps) {
        assert.ok(fs.existsSync(path.join(dir, 'steps', step, 'instruction.md')), `${task.id}-${arm}: missing ${step}`);
      }
      const init = fs.readFileSync(path.join(dir, 'steps/lamina_init/instruction.md'), 'utf8');
      assert.match(init, /\/lamina-init/);
      assert.match(init, /Lamina bench profile/);
      assert.match(init, new RegExp(task.stage));
      const design = fs.readFileSync(path.join(dir, 'steps/lamina_design/instruction.md'), 'utf8');
      assert.match(design, /\/lamina-design/);
      assert.match(design, /persona-panel/);
      assert.doesNotMatch(design, /≤2 workflows|≤4 proofs|≤3 operations/);
      assert.doesNotMatch(design, /not `harden`/);
      const verify = fs.readFileSync(path.join(dir, 'steps/lamina_verify/instruction.md'), 'utf8');
      assert.match(verify, /\/lamina-verify/);
      assert.doesNotMatch(verify, /\(static-only\)|Verify:\s*\*\*static-only\*\*/i);
      assert.match(verify, /persona-panel/);
      assert.match(verify, /walkthrough/);
      assert.match(verify, /agent owns spawning|does not spawn reviewers/i);
      const implement = fs.readFileSync(path.join(dir, 'steps/implement/instruction.md'), 'utf8');
      assert.match(implement, /implement\.md/);
      assert.match(implement, /selfcheck\.mjs/);
      assert.match(implement, /may Read/i);
      assert.doesNotMatch(implement, /\/lamina-init/);
      assert.ok(fs.existsSync(path.join(dir, 'steps/implement/tests/selfcheck.mjs')));
    } else {
      assert.ok(fs.existsSync(path.join(dir, 'steps/shape_build/instruction.md')));
      assert.match(
        fs.readFileSync(path.join(dir, 'steps/shape_build/instruction.md'), 'utf8'),
        /selfcheck\.mjs/
      );
    }
    const finalStep = arm === 'lamina' ? 'fix' : 'verify_fix';
    assert.ok(fs.existsSync(path.join(dir, 'steps', finalStep, 'tests/grade.mjs')));
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'task.toml'), 'utf8'), /claude|sonnet|treatment/i);
  }
}

const careCircle = manifest.tasks.find((task) => task.id === 'pilot-care-circle');
const schema = buildActionSchema(careCircle.golden);
assert.match(schema, /add_task/);
assert.match(schema, /revoke_caregiver/);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-bench-'));

function writeApp(dir, body) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.mjs'), body);
}

// noop attack
writeApp(path.join(tmp, 'noop'), 'export function createInitialState(){return{}} export function reduce(s){return s} export function project(){return{}}');
let noop = await gradeBehavior({ root: path.join(tmp, 'noop'), golden: careCircle.golden, arm: 'direct', phase: 'verify_fix', taskId: 'pilot-care-circle' });
assert.equal(noop.reward, 0);

// keyword stuffing without domain state (should not pass behavior sequences)
writeApp(
  path.join(tmp, 'keywords'),
  `export function createInitialState(){return{}}
export function reduce(s,a){return s}
export function project(){return{persona:'x',assumption:'y',edge:'z',recovery:'r',invariant:'i',state:'s'}}`
);
let keywords = await gradeBehavior({ root: path.join(tmp, 'keywords'), golden: careCircle.golden, arm: 'direct', phase: 'verify_fix', taskId: 'pilot-care-circle' });
assert.equal(keywords.reward, 0);

// static projection with keyword blob (must not pass)
writeApp(
  path.join(tmp, 'static-projection'),
  `export function createInitialState(){return{}}
export function reduce(s,a){return s}
export function project(){
  return {'med-1':'escalat missed done',private:'private note',denied:'revoked',revok:true};
}`
);
let staticProjection = await gradeBehavior({
  root: path.join(tmp, 'static-projection'),
  golden: careCircle.golden,
  arm: 'direct',
  phase: 'verify_fix',
  taskId: 'pilot-care-circle',
});
assert.equal(staticProjection.reward, 0);

// passing reference implementation
writeApp(
  path.join(tmp, 'good'),
  `export function createInitialState(){return{tasks:{},notes:[],revoked:[]}}
export function reduce(state,action){
  const s=structuredClone(state);
  if(action.type==='add_task'){s.tasks[action.id]={id:action.id,title:action.title,status:'open'};return s}
  if(action.type==='mark_missed'){if(s.tasks[action.id]) s.tasks[action.id].status='missed_escalated';return s}
  if(action.type==='complete_task'){if(s.tasks[action.id]) s.tasks[action.id].status='done';return s}
  if(action.type==='add_note'){s.notes.push({id:action.id,text:action.text,visibility:'private note'});return s}
  if(action.type==='revoke_caregiver'){s.revoked.push(action.actor);return s}
  return s;
}
export function project(state,actor){
  if(state.revoked.includes(actor)) return {denied:'revoked',access:false};
  return {tasks:state.tasks,notes:state.notes,private:'private note'};
}`
);
let good = await gradeBehavior({ root: path.join(tmp, 'good'), golden: careCircle.golden, arm: 'direct', phase: 'verify_fix', taskId: 'pilot-care-circle' });
assert.equal(good.reward, 1);

// lamina treatment gate: missing artifacts invalidates reward
let gated = await gradeBehavior({ root: path.join(tmp, 'good'), golden: careCircle.golden, arm: 'lamina', phase: 'fix', taskId: 'pilot-care-circle' });
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

// valid lamina treatment fixture
const laminaRoot = path.join(tmp, 'lamina-valid', '.lamina');
fs.mkdirSync(path.join(laminaRoot, 'runs/run-1'), { recursive: true });
fs.writeFileSync(path.join(laminaRoot, 'business-context.md'), '# charter');
fs.writeFileSync(path.join(laminaRoot, 'personas.json'), '{"contract_version":"2.0","personas":[]}');
fs.writeFileSync(path.join(laminaRoot, 'runs/run-1/fix.md'), '# fix');
fs.writeFileSync(path.join(laminaRoot, 'runs/run-1/report.md'), '# report');
writeVerifyAudit(path.join(laminaRoot, 'runs/run-1'), { status: 'complete' });
writeApp(path.join(tmp, 'lamina-valid'), fs.readFileSync(path.join(tmp, 'good', 'app.mjs'), 'utf8'));
let treatment = checkLaminaTreatment(path.join(tmp, 'lamina-valid'), 'fix');
assert.equal(treatment.valid, true);
let laminaGood = await gradeBehavior({ root: path.join(tmp, 'lamina-valid'), golden: careCircle.golden, arm: 'lamina', phase: 'fix', taskId: 'pilot-care-circle' });
assert.equal(laminaGood.reward, 1);
assert.equal(laminaGood.invalid_treatment, false);

// missing persona/UI audit invalidates verify treatment
const noAuditRoot = path.join(tmp, 'lamina-no-audit', '.lamina');
fs.mkdirSync(path.join(noAuditRoot, 'runs/run-1'), { recursive: true });
fs.writeFileSync(path.join(noAuditRoot, 'business-context.md'), '# charter');
fs.writeFileSync(path.join(noAuditRoot, 'personas.json'), '{"contract_version":"2.0","personas":[]}');
fs.writeFileSync(path.join(noAuditRoot, 'runs/run-1/run.json'), JSON.stringify({ status: 'complete', persona_findings: [] }));
fs.writeFileSync(path.join(noAuditRoot, 'runs/run-1/fix.md'), '# fix');
fs.writeFileSync(path.join(noAuditRoot, 'runs/run-1/report.md'), '# report');
writeApp(path.join(tmp, 'lamina-no-audit'), fs.readFileSync(path.join(tmp, 'good', 'app.mjs'), 'utf8'));
let noAudit = checkLaminaTreatment(path.join(tmp, 'lamina-no-audit'), 'lamina_verify');
assert.equal(noAudit.valid, false);
assert.ok(noAudit.missing.some((m) => /walkthrough|persona_findings/i.test(m)));
let noAuditGrade = await gradeBehavior({
  root: path.join(tmp, 'lamina-no-audit'),
  golden: careCircle.golden,
  arm: 'lamina',
  phase: 'fix',
  taskId: 'pilot-care-circle',
});
assert.equal(noAuditGrade.reward, 0);
assert.equal(noAuditGrade.invalid_treatment, true);

// structural self-check rejects no-op reduce without leaking golden expects
import { runBehaviorSelfcheck } from '../benchmarks/lib/behavior-selfcheck.mjs';
let noopSelf = await runBehaviorSelfcheck({ root: path.join(tmp, 'noop'), golden: careCircle.golden });
assert.equal(noopSelf.ok, false);
assert.ok(noopSelf.errors.some((e) => /no-op|mutate/i.test(e)));
let goodSelf = await runBehaviorSelfcheck({ root: path.join(tmp, 'good'), golden: careCircle.golden });
assert.equal(goodSelf.ok, true);
assert.ok(!JSON.stringify(goodSelf).includes('escalat'));

// agent-facing selfcheck source must not embed graded expects
const builtSelfcheck = fs.readFileSync(
  path.join(taskRoot, 'pilot-care-circle-lamina/steps/implement/tests/selfcheck.mjs'),
  'utf8'
);
assert.doesNotMatch(builtSelfcheck, /"expect"|must_not_include|escalat/);
const builtGrade = fs.readFileSync(
  path.join(taskRoot, 'pilot-care-circle-lamina/steps/fix/tests/grade.mjs'),
  'utf8'
);
assert.doesNotMatch(builtGrade, /"expect"|must_not_include|"escalat"/);
assert.match(builtGrade, /base64/);

// phased treatment gates
let initOnly = checkLaminaTreatment(path.join(tmp, 'lamina-valid'), 'lamina_init');
assert.equal(initOnly.valid, true);
fs.rmSync(path.join(tmp, 'lamina-valid', '.lamina', 'runs'), { recursive: true, force: true });
let designGate = checkLaminaTreatment(path.join(tmp, 'lamina-valid'), 'lamina_design');
assert.equal(designGate.valid, false);

// verify outputs without status bump still count as valid treatment on fix when audit artifacts exist
const relaxedRoot = path.join(tmp, 'lamina-relaxed', '.lamina');
fs.mkdirSync(path.join(relaxedRoot, 'runs/run-1'), { recursive: true });
fs.writeFileSync(path.join(relaxedRoot, 'business-context.md'), '# charter');
fs.writeFileSync(path.join(relaxedRoot, 'personas.json'), '{"contract_version":"2.0","personas":[]}');
fs.writeFileSync(path.join(relaxedRoot, 'runs/run-1/fix.md'), '# fix');
fs.writeFileSync(path.join(relaxedRoot, 'runs/run-1/report.md'), '# report');
writeVerifyAudit(path.join(relaxedRoot, 'runs/run-1'), { status: 'ready_to_build' });
let relaxed = checkLaminaTreatment(path.join(tmp, 'lamina-relaxed'), 'fix');
assert.equal(relaxed.valid, true);

// matched agent budget in generated tasks
for (const arm of manifest.arms) {
  const toml = fs.readFileSync(path.join(taskRoot, `${manifest.pilot.tasks[0]}-${arm}`, 'task.toml'), 'utf8');
  assert.match(toml, /timeout_sec = 4200\.0/);
}

console.log('Harbor v4 benchmark test passed: structure, ABC attacks, and treatment gates.');
