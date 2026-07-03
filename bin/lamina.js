#!/usr/bin/env node
import { runCli } from '../src/cli.js';

const code = await runCli(process.argv.slice(2), process);
process.exitCode = code;
