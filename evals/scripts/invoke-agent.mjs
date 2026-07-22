#!/usr/bin/env node
/**
 * Invoke a Tier-1 agent CLI with a prompt in a workspace directory.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DEFAULT_PHASE_TIMEOUT_MS = Number(process.env.BENCH_PHASE_TIMEOUT_MS) || 20 * 60 * 1000;

const AGENT_COMMANDS = {
  'claude-code': ['claude', '-p'],
  // --skip-git-repo-check: multiturn workspaces are not git repos
  // --sandbox workspace-write: replaces deprecated --full-auto
  codex: ['codex', 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check'],
  opencode: ['opencode', 'run'],
};

const CLAUDE_BENCH_SYSTEM_APPEND = [
  'Unattended benchmark run (YOLO mode).',
  'Never ask the user for permission, confirmation, or clarification.',
  'Use Read, Write, Edit, and Bash tools immediately when needed.',
  'Write all required deliverables to the workspace before responding.',
].join(' ');

function resolveAgentCommand(agent) {
  const base = AGENT_COMMANDS[agent];
  if (!base) return null;

  const which = spawnSync('which', [base[0]], { encoding: 'utf8', env: process.env });
  if (which.status === 0 && which.stdout.trim()) {
    return [which.stdout.trim(), ...base.slice(1)];
  }

  if (agent === 'claude-code') {
    const homeLocal = path.join(process.env.HOME || '', '.local', 'bin', 'claude');
    if (homeLocal && fs.existsSync(homeLocal)) {
      return [homeLocal, ...base.slice(1)];
    }
    const localBin = path.join(ROOT, 'node_modules', '.bin', 'claude');
    if (fs.existsSync(localBin)) {
      return [localBin, ...base.slice(1)];
    }
    return ['npx', '--yes', '@anthropic-ai/claude-code', ...base.slice(1)];
  }

  return [...base];
}

function buildClaudeArgs(baseArgs, prompt, options = {}) {
  const args = [...baseArgs];
  args.push('--output-format', 'json');
  args.push('--dangerously-skip-permissions');
  args.push('--permission-mode', 'bypassPermissions');
  args.push('--append-system-prompt', CLAUDE_BENCH_SYSTEM_APPEND);
  if (options.sessionId) {
    args.push('--resume', options.sessionId);
  }
  if (options.model) args.push('--model', options.model);
  args.push(prompt);
  return args;
}

function parseClaudeJsonPayload(stdout, stderr) {
  const text = (stdout || '').trim();
  if (!text) {
    return {
      output: (stderr || '').trim(),
      session_id: null,
      cost_usd: null,
      usage: extractUsage(`${stdout}\n${stderr}`),
    };
  }

  try {
    const parsed = JSON.parse(text);
    const usage = parsed.usage
      ? {
          input_tokens: parsed.usage.input_tokens ?? null,
          output_tokens: parsed.usage.output_tokens ?? null,
          total_tokens:
            parsed.usage.input_tokens != null && parsed.usage.output_tokens != null
              ? parsed.usage.input_tokens + parsed.usage.output_tokens
              : parsed.usage.total_tokens ?? null,
        }
      : extractUsage(`${stdout}\n${stderr}`);

    return {
      output: typeof parsed.result === 'string' ? parsed.result : text,
      session_id: parsed.session_id ?? null,
      cost_usd: parsed.total_cost_usd ?? null,
      usage,
    };
  } catch {
    return {
      output: text || (stderr || '').trim(),
      session_id: null,
      cost_usd: null,
      usage: extractUsage(`${stdout}\n${stderr}`),
    };
  }
}

/** Parse opencode --format json NDJSON (ASE OpenCodeHarness.parse_output). */
function parseOpencodeJsonPayload(stdout, stderr) {
  const messages = [];
  let sessionId = null;
  let cost = null;
  let input = 0;
  let output = 0;
  for (const line of (stdout || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (!sessionId && event.sessionID) sessionId = event.sessionID;
      if (event.type === 'text') {
        const text = event.part?.text ?? '';
        if (text) messages.push(text);
      } else if (event.type === 'step_finish') {
        const tokens = event.part?.tokens ?? {};
        input += Number(tokens.input || 0);
        output += Number(tokens.output || 0);
        if (event.part && 'cost' in event.part) {
          cost = (cost || 0) + Number(event.part.cost || 0);
        }
      }
    } catch {
      // ignore non-JSON lines
    }
  }
  const joined = messages.join('\n').trim();
  if (joined) {
    return {
      output: joined,
      session_id: sessionId,
      cost_usd: cost,
      usage: { input_tokens: input, output_tokens: output, total_tokens: input + output },
    };
  }
  return {
    output: (stdout || '').trim() || (stderr || '').trim(),
    session_id: sessionId,
    cost_usd: cost,
    usage: extractUsage(`${stdout}\n${stderr}`),
  };
}

