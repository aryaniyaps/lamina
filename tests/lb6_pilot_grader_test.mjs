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
  const loan=s.loans[action.id]||{id:action.id,status:'pending',confirmations:[]};
  if(action.type==='request_loan'){loan.item=action.item;loan.status='requested pending';s.loans[action.id]=loan;return s}
  if(action.type==='confirm_handoff'){loan.confirmations.push(action.actor);if(loan.confirmations.includes('borrower')&&loan.confirmations.includes('owner')) loan.status='active confirmed';s.loans[action.id]=loan;return s}
  if(action.type==='report_damage'){loan.status='dispute paused';s.loans[action.id]=loan;return s}
  return s;
}
export function project(state,actor){
  const loan=Object.values(state.loans)[0];
  if(!loan) return {status:'empty'};
  return {loan,status:loan.status,confirm:loan.status.includes('confirm'),active:loan.status.includes('active'),dispute:loan.status.includes('dispute'),pause:loan.status.includes('pause')};
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
  if(invite.status==='expired') return {status:'expired',access:'denied access',deniedComments:state.deniedComments.map((c)=>c.id)};
  if(invite.status==='revoked') return {status:'revoked',access:'denied access',deniedComments:state.deniedComments.map((c)=>c.id)};
  const comments=state.comments.map((c)=>c.text.toLowerCase());
  return {invite,comments,comment:comments.join(' '),access:'granted'};
}`;

const listGood = `export function createInitialState(){return{items:{}}}
export function reduce(state,action){
  const s=structuredClone(state);
  if(action.type==='add_item'){s.items[action.id]={id:action.id,title:action.title,status:'open'};return s}
  if(action.type==='complete_item'){if(s.items[action.id]) s.items[action.id].status='done';return s}
  return s;
}
export function project(state,actor){return {items:state.items,summary:Object.values(state.items).map((item)=>item.id+' '+item.status).join(' ')};}`;

const noop = `export function createInitialState(){return{}}
export function reduce(s){return s}
export function project(){return {}}`;

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
  assert.equal(result.reward, 1, `${taskId} reference reducer should pass`);
}

for (const [taskId, body, label] of [
  ['dev-loan-library', noop, 'noop'],
  ['dev-loan-library', loanKeywordOnly, 'keyword-only'],
  ['dev-review-room', noop, 'noop'],
  ['dev-review-room', reviewLeakage, 'leakage'],
  ['dev-simple-list', noop, 'noop'],
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
  assert.equal(result.reward, 0, `${taskId} ${label} mutant should fail`);
}

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
assert.ok(loanWeak.reward < 1, 'loan-library reducer that ignores handoff confirmations should fail');

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
assert.ok(reviewWeak.reward < 1, 'review-room without follow-on add_comment attempts should fail');

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
assert.ok(reviewPreAccept.reward < 1, 'review-room pre-accept-only invalidation mutant should fail');

console.log('lb6 pilot grader tests passed');
