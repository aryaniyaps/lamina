import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradePilotBehavior } from '../benchmarks/lb6/pilot/lib/pilot-behavior-grade.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'benchmarks/lb6/pilot/corpus/manifest.json'), 'utf8'),
);

function taskGolden(taskId) {
  const task = manifest.tasks.find((entry) => entry.id === taskId);
  assert.ok(task, `missing task ${taskId}`);
  return task.golden;
}

function writeApp(dir, body) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.mjs'), body);
}

const loanGood = `export function createInitialState(){return{loans:{}}}
export function reduce(state,action){
  const s=structuredClone(state);
  const loan=s.loans[action.id]||{id:action.id,status:'pending',confirmations:[],borrowerConfirmed:false,ownerConfirmed:false,damageReported:false,lendingPaused:false};
  if(action.type==='request_loan'){loan.item=action.item;loan.status='requested';s.loans[action.id]=loan;return s}
  if(action.type==='confirm_handoff'){loan.confirmations.push(action.actor);loan[action.actor+'Confirmed']=true;if(loan.confirmations.includes('borrower')&&loan.confirmations.includes('owner')) loan.status='active';s.loans[action.id]=loan;return s}
  if(action.type==='report_damage'){if(loan.status!=='active') return s;loan.status='dispute';loan.damageReported=true;loan.lendingPaused=true;s.loans[action.id]=loan;return s}
  return s;
}
export function project(state,actor){
  const loan=Object.values(state.loans)[0];
  if(!loan) return {status:'empty'};
  return {loans:Object.values(state.loans),loan,status:loan.status,confirm:loan.status.includes('confirm'),active:loan.status.includes('active'),dispute:loan.status.includes('dispute'),pause:loan.status.includes('pause')};
}`;

const reviewGood = `export function createInitialState(){return{invites:{},comments:[],deniedComments:[]}}
export function reduce(state,action){
  const s=structuredClone(state);
  if(action.type==='invite'){s.invites[action.id]={id:action.id,document:action.document,status:'open'};return s}
  if(action.type==='accept_invite'){if(s.invites[action.id]) s.invites[action.id].accepted=action.email;return s}
  if(action.type==='add_comment'){
    const invite=Object.values(s.invites).find((entry)=>entry.status==='open'&&entry.accepted);
    if(!invite||invite.status!=='open'||!invite.accepted){
      s.deniedComments.push({id:action.id,text:action.text,denied:true});
      return s;
    }
    s.comments.push({id:action.id,text:action.text,inviteId:invite.id});return s;
  }
  if(action.type==='expire_invite'){if(s.invites[action.id]) s.invites[action.id].status='expired';return s}
  if(action.type==='revoke_invite'){if(s.invites[action.id]) s.invites[action.id].status='revoked';return s}
  return s;
}
export function project(state,actor){
  const invite=Object.values(state.invites)[0];
  if(!invite) return {access:'denied'};
  if(invite.status==='expired') return {status:'expired',access:'denied',deniedComments:state.deniedComments.map((c)=>c.id)};
  if(invite.status==='revoked') return {status:'revoked',access:'denied',deniedComments:state.deniedComments.map((c)=>c.id)};
  const comments=state.comments.map((c)=>({id:c.id,text:c.text}));
  return {invite,comments,access:'granted'};
}`;

const listGood = `export function createInitialState(){return{items:{}}}
export function reduce(state,action){
  const s=structuredClone(state);
  if(action.type==='add_item'){s.items[action.id]={id:action.id,title:action.title,status:'open'};return s}
  if(action.type==='complete_item'){if(s.items[action.id]) s.items[action.id].status='done';return s}
  if(action.type==='clear_completed'){for(const [id,item] of Object.entries(s.items)){if(item.status==='done') delete s.items[id]}return s}
  return s;
}
export function project(state,actor){return {items:state.items,summary:Object.values(state.items).map((item)=>item.id+' '+item.status).join(' ')};}`;

const listOrderBroken = `export function createInitialState(){return{items:{},pendingCompletions:[]}}
export function reduce(state,action){
  const s=structuredClone(state);
  if(action.type==='add_item'){s.items[action.id]={id:action.id,title:action.title,status:s.pendingCompletions.includes(action.id)?'completed':'open'};return s}
  if(action.type==='complete_item'){if(s.items[action.id]) s.items[action.id].status='completed';else s.pendingCompletions.push(action.id);return s}
  if(action.type==='clear_completed'){for(const [id,item] of Object.entries(s.items)){if(item.status==='completed') delete s.items[id]}return s}
  return s;
}
export function project(state){return {items:state.items}}`;

