import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function backupDigest(body) {
  return `backup_${crypto.createHash('sha256')
    .update(JSON.stringify(canonical(body)))
    .digest('hex')
    .slice(0, 32)}`;
}

function readBackup(file, missing) {
  if (!fs.existsSync(file)) {
    missing.push(path.relative(path.dirname(path.dirname(file)), file));
    return null;
  }
  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (payload.format !== 'lamina-graph-backup-v1') {
      missing.push(`${file}: unsupported graph backup format`);
      return null;
    }
    const { integrity, ...body } = payload;
    if (!integrity || backupDigest(body) !== integrity) {
      missing.push(`${file}: graph backup integrity mismatch`);
      return null;
    }
    return payload;
  } catch {
    missing.push(`${file}: graph backup must be valid JSON`);
    return null;
  }
}

function activeGraph(backup, missing) {
  if (!backup) return null;
  const branch = (backup.views || []).find((view) =>
    view.kind === 'branch' && (view.name === 'main' || view.id === 'branch:main'))
    || (backup.views || []).find((view) => view.kind === 'branch');
  if (!branch?.head) {
    missing.push('graph backup has no active branch GraphVersion');
    return null;
  }
  const version = (backup.versions || []).find((item) => item.id === branch.head);
  if (!version?.receipt?.validation?.ok) {
    missing.push('active GraphVersion lacks a successful validation receipt');
  }
  if (!version?.source_revision) {
    missing.push('active GraphVersion lacks source revision');
  }
  const activeIds = new Set(branch.resources || version?.receipt?.active_resources || []);
  const resources = (backup.resources || []).filter((item) => activeIds.has(item.id));
  const activeStatements = new Set(branch.statements || version?.receipt?.active_statements || []);
  const statements = (backup.statements || []).filter((item) => activeStatements.has(item.id));
  return { branch, version, resources, statements };
}

function countKinds(resources) {
  const counts = {};
  for (const resource of resources) counts[resource.kind] = (counts[resource.kind] || 0) + 1;
  return counts;
}

/**
 * Development-pilot treatment gate over a deterministic logical export from
 * graphd. The export is evaluator evidence only; it is never a runtime input.
 * Native persona Task provenance is validated separately from stream-json.
 */
export function checkPilotLaminaTreatment(root, phase) {
  const laminaRoot = path.join(root, '.lamina');
  const missing = [];
  for (const rel of ['business-context.md', 'personas.json']) {
    if (!fs.existsSync(path.join(laminaRoot, rel))) missing.push(`.lamina/${rel}`);
  }
  if (fs.existsSync(path.join(laminaRoot, 'runs'))) {
    missing.push('.lamina/runs must not exist after the transactional hard cutover');
  }

  const initOnly = phase === 'lamina_init';
  const backupRel = initOnly ? 'benchmark/init-graph.json' : 'benchmark/design-graph.json';
  const backup = readBackup(path.join(laminaRoot, backupRel), missing);
  const graph = activeGraph(backup, missing);
  const counts = countKinds(graph?.resources || []);

  if ((counts.product || 0) < 1) missing.push('active graph requires a Product');
  if ((counts.persona || 0) < 2) missing.push('active graph requires at least two evidence-grounded Personas');
  if ((counts.actor || 0) < 1) missing.push('active graph requires an Actor');

  if (!initOnly) {
    for (const kind of ['workflow', 'operation', 'invariant', 'scenario', 'proof', 'mission']) {
      if ((counts[kind] || 0) < 1) missing.push(`active design graph requires a ${kind}`);
    }
    if ((graph?.statements.length || 0) < 1) missing.push('active design graph requires typed Statements');

    const projection = path.join(laminaRoot, 'projections/implement.md');
    if (!fs.existsSync(projection)) {
      missing.push('.lamina/projections/implement.md');
    } else {
      const text = fs.readFileSync(projection, 'utf8');
      if (!graph?.version?.id || !text.includes(graph.version.id) ||
          !graph.version.source_revision || !text.includes(graph.version.source_revision)) {
        missing.push('implementation projection must cite the exported GraphVersion and source revision');
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    graph_version: graph?.version?.id || null,
    source_revision: graph?.version?.source_revision || null,
    resource_counts: counts,
  };
}
