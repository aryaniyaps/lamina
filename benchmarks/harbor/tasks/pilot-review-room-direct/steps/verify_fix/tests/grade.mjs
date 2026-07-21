#!/usr/bin/env node
import fs from 'node:fs';
import { gradeBehavior } from './behavior-grade.mjs';

const golden = JSON.parse(Buffer.from("eyJzZXF1ZW5jZXMiOlt7ImFjdG9yIjoicmV2aWV3ZXIiLCJhY3Rpb25zIjpbeyJ0eXBlIjoiaW52aXRlIiwiaWQiOiJpbnZpdGUtMSIsImRvY3VtZW50IjoiZG9jLTEifSx7InR5cGUiOiJhY2NlcHRfaW52aXRlIiwiaWQiOiJpbnZpdGUtMSIsImVtYWlsIjoicmV2aWV3ZXJAZXhhbXBsZS5jb20ifSx7InR5cGUiOiJhZGRfY29tbWVudCIsImlkIjoiYy0xIiwidGV4dCI6Ikxvb2tzIGdvb2QifV0sImV4cGVjdCI6W1siY29tbWVudCIsImxvb2tzIGdvb2QiXV19LHsiYWN0b3IiOiJyZXZpZXdlciIsImFjdGlvbnMiOlt7InR5cGUiOiJpbnZpdGUiLCJpZCI6Imludml0ZS0xIiwiZG9jdW1lbnQiOiJkb2MtMSJ9LHsidHlwZSI6ImV4cGlyZV9pbnZpdGUiLCJpZCI6Imludml0ZS0xIn1dLCJleHBlY3QiOltbImV4cGlyIl0sWyJkZW5pZWQiLCJhY2Nlc3MiXV19LHsiYWN0b3IiOiJyZXZpZXdlciIsImFjdGlvbnMiOlt7InR5cGUiOiJpbnZpdGUiLCJpZCI6Imludml0ZS0xIiwiZG9jdW1lbnQiOiJkb2MtMSJ9LHsidHlwZSI6InJldm9rZV9pbnZpdGUiLCJpZCI6Imludml0ZS0xIn1dLCJleHBlY3QiOltbInJldm9rIl0sWyJkZW5pZWQiLCJhY2Nlc3MiXV19XX0=", 'base64').toString('utf8'));
const arm = "direct";
const phase = "verify_fix";
const taskId = "pilot-review-room";

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
