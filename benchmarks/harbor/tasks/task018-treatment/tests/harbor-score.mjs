#!/usr/bin/env node
/**
 * Harbor verifier scorer — runs inside Harbor trial container at /tests/harbor-score.mjs.
 * Bundles /app source, scores golden coverage, optional LLM judge when Anthropic creds exist.
 * Writes /logs/verifier/reward.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureImplementationArtifact, isArtifactValid } from './deps/artifact-contract.mjs';
import { isClarifyOutput } from './deps/bench-clarify.mjs';
import { readYamlSync } from './deps/yaml.mjs';

const GOLDEN_FIELD_WEIGHTS = {
  required_invariants: 2,
  required_entities: 2,
  required_scenarios: 2,
  required_tradeoffs: 2,
  required_personas: 1,
  required_flows: 1,
  required_rules: 1,
  required_edge_cases: 1,
  required_a11y: 1,
  required_findings: 1,
};

const ALIASES = {
  one_active_budget_per_household: ['single active budget', 'one budget per household', 'only one active budget'],
  partner_privacy_boundary: ['partner privacy', 'privacy between partners', 'partner data boundary'],
  no_investment_advice_display: ['no investment advice', 'exclude investment advice', 'without investment advice'],
  sync_failure_recovery: ['sync failure', 'when sync fails', 'recover from sync'],
  zero_income_month: ['zero income', 'no income month', 'month with no income'],
  duplicate_transaction_handling: ['duplicate transaction', 'dedupe transaction', 'duplicate transactions'],
};

function parseArgs() {
  const opts = { workspace: '/app', out: '/logs/verifier/reward.json', golden: '/tests/golden.yaml', meta: '/tests/task-meta.json' };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--workspace') opts.workspace = process.argv[++i];
    else if (process.argv[i] === '--out') opts.out = process.argv[++i];
    else if (process.argv[i] === '--golden') opts.golden = process.argv[++i];
    else if (process.argv[i] === '--meta') opts.meta = process.argv[++i];
  }
  return opts;
}

function normalize(text) {
  return text.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
}

function phrasesFor(item) {
  const key = String(item);
  const phrases = [normalize(key)];
  if (ALIASES[key]) phrases.push(...ALIASES[key].map(normalize));
  return phrases;
}

function phraseMatches(phrase, text) {
  const words = phrase.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return phrase.length > 0 && text.includes(phrase);
  if (text.includes(phrase)) return true;
  const matched = words.filter((w) => text.includes(w));
  return matched.length >= Math.ceil(words.length * 0.6);
}

function itemMatches(item, text) {
  return phrasesFor(item).some((p) => phraseMatches(p, text));
}

function scoreGolden(golden, artifactText) {
  const text = normalize(artifactText);
  let totalWeight = 0;
  let passedWeight = 0;
  const checks = [];
  for (const [field, weight] of Object.entries(GOLDEN_FIELD_WEIGHTS)) {
    const items = golden[field];
    if (!items?.length) continue;
    for (const item of items) {
      totalWeight += weight;
      const pass = itemMatches(item, text);
      if (pass) passedWeight += weight;
      checks.push({ field, item, pass, weight });
    }
  }
  const coverage_score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;
  return { coverage_score, checks, passed: passedWeight, total: totalWeight };
}

function readAgentOutput(logsDir) {
  const candidates = [
    path.join(logsDir, 'agent', 'stdout.txt'),
    path.join(logsDir, 'agent', 'output.txt'),
    path.join(logsDir, 'agent', 'claude-code.txt'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  const agentDir = path.join(logsDir, 'agent');
  if (!fs.existsSync(agentDir)) return '';
  for (const name of fs.readdirSync(agentDir)) {
    const p = path.join(agentDir, name);
    if (fs.statSync(p).isFile() && /\.(txt|log|md|jsonl)$/i.test(name)) {
      try {
        return fs.readFileSync(p, 'utf8').slice(0, 50000);
      } catch {
        /* skip */
      }
    }
  }
  return '';
}

function hasAnthropicCreds() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

