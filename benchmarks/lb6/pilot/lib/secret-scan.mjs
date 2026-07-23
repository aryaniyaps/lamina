import fs from 'node:fs';
import path from 'node:path';
import { collectScoringSensitiveStrings } from './public-golden.mjs';

const SECRET_PATTERNS = [
  /\bCURSOR_API_KEY\s*=\s*\S+/i,
  /\bHARBOR_API_KEY\s*=\s*\S+/i,
  /\bANTHROPIC_API_KEY\s*=\s*\S+/i,
  /\bsk-[a-zA-Z0-9]{20,}\b/,
];

const GRADED_LEAK_PATTERNS = [
  /must_not_include/i,
  /"expect"\s*:/,
];

function listFilesRecursive(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFilesRecursive(full, out);
    else out.push(full);
  }
  return out;
}

function isFinalGradeFile(taskDir, filePath, finalStep) {
  const rel = path.relative(taskDir, filePath).replaceAll('\\', '/');
  return rel === `steps/${finalStep}/tests/grade.mjs`;
}

const VERIFIER_LIB_FILES = new Set([
  'behavior-grade.mjs',
  'behavior-selfcheck.mjs',
  'pilot-behavior-grade.mjs',
  'pilot-treatment.mjs',
]);

function isAgentVisibleBeforeFinal(taskDir, filePath, finalStep) {
  const rel = path.relative(taskDir, filePath).replaceAll('\\', '/');
  if (VERIFIER_LIB_FILES.has(path.basename(rel))) return false;
  if (!rel.startsWith('steps/')) return rel.endsWith('task.toml');
  const stepName = rel.split('/')[1];
  if (stepName === finalStep) return false;
  return /instruction\.md$|selfcheck\.mjs$|grade\.mjs$|test\.sh$/.test(rel);
}

function isFinalAbiFile(taskDir, filePath, finalStep) {
  const rel = path.relative(taskDir, filePath).replaceAll('\\', '/');
  return rel === `steps/${finalStep}/workdir/.lb6-abi/public-abi.json`
    || rel === `steps/${finalStep}/workdir/.lb6-abi/selfcheck.mjs`;
}

function scanHiddenTerms(text, scoringSensitiveStrings) {
  const findings = [];
  const haystack = String(text);
  const haystackLower = haystack.toLowerCase();
  for (const term of scoringSensitiveStrings) {
    if (term.length < 4) continue;
    if (haystack.includes(term) || haystackLower.includes(String(term).toLowerCase())) {
      findings.push({ kind: 'graded_leak', pattern: `scoring-sensitive string "${term}"` });
    }
  }
  return findings;
}

export function scanPilotTaskSecrets(taskDir, { finalStep, scoringSensitiveStrings = [] }) {
  const findings = [];
  for (const filePath of listFilesRecursive(taskDir)) {
    const rel = path.relative(taskDir, filePath).replaceAll('\\', '/');
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        findings.push({ kind: 'secret', file: rel, pattern: pattern.source });
      }
    }

    const beforeFinal = isAgentVisibleBeforeFinal(taskDir, filePath, finalStep)
      && !isFinalGradeFile(taskDir, filePath, finalStep);
    const finalAbi = isFinalAbiFile(taskDir, filePath, finalStep);

    if (beforeFinal) {
      for (const pattern of GRADED_LEAK_PATTERNS) {
        if (pattern.test(text)) {
          findings.push({ kind: 'graded_leak', file: rel, pattern: pattern.source });
        }
      }
      if (/Buffer\.from\([^)]*, ['"]base64['"]\)/.test(text)) {
        findings.push({ kind: 'graded_leak', file: rel, pattern: 'base64 golden payload' });
      }
    }

    if (finalAbi) {
      for (const pattern of GRADED_LEAK_PATTERNS) {
        if (pattern.test(text)) {
          findings.push({ kind: 'graded_leak', file: rel, pattern: pattern.source });
        }
      }
      for (const leak of scanHiddenTerms(text, scoringSensitiveStrings)) {
        findings.push({ kind: leak.kind, file: rel, pattern: leak.pattern });
      }
    }
  }
  return findings;
}

export function scanPilotPackage(tasksRoot, taskSpecs, { scoringSensitiveStringsByTaskId = {} } = {}) {
  const all = [];
  for (const spec of taskSpecs) {
    const taskDir = path.join(tasksRoot, `${spec.taskId}-${spec.arm}`);
    const scoringSensitiveStrings = scoringSensitiveStringsByTaskId[spec.taskId] ?? [];
    const findings = scanPilotTaskSecrets(taskDir, {
      finalStep: spec.finalStep,
      scoringSensitiveStrings,
    });
    for (const finding of findings) {
      all.push({ task: `${spec.taskId}-${spec.arm}`, ...finding });
    }
  }
  return all;
}

export function scoringSensitiveStringsByTaskIdFromManifest(manifest) {
  return Object.fromEntries(
    (manifest.tasks ?? []).map((task) => [task.id, collectScoringSensitiveStrings(task.golden)]),
  );
}