const toggleGood = `export function createInitialState(){return{preferences:{},internalContext:{}}}
export function reduce(state,action){
  const s=structuredClone(state);
  if(action.type==='register_device_context'){
    s.internalContext=s.internalContext||{};
    s.internalContext[action.id]=action.contextToken;
    return s;
  }
  const pref=s.preferences[action.id]||{id:action.id,focus:false};
  if(action.type==='enable_focus_mode'){pref.focus=true;s.preferences[action.id]=pref;return s}
  if(action.type==='disable_focus_mode'){pref.focus=false;s.preferences[action.id]=pref;return s}
  if(action.type==='toggle_focus_mode'){pref.focus=!pref.focus;s.preferences[action.id]=pref;return s}
  return s;
}
export function project(state,actor){
  const pref=Object.values(state.preferences)[0];
  const preferences=Object.values(state.preferences).map((entry)=>({id:entry.id,focusEnabled:entry.focus}));
  if(!pref) return {preferences,focus:'off',mode:'idle',quiet:'',configured:false};
  return {
    preferences,
    focus:pref.focus?'on':'off',
    mode:pref.focus?'quiet focus on':'normal focus off',
    quiet:pref.focus?'quiet':'',
    configured:true,
    prefId:pref.id,
  };
}`;

const toggleKeywordOnly = `export function createInitialState(){return{}}
export function reduce(s,a){return s}
export function project(){return {focus:'on off',mode:'quiet normal focus off',quiet:'quiet'};}`;

const toggleUnconditional = `export function createInitialState(){return{preferences:{},internalContext:{}}}
export function reduce(state,action){
  const s=structuredClone(state);
  if(action.contextToken){
    s.internalContext[action.id]=action.contextToken;
    return s;
  }
  s.preferences[action.id||'pref-1']={id:action.id||'pref-1',focus:true};
  return s;
}
export function project(){return {focus:'on',mode:'quiet focus on',quiet:'quiet'};}`;

const toggleOneSided = `export function createInitialState(){return{preferences:{},internalContext:{}}}
export function reduce(state,action){
  const s=structuredClone(state);
  if(action.type==='register_device_context'){
    s.internalContext[action.id]=action.contextToken;
    return s;
  }
  const pref=s.preferences[action.id]||{id:action.id,focus:false};
  if(action.type==='enable_focus_mode'){pref.focus=true;s.preferences[action.id]=pref}
  return s;
}
export function project(state){
  const pref=Object.values(state.preferences)[0];
  return pref?{focus:pref.focus?'on':'off',mode:pref.focus?'quiet focus on':'normal focus off',quiet:pref.focus?'quiet':''}:{focus:'off',mode:'normal focus off'};
}`;

const toggleLeakage = `export function createInitialState(){return{preferences:{},internalContext:{}}}
export function reduce(state,action){
  const s=structuredClone(state);
  if(action.contextToken){
    s.internalContext[action.id]=action.contextToken;
    return s;
  }
  const pref=s.preferences[action.id]||{id:action.id,focus:false};
  if(action.type==='enable_focus_mode'){pref.focus=true;s.preferences[action.id]=pref;return s}
  if(action.type==='disable_focus_mode'){pref.focus=false;s.preferences[action.id]=pref;return s}
  if(action.type==='toggle_focus_mode'){pref.focus=!pref.focus;s.preferences[action.id]=pref;return s}
  return s;
}
export function project(state,actor){
  const pref=Object.values(state.preferences)[0];
  const preferences=Object.values(state.preferences).map((entry)=>({id:entry.id,focusEnabled:entry.focus}));
  const base=pref?{
    preferences,
    focus:pref.focus?'on':'off',
    mode:pref.focus?'quiet focus on':'normal focus off',
    quiet:pref.focus?'quiet':'',
    configured:true,
    prefId:pref.id,
  }:{preferences,focus:'off',mode:'normal focus off',quiet:'',configured:false};
  return {...base,rawState:state,internalSecret:state.internalContext};
}`;

