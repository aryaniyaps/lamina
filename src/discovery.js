import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', '.cache', 'vendor']);
const PERMISSION_RE = /\b(role|roles|permission|permissions|canAccess|authorize|requireAuth|middleware|isAdmin|ownerId|tenantId|organizationId)\b/i;

async function walk(root, dir = root, out = []) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(root, full, out);
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function detectPackageManager(root) {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb'))) return 'bun';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  return null;
}

function detectFrameworks(pkg) {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const names = new Set();
  if (deps.next) names.add('Next.js');
  if (deps.react) names.add('React');
  if (deps['react-native']) names.add('React Native');
  if (deps.express) names.add('Express');
  if (deps.fastify) names.add('Fastify');
  if (deps['@prisma/client'] || deps.prisma) names.add('Prisma');
  if (deps['drizzle-orm']) names.add('Drizzle');
  return [...names];
}

function routeFromFile(file) {
  if (/^app\/.+\/page\.(t|j)sx?$/.test(file)) return { path: '/' + file.replace(/^app\//, '').replace(/\/page\.(t|j)sx?$/, ''), file, kind: 'page' };
  if (/^app\/.+\/route\.(t|j)s$/.test(file)) return { path: '/' + file.replace(/^app\//, '').replace(/\/route\.(t|j)s$/, ''), file, kind: 'api' };
  if (/^pages\/.+\.(t|j)sx?$/.test(file) && !file.startsWith('pages/api/')) return { path: '/' + file.replace(/^pages\//, '').replace(/\.(t|j)sx?$/, '').replace(/\/index$/, ''), file, kind: 'page' };
  if (/^pages\/api\/.+\.(t|j)s$/.test(file)) return { path: '/api/' + file.replace(/^pages\/api\//, '').replace(/\.(t|j)s$/, ''), file, kind: 'api' };
  return null;
}

async function scanPermissions(root, files) {
  const matches = [];
  for (const file of files.filter((name) => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(name))) {
    try {
      const text = await readFile(join(root, file), 'utf8');
      if (PERMISSION_RE.test(text)) matches.push({ file, evidence: text.match(PERMISSION_RE)[0] });
    } catch {
      continue;
    }
  }
  return matches.slice(0, 20);
}

export async function scanProject(projectRoot) {
  const files = await walk(projectRoot);
  const pkg = await readJson(join(projectRoot, 'package.json'));
  const packageManager = detectPackageManager(projectRoot);
  const frameworks = detectFrameworks(pkg);
  const routes = files.map(routeFromFile).filter(Boolean);
  const schemas = files.filter((file) => /(^|\/)(schema\.prisma|.*schema.*\.(ts|js)|.*\.sql)$/.test(file)).map((file) => ({ file }));
  const permissions = await scanPermissions(projectRoot, files);
  const existingArtifacts = files.filter((file) => file.startsWith('.lamina/')).map((file) => file.replace('.lamina/', ''));
  const gaps = [];

  if (!pkg) gaps.push('No package.json found.');
  if (frameworks.length === 0) gaps.push('No known framework detected.');
  if (routes.length === 0) gaps.push('No route files detected.');
  if (schemas.length === 0) gaps.push('No schema/model files detected.');
  if (permissions.length === 0) gaps.push('No permission/auth hints detected.');

  const evidenceCount = [pkg, frameworks.length, routes.length, schemas.length, permissions.length].filter(Boolean).length;
  const confidence = evidenceCount >= 4 ? 'high' : evidenceCount >= 2 ? 'medium' : 'low';

  return {
    projectType: frameworks.includes('React Native') ? 'mobile' : frameworks.includes('Next.js') || frameworks.includes('React') ? 'web' : null,
    frameworks,
    packageManager,
    schemas,
    routes,
    permissions,
    existingArtifacts,
    confidence,
    gaps,
  };
}

export function formatDiscoverySummary(context) {
  const lines = ['## What I found', ''];
  lines.push(`- Project type: ${context.projectType ?? 'unknown'}`);
  lines.push(`- Package manager: ${context.packageManager ?? 'unknown'}`);
  lines.push(`- Frameworks: ${context.frameworks.length ? context.frameworks.join(', ') : 'none detected'}`);
  lines.push(`- Routes: ${context.routes.length ? context.routes.map((route) => `${route.path} (${route.file})`).join(', ') : 'none detected'}`);
  lines.push(`- Schemas/models: ${context.schemas.length ? context.schemas.map((schema) => schema.file).join(', ') : 'none detected'}`);
  lines.push(`- Permission hints: ${context.permissions.length ? context.permissions.map((permission) => `${permission.file} (${permission.evidence})`).join(', ') : 'none detected'}`);
  lines.push(`- Existing Lamina artifacts: ${context.existingArtifacts.length ? context.existingArtifacts.join(', ') : 'none detected'}`);
  lines.push('', '## Confidence', '', context.confidence, '', '## Gaps', '');
  lines.push(...(context.gaps.length ? context.gaps.map((gap) => `- ${gap}`) : ['- None detected.']));
  lines.push('');
  return lines.join('\n');
}
