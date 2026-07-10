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

/** Best-effort token extraction from agent CLI stdout/stderr. */
export function extractUsage(text) {
  if (!text) return null;
  const patterns = [
    /"total_tokens"\s*:\s*(\d+)/i,
    /total[_\s-]?tokens?\s*[:=]\s*(\d+)/i,
    /(\d+)\s*total\s*tokens/i,
    /input[_\s-]?tokens?\s*[:=]\s*(\d+).*output[_\s-]?tokens?\s*[:=]\s*(\d+)/is,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    if (m[2]) {
      const input = Number(m[1]);
      const output = Number(m[2]);
      return { input_tokens: input, output_tokens: output, total_tokens: input + output };
    }
    return { total_tokens: Number(m[1]) };
  }
  return null;
}

export function invokeAgent(agent, prompt, cwd) {
  const base = AGENT_COMMANDS[agent];
  if (!base) {
    throw new Error(`Unknown agent: ${agent}. Supported: ${Object.keys(AGENT_COMMANDS).join(', ')}`);
  }

  const cmd = base[0];
  const args = [...base.slice(1), prompt];
  const started = Date.now();
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const duration_ms = Date.now() - started;

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const output = stdout.trim() || stderr.trim();
  const usage = extractUsage(`${stdout}\n${stderr}`);

  if (result.error) {
    throw new Error(`Agent ${agent} failed to start (${cmd}): ${result.error.message}`);
  }
  if (result.status !== 0 && !output) {
    throw new Error(`Agent ${agent} exited ${result.status}: ${stderr || stdout}`);
  }

  return {
    output,
    stdout,
    stderr,
    exitCode: result.status ?? 1,
    duration_ms,
    usage,
  };
}

export function isAgentAvailable(agent) {
  const base = AGENT_COMMANDS[agent];
  if (!base) return false;
  const check = spawnSync('which', [base[0]], { encoding: 'utf8' });
  return check.status === 0;
}
