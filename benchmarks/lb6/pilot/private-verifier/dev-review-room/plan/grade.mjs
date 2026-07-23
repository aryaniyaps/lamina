#!/usr/bin/env node
import fs from 'node:fs';
import { gradePilotBehavior } from './pilot-behavior-grade.mjs';

const golden = JSON.parse(Buffer.from("eyJzZXF1ZW5jZXMiOlt7ImFjdG9yIjoicmV2aWV3ZXIiLCJhY3Rpb25zIjpbeyJ0eXBlIjoiaW52aXRlIiwiaWQiOiJpbnZpdGUtMSIsImRvY3VtZW50IjoiZG9jLTEifSx7InR5cGUiOiJhY2NlcHRfaW52aXRlIiwiaWQiOiJpbnZpdGUtMSIsImVtYWlsIjoicmV2aWV3ZXJAZXhhbXBsZS5jb20ifSx7InR5cGUiOiJhZGRfY29tbWVudCIsImlkIjoiYy0xIiwidGV4dCI6Ikxvb2tzIGdvb2QifV0sImV4cGVjdCI6W1siY29tbWVudCIsImxvb2tzIGdvb2QiXV19LHsiYWN0b3IiOiJyZXZpZXdlciIsImFjdGlvbnMiOlt7InR5cGUiOiJpbnZpdGUiLCJpZCI6Imludml0ZS0xIiwiZG9jdW1lbnQiOiJkb2MtMSJ9LHsidHlwZSI6ImFjY2VwdF9pbnZpdGUiLCJpZCI6Imludml0ZS0xIiwiZW1haWwiOiJyZXZpZXdlckBleGFtcGxlLmNvbSJ9LHsidHlwZSI6ImV4cGlyZV9pbnZpdGUiLCJpZCI6Imludml0ZS0xIn0seyJ0eXBlIjoiYWRkX2NvbW1lbnQiLCJpZCI6ImMtZXhwaXJlZCIsInRleHQiOiJTaG91bGQgbm90IGFwcGVhciBhZnRlciBleHBpcnkifV0sImV4cGVjdCI6W1siZXhwaXIiXSxbImRlbmllZCIsImFjY2VzcyJdXSwibXVzdF9ub3RfaW5jbHVkZSI6WyJzaG91bGQgbm90IGFwcGVhciBhZnRlciBleHBpcnkiXX0seyJhY3RvciI6InJldmlld2VyIiwiYWN0aW9ucyI6W3sidHlwZSI6Imludml0ZSIsImlkIjoiaW52aXRlLTEiLCJkb2N1bWVudCI6ImRvYy0xIn0seyJ0eXBlIjoiYWNjZXB0X2ludml0ZSIsImlkIjoiaW52aXRlLTEiLCJlbWFpbCI6InJldmlld2VyQGV4YW1wbGUuY29tIn0seyJ0eXBlIjoicmV2b2tlX2ludml0ZSIsImlkIjoiaW52aXRlLTEifSx7InR5cGUiOiJhZGRfY29tbWVudCIsImlkIjoiYy1yZXZva2VkIiwidGV4dCI6IlNob3VsZCBub3QgYXBwZWFyIGFmdGVyIHJldm9jYXRpb24ifV0sImV4cGVjdCI6W1sicmV2b2siXSxbImRlbmllZCIsImFjY2VzcyJdXSwibXVzdF9ub3RfaW5jbHVkZSI6WyJzaG91bGQgbm90IGFwcGVhciBhZnRlciByZXZvY2F0aW9uIl19XX0=", 'base64').toString('utf8'));
const arm = "plan";
const phase = "verify_fix";
const taskId = "dev-review-room";

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
