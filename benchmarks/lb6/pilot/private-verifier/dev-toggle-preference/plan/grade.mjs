#!/usr/bin/env node
import fs from 'node:fs';
import { gradePilotBehavior } from './pilot-behavior-grade.mjs';

const golden = JSON.parse(Buffer.from("eyJzZXF1ZW5jZXMiOlt7ImFjdG9yIjoidXNlciIsImFjdGlvbnMiOlt7InR5cGUiOiJyZWdpc3Rlcl9kZXZpY2VfY29udGV4dCIsImlkIjoicHJlZi0xIiwiY29udGV4dFRva2VuIjoibGI2LXRnbC1hMWY4ZTJiOSJ9LHsidHlwZSI6ImVuYWJsZV9mb2N1c19tb2RlIiwiaWQiOiJwcmVmLTEifV0sImV4cGVjdCI6W1siZm9jdXMiLCJvbiJdLFsicXVpZXQiXV0sIm11c3Rfbm90X2luY2x1ZGUiOlsibGI2LXRnbC1hMWY4ZTJiOSJdfSx7ImFjdG9yIjoidXNlciIsImFjdGlvbnMiOlt7InR5cGUiOiJyZWdpc3Rlcl9kZXZpY2VfY29udGV4dCIsImlkIjoicHJlZi0xIiwiY29udGV4dFRva2VuIjoibGI2LXRnbC1jNGQ3ZTZmMCJ9LHsidHlwZSI6ImVuYWJsZV9mb2N1c19tb2RlIiwiaWQiOiJwcmVmLTEifSx7InR5cGUiOiJkaXNhYmxlX2ZvY3VzX21vZGUiLCJpZCI6InByZWYtMSJ9XSwiZXhwZWN0IjpbWyJmb2N1cyIsIm9mZiJdLFsibm9ybWFsIl1dLCJtdXN0X25vdF9pbmNsdWRlIjpbImxiNi10Z2wtYzRkN2U2ZjAiXX0seyJhY3RvciI6InVzZXIiLCJhY3Rpb25zIjpbeyJ0eXBlIjoicmVnaXN0ZXJfZGV2aWNlX2NvbnRleHQiLCJpZCI6InByZWYtMSIsImNvbnRleHRUb2tlbiI6ImxiNi10Z2wtYjhjM2E1ZDEifSx7InR5cGUiOiJlbmFibGVfZm9jdXNfbW9kZSIsImlkIjoicHJlZi0xIn0seyJ0eXBlIjoidG9nZ2xlX2ZvY3VzX21vZGUiLCJpZCI6InByZWYtMSJ9LHsidHlwZSI6InRvZ2dsZV9mb2N1c19tb2RlIiwiaWQiOiJwcmVmLTEifV0sImV4cGVjdCI6W1siZm9jdXMiLCJvbiJdXSwibXVzdF9ub3RfaW5jbHVkZSI6WyJsYjYtdGdsLWI4YzNhNWQxIl19XX0=", 'base64').toString('utf8'));
const arm = "plan";
const phase = "verify_fix";
const taskId = "dev-toggle-preference";

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
