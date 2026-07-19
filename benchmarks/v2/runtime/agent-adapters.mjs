import { randomUUID } from 'node:crypto';

function parseJsonLines(raw) {
  return String(raw || '').split('\n').map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function usageValues(usage = {}) {
  return {
    input_tokens: Number(usage.input_tokens || usage.inputTokens || 0),
    cached_input_tokens: Number(usage.cached_input_tokens || usage.cachedInputTokens || 0),
    output_tokens: Number(usage.output_tokens || usage.outputTokens || 0),
    reasoning_output_tokens: Number(usage.reasoning_output_tokens || usage.reasoningOutputTokens || 0),
  };
}

function usageEvents(events) {
  const values = [];
  for (const event of events) {
    const usage = event.usage || event.message?.usage || event.result?.usage;
    if (!usage) continue;
    values.push(usageValues(usage));
  }
  return values;
}

function sumUsage(events) {
  const records = usageEvents(events);
  if (!records.length) return { input_tokens: null, cached_input_tokens: null, output_tokens: null, reasoning_output_tokens: null };
  return records.reduce((total, usage) => ({
    input_tokens: total.input_tokens + usage.input_tokens,
    cached_input_tokens: total.cached_input_tokens + usage.cached_input_tokens,
    output_tokens: total.output_tokens + usage.output_tokens,
    reasoning_output_tokens: total.reasoning_output_tokens + usage.reasoning_output_tokens,
  }), { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 });
}

function codexToolCalls(events) {
  const toolItemTypes = new Set([
    'command_execution',
    'file_change',
    'mcp_tool_call',
    'web_search',
    'image_generation',
    'collab_tool_call',
    'dynamic_tool_call',
  ]);
  return events.filter((event) => {
    if (event.type === 'item.started' || event.type === 'item.completed') return toolItemTypes.has(event.item?.type);
    return /(?:^|[._-])(tool|command)(?:$|[._-])/.test(event.type || '');
  }).filter((event) => event.type !== 'item.started').length;
}

function codexSubagentCalls(events) {
  return events.filter((event) => {
    if (event.type !== 'item.completed') return false;
    if (['spawn_agent', 'spawn_agents_on_csv'].includes(event.item?.type)) return true;
    if (event.item?.type !== 'collab_tool_call') return false;
    if (['spawn_agent', 'spawn_agents_on_csv'].includes(event.item?.tool)) return true;
    return Array.isArray(event.item?.receiver_thread_ids) && event.item.receiver_thread_ids.length > 0;
  }).length;
}

function claudeSubagentCalls(events) {
  const names = new Set(['Task', 'Agent', 'TeamCreate', 'SendMessage']);
  return events.filter((event) => event.type === 'assistant' && event.message?.content?.some?.((item) => item.type === 'tool_use' && names.has(item.name))).length;
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
    this.usageCheckpoints = new Map();
  }

  start(prompt) {
    return { command: 'codex', args: ['exec', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--disable', 'multi_agent', '--model', this.model, '--json', '-c', `model_reasoning_effort=${this.reasoningEffort}`, '--', prompt] };
  }

  resume(sessionId, prompt) {
    return { command: 'codex', args: ['exec', 'resume', sessionId, '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--disable', 'multi_agent', '--model', this.model, '--json', '-c', `model_reasoning_effort=${this.reasoningEffort}`, '--', prompt] };
  }

  normalize(raw) {
    const events = parseJsonLines(raw);
    const started = events.find((event) => event.type === 'thread.started');
    const sessionId = started?.thread_id || events.find((event) => event.thread_id)?.thread_id;
    const usageRecords = usageEvents(events);
    const cumulative = usageRecords.at(-1) || null;
    let usage = {
      usage_accounting: 'session_delta',
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
      reasoning_output_tokens: null,
      cumulative_input_tokens: null,
      cumulative_cached_input_tokens: null,
      cumulative_output_tokens: null,
      cumulative_reasoning_output_tokens: null,
    };
    if (cumulative) {
      const previous = sessionId ? this.usageCheckpoints.get(sessionId) : null;
      const delta = Object.fromEntries(Object.entries(cumulative).map(([key, value]) => [key, value - Number(previous?.[key] || 0)]));
      for (const [key, value] of Object.entries(delta)) {
        if (!Number.isInteger(value) || value < 0) throw new Error(`Non-monotonic cumulative Codex usage for ${sessionId || 'unknown session'}: ${key}`);
      }
      if (sessionId) this.usageCheckpoints.set(sessionId, cumulative);
      usage = {
        usage_accounting: 'session_delta',
        ...delta,
        cumulative_input_tokens: cumulative.input_tokens,
        cumulative_cached_input_tokens: cumulative.cached_input_tokens,
        cumulative_output_tokens: cumulative.output_tokens,
        cumulative_reasoning_output_tokens: cumulative.reasoning_output_tokens,
      };
    }
    const resolvedModel = [...events].reverse().find((event) => event.model || event.resolved_model)?.model
      || [...events].reverse().find((event) => event.model || event.resolved_model)?.resolved_model
      || this.model;
    return { provider: this.provider, session_id: sessionId, resolved_model: resolvedModel, final_text: codexFinalText(events), events, ...usage, tool_calls: codexToolCalls(events), subagent_calls: codexSubagentCalls(events) };
  }

  preflight() { return { command: 'codex', args: ['login', 'status'] }; }

  version() { return { command: 'codex', args: ['--version'] }; }
}

export class ClaudeCodeAdapter {
  constructor({ model, effort = 'high' }) {
    this.provider = 'claude-code';
    this.model = model;
    this.effort = effort;
  }

  start(prompt) {
    const sessionId = randomUUID();
    return { sessionId, command: 'claude', args: ['--print', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--disallowedTools', 'Task,Agent,TeamCreate,SendMessage', '--model', this.model, '--effort', this.effort, '--session-id', sessionId, prompt] };
  }

  resume(sessionId, prompt) {
    return { command: 'claude', args: ['--print', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--disallowedTools', 'Task,Agent,TeamCreate,SendMessage', '--model', this.model, '--effort', this.effort, '--resume', sessionId, prompt] };
  }

  normalize(raw) {
    const events = parseJsonLines(raw);
    const result = [...events].reverse().find((event) => event.type === 'result') || {};
    const init = events.find((event) => event.type === 'system' && event.subtype === 'init') || {};
    const usage = {
      usage_accounting: 'phase_total',
      ...sumUsage(events),
      cumulative_input_tokens: null,
      cumulative_cached_input_tokens: null,
      cumulative_output_tokens: null,
      cumulative_reasoning_output_tokens: null,
    };
    return {
      provider: this.provider,
      session_id: result.session_id || init.session_id,
      resolved_model: result.model || init.model || this.model,
      final_text: claudeFinalText(events),
      events,
      ...usage,
      tool_calls: events.filter((event) => event.type === 'assistant' && event.message?.content?.some?.((item) => item.type === 'tool_use')).length,
      subagent_calls: claudeSubagentCalls(events),
    };
  }

  preflight() { return { command: 'claude', args: ['auth', 'status'] }; }

  version() { return { command: 'claude', args: ['--version'] }; }
}

export function createAdapter(config) {
  if (config.provider === 'codex') return new CodexAdapter(config);
  if (config.provider === 'claude-code') return new ClaudeCodeAdapter(config);
  throw new Error(`Unsupported provider: ${config.provider}`);
}
