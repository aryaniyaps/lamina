#!/usr/bin/env node
import fs from 'node:fs';
import { gradeBehavior } from './behavior-grade.mjs';

const golden = JSON.parse(Buffer.from("eyJzZXF1ZW5jZXMiOlt7ImFjdG9yIjoib3duZXIiLCJhY3Rpb25zIjpbeyJ0eXBlIjoiYWRkX2l0ZW0iLCJpZCI6Iml0ZW0tMSIsInRpdGxlIjoiQnV5IG1pbGsifSx7InR5cGUiOiJjb21wbGV0ZV9pdGVtIiwiaWQiOiJpdGVtLTEifV0sImV4cGVjdCI6W1siaXRlbS0xIiwiZG9uZSJdXX1dfQ==", 'base64').toString('utf8'));
const arm = "checklist";
const phase = "shape_build";
const taskId = "control-simple-list";

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
if (phase === "shape_build") {
  fs.writeFileSync('/logs/verifier/mid_behavior.json', JSON.stringify({ behavior_pass_rate: result.behavior_pass_rate, sequences: result.sequences }, null, 2) + '\n');
}
console.log(JSON.stringify(result));
