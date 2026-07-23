import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactObject, redactString } from '../benchmarks/lb6/lib/redact.mjs';
import {
  analyzeStreamProvenance,
  buildPersonaProvenanceFailureRecord,
  checkCursorLocalAuth,
  checkHarborPublicationAuth,
  locateCursorCli,
  parseStreamJson,
  runPilotPreflight,
  validateComposerProbe,
  validatePersonaChildren,
} from '../benchmarks/lb6/lib/pilot-preflight.mjs';
import { resolveCursorCredential } from '../benchmarks/lib/load-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validFixturePath = path.join(
  root,
  'benchmarks/lb6/fixtures/stream-json/persona-children-valid.ndjson',
);
const liveShapeFixturePath = path.join(
  root,
  'benchmarks/lb6/fixtures/stream-json/task-tool-only-live-shape.ndjson',
);

assert.match(redactString('CURSOR_API_KEY=sekret'), /CURSOR_API_KEY=<redacted>/);
assert.equal(redactObject({ CURSOR_API_KEY: 'sekret' }).CURSOR_API_KEY, '<redacted>');

const validEvents = parseStreamJson(fs.readFileSync(validFixturePath, 'utf8'));
const validAnalysis = analyzeStreamProvenance(validEvents);
assert.equal(validAnalysis.parentModel, 'Composer 2.5');
assert.equal(validateComposerProbe(validAnalysis).length, 0);
const validChildCheck = validatePersonaChildren(validAnalysis);
assert.equal(validChildCheck.failures.length, 0);
assert.equal(validChildCheck.validChildren.length, 2);

const liveEvents = parseStreamJson(fs.readFileSync(liveShapeFixturePath, 'utf8'));
const liveAnalysis = analyzeStreamProvenance(liveEvents);
assert.equal(liveAnalysis.singleSessionStream, true);
assert.equal(liveAnalysis.completedTaskLaunches.length, 2);
assert.equal(validateComposerProbe(liveAnalysis).length, 0);
const liveChildCheck = validatePersonaChildren(liveAnalysis);
assert.ok(liveChildCheck.failures.length > 0);
assert.equal(liveChildCheck.validChildren.length, 0);
assert.ok(liveChildCheck.failureRecord);
assert.match(
  liveChildCheck.failureRecord.conclusion,
  /taskToolCall execution metadata/,
);
assert.equal(liveChildCheck.failureRecord.attributableChildren, 0);
assert.equal(liveChildCheck.failureRecord.missingEvidence.childSystemInit, 2);

const failureRecord = buildPersonaProvenanceFailureRecord(liveAnalysis);
assert.equal(failureRecord.observedTaskToolFields.length, 2);
assert.equal(failureRecord.observedTaskToolFields[0].argsAgentId, 'child-alpha-id');
assert.equal(failureRecord.observedTaskToolFields[0].requestedModel, 'composer-2.5');

const missingKey = checkCursorLocalAuth({ fileEnv: {} });
assert.equal(missingKey.status, 'blocked');
assert.equal(missingKey.cursorApiKey, 'absent');
assert.match(missingKey.reason, /CURSOR_API_KEY/);

const presentKey = checkCursorLocalAuth({ fileEnv: { CURSOR_API_KEY: 'test-key' } });
assert.equal(presentKey.status, 'passed');
assert.equal(presentKey.cursorApiKey, 'present');
assert.equal(presentKey.transport, 'process_env_only');

const harborBlocked = checkHarborPublicationAuth({ fileEnv: {} });
assert.equal(harborBlocked.status, 'blocked');
assert.equal(harborBlocked.distinctFrom, 'cursor_local_auth');

const staticPreflight = runPilotPreflight({
  root,
  skipLiveProbes: true,
  cursorCli: locateCursorCli(),
  fileEnv: {},
});
assert.equal(staticPreflight.report.credentials.workerProcessScrape, false);
assert.equal(staticPreflight.report.credentials.source, 'repo_root_env_only');
assert.equal(staticPreflight.report.liveProbes.skipped, true);
assert.equal(staticPreflight.ok, true);
assert.equal(staticPreflight.report.ticketStatus, 'static_checks_only_not_ticket_complete');
assert.equal(
  staticPreflight.report.gates.find((gate) => gate.name === 'harbor_publication_auth')?.status,
  'blocked',
);

const envKey = resolveCursorCredential({ CURSOR_API_KEY: 'from-file-only' });
assert.equal(envKey, 'from-file-only');

console.log('lb6 pilot preflight tests passed');
