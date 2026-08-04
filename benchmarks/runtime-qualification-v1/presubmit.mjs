#!/usr/bin/env node
/** Fast presubmit qualification: oracle contract suites + committed result gate check. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateQualificationIndex } from './gates.mjs';
import { loadManifest, stableJson } from './contract.mjs';
import { validateQualificationResult } from './validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMITTED = path.join(HERE, 'results', 'linux-x64-small-partial.json');

async function main() {
  const { manifest } = loadManifest();
  const oracleResults = [];
  let failures = 0;

  for (const suite of manifest.oracle_suites.filter((item) => item.presubmit)) {
    const [command, ...args] = suite.command.split(/\s+/);
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(command, args, {
      cwd: path.resolve(HERE, '../..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    oracleResults.push({
      id: suite.id,
      command: suite.command,
      exit_code: result.status ?? 1,
      skipped: false,
    });
    if (result.status !== 0) failures += 1;
  }

  let committedEvaluation = null;
  if (fs.existsSync(COMMITTED)) {
    const payload = JSON.parse(fs.readFileSync(COMMITTED, 'utf8'));
    const validation = validateQualificationResult(payload);
    if (!validation.valid) {
      process.stderr.write(`${stableJson({ committed_validation: validation })}\n`);
      failures += 1;
    } else {
      committedEvaluation = evaluateQualificationIndex(payload.index);
    }
  }

  process.stdout.write(stableJson({
    oracle_results: oracleResults,
    committed_result: fs.existsSync(COMMITTED) ? path.basename(COMMITTED) : null,
    committed_evaluation: committedEvaluation?.summary || null,
    pass: failures === 0,
  }));
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main();
