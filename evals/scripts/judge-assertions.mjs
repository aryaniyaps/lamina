#!/usr/bin/env node
/**
 * LLM rubric judge for eval assertions (used by multi-turn runner when agent-skill-eval is unavailable).
 */
import fs from 'node:fs';
import path from 'node:path';

const JUDGE_SYSTEM = `You are grading a Lamina skill evaluation run.
Return STRICT JSON only. Shape:
{"assertion_results":[{"text":"...","passed":true,"evidence":"..."}],"summary":{"passed":0,"failed":0,"total":0,"pass_rate":0}}
Include every assertion exactly once. Require concrete evidence for PASS.`;

export async function judgeAssertions(assertions, output, logs = '') {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      assertion_results: assertions.map((text) => ({
        text,
        passed: false,
        evidence: 'OPENAI_API_KEY not set — LLM judge skipped',
        method: 'llm',
        skipped: true,
      })),
      summary: { passed: 0, failed: assertions.length, total: assertions.length, pass_rate: 0 },
    };
  }

  const user = `Assertions:\n${JSON.stringify(assertions, null, 2)}\n\nModel output:\n${output}\n\nAgent logs:\n${logs.slice(0, 12000)}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.LAMINA_EVAL_JUDGE_MODEL || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM judge failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '{}';
  return JSON.parse(content);
}

export function writeGrading(filePath, grading) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(grading, null, 2) + '\n');
}
