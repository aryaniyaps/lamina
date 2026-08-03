#!/usr/bin/env node
import { runLandlockCandidateProbe } from '../../scripts/safe-runner/landlock-candidate-probe.mjs';

const result = await runLandlockCandidateProbe();
process.stdout.write(`${JSON.stringify(result)}\n`);