const noop = `export function createInitialState(){return{}}
export function reduce(s){return s}
export function project(){return {}}`;

const wallClockList = `export function createInitialState(){return{items:{},createdAt:Date.now()}}
export function reduce(state,action){
  const s=structuredClone(state);s.touchedAt=Date.now();
  if(action.type==='add_item') s.items[action.id]={id:action.id,title:action.title,status:'open',at:Date.now()};
  if(action.type==='complete_item'&&s.items[action.id]) s.items[action.id].status='completed';
  return s;
}
export function project(state){return {items:state.items,projectedAt:Date.now()}}`;

const moduleLoadClockList = `const loadedAt=Date.now();\n${listGood.replace('return{items:{}}', 'return{items:{},loadedAt}')}`;
const bigIntToggle = toggleGood.replace(
  'return{preferences:{},internalContext:{}}',
  'return{preferences:{},internalContext:{},nonJson:1n}',
);
const loanUnconditionalDamage = loanGood.replace(
  "if(action.type==='report_damage'){if(loan.status!=='active') return s;loan.status='dispute';loan.damageReported=true;loan.lendingPaused=true;s.loans[action.id]=loan;return s}",
  "if(action.type==='report_damage'){loan.status='dispute';loan.damageReported=true;s.loans[action.id]=loan;return s}",
);

const loanKeywordOnly = `export function createInitialState(){return{}}
export function reduce(s,a){return s}
export function project(){return {status:'requested pending active confirmed dispute paused'};}`;