function spawnWithTimeout(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, IS_SANDBOX: process.env.IS_SANDBOX || '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        timed_out: timedOut,
      });
    });
  });
}

export function isAgentAvailable(agent) {
  const resolved = resolveAgentCommand(agent);
  if (!resolved) return false;
  const cmd = resolved[0];
  if (path.isAbsolute(cmd) || cmd.includes(path.sep)) {
    return fs.existsSync(cmd);
  }
  const which = spawnSync('which', [cmd], { encoding: 'utf8', env: process.env });
  return which.status === 0;
}

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

/**
 * Invoke agent asynchronously with optional timeout and session resume.
 * @returns {Promise<{output, stdout, stderr, session_id, cost_usd, usage, exitCode, duration_ms, timed_out}>}
 */
export async function invokeAgent(agent, prompt, cwd, options = {}) {
  const resolved = resolveAgentCommand(agent);
  if (!resolved) {
    throw new Error(`Unknown agent: ${agent}. Supported: ${Object.keys(AGENT_COMMANDS).join(', ')}`);
  }

  const cmd = resolved[0];
  const model =
    options.model ?? (agent === 'claude-code' ? process.env.ANTHROPIC_MODEL : undefined);
  const timeoutMs = options.timeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS;

  const args =
    agent === 'claude-code'
      ? buildClaudeArgs(resolved.slice(1), prompt, { sessionId: options.sessionId, model })
      : (() => {
          const generic = [...resolved.slice(1)];
          if (agent === 'opencode') {
            // Match ASE OpenCodeHarness: pin dir, json events, unattended perms.
            generic.push('--dir', cwd);
            generic.push('--format', 'json');
            // Current CLI flag (ASE still documents --dangerously-skip-permissions).
            generic.push('--auto');
          }
          if (model) generic.push('--model', model);
          generic.push(prompt);
          return generic;
        })();

  const started = Date.now();
  const result = await spawnWithTimeout(cmd, args, cwd, timeoutMs);
  const duration_ms = Date.now() - started;

  const parsed =
    agent === 'claude-code'
      ? parseClaudeJsonPayload(result.stdout, result.stderr)
      : agent === 'opencode'
        ? parseOpencodeJsonPayload(result.stdout, result.stderr)
        : {
            output: result.stdout.trim() || result.stderr.trim(),
            session_id: null,
            cost_usd: null,
            usage: extractUsage(`${result.stdout}\n${result.stderr}`),
          };

  if (result.error) {
    throw new Error(`Agent ${agent} failed to start (${cmd}): ${result.error.message}`);
  }
  if (result.timed_out) {
    throw new Error(`Agent ${agent} timed out after ${timeoutMs}ms`);
  }
  if (result.exitCode !== 0 && !parsed.output) {
    throw new Error(`Agent ${agent} exited ${result.exitCode}: ${result.stderr || result.stdout}`);
  }

  return {
    output: parsed.output,
    stdout: result.stdout,
    stderr: result.stderr,
    session_id: parsed.session_id,
    cost_usd: parsed.cost_usd,
    usage: parsed.usage,
    exitCode: result.exitCode,
    duration_ms,
    timed_out: result.timed_out,
  };
}
