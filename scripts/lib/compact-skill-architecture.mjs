import fs from 'node:fs';
import path from 'node:path';

export function approximateTokens(text) {
  return Math.ceil(text.length / 4);
}

export function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function expandRoute(architecture, workflow, signals = []) {
  if (!workflow) return [];
  const profile = architecture.profiles[workflow];
  if (!profile) throw new Error(`unknown workflow: ${workflow}`);
  const selected = [...profile.always];
  for (const signal of signals) {
    if (!profile.conditional[signal]) throw new Error(`unknown ${workflow} signal: ${signal}`);
    selected.push(...profile.conditional[signal]);
  }
  return [...new Set(selected)];
}

export function publicSkillFor(architecture, workflow) {
  if (architecture.variant === 'candidate-1') return 'lamina';
  return {
    init: 'lamina-init',
    design: 'lamina-design',
    work: 'lamina-work',
    verify: 'lamina-verify',
    'product-question': 'lamina-product',
  }[workflow] || 'lamina';
}

export function loadedContext(variantRoot, architecture, workflow, signals) {
  if (!workflow) return { files: [], approximateTokens: 0, capabilityReferences: 0 };
  const publicSkill = publicSkillFor(architecture, workflow);
  const relativeFiles = [
    `skills/${publicSkill}/SKILL.md`,
    ...expandRoute(architecture, workflow, signals).map((file) => `skills/lamina/${file}`),
  ];
  const files = [...new Set(relativeFiles)];
  const approximateTokenCount = files.reduce((total, file) =>
    total + approximateTokens(fs.readFileSync(path.join(variantRoot, file), 'utf8')), 0);
  return {
    files,
    approximateTokens: approximateTokenCount,
    capabilityReferences: files.filter((file) => file.includes('/references/') &&
      !file.endsWith('authority-and-safety.md') && !file.endsWith('graph-sessions.md')).length,
  };
}

export function validateArchitecture(variantRoot, expectedLedgerRuleIds = null) {
  const errors = [];
  let architecture;
  let traceability;
  try {
    architecture = readJson(path.join(variantRoot, 'architecture.json'));
    traceability = readJson(path.join(variantRoot, 'traceability.json'));
  } catch (error) {
    return { errors: [`invalid architecture metadata: ${error.message}`] };
  }
  const existingFiles = walk(variantRoot)
    .map((file) => path.relative(variantRoot, file).replaceAll(path.sep, '/')).sort();
  if (JSON.stringify(existingFiles) !== JSON.stringify(architecture.expectedInstallInventory)) {
    errors.push('expected install inventory does not match fixture files');
  }
  const publicManifests = existingFiles.filter((file) => /^skills\/[^/]+\/SKILL\.md$/.test(file));
  const nestedManifests = existingFiles.filter((file) => file.endsWith('/SKILL.md') && !/^skills\/[^/]+\/SKILL\.md$/.test(file));
  if (nestedManifests.length) errors.push(`accidental nested public manifest: ${nestedManifests[0]}`);
  const publicNames = [];
  const descriptions = [];
  for (const file of publicManifests) {
    const content = fs.readFileSync(path.join(variantRoot, file), 'utf8');
    const name = content.match(/^name:\s*([^\s]+)$/m)?.[1];
    const description = content.match(/^description:\s*"(.+)"$/m)?.[1];
    if (!name || !description) errors.push(`invalid frontmatter: ${file}`);
    publicNames.push(name);
    descriptions.push(description);
    if (wordCount(content) > architecture.contextBudgets.genericRootWords) errors.push(`public root exceeds word budget: ${file}`);
    if (/read every reference|load all capabilities|read all workflow documents/i.test(content)) errors.push(`eager-load instruction: ${file}`);
  }
  if (new Set(publicNames).size !== publicNames.length) errors.push('duplicate public skill name');
  if (new Set(descriptions).size !== descriptions.length) errors.push('duplicate public skill description');
  if (JSON.stringify([...publicNames].sort()) !== JSON.stringify([...architecture.public].sort())) errors.push('public manifests do not match architecture manifest');

  for (const relative of [...Object.values(architecture.workflows), ...Object.values(architecture.references)]) {
    if (!fs.existsSync(path.join(variantRoot, relative))) errors.push(`missing declared file: ${relative}`);
  }
  for (const [workflow, profile] of Object.entries(architecture.profiles)) {
    for (const relative of [...profile.always, ...Object.values(profile.conditional).flat()]) {
      if (!fs.existsSync(path.join(variantRoot, 'skills/lamina', relative))) errors.push(`missing profile reference: ${workflow}/${relative}`);
    }
  }

  const design = path.join(variantRoot, architecture.workflows.design);
  const verify = path.join(variantRoot, architecture.workflows.verify);
  const work = path.join(variantRoot, architecture.workflows.work);
  const authority = path.join(variantRoot, 'skills/lamina/references/authority-and-safety.md');
  const requiredText = [
    [design, /must not edit application source|never edit application source/i, 'design source-write prohibition'],
    [verify, /source-read-only/i, 'verification source-read-only boundary'],
    [work, /WorkMap gate|WorkMap.*(?:before|blocked)/is, 'WorkMap source-edit gate'],
    [work, /checked\s+map\s+is\s+immutable/i, 'checked WorkMap immutability'],
    [authority, /graphd.*canonical|Ladybug.*canonical/i, 'graph authority'],
    [authority, /raw Cypher/i, 'raw graph internals prohibition'],
  ];
  for (const [file, pattern, label] of requiredText) {
    if (!fs.existsSync(file) || !pattern.test(fs.readFileSync(file, 'utf8'))) errors.push(`missing mandatory safety rule: ${label}`);
  }
  const designForm = architecture.profiles.design?.conditional?.user_facing_form || [];
  if (!designForm.some((file) => file.includes('accessibility'))) errors.push('user-facing form omits accessibility guidance');
  const designTime = architecture.profiles.design?.conditional?.time_bearing_operation || [];
  if (!designTime.some((file) => file.includes('idempotency-concurrency'))) errors.push('time-bearing operation omits concurrency guidance');

  const traceIds = traceability.rules.map((rule) => rule.rule);
  if (new Set(traceIds).size !== traceIds.length) errors.push('duplicate traceability rule');
  if (expectedLedgerRuleIds) {
    const missing = expectedLedgerRuleIds.filter((id) => !traceIds.includes(id));
    if (missing.length) errors.push(`traceability missing baseline rule: ${missing[0]}`);
  }
  for (const rule of traceability.rules) {
    if (!fs.existsSync(path.join(variantRoot, rule.destination))) errors.push(`traceability destination missing: ${rule.rule}`);
  }
  return { architecture, traceability, errors };
}
