#!/usr/bin/env node
import fs from 'node:fs';
import { gradePilotBehavior } from './pilot-behavior-grade.mjs';

const golden = JSON.parse(Buffer.from("eyJzZXF1ZW5jZXMiOlt7ImFjdG9yIjoiY2FyZWdpdmVyIiwiYWN0aW9ucyI6W3sidHlwZSI6ImFkZF90YXNrIiwiaWQiOiJtZWQtMSIsInRpdGxlIjoiTW9ybmluZyBtZWRpY2F0aW9uIn0seyJ0eXBlIjoibWFya19taXNzZWQiLCJpZCI6Im1lZC0xIn1dLCJleHBlY3QiOltbIm1lZC0xIiwiZXNjYWxhdCJdLFsibWlzc2VkIl1dfSx7ImFjdG9yIjoiY2FyZWdpdmVyIiwiYWN0aW9ucyI6W3sidHlwZSI6ImFkZF90YXNrIiwiaWQiOiJtZWQtMSIsInRpdGxlIjoiTW9ybmluZyBtZWRpY2F0aW9uIn0seyJ0eXBlIjoiY29tcGxldGVfdGFzayIsImlkIjoibWVkLTEifV0sImV4cGVjdCI6W1sibWVkLTEiLCJkb25lIl1dfSx7ImFjdG9yIjoiY2FyZWdpdmVyIiwiYWN0aW9ucyI6W3sidHlwZSI6ImFkZF9ub3RlIiwiaWQiOiJuLTEiLCJ0ZXh0IjoiUHJpdmF0ZSBub3RlIn1dLCJleHBlY3QiOltbInByaXZhdGUiLCJub3RlIl1dfSx7ImFjdG9yIjoicmV2b2tlZC1jYXJlZ2l2ZXIiLCJhY3Rpb25zIjpbeyJ0eXBlIjoicmV2b2tlX2NhcmVnaXZlciIsImFjdG9yIjoicmV2b2tlZC1jYXJlZ2l2ZXIifSx7InR5cGUiOiJhZGRfbm90ZSIsImlkIjoibi0yIiwidGV4dCI6IlNob3VsZCBub3QgYmUgdmlzaWJsZSJ9XSwiZXhwZWN0IjpbWyJkZW5pZWQiXSxbInJldm9rIl1dLCJtdXN0X25vdF9pbmNsdWRlIjpbInNob3VsZCBub3QgYmUgdmlzaWJsZSJdfV19", 'base64').toString('utf8'));
const arm = "lamina";
const phase = "fix";
const taskId = "dev-care-circle";

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