async function llmJudgeScore(artifact, golden, taskPrompt) {
  const token = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
  const rubric = [
    'domain_system_structure',
    'invariants_product_rules',
    'workflow_quality',
    'scenario_edge_coverage',
    'overall_product_behavior',
  ];
  const goldenSummary = Object.entries(golden)
    .filter(([k, v]) => Array.isArray(v) && v.length && k.startsWith('required_'))
    .map(([k, v]) => `${k}: ${v.slice(0, 8).join(', ')}`)
    .join('\n');
  const body = {
    model,
    max_tokens: 1024,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: `Score this implementation 1-5 on each criterion (JSON only).\n\nTask: ${taskPrompt}\n\nGolden checklist:\n${goldenSummary}\n\nImplementation (truncated):\n${artifact.slice(0, 20000)}\n\nReturn JSON: {"scores":{"criterion":number,...},"mean":number}`,
      },
    ],
  };
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-api-key': token,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM judge HTTP ${res.status}`);
  const data = await res.json();
  const text = data.content?.find((c) => c.type === 'text')?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM judge: no JSON in response');
  const parsed = JSON.parse(match[0]);
  const mean = parsed.mean ?? (parsed.scores ? Object.values(parsed.scores).reduce((a, b) => a + b, 0) / Object.values(parsed.scores).length : 3);
  return { llm_mean: mean, llm_scores: parsed.scores || {}, judge_mode: 'live' };
}

function heuristicJudge(artifact, golden) {
  const text = artifact.toLowerCase().replace(/[_-]/g, ' ');
  const fields = Object.values(golden).flat().filter((v) => typeof v === 'string');
  const hits = fields.filter((f) => {
    const phrase = f.replace(/_/g, ' ');
    const words = phrase.split(/\s+/).filter((w) => w.length > 2);
    if (!words.length) return text.includes(phrase);
    return words.filter((w) => text.includes(w)).length >= Math.ceil(words.length * 0.6);
  });
  const mean = Math.min(5, Math.max(1, 2.8 + (hits.length / Math.max(fields.length, 1)) * 1.5));
  return { llm_mean: mean, judge_mode: 'heuristic' };
}

async function main() {
  const opts = parseArgs();
  const meta = fs.existsSync(opts.meta) ? JSON.parse(fs.readFileSync(opts.meta, 'utf8')) : {};
  const golden = readYamlSync(opts.golden);
  const agentOutput = readAgentOutput('/logs');
  const artifact = captureImplementationArtifact(opts.workspace, agentOutput);
  const artifact_valid = isArtifactValid(artifact);
  const clarify_stall = !artifact_valid && isClarifyOutput(agentOutput);
  const goldenResult = scoreGolden(golden, artifact);

  let llm = { llm_mean: null, judge_mode: 'skipped' };
  if (artifact_valid) {
    try {
      if (hasAnthropicCreds()) {
        llm = await llmJudgeScore(artifact, golden, meta.prompt || meta.task_id || '');
      } else {
        llm = heuristicJudge(artifact, golden);
      }
    } catch (err) {
      llm = { ...heuristicJudge(artifact, golden), judge_error: err.message };
    }
  }

  const goldenNorm = goldenResult.coverage_score / 100;
  const llmNorm = llm.llm_mean != null ? llm.llm_mean / 5 : 0;
  const composite = artifact_valid ? goldenNorm * 0.5 + llmNorm * 0.5 : 0;
  const reward = clarify_stall && !artifact_valid ? 0 : composite;

  const result = {
    reward,
    max_reward: 1,
    composite,
    golden_coverage: goldenResult.coverage_score,
    llm_judge_mean: llm.llm_mean,
    judge_mode: llm.judge_mode,
    artifact_valid,
    clarify_stall,
    checks_passed: goldenResult.passed,
    checks_total: goldenResult.total,
    feedback: artifact_valid
      ? `Golden ${goldenResult.coverage_score}%, LLM mean ${llm.llm_mean?.toFixed?.(2) ?? 'n/a'}`
      : clarify_stall
        ? 'Clarify stall — incomplete deliverables'
        : 'Missing or invalid implementation artifact',
  };

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(path.dirname(opts.out), 'reward.txt'), String(reward) + '\n');

  // Persist artifact for host ingest
  const artifactOut = path.join('/logs', 'verifier', 'implementation.md');
  fs.writeFileSync(artifactOut, artifact);

  if (!artifact_valid || reward < 0.5) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  fs.mkdirSync('/logs/verifier', { recursive: true });
  fs.writeFileSync('/logs/verifier/reward.txt', '0\n');
  fs.writeFileSync(
    '/logs/verifier/reward.json',
    JSON.stringify({ reward: 0, error: err.message }, null, 2) + '\n'
  );
  process.exit(1);
});
