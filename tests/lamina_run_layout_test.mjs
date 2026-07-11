#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkDesignRunLayout,
  hasLegacyReadyToBuildDir,
  latestRunRecord,
} from '../benchmarks/scripts/lamina-run-layout.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-run-layout-'));

function write(rel, content) {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

write('.lamina/ready_to_build/run.yaml', 'status: ready_to_build\n');
assert.equal(hasLegacyReadyToBuildDir(tmp), true);
assert.equal(checkDesignRunLayout(tmp).ok, false);

fs.rmSync(path.join(tmp, '.lamina/ready_to_build'), { recursive: true, force: true });

write('.lamina/runs/household-001/run.yaml', `id: household-001\nstatus: ready_to_build\n${'domain: test\n'.repeat(8)}`);
write('.lamina/runs/household-001/implement.md', 'x'.repeat(60));
write('.lamina/runs/household-001/report.md', 'y'.repeat(60));

const layout = checkDesignRunLayout(tmp);
assert.equal(layout.ok, true);
assert.equal(latestRunRecord(tmp)?.runId, 'household-001');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('lamina_run_layout_test: ok');
