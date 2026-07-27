#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function filesUnder(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(full, extension);
    return entry.name.endsWith(extension) ? [full] : [];
  });
}

function ordered(source, heading, signals) {
  let offset = source.indexOf(heading);
  assert.ok(offset >= 0, `missing workflow section ${heading}`);
  for (const signal of signals) {
    offset = source.indexOf(signal, offset);
    assert.ok(offset >= 0, `${heading} must include ${signal} in workflow order`);
    offset += signal.length;
  }
}

execFileSync(process.execPath, ['docs/scripts/generate-llms.mjs'], { stdio: 'pipe' });

const docsFiles = filesUnder('docs/content', '.mdx');
const docs = Object.fromEntries(docsFiles.map((file) => [file, fs.readFileSync(file, 'utf8')]));
const readme = fs.readFileSync('README.md', 'utf8');
const cliReadme = fs.readFileSync('packages/cli/README.md', 'utf8');
const llms = fs.readFileSync('docs/public/llms.txt', 'utf8');
const llmsFull = fs.readFileSync('docs/public/llms-full.txt', 'utf8');
const publicSurface = [readme, cliReadme, llms, llmsFull, ...Object.values(docs)].join('\n');

assert.doesNotMatch(publicSurface, /npx skills install/);
for (const source of [
  readme,
  cliReadme,
  docs['docs/content/index.mdx'],
  docs['docs/content/getting-started/installation.mdx'],
]) {
  assert.match(source, /npx skills add aryaniyaps\/lamina --all -y/);
}

for (const signal of [
  'transactional product graph',
  'CocoIndex',
  'graphd',
  'Ladybug',
  'GraphVersion',
  'Persona Mission',
]) {
  assert.match(publicSurface, new RegExp(signal, 'i'), `documentation must explain ${signal}`);
}

ordered(readme, '## Quickstart', ['/lamina-init', '/lamina-design', 'Implement', '/lamina-verify']);
ordered(
  docs['docs/content/getting-started/quickstart.mdx'],
  '# Complete your first workflow',
  ['Initialize product knowledge', 'Design one workflow', 'Implement the resolved version', 'Verify through Persona Missions'],
);

const authoritySurface = [
  docs['docs/content/index.mdx'],
  docs['docs/content/reference/artifacts.mdx'],
  docs['docs/content/reference/global-artifacts.mdx'],
  docs['docs/content/reference/transactional-graph.mdx'],
].join('\n');
assert.match(authoritySurface, /Git common directory/i);
assert.match(authoritySurface, /only (?:read-write )?(?:owner|writer)|sole .*writer/i);
assert.match(authoritySurface, /evidence inputs/i);
assert.match(authoritySurface, /CocoIndex never opens Ladybug/i);
assert.match(authoritySurface, /explicitly transfer/i);
assert.match(authoritySurface, /legacy .*no runtime authority|legacy .*no runtime meaning/i);

for (const [file, source] of Object.entries(docs)) {
  if (file.endsWith('reference/run-json-schema.mdx')) continue;
  assert.doesNotMatch(source, /\brun\.json\b|\bimplement\.md\b|\bfix\.md\b/, `${file} revives a legacy authority artifact`);
}

for (const [file, source] of Object.entries(docs)) {
  for (const line of source.split('\n').filter((item) => item.includes('.lamina/runs'))) {
    assert.match(line, /exclude|legacy|no runtime|untouched/i, `${file} gives legacy runs authority`);
  }
}

const benchmark = docs['docs/content/advanced/lamina-bench.mdx'];
const benchmarkRelease = JSON.parse(fs.readFileSync('benchmarks/releases/current/release.json', 'utf8'));
assert.match(benchmark, /LaminaBench 6 \(LB6\)/);
assert.match(benchmark, /benchmarks\/releases\/current/);
assert.ok(['running', 'published', 'complete'].includes(benchmarkRelease.status));
assert.doesNotMatch(benchmark, /\b\d+(?:\.\d+)?%\b|\boutperform(?:s|ed)?\b/i);

