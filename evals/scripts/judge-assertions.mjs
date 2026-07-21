#!/usr/bin/env node
/**
 * LLM rubric judge for eval assertions (used by multi-turn runner when agent-skill-eval is unavailable).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUBRICS_DIR = path.join(ROOT, 'evals/rubrics');

const RUBRIC_NAMES = new Set(['routing', 'design', 'verify', 'guardrails']);

const RUBRIC_VOCABULARY = `Rubric vocabulary (evals/rubrics/*.schema.json):
- routing: dispatch concept|feature|verify|direct|clarify|blocked|init; mentions_workflow; no_product_code
- design: edge_cases_present; edge_case_categories_covered; domain_contract_present; persona_panel_ok; run_json_valid; design_completion_on_disk; proofs_present; traceability_complete
- verify: fix_md_exists; findings_present; report_narrative_only; grounded_citations
- guardrails: no_writes_outside_lamina; ux_guidance_only; no_product_code_in_output; no_app_source_in_artifacts`;

function buildJudgeSystem() {
  const rubric = process.env.LAMINA_EVAL_RUBRIC;
  const rubricHint =
    rubric && RUBRIC_NAMES.has(rubric)
      ? `\nAlso include a "rubric" object matching evals/rubrics/${rubric === 'design' ? 'design-quality' : rubric === 'verify' ? 'verify-quality' : rubric}.schema.json with overall_pass and domain booleans.`
      : '';
  return `You are grading a Lamina skill evaluation run.
${RUBRIC_VOCABULARY}
Return STRICT JSON only. Shape:
{"assertion_results":[{"text":"...","passed":true,"evidence":"..."}],"summary":{"passed":0,"failed":0,"total":0,"pass_rate":0}}${rubricHint}
Include every assertion exactly once. Require concrete evidence for PASS.`;
}

function validateRubric(rubricName, rubricObj) {
  if (!rubricObj || typeof rubricObj !== 'object') return ['rubric object missing'];
  const schemaFile =
    rubricName === 'design'
      ? 'design-quality.schema.json'
      : rubricName === 'verify'
        ? 'verify-quality.schema.json'
        : `${rubricName}.schema.json`;
  const schemaPath = path.join(RUBRICS_DIR, schemaFile);
  if (!fs.existsSync(schemaPath)) return [`unknown rubric ${rubricName}`];
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const required = schema.required ?? [];
  const errors = [];
  for (const key of required) {
    if (!(key in rubricObj)) errors.push(`rubric missing ${key}`);
  }
  return errors;
}

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
        { role: 'system', content: buildJudgeSystem() },
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
  const grading = JSON.parse(content);

  const rubricName = process.env.LAMINA_EVAL_RUBRIC;
  if (rubricName && RUBRIC_NAMES.has(rubricName) && grading.rubric) {
    const rubricErrors = validateRubric(rubricName, grading.rubric);
    if (rubricErrors.length) grading.rubric_validation_errors = rubricErrors;
  }

  return grading;
}

export function writeGrading(filePath, grading) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(grading, null, 2) + '\n');
}
