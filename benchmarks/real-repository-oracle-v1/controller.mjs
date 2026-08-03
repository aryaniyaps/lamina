import fs from 'node:fs';
import path from 'node:path';
import { runSafely } from '../../scripts/safe-runner/runner.mjs';
import {
  canonical, collectionDigest, fixtureDigest, validateFixture,
} from './contract.mjs';
import {
  AUDITED_ENTRYPOINT, WORKLOAD_ID, verifyReturnedBlockedControllerReport,
  verifyReturnedControllerReport,
} from './attestation.mjs';

const issued = new WeakSet();
const UNSEALED_SEMANTIC_ENV = Object.freeze([
  'LAMINA_UV_BINARY', 'LAMINA_STANDALONE', 'LAMINA_BINARY', 'LAMINA_MODEL',
  'LAMINA_WORKER', 'ORACLE_FIXTURE',
]);
export function isControllerOracleVerification(value) { return issued.has(value); }

export async function runOracleThroughSafeRunner(options) {
  if (Object.hasOwn(options || {}, 'env')) {
    throw new Error('oracle controller rejects caller environment overrides');
  }
  const {
    fixture, collection, tier, cwd, reportFile, overrides = {}, promote = false,
  } = options || {};
  const validation = validateFixture(fixture);
  if (!validation.valid) throw new Error(`oracle controller fixture is invalid: ${validation.errors.join('; ')}`);
  const reviewedCollection = fixture.collections.find((item) => item.id === collection?.id);
  if (!reviewedCollection
    || JSON.stringify(canonical(collection)) !== JSON.stringify(canonical(reviewedCollection))
    || collection.collection_digest !== collectionDigest(collection)) {
    throw new Error('oracle controller requires the exact digest-bound fixture collection member');
  }
  if (tier !== collection.fixture_id || tier !== collection.fixture_class) {
    throw new Error('oracle controller tier must exactly match the reviewed collection fixture class');
  }
  const ambientSemanticNames = Object.keys(process.env).filter((name) => {
    const normalized = name.toUpperCase();
    return UNSEALED_SEMANTIC_ENV.includes(normalized)
      || normalized.startsWith('LAMINA_RETRIEVAL_') || normalized.startsWith('LAMINA_TEST_RETRIEVAL_');
  });
  if (ambientSemanticNames.length) {
    throw new Error(`oracle controller refuses unsealed ambient semantic environment: ${ambientSemanticNames.join(', ')}`);
  }
  const repository = fs.realpathSync.native(path.resolve(cwd));
  const requestedReport = path.resolve(reportFile);
  const reportParent = fs.realpathSync.native(path.dirname(requestedReport));
  const authorityFile = path.join(reportParent, path.basename(requestedReport));
  const command = [fs.realpathSync.native(process.execPath), path.join(repository, AUDITED_ENTRYPOINT), 'validate'];
  const returnedReport = await runSafely({
    tier, command, cwd: repository, reportFile: authorityFile, overrides,
    workloadId: WORKLOAD_ID, promote,
  });
  const verificationOptions = {
    reportFile: authorityFile, expectedTier: tier,
    expectedCollectionDigest: collection.collection_digest,
    expectedFixtureDigest: fixtureDigest(fixture),
  };
  const raw = returnedReport.outcome === 'success'
    ? verifyReturnedControllerReport(returnedReport, verificationOptions)
    : verifyReturnedBlockedControllerReport(returnedReport, verificationOptions);
  const verification = Object.freeze({
    ...raw, schema: 'lamina.real-repository-oracle-controller-verification/v1',
  });
  issued.add(verification);
  return verification;
}
