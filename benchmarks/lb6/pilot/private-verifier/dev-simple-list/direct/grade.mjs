#!/usr/bin/env node
import fs from 'node:fs';
import { gradePilotBehavior } from './pilot-behavior-grade.mjs';

const golden = JSON.parse(Buffer.from("eyJzZXF1ZW5jZXMiOlt7ImFjdG9yIjoib3duZXIiLCJhY3Rpb25zIjpbeyJ0eXBlIjoiYWRkX2l0ZW0iLCJpZCI6Iml0ZW0tMSIsInRpdGxlIjoiQnV5IG1pbGsifSx7InR5cGUiOiJjb21wbGV0ZV9pdGVtIiwiaWQiOiJpdGVtLTEifV0sImV4cGVjdCI6W1siaXRlbS0xIiwiZG9uZSJdXX1dfQ==", 'base64').toString('utf8'));
const arm = "direct";
const phase = "verify_fix";
const taskId = "dev-simple-list";

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
