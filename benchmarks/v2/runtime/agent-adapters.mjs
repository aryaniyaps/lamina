import { randomUUID } from 'node:crypto';

function parseJsonLines(raw) {
  return String(raw || '').split('\n').map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function sumUsage(events) {
  let input = 0;
  let output = 0;
  let found = false;
  for (const event of events) {
    const usage = event.usage || event.message?.usage || event.result?.usage;
    if (!usage) continue;
    input += Number(usage.input_tokens || usage.inputTokens || 0);
    output += Number(usage.output_tokens || usage.outputTokens || 0);
    found = true;
  }
  return { input_tokens: found ? input : null, output_tokens: found ? output : null };
}

function codexFinalText(events) {
  const messages = events.flatMap((event) => {
    if (event.type !== 'item.completed' || event.item?.type !== 'agent_message') return [];
    return [event.item.text || event.item.content || ''];
  }).filter(Boolean);
  return messages.at(-1) || '';
}

function claudeFinalText(events) {
  const result = [...events].reverse().find((event) => event.type === 'result');
  if (typeof result?.result === 'string') return result.result;
  const assistants = events.filter((event) => event.type === 'assistant');
  const content = assistants.at(-1)?.message?.content;
  if (!Array.isArray(content)) return '';
  return content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
}

export class CodexAdapter {
  constructor({ model, reasoningEffort = 'high' }) {
    this.provider = 'codex';
    this.model = model;
    this.reasoningEffort = reasoningEffort;
  }

  start(prompt) {
    return { command: 'codex', args: ['exec', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--model', this.model, '--json', '-c', `model_reasoning_effort=${this.reasoningEffort}`, '--', prompt] };
  }

  resume(sessionId, prompt) {
    return { command: 'codex', args: ['exec', 'resume', sessionId, '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--model', this.model, '--json', '-c', `model_reasoning_effort=${this.reasoningEffort}`, '--', prompt] };
  }

  normalize(raw) {
    const events = parseJsonLines(raw);
    const started = events.find((event) => event.type === 'thread.started');
    const sessionId = started?.thread_id || events.find((event) => event.thread_id)?.thread_id;
    const usage = sumUsage(events);
    return { provider: this.provider, session_id: sessionId, resolved_model: this.model, final_text: codexFinalText(events), events, ...usage, tool_calls: events.filter((event) => /tool|command/.test(event.type || '')).length };
  }

  preflight() { return { command: 'codex', args: ['login', 'status'] }; }
}

export class ClaudeCodeAdapter {
  constructor({ model, effort = 'high' }) {
    this.provider = 'claude-code';
    this.model = model;
    this.effort = effort;
  }

  start(prompt) {
    const sessionId = randomUUID();
    return { sessionId, command: 'claude', args: ['--print', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--model', this.model, '--effort', this.effort, '--session-id', sessionId, prompt] };
  }

  resume(sessionId, prompt) {
    return { command: 'claude', args: ['--print', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--model', this.model, '--effort', this.effort, '--resume', sessionId, prompt] };
  }

  normalize(raw) {
    const events = parseJsonLines(raw);
    const result = [...events].reverse().find((event) => event.type === 'result') || {};
    const init = events.find((event) => event.type === 'system' && event.subtype === 'init') || {};
    const usage = sumUsage(events);
    return {
      provider: this.provider,
      session_id: result.session_id || init.session_id,
      resolved_model: result.model || init.model || this.model,
      final_text: claudeFinalText(events),
      events,
      ...usage,
      tool_calls: events.filter((event) => event.type === 'assistant' && event.message?.content?.some?.((item) => item.type === 'tool_use')).length,
    };
  }

  preflight() { return { command: 'claude', args: ['auth', 'status'] }; }
}

export function createAdapter(config) {
  if (config.provider === 'codex') return new CodexAdapter(config);
  if (config.provider === 'claude-code') return new ClaudeCodeAdapter(config);
  throw new Error(`Unsupported provider: ${config.provider}`);
}
