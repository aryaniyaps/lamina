#!/usr/bin/env node
import fs from 'node:fs';
import { gradePilotBehavior } from './pilot-behavior-grade.mjs';

const golden = JSON.parse(Buffer.from("eyJzZXF1ZW5jZXMiOlt7ImFjdG9yIjoiYm9ycm93ZXIiLCJhY3Rpb25zIjpbeyJ0eXBlIjoicmVxdWVzdF9sb2FuIiwiaWQiOiJsb2FuLTEiLCJpdGVtIjoiUHJvamVjdG9yIn1dLCJleHBlY3QiOltbInJlcXVlc3RlZCIsInBlbmRpbmciXV19LHsiYWN0b3IiOiJib3Jyb3dlciIsImFjdGlvbnMiOlt7InR5cGUiOiJyZXF1ZXN0X2xvYW4iLCJpZCI6ImxvYW4tMSIsIml0ZW0iOiJQcm9qZWN0b3IifSx7InR5cGUiOiJjb25maXJtX2hhbmRvZmYiLCJpZCI6ImxvYW4tMSIsImFjdG9yIjoiYm9ycm93ZXIifSx7InR5cGUiOiJjb25maXJtX2hhbmRvZmYiLCJpZCI6ImxvYW4tMSIsImFjdG9yIjoib3duZXIifV0sImV4cGVjdCI6W1siYWN0aXZlIl0sWyJjb25maXJtIl1dfSx7ImFjdG9yIjoib3duZXIiLCJhY3Rpb25zIjpbeyJ0eXBlIjoicmVxdWVzdF9sb2FuIiwiaWQiOiJsb2FuLTEiLCJpdGVtIjoiUHJvamVjdG9yIn0seyJ0eXBlIjoiY29uZmlybV9oYW5kb2ZmIiwiaWQiOiJsb2FuLTEiLCJhY3RvciI6ImJvcnJvd2VyIn0seyJ0eXBlIjoiY29uZmlybV9oYW5kb2ZmIiwiaWQiOiJsb2FuLTEiLCJhY3RvciI6Im93bmVyIn0seyJ0eXBlIjoicmVwb3J0X2RhbWFnZSIsImlkIjoibG9hbi0xIn1dLCJleHBlY3QiOltbImRpc3B1dGUiXSxbInBhdXNlIl1dfV19", 'base64').toString('utf8'));
const arm = "direct";
const phase = "verify_fix";
const taskId = "dev-loan-library";

const result = await gradePilotBehavior({ root: '/candidate', treatmentRoot: '/treatment', golden, arm, phase, taskId });
const harborRewards = {
  reward: result.reward,
  behavior: result.scores?.behavior ?? 0,
  import_ok: result.scores?.import ?? 0,
};
if (result.invalid_treatment) harborRewards.reward = 0;

fs.mkdirSync('/output', { recursive: true });
fs.writeFileSync('/output/reward.json', JSON.stringify(harborRewards, null, 2) + '\n');
fs.writeFileSync('/output/behavior_report.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
