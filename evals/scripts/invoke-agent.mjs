#!/usr/bin/env node
/**
 * Invoke a Tier-1 agent CLI with a prompt in a workspace directory.
 */
import { spawnSync } from 'node:child_process';

const AGENT_COMMANDS = {
  'claude-code': ['claude', '-p'],
  codex: ['codex', 'exec', '--full-auto'],
  opencode: ['opencode', 'run'],
};

export function invokeAgent(agent, prompt, cwd) {
  const base = AGENT_COMMANDS[agent];
  if (!base) {
    throw new Error(`Unknown agent: ${agent}. Supported: ${Object.keys(AGENT_COMMANDS).join(', ')}`);
  }

  const cmd = base[0];
  const args = [...base.slice(1), prompt];
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const output = stdout.trim() || stderr.trim();

  if (result.error) {
    throw new Error(`Agent ${agent} failed to start (${cmd}): ${result.error.message}`);
  }
  if (result.status !== 0 && !output) {
    throw new Error(`Agent ${agent} exited ${result.status}: ${stderr || stdout}`);
  }

  return { output, stdout, stderr, exitCode: result.status ?? 1 };
}

export function isAgentAvailable(agent) {
  const base = AGENT_COMMANDS[agent];
  if (!base) return false;
  const check = spawnSync('which', [base[0]], { encoding: 'utf8' });
  return check.status === 0;
}