const reviewLeakage = `export function createInitialState(){return{}}
export function reduce(s,a){return s}
export function project(){
  return {
    status:'expired revoked denied access',
    comment:'should not appear after expiry should not appear after revocation looks good',
  };
}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb6-pilot-grader-'));

for (const [taskId, body] of [
  ['dev-loan-library', loanGood],
  ['dev-review-room', reviewGood],
  ['dev-simple-list', listGood],
  ['dev-toggle-preference', toggleGood],
]) {
  const dir = path.join(tmp, taskId, 'good');
  writeApp(dir, body);
  const result = await gradePilotBehavior({
    root: dir,
    golden: taskGolden(taskId),
    arm: 'direct',
    phase: 'verify_fix',
    taskId,
  });
  assert.equal(result.reward, 0.9167, `${taskId} reference reducer should reach the common smoothed ceiling`);
  assert.equal(result.raw_behavior, 1, `${taskId} reference reducer should earn all ten semantic points`);
}

for (const [taskId, body, label] of [
  [
    'dev-loan-library',
    loanGood
      .replace("loan.status='requested'", "loan.status='pending'")
      .replace("loan.status='dispute'", "loan.status='damage_review'")
      .replace('loan.lendingPaused=true', 'loan.canLend=false'),
    'typed-loan-aliases',
  ],
  [
    'dev-review-room',
    reviewGood.replaceAll("access:'denied'", 'access:false').replace("access:'granted'", 'access:true'),
    'boolean-access-aliases',
  ],
  ['dev-simple-list', listGood.replaceAll("'done'", "'completed'"), 'completed-status-alias'],
  ['dev-toggle-preference', toggleGood.replace('focusEnabled:entry.focus', "focusEnabled:entry.focus?'on':'off'"), 'string-toggle-alias'],
]) {
  const dir = path.join(tmp, taskId, label);
  writeApp(dir, body);
  const result = await gradePilotBehavior({
    root: dir,
    golden: taskGolden(taskId),
    arm: 'direct',
    phase: 'verify_fix',
    taskId,
  });
  assert.equal(result.reward, 0.9167, `${taskId} ${label} must equal the typed reference`);
  assert.equal(result.raw_behavior, 1);
}

for (const [taskId, body, label] of [
  ['dev-loan-library', noop, 'noop'],
  ['dev-loan-library', loanKeywordOnly, 'keyword-only'],
  ['dev-review-room', noop, 'noop'],
  ['dev-review-room', reviewLeakage, 'leakage'],
  ['dev-simple-list', noop, 'noop'],
  ['dev-toggle-preference', noop, 'noop'],
  ['dev-toggle-preference', toggleKeywordOnly, 'keyword-only'],
  ['dev-toggle-preference', toggleUnconditional, 'unconditional'],
  ['dev-toggle-preference', toggleLeakage, 'leaked-state'],
]) {
  const dir = path.join(tmp, taskId, label);
  writeApp(dir, body);
  const result = await gradePilotBehavior({
    root: dir,
    golden: taskGolden(taskId),
    arm: 'direct',
    phase: 'verify_fix',
    taskId,
  });
  if (taskId === 'dev-toggle-preference' && label === 'leaked-state') {
    assert.ok(result.raw_behavior < 1, `${taskId} ${label} mutant should fail for projection leakage`);
  } else {
    assert.ok(result.raw_behavior <= 0.25, `${taskId} ${label} mutant should remain below calibration ceiling`);
  }
}

writeApp(path.join(tmp, 'dev-toggle-preference', 'one-sided-toggle'), toggleOneSided);
const toggleOneSidedResult = await gradePilotBehavior({
  root: path.join(tmp, 'dev-toggle-preference', 'one-sided-toggle'),
  golden: taskGolden('dev-toggle-preference'),
  arm: 'direct',
  phase: 'verify_fix',
  taskId: 'dev-toggle-preference',
});
assert.ok(toggleOneSidedResult.raw_behavior < 1, 'dev-toggle-preference one-sided-toggle mutant should fail');

writeApp(path.join(tmp, 'dev-simple-list', 'wall-clock'), wallClockList);
const nondeterministicList = await gradePilotBehavior({
  root: path.join(tmp, 'dev-simple-list', 'wall-clock'),
  golden: taskGolden('dev-simple-list'),
  arm: 'direct',
  phase: 'verify_fix',
  taskId: 'dev-simple-list',
});
assert.equal(nondeterministicList.measurement_invalid, true, 'wall-clock reducer must be measurement-invalid');
assert.equal(nondeterministicList.measurement_invalid_reason, 'behavior_nondeterministic');
assert.equal(nondeterministicList.reward, 0, 'measurement-invalid reward must fail closed');

for (const [taskId, body, label, reason] of [
  ['dev-simple-list', moduleLoadClockList, 'module-load-clock', 'behavior_nondeterministic'],
  ['dev-toggle-preference', bigIntToggle, 'bigint-state', 'non_json_serializable_trace'],
]) {
  const dir = path.join(tmp, taskId, label);
  writeApp(dir, body);
  const result = await gradePilotBehavior({
    root: dir,
    golden: taskGolden(taskId),
    arm: 'direct',
    phase: 'verify_fix',
    taskId,
  });
  assert.equal(result.measurement_invalid, true, `${label} must be measurement-invalid`);
  assert.equal(result.measurement_invalid_reason, reason);
  assert.equal(result.reward, 0);
}

writeApp(path.join(tmp, 'dev-loan-library', 'unconditional-damage'), loanUnconditionalDamage);
const unconditionalDamage = await gradePilotBehavior({
  root: path.join(tmp, 'dev-loan-library', 'unconditional-damage'),
  golden: taskGolden('dev-loan-library'),
  arm: 'direct',
  phase: 'verify_fix',
  taskId: 'dev-loan-library',
});
assert.ok(unconditionalDamage.raw_behavior <= 0.8, 'pre-handoff damage and missing pause must lose two causal points');
assert.equal(unconditionalDamage.criteria.find((criterion) => criterion.id === 'damage.requires_active_handoff')?.passed, false);
assert.equal(unconditionalDamage.criteria.find((criterion) => criterion.id === 'damage.lending_paused')?.passed, false);

writeApp(path.join(tmp, 'dev-simple-list', 'action-order'), listOrderBroken);
const actionOrder = await gradePilotBehavior({
  root: path.join(tmp, 'dev-simple-list', 'action-order'),
  golden: taskGolden('dev-simple-list'),
  arm: 'direct',
  phase: 'verify_fix',
  taskId: 'dev-simple-list',
});
assert.equal(actionOrder.criteria.find((criterion) => criterion.id === 'list.missing_id_noop')?.passed, false);
assert.ok(actionOrder.raw_behavior <= 0.9, 'action-order mutant must not reach the rubric ceiling');

const loanDamageWithoutActive = `export function createInitialState(){return{loans:{}}}
export function reduce(state,action){
  const s=structuredClone(state);
  const loan=s.loans[action.id]||{id:action.id,status:'pending'};
  if(action.type==='request_loan'){loan.status='requested pending';s.loans[action.id]=loan;return s}
  if(action.type==='report_damage'){loan.status='dispute paused';s.loans[action.id]=loan;return s}
  return s;
}
export function project(state,actor){
  const loan=Object.values(state.loans)[0];
  return loan?{status:loan.status,dispute:loan.status.includes('dispute'),pause:loan.status.includes('pause')}:{};}`;
writeApp(path.join(tmp, 'dev-loan-library', 'damage-without-active'), loanDamageWithoutActive);
const loanWeak = await gradePilotBehavior({
  root: path.join(tmp, 'dev-loan-library', 'damage-without-active'),
  golden: taskGolden('dev-loan-library'),
  arm: 'direct',
  phase: 'verify_fix',
  taskId: 'dev-loan-library',
});
assert.ok(loanWeak.raw_behavior < 1, 'loan-library reducer that ignores handoff confirmations should fail');

const reviewNoFollowOn = `export function createInitialState(){return{invites:{}}}
export function reduce(state,action){
  const s=structuredClone(state);
  if(action.type==='invite'){s.invites[action.id]={id:action.id,status:'open'};return s}
  if(action.type==='expire_invite'){if(s.invites[action.id]) s.invites[action.id].status='expired';return s}
  if(action.type==='revoke_invite'){if(s.invites[action.id]) s.invites[action.id].status='revoked';return s}
  if(action.type==='add_comment'){return s}
  return s;
}
export function project(state,actor){
  const invite=Object.values(state.invites)[0];
  if(!invite) return {access:'denied'};
  if(invite.status==='expired') return {status:'expired',access:'denied access'};
  if(invite.status==='revoked') return {status:'revoked',access:'denied access'};
  return {access:'granted'};
}`;
writeApp(path.join(tmp, 'dev-review-room', 'no-follow-on'), reviewNoFollowOn);
const reviewWeak = await gradePilotBehavior({
  root: path.join(tmp, 'dev-review-room', 'no-follow-on'),
  golden: taskGolden('dev-review-room'),
  arm: 'direct',
  phase: 'verify_fix',
  taskId: 'dev-review-room',
});
assert.ok(reviewWeak.raw_behavior < 1, 'review-room without follow-on add_comment attempts should fail');

const reviewPreAcceptOnly = `export function createInitialState(){return{invites:{},comments:[],deniedComments:[]}}
export function reduce(state,action){
  const s=structuredClone(state);
  if(action.type==='invite'){s.invites[action.id]={id:action.id,document:action.document,status:'open'};return s}
  if(action.type==='accept_invite'){if(s.invites[action.id]) s.invites[action.id].accepted=action.email;return s}
  if(action.type==='expire_invite'){const invite=s.invites[action.id];if(invite&&!invite.accepted) invite.status='expired';return s}
  if(action.type==='revoke_invite'){const invite=s.invites[action.id];if(invite&&!invite.accepted) invite.status='revoked';return s}
  if(action.type==='add_comment'){
    const invite=Object.values(s.invites).find((entry)=>entry.status==='open'&&entry.accepted);
    if(!invite){s.deniedComments.push({id:action.id,text:action.text,denied:true});return s}
    s.comments.push({id:action.id,text:action.text});return s;
  }
  return s;
}
export function project(state,actor){
  const invite=Object.values(state.invites)[0];
  if(!invite) return {access:'denied'};
  if(invite.status==='expired') return {status:'expired',access:'denied access',deniedComments:state.deniedComments.map((c)=>c.id)};
  if(invite.status==='revoked') return {status:'revoked',access:'denied access',deniedComments:state.deniedComments.map((c)=>c.id)};
  const comments=state.comments.map((c)=>c.text.toLowerCase());
  return {invite,comments,comment:comments.join(' '),access:'granted'};
}`;
writeApp(path.join(tmp, 'dev-review-room', 'pre-accept-only'), reviewPreAcceptOnly);
const reviewPreAccept = await gradePilotBehavior({
  root: path.join(tmp, 'dev-review-room', 'pre-accept-only'),
  golden: taskGolden('dev-review-room'),
  arm: 'direct',
  phase: 'verify_fix',
  taskId: 'dev-review-room',
});
assert.ok(reviewPreAccept.raw_behavior < 1, 'review-room pre-accept-only invalidation mutant should fail');

console.log('lb6 pilot grader tests passed');
