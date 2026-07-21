#!/usr/bin/env node
import fs from 'node:fs';
import { gradeBehavior } from './behavior-grade.mjs';

const golden = JSON.parse(Buffer.from("eyJzZXF1ZW5jZXMiOlt7ImFjdG9yIjoiYm9ycm93ZXIiLCJhY3Rpb25zIjpbeyJ0eXBlIjoicmVxdWVzdF9sb2FuIiwiaWQiOiJsb2FuLTEiLCJpdGVtIjoiUHJvamVjdG9yIn1dLCJleHBlY3QiOltbInJlcXVlc3RlZCIsInBlbmRpbmciXV19LHsiYWN0b3IiOiJib3Jyb3dlciIsImFjdGlvbnMiOlt7InR5cGUiOiJyZXF1ZXN0X2xvYW4iLCJpZCI6ImxvYW4tMSIsIml0ZW0iOiJQcm9qZWN0b3IifSx7InR5cGUiOiJjb25maXJtX2hhbmRvZmYiLCJpZCI6ImxvYW4tMSIsImFjdG9yIjoiYm9ycm93ZXIifSx7InR5cGUiOiJjb25maXJtX2hhbmRvZmYiLCJpZCI6ImxvYW4tMSIsImFjdG9yIjoib3duZXIifV0sImV4cGVjdCI6W1siYWN0aXZlIl0sWyJjb25maXJtIl1dfSx7ImFjdG9yIjoib3duZXIiLCJhY3Rpb25zIjpbeyJ0eXBlIjoicmVxdWVzdF9sb2FuIiwiaWQiOiJsb2FuLTEiLCJpdGVtIjoiUHJvamVjdG9yIn0seyJ0eXBlIjoicmVwb3J0X2RhbWFnZSIsImlkIjoibG9hbi0xIn1dLCJleHBlY3QiOltbImRpc3B1dGUiXSxbInBhdXNlIl1dfV19", 'base64').toString('utf8'));
const arm = "lamina";
const phase = "lamina_design";
const taskId = "pilot-loan-library";

const result = await gradeBehavior({ root: '/app', golden, arm, phase, taskId });
const harborRewards = {
  reward: result.reward,
  behavior: result.scores?.behavior ?? 0,
  import_ok: result.scores?.import ?? 0,
};
if (result.invalid_treatment) harborRewards.reward = 0;

fs.mkdirSync('/logs/verifier', { recursive: true });
fs.writeFileSync('/logs/verifier/reward.json', JSON.stringify(harborRewards, null, 2) + '\n');
fs.writeFileSync('/logs/verifier/behavior_report.json', JSON.stringify(result, null, 2) + '\n');
if (phase === "implement") {
  fs.writeFileSync('/logs/verifier/mid_behavior.json', JSON.stringify({ behavior_pass_rate: result.behavior_pass_rate, sequences: result.sequences }, null, 2) + '\n');
}
console.log(JSON.stringify(result));
