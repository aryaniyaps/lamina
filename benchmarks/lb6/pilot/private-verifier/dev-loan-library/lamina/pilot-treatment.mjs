import fs from 'node:fs';
import path from 'node:path';

function listRunJsonPaths(laminaRoot) {
  const runsDir = path.join(laminaRoot, 'runs');
  if (!fs.existsSync(runsDir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runJson = path.join(runsDir, entry.name, 'run.json');
    if (fs.existsSync(runJson)) found.push(runJson);
  }
  return found;
}

/**
 * Development-pilot Lamina treatment gate.
 * Filesystem checks only; native persona Task provenance is validated post-run from stream-json.
 */
export function checkPilotLaminaTreatment(root, phase) {
  const laminaRoot = path.join(root, '.lamina');
  const missing = [];

  const charter = path.join(laminaRoot, 'business-context.md');
  const personas = path.join(laminaRoot, 'personas.json');
  if (!fs.existsSync(charter)) missing.push('.lamina/business-context.md');
  if (!fs.existsSync(personas)) missing.push('.lamina/personas.json');

  if (phase === 'lamina_init') {
    return { valid: missing.length === 0, missing, run_status: null };
  }

  const runPaths = listRunJsonPaths(laminaRoot);
  if (!runPaths.length) missing.push('.lamina/runs/*/run.json');

  let runStatus = null;
  for (const runPath of runPaths) {
    try {
      const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
      runStatus = run.status;
      if (phase === 'lamina_design' && run.status !== 'ready_to_build') {
        missing.push(`${path.relative(root, runPath)} status must be ready_to_build after design`);
      }
      if (phase === 'implement' && !['ready_to_build', 'verifying', 'complete'].includes(run.status)) {
        missing.push(`${path.relative(root, runPath)} status must be ready_to_build, verifying, or complete`);
      }
      if (phase === 'fix') {
        const implementMd = path.join(path.dirname(runPath), 'implement.md');
        if (!fs.existsSync(implementMd)) {
          missing.push(`${path.relative(root, path.dirname(runPath))}/implement.md`);
        }
      }
    } catch {
      missing.push(`${path.relative(root, runPath)} must be valid JSON`);
    }
  }

  return { valid: missing.length === 0, missing, run_status: runStatus };
}
