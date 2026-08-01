#!/usr/bin/env node
import fs from 'node:fs';
import { SELF_TEST_CASE_IDS } from './constants.mjs';

const fileIndex = process.argv.indexOf('--file');
const statusIndex = process.argv.indexOf('--status');
if (fileIndex < 0 || statusIndex < 0) throw new Error('--file and --status are required');
const result = JSON.parse(fs.readFileSync(process.argv[fileIndex + 1], 'utf8'));
const status = Number(process.argv[statusIndex + 1]);
const cases = Array.isArray(result.cases) ? result.cases : [];
const exactCases = JSON.stringify(cases.map((item) => item.id).sort())
  === JSON.stringify([...SELF_TEST_CASE_IDS].sort());
const fullyQualified = status === 0
  && result.passed === true
  && result.qualified_for_production_tiers === true
  && result.attestation?.passed === true
  && result.attestation?.qualified_for_production_tiers === true
  && exactCases
  && cases.every((item) => item.passed === true && item.cleanup_verified === true);
const explicitRefusal = status === 1
  && result.passed === false
  && result.qualified_for_production_tiers === false
  && result.adapter?.production_enforcement === false
  && result.refusal?.code === 'LAMINA_SAFE_PRODUCTION_ENFORCEMENT_REQUIRED'
  && result.attestation?.passed === false
  && result.attestation?.qualified_for_production_tiers === false
  && exactCases
  && cases.every((item) => item.passed === false
    && item.skipped === true
    && item.outcome === 'preflight_refused'
    && item.cleanup_verified === true);
if (!fullyQualified && !explicitRefusal) {
  throw new Error('qualification output was neither a full production attestation nor the exact fail-closed refusal');
}
process.stdout.write(`${JSON.stringify({ accepted: true, mode: fullyQualified ? 'production' : 'explicit-refusal' })}\n`);
