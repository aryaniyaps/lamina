#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  ORACLE_HOST_LAUNCH_PROFILE,
} from '../../scripts/safe-runner/oracle-host-profile.mjs';

export const ORACLE_HOST_RESULT_SCHEMA =
  'lamina.real-repository-oracle-host-probe/v1';

export async function main(_exactArguments = []) {
  const error = new Error(
    `${ORACLE_HOST_LAUNCH_PROFILE} quota broker lifecycle is not installed`,
  );
  error.code = 'LAMINA_SAFE_ORACLE_QUOTA_UNAVAILABLE';
  throw error;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
