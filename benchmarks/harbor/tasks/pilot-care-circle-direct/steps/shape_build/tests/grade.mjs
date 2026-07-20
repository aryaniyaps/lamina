#!/usr/bin/env node
import fs from 'node:fs';
import { gradeBehavior } from './behavior-grade.mjs';

const golden = JSON.parse(Buffer.from("eyJzZXF1ZW5jZXMiOlt7ImFjdG9yIjoiY2FyZWdpdmVyIiwiYWN0aW9ucyI6W3sidHlwZSI6ImFkZF90YXNrIiwiaWQiOiJtZWQtMSIsInRpdGxlIjoiTW9ybmluZyBtZWRpY2F0aW9uIn0seyJ0eXBlIjoibWFya19taXNzZWQiLCJpZCI6Im1lZC0xIn1dLCJleHBlY3QiOltbIm1lZC0xIiwiZXNjYWxhdCJdLFsibWlzc2VkIl1dfSx7ImFjdG9yIjoiY2FyZWdpdmVyIiwiYWN0aW9ucyI6W3sidHlwZSI6ImFkZF90YXNrIiwiaWQiOiJtZWQtMSIsInRpdGxlIjoiTW9ybmluZyBtZWRpY2F0aW9uIn0seyJ0eXBlIjoiY29tcGxldGVfdGFzayIsImlkIjoibWVkLTEifV0sImV4cGVjdCI6W1sibWVkLTEiLCJkb25lIl1dfSx7ImFjdG9yIjoiY2FyZWdpdmVyIiwiYWN0aW9ucyI6W3sidHlwZSI6ImFkZF9ub3RlIiwiaWQiOiJuLTEiLCJ0ZXh0IjoiUHJpdmF0ZSBub3RlIn1dLCJleHBlY3QiOltbInByaXZhdGUiLCJub3RlIl1dfSx7ImFjdG9yIjoicmV2b2tlZC1jYXJlZ2l2ZXIiLCJhY3Rpb25zIjpbeyJ0eXBlIjoicmV2b2tlX2NhcmVnaXZlciIsImFjdG9yIjoicmV2b2tlZC1jYXJlZ2l2ZXIifSx7InR5cGUiOiJhZGRfbm90ZSIsImlkIjoibi0yIiwidGV4dCI6IlNob3VsZCBub3QgYmUgdmlzaWJsZSJ9XSwiZXhwZWN0IjpbWyJkZW5pZWQiXSxbInJldm9rIl1dLCJtdXN0X25vdF9pbmNsdWRlIjpbInNob3VsZCBub3QgYmUgdmlzaWJsZSJdfV19", 'base64').toString('utf8'));
const arm = "direct";
const phase = "shape_build";
const taskId = "pilot-care-circle";

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
