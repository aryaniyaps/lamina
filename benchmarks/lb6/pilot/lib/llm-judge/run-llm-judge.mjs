/**
 * Host-side OpenAI LLM judge for LB6 v3 (claim surface: llm_judge_v3).
 * Never runs inside the network=none sealed verifier container.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { captureArtifact } from './capture-artifact.mjs';
import { loadEnvFiles } from './load-env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CRITERIA_PATH = path.join(HERE, 'criteria.json');
const DEFAULT_PROMPT_PATH = path.join(HERE, 'prompt.md');
const DEFAULT_CONTEXTS_DIR = path.join(HERE, 'judge-contexts');

export const MEASUREMENT = 'llm_judge_v3';
export const DEFAULT_MODEL = 'gpt-4.1';
export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_RETRY_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function loadCriteria(criteriaPath = DEFAULT_CRITERIA_PATH) {
  return JSON.parse(fs.readFileSync(criteriaPath, 'utf8'));
}

export function loadPromptTemplate(promptPath = DEFAULT_PROMPT_PATH) {
  return fs.readFileSync(promptPath, 'utf8');
}

export function loadJudgeContext(taskId, contextsDir = DEFAULT_CONTEXTS_DIR) {
  const filePath = path.join(contextsDir, `${taskId}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`judge context missing for task ${taskId}: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function resolveCandidateRoot({
  root,
  candidateDigest,
  sealedRoot = path.join(root, 'benchmarks/lb6/pilot/sealed-store'),
  candidateRoot = null,
}) {
  if (candidateRoot) {
    const resolved = path.resolve(candidateRoot);
    if (!fs.existsSync(resolved)) throw new Error(`candidateRoot missing: ${resolved}`);
    return resolved;
  }
  if (!candidateDigest) throw new Error('candidateDigest or candidateRoot required');
  const objectDir = path.join(sealedRoot, 'objects', `candidate-${candidateDigest}`, 'candidate');
  if (!fs.existsSync(objectDir)) {
    throw new Error(`sealed candidate missing for digest ${candidateDigest}: ${objectDir}`);
  }
  return objectDir;
}

function formatCriteriaBlock(criteriaDoc) {
  return criteriaDoc.criteria
    .map(
      (item, index) =>
        `${index + 1}. **${item.name}** (Likert 1–${item.points}, weight ${item.weight}): ${item.description}`,
    )
    .join('\n');
}

function buildUserPrompt({ promptTemplate, criteriaDoc, judgeContext, implementation }) {
  const criteriaBlock = formatCriteriaBlock(criteriaDoc);
  const instructions = promptTemplate.replace('{criteria}', criteriaBlock);
  return [
    instructions,
    '',
    '## Behavioral reference / task brief',
    '',
    judgeContext.trim(),
    '',
    '## Implementation artifact',
    '',
    implementation.trim(),
  ].join('\n');
}

function extractJsonObject(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('empty judge response');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('judge response is not JSON');
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function normalizeScores(parsed, criteriaDoc) {
  const byName = new Map();
  for (const item of parsed?.criteria || []) {
    if (item?.name) byName.set(String(item.name), item);
  }
  const scores = [];
  for (const criterion of criteriaDoc.criteria) {
    const hit = byName.get(criterion.name);
    const raw = hit?.score;
    const score = Number(raw);
    if (!Number.isInteger(score) || score < 1 || score > criterion.points) {
      throw new Error(`invalid score for ${criterion.name}: ${raw}`);
    }
    scores.push({
      name: criterion.name,
      score,
      weight: criterion.weight,
      points: criterion.points,
      rationale: String(hit?.rationale || '').slice(0, 2000),
      normalized: score / criterion.points,
    });
  }
  if (scores.length !== criteriaDoc.criteria.length) {
    throw new Error('incomplete criterion coverage');
  }
  const weightSum = scores.reduce((sum, item) => sum + item.weight, 0);
  const weighted = scores.reduce((sum, item) => sum + item.normalized * item.weight, 0);
  const reward = weightSum > 0 ? weighted / weightSum : 0;
  return {
    scores,
    reward: Math.round(reward * 10000) / 10000,
    notes: parsed?.notes ? String(parsed.notes).slice(0, 4000) : null,
  };
}

function modelOmitsTemperature(model) {
  const name = String(model || '').toLowerCase();
  // Newer GPT-5.x reasoning models reject non-default temperature.
  return name.includes('gpt-5') || name.includes('o1') || name.includes('o3') || name.includes('o4');
}

async function callOpenAIOnce({
  apiKey,
  model,
  userPrompt,
  baseUrl,
  timeoutMs,
  includeTemperature,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const payload = {
      model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a strict product-behavior judge. Return only valid JSON matching the requested schema.',
        },
        { role: 'user', content: userPrompt },
      ],
    };
    if (includeTemperature) payload.temperature = 0;
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    if (!response.ok) {
      const detail = body?.error?.message || text.slice(0, 400);
      const err = new Error(`OpenAI HTTP ${response.status}: ${detail}`);
      err.status = response.status;
      err.detail = detail;
      throw err;
    }
    const content = body?.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI response missing message content');
    return {
      content,
      model: body?.model || model,
      usage: body?.usage || null,
      id: body?.id || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI({
  apiKey,
  model,
  userPrompt,
  baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  timeoutMs = 120_000,
}) {
  const preferTemp = !modelOmitsTemperature(model);
  try {
    return await callOpenAIOnce({
      apiKey,
      model,
      userPrompt,
      baseUrl,
      timeoutMs,
      includeTemperature: preferTemp,
    });
  } catch (error) {
    const detail = String(error?.detail || error?.message || '');
    if (preferTemp && /temperature/i.test(detail)) {
      return callOpenAIOnce({
        apiKey,
        model,
        userPrompt,
        baseUrl,
        timeoutMs,
        includeTemperature: false,
      });
    }
    throw error;
  }
}

export async function runLlmJudge({
  root,
  taskId,
  arm = null,
  candidateDigest = null,
  candidateRoot = null,
  sealedRoot = null,
  outPath = null,
  model = process.env.LB6_LLM_JUDGE_MODEL || process.env.OPENAI_JUDGE_MODEL || DEFAULT_MODEL,
  apiKey = process.env.OPENAI_API_KEY,
  maxAttempts = Number(process.env.LB6_LLM_JUDGE_MAX_ATTEMPTS || DEFAULT_MAX_ATTEMPTS),
  retryDelayMs = Number(process.env.LB6_LLM_JUDGE_RETRY_DELAY_MS || DEFAULT_RETRY_DELAY_MS),
  semanticReward = null,
  jobName = null,
  trialPath = null,
} = {}) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for LB6 LLM judge');
  }
  const criteriaDoc = loadCriteria();
  const promptTemplate = loadPromptTemplate();
  const judgeContext = loadJudgeContext(taskId);
  const resolvedCandidate = resolveCandidateRoot({
    root,
    candidateDigest,
    candidateRoot,
    sealedRoot: sealedRoot || path.join(root, 'benchmarks/lb6/pilot/sealed-store'),
  });
  const artifact = captureArtifact(resolvedCandidate);
  const userPrompt = buildUserPrompt({
    promptTemplate,
    criteriaDoc,
    judgeContext,
    implementation: artifact.markdown,
  });

  let lastError = null;
  let apiResult = null;
  let normalized = null;
  const attempts = Math.max(1, maxAttempts);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      apiResult = await callOpenAI({ apiKey, model, userPrompt });
      const parsed = extractJsonObject(apiResult.content);
      normalized = normalizeScores(parsed, criteriaDoc);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(retryDelayMs * attempt);
    }
  }

  const degraded = Boolean(lastError) || !normalized;
  const result = {
    measurement: MEASUREMENT,
    claim_surface: 'llm_judge',
    judge_mode: 'openai_judge_only',
    task_id: taskId,
    arm,
    job_name: jobName,
    trial_path: trialPath,
    candidate_digest: candidateDigest,
    candidate_root: resolvedCandidate,
    model: apiResult?.model || model,
    reward: degraded ? 0 : normalized.reward,
    llm_judge: degraded ? 0 : normalized.reward,
    scoring_incomplete: degraded,
    llm_judge_degraded: degraded,
    degradation_reason: degraded ? String(lastError?.message || 'judge failed') : null,
    criteria: normalized?.scores || [],
    notes: normalized?.notes || null,
    artifact: {
      files: artifact.files,
      chars: artifact.chars,
      sha256: sha256Text(artifact.markdown),
    },
    judge_context_sha256: sha256Text(judgeContext),
    prompt_sha256: sha256Text(userPrompt),
    api: degraded
      ? null
      : {
          id: apiResult.id,
          usage: apiResult.usage,
        },
    semantic_diagnostic: semanticReward,
    generated_at: new Date().toISOString(),
  };

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (degraded) {
    const err = new Error(result.degradation_reason);
    err.result = result;
    throw err;
  }
  return result;
}

function parseArgs(argv) {
  const out = {
    root: null,
    taskId: null,
    arm: null,
    candidateDigest: null,
    candidateRoot: null,
    outPath: null,
    model: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--root') out.root = next;
    else if (arg === '--task') out.taskId = next;
    else if (arg === '--arm') out.arm = next;
    else if (arg === '--candidate-digest') out.candidateDigest = next;
    else if (arg === '--candidate-root') out.candidateRoot = next;
    else if (arg === '--out') out.outPath = next;
    else if (arg === '--model') out.model = next;
    else continue;
    i += 1;
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.root || !args.taskId || (!args.candidateDigest && !args.candidateRoot) || !args.outPath) {
    console.error(
      'Usage: run-llm-judge.mjs --root <repo> --task <id> (--candidate-digest <hex>|--candidate-root <dir>) --out <path> [--arm <arm>] [--model <model>]',
    );
    process.exitCode = 2;
    return;
  }
  const root = path.resolve(args.root);
  loadEnvFiles(root);
  const result = await runLlmJudge({
    root,
    taskId: args.taskId,
    arm: args.arm,
    candidateDigest: args.candidateDigest,
    candidateRoot: args.candidateRoot,
    outPath: path.resolve(args.outPath),
    model: args.model || undefined,
  });
  console.log(JSON.stringify({ reward: result.reward, model: result.model, out: args.outPath }));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
