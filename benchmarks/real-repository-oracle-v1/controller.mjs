import path from 'node:path';
import { runSafely } from '../../scripts/safe-runner/runner.mjs';
import { fixtureDigest } from './contract.mjs';
import {
  AUDITED_ENTRYPOINT, WORKLOAD_ID, verifyReturnedBlockedControllerReport,
  verifyReturnedControllerReport,
} from './attestation.mjs';

const issued = new WeakSet();
export function isControllerOracleVerification(value) { return issued.has(value); }

export async function runOracleThroughSafeRunner({
  fixture, collection, tier, cwd, reportFile, overrides = {}, env = {}, promote = false,
}) {
  const repository = path.resolve(cwd);
  const authorityFile = path.resolve(reportFile);
  const command = [process.execPath, path.join(repository, AUDITED_ENTRYPOINT), 'validate'];
  const returnedReport = await runSafely({
    tier, command, cwd: repository, reportFile: authorityFile, overrides, env,
    workloadId: WORKLOAD_ID, promote,
  });
  const options = {
    reportFile: authorityFile, expectedTier: tier,
    expectedCollectionDigest: collection.collection_digest,
    expectedFixtureDigest: fixtureDigest(fixture),
  };
  const raw = returnedReport.outcome === 'success'
    ? verifyReturnedControllerReport(returnedReport, options)
    : verifyReturnedBlockedControllerReport(returnedReport, options);
  const verification = Object.freeze({
    ...raw, schema: 'lamina.real-repository-oracle-controller-verification/v1',
  });
  issued.add(verification);
  return verification;
}
