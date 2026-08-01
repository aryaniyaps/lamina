#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { adapterProbe } from './adapter.mjs';
import { bytesForMib, integer } from './constants.mjs';
import { hostEnvelope } from './envelope.mjs';
import {
  baseReport,
  finishReport,
  validateReport,
  writeReportWithFallback,
} from './report.mjs';
import { reportExitCode, runSafely } from './runner.mjs';
import { runAdversarialSelfTests } from './self-test.mjs';
import { readAttestation, promotionStatus } from './state.mjs';

const HELP = `Usage:
  npm run safe:envelope
  npm run safe:self-test
  npm run safe:run -- --tier <small|medium|large> --workload <stable-id> --report <file> [limits] -- <command> [args]
  node scripts/safe-runner/cli.mjs validate-report --file <report.json>

Downward-only limit overrides:
  --memory-mib N --memory-high-mib N --pids N --timeout-ms N
  --output-mib N --temporary-mib N --sample-ms N --high-samples N --grace-ms N
  --promote records a tier only after success and fully verified cleanup

Medium and large runs fail closed unless Linux user-systemd/cgroup-v2 enforcement,
a current passing host attestation, sequential tier promotion, and concurrency=1 are proven.
`;

function print(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function take(args, index, name) {
  const value = args[index + 1];
  if (value === undefined) throw new Error(`${name} requires a value`);
  return value;
}

function parseRun(args) {
  const separator = args.indexOf('--');
  if (separator === -1) throw new Error('run requires -- before the child command');
  const flags = args.slice(0, separator);
  const command = args.slice(separator + 1);
  const options = {
    tier: 'small', cwd: process.cwd(), reportFile: null, overrides: {}, command, promote: false,
    workloadId: null,
  };
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === '--tier') options.tier = take(flags, index++, flag);
    else if (flag === '--cwd') options.cwd = path.resolve(take(flags, index++, flag));
    else if (flag === '--report') options.reportFile = path.resolve(take(flags, index++, flag));
    else if (flag === '--workload') options.workloadId = take(flags, index++, flag);
    else if (flag === '--promote') options.promote = true;
    else if (flag === '--memory-mib') options.overrides.memoryMaxBytes = bytesForMib(take(flags, index++, flag), flag);
    else if (flag === '--memory-high-mib') options.overrides.memoryHighBytes = bytesForMib(take(flags, index++, flag), flag);
    else if (flag === '--output-mib') options.overrides.outputMaxBytes = bytesForMib(take(flags, index++, flag), flag);
    else if (flag === '--temporary-mib') options.overrides.tempMaxBytes = bytesForMib(take(flags, index++, flag), flag);
    else if (flag === '--pids') options.overrides.pidsMax = integer(take(flags, index++, flag), flag, { max: 64 });
    else if (flag === '--timeout-ms') options.overrides.timeoutMs = integer(take(flags, index++, flag), flag);
    else if (flag === '--sample-ms') options.overrides.sampleIntervalMs = integer(take(flags, index++, flag), flag, { min: 25 });
    else if (flag === '--high-samples') options.overrides.sustainedHighSamples = integer(take(flags, index++, flag), flag);
    else if (flag === '--grace-ms') options.overrides.gracefulStopMs = integer(take(flags, index++, flag), flag);
    else throw new Error(`unknown run option: ${flag}`);
  }
  if (!options.reportFile) throw new Error('run requires --report <file>');
  return options;
}

async function main() {
  const [subcommand, ...args] = process.argv.slice(2);
  if (!subcommand || subcommand === '--help' || subcommand === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  if (subcommand === 'envelope') {
    const probe = adapterProbe();
    const cwdIndex = args.indexOf('--cwd');
    const cwd = cwdIndex === -1 ? process.cwd() : path.resolve(take(args, cwdIndex, '--cwd'));
    print({
      ...hostEnvelope({ cwd, productionEnforcement: probe.production_enforcement === true }),
      adapter: probe,
      attestation: readAttestation(probe),
      promotion: promotionStatus(cwd),
      production_tiers_fail_closed: !probe.production_enforcement,
    });
    return 0;
  }
  if (subcommand === 'self-test') {
    const cwdIndex = args.indexOf('--cwd');
    const cwd = cwdIndex === -1 ? process.cwd() : path.resolve(take(args, cwdIndex, '--cwd'));
    const result = await runAdversarialSelfTests({ cwd });
    print(result);
    const requireProduction = args.includes('--require-production');
    return result.passed && (!requireProduction || result.qualified_for_production_tiers) ? 0 : 1;
  }
  if (subcommand === 'validate-report') {
    const fileIndex = args.indexOf('--file');
    if (fileIndex === -1) throw new Error('validate-report requires --file <report.json>');
    const file = path.resolve(take(args, fileIndex, '--file'));
    const result = validateReport(JSON.parse(fs.readFileSync(file, 'utf8')));
    print({ file, ...result });
    return result.valid ? 0 : 1;
  }
  if (subcommand === 'run') {
    const report = await runSafely(parseRun(args));
    print(report);
    return reportExitCode(report);
  }
  throw new Error(`unknown safe-runner command: ${subcommand}`);
}

try {
  process.exitCode = await main();
} catch (error) {
  if (process.argv[2] === 'run') {
    const args = process.argv.slice(3);
    const reportIndex = args.indexOf('--report');
    const tierIndex = args.indexOf('--tier');
    const separator = args.indexOf('--');
    const report = baseReport({
      tier: tierIndex >= 0 ? args[tierIndex + 1] : 'small',
      command: separator >= 0 ? args.slice(separator + 1) : [],
      cwd: process.cwd(),
    });
    report.outcome = 'preflight_refused';
    report.termination.reason = 'preflight_refused';
    report.preflight = { ok: false, reasons: [error.message] };
    report.cleanup.attempted = true;
    report.error = { code: error.code || 'LAMINA_SAFE_USAGE', message: error.message };
    finishReport(report, Date.now());
    writeReportWithFallback(reportIndex >= 0 ? args[reportIndex + 1] : null, report);
    print(report, process.stderr);
    process.exitCode = 2;
  } else {
  print({
    schema: 'lamina.safe-runner-cli-error/v1',
    outcome: 'preflight_refused',
    error: { code: error.code || 'LAMINA_SAFE_USAGE', message: error.message },
  }, process.stderr);
  process.exitCode = 2;
  }
}