assert.match(readme, /brand\/assets\/wordmark\/lamina-lockup-readme\.svg/);
assert.match(readme, /Design is how it works — not just how it looks\./);
assert.match(readme, /transactional product graph for AI coding agents/i);
assert.match(readme, /never edits application source|do not edit application source/i);
assert.match(readme, /HavenStay predates the transactional graph runtime/);

for (const screenshot of [
  'demo/hotel-booking-with-lamina/screenshot.png',
  'demo/hotel-booking-without-lamina/screenshot.png',
]) {
  assert.ok(fs.existsSync(screenshot), `README demo asset must exist: ${screenshot}`);
  assert.ok(readme.includes(screenshot), `README must reference demo asset: ${screenshot}`);
}

const cliSource = fs.readFileSync('packages/cli/bin/lamina.mjs', 'utf8');
const cliDocs = docs['docs/content/commands/index.mdx'];
const commands = {
  graph: ['query', 'propose', 'patch', 'link', 'retire', 'validate', 'diff', 'status', 'backup', 'restore', 'observe', 'discover', 'rebuild-observations'],
  session: ['start', 'query', 'publish', 'rebase', 'abort'],
  mission: ['compile', 'run'],
};
for (const [domain, names] of Object.entries(commands)) {
  assert.match(cliSource, new RegExp(`domain === '${domain}'`));
  for (const command of names) {
    assert.ok(cliSource.includes(`command === '${command}'`), `parser missing ${domain} ${command}`);
    assert.match(cliDocs, new RegExp(`${domain} ${command.replace('-', '\\-')}(?:\\s|\\\`)`), `CLI docs missing ${domain} ${command}`);
  }
}
for (const option of new Set([...cliSource.matchAll(/\bopt\.([a-z][a-z0-9]*)/g)].map((match) => match[1]))) {
  assert.match(cliDocs, new RegExp(`--${option}\\b`), `CLI docs missing --${option}`);
}
for (const code of [
  'LAMINA_BAD_REQUEST',
  'LAMINA_NOT_FOUND',
  'LAMINA_VALIDATION_FAILED',
  'LAMINA_COMPARE_AND_SWAP_FAILED',
  'LAMINA_EPISTEMIC_STATUS_FORBIDDEN',
  'LAMINA_EVIDENCE_MISSING',
  'LAMINA_UNAUTHORIZED',
  'LAMINA_INTERNAL',
  'LAMINA_OBSERVATION_UNAVAILABLE',
  'LAMINA_OBSERVATION_FAILED',
  'LAMINA_OBSERVATION_INCOMPLETE',
]) {
  assert.ok(cliDocs.includes(code), `CLI docs missing ${code}`);
}

for (const [file, source] of Object.entries(docs)) {
  for (const match of source.matchAll(/\]\((\/[^)#?]+)(?:#[^)]*)?\)/g)) {
    const route = match[1];
    const relative = route.replace(/^\//, '');
    const candidates = [
      path.join('docs/content', `${relative}.mdx`),
      path.join('docs/content', relative, 'index.mdx'),
    ];
    assert.ok(candidates.some(fs.existsSync), `${file} has unresolved internal link ${route}`);
  }
}

for (const section of fs.readdirSync('docs/content', { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  const directory = path.join('docs/content', section.name);
  const metaPath = path.join(directory, '_meta.js');
  if (!fs.existsSync(metaPath)) continue;
  const meta = (await import(`${pathToFileURL(path.resolve(metaPath)).href}?contract`)).default;
  for (const key of Object.keys(meta)) {
    assert.ok(
      fs.existsSync(path.join(directory, `${key}.mdx`)) || fs.existsSync(path.join(directory, key)),
      `${metaPath} navigates to missing page ${key}`,
    );
  }
}

assert.equal(fs.existsSync('docs/tsconfig.tsbuildinfo'), false);
assert.match(fs.readFileSync('.gitignore', 'utf8'), /docs\/tsconfig\.tsbuildinfo/);

console.log(`docs_onboarding_test: ok (${docsFiles.length} pages)`);
