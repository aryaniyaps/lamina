#!/usr/bin/env node
/**
 * Focused onboarding-contract regression checks for README + docs source.
 * Semantic assertions only — no whole-file snapshots.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const README = path.join(root, 'README.md');
const DOCS_CONTENT = path.join(root, 'docs', 'content');
const SITE_DATA = path.join(root, 'docs', 'lib', 'site-data.mjs');
const GENERATE_LLMS = path.join(root, 'docs', 'scripts', 'generate-llms.mjs');
const GETTING_STARTED_META = path.join(DOCS_CONTENT, 'getting-started', '_meta.js');
const DOCS_INDEX = path.join(DOCS_CONTENT, 'index.mdx');
const QUICKSTART = path.join(DOCS_CONTENT, 'getting-started', 'quickstart.mdx');
const INSTALLATION = path.join(DOCS_CONTENT, 'getting-started', 'installation.mdx');
const COMMANDS_INDEX = path.join(DOCS_CONTENT, 'commands', 'index.mdx');
const LAMINA_VERIFY = path.join(DOCS_CONTENT, 'commands', 'lamina-verify.mdx');
const DEMO_HAVENSTAY = path.join(DOCS_CONTENT, 'guides', 'demo-havenstay.mdx');
const THE_LOOP = path.join(DOCS_CONTENT, 'concepts', 'the-loop.mdx');
const WORKING_FINDINGS = path.join(DOCS_CONTENT, 'guides', 'working-with-findings.mdx');
const GLOSSARY = path.join(DOCS_CONTENT, 'reference', 'glossary.mdx');
const PAIR_SPEC_KIT = path.join(DOCS_CONTENT, 'guides', 'pair-with-spec-kit.mdx');
const PAIR_UI = path.join(DOCS_CONTENT, 'guides', 'pair-with-ui-skills.mdx');

const LLMS_TXT = path.join(root, 'docs', 'public', 'llms.txt');
const LLMS_FULL = path.join(root, 'docs', 'public', 'llms-full.txt');

const CANONICAL_LOOP = '/lamina-init → /lamina-design → implement → /lamina-verify → fix';

const EQUAL_PATH_PHRASES = [
  /slash commands or natural language/i,
  /without slash commands/i,
];

const failures = [];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function pass(name) {
  console.log(`PASS ${name}`);
}

async function check(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(`${name}: ${error.message}`);
  }
}

function collectDocsSources() {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(mdx|md|js|mjs)$/.test(entry.name)) {
        files.push(full);
      }
    }
  }
  walk(DOCS_CONTENT);
  return files;
}

function firstWorkflowCommandAfterInstall(source) {
  const installIdx = source.search(/npx skills (install|add)\s+/);
  assert.ok(installIdx >= 0, 'expected install command');
  // Drop package/repo path tokens so `aryaniyaps/lamina` is not mistaken for `/lamina`.
  const after = source
    .slice(installIdx)
    .replace(/aryaniyaps\/lamina/g, '')
    .replace(/github\.com\/[^\s)`'"]+/g, '');
  const commandMatch = after.match(/\/lamina(?:-[a-z]+)?\b/);
  assert.ok(commandMatch, 'expected a Lamina slash command after install');
  return commandMatch[0];
}

function assertContains(source, pattern, label) {
  assert.match(source, pattern, `expected ${label}`);
}

/** Extract a markdown section starting at `startRe` until the next heading matching `endRe`. */
function extractSection(source, startRe, endRe = /^##\s+/m) {
  const startMatch = startRe.exec(source);
  assert.ok(startMatch, `expected section matching ${startRe}`);
  const from = startMatch.index;
  const afterStart = source.slice(from + startMatch[0].length);
  const endMatch = endRe.exec(afterStart);
  const to = endMatch ? from + startMatch[0].length + endMatch.index : source.length;
  return source.slice(from, to);
}

/** First fenced code block inside a section (``` ... ```). */
function firstFence(section) {
  const match = section.match(/```[^\n]*\n([\s\S]*?)```/);
  assert.ok(match, 'expected a fenced code block in section');
  return match[1];
}

function assertOrderedNeedle(section, needles, label) {
  let cursor = 0;
  for (const needle of needles) {
    const idx = section.indexOf(needle, cursor);
    assert.ok(
      idx >= 0,
      `${label}: expected ordered "${needle}" after index ${cursor}`,
    );
    cursor = idx + needle.length;
  }
}

function assertOrderedWorkflow(section, label) {
  assertOrderedNeedle(
    section,
    ['/lamina-init', '/lamina-design', 'Implement', '/lamina-verify'],
    label,
  );
}

/**
 * Classify a copyable `/lamina-verify` string.
 * - bare: only exact `/lamina-verify` (no trailing tokens) — allowed
 * - ok: named target (text or semantic placeholder) + URL / `<base_url>`,
 *   optionally followed by trailing `again`
 * - invalid: any other trailing token without valid target+URL, including
 *   `/lamina-verify again`, URL-only, or `<base_url>` as target
 *
 * Does not strip `again` before deciding whether arguments exist.
 * Optional trailing `again` is handled only after target+URL is parsed.
 * Does not use a `<base_url>\b` lookahead.
 */
function classifyVerifyCommand(raw) {
  let cmd = String(raw).trim().replace(/^`+|`+$/g, '');
  cmd = cmd.replace(/\s*[→].*$/, '').replace(/\s+[—].*$/, '').trim();

  const match = cmd.match(/^\/lamina-verify(?:\s+(.*))?$/s);
  if (!match) return { kind: 'not-command' };

  const args = (match[1] || '').trim();

  // Only exact `/lamina-verify` is bare. Any trailing token requires target+URL.
  if (!args) {
    return { kind: 'bare', command: cmd };
  }

  const parts = args.match(/^(.+?)\s+at\s+(\S+?)(?:\s+again)?$/i);
  if (!parts) {
    return {
      kind: 'invalid',
      command: cmd,
      reason: 'expected "<target> at <url>" form (optional trailing again)',
      args,
    };
  }

  const target = parts[1].trim();
  const url = parts[2].trim().replace(/[)\].,;:]+$/, '');

  if (!target) {
    return { kind: 'invalid', command: cmd, reason: 'empty target', target, url };
  }
  // Explicit rejection — URL or exact <base_url> cannot be the target.
  if (/^https?:\/\//i.test(target) || target === '<base_url>') {
    return {
      kind: 'invalid',
      command: cmd,
      reason: 'target must not be a URL or exact <base_url>',
      target,
      url,
    };
  }
  if (!/^https?:\/\//i.test(url) && url !== '<base_url>') {
    return {
      kind: 'invalid',
      command: cmd,
      reason: 'url must be http(s) or <base_url>',
      target,
      url,
    };
  }

  return { kind: 'ok', command: cmd, target, url };
}

function isValidVerifyWithArgs(raw) {
  return classifyVerifyCommand(raw).kind === 'ok';
}

/**
 * Pull copyable `/lamina-verify` snippets from:
 * - lines inside fenced code blocks
 * - inline code spans
 * - plain lines that begin with `/lamina-verify` (covers already-extracted fence bodies)
 * Bare command names/links without args are classified later as `bare` and ignored.
 */
function extractCopyableVerifyCommands(source) {
  const commands = [];

  function pushCommandLine(line) {
    const cleaned = line.replace(/^\s*(?:\d+\.|[-*])\s*/, '').trim();
    if (!cleaned.startsWith('/lamina-verify')) return;
    commands.push(cleaned);
  }

  for (const fence of source.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const line of fence[1].split('\n')) pushCommandLine(line);
  }

  for (const inline of source.matchAll(/`(\/lamina-verify[^`]*)`/g)) {
    commands.push(inline[1].trim());
  }

  // Plain lines — needed when callers pass an already-unfenced code block body.
  for (const line of source.split('\n')) pushCommandLine(line);

  return [...new Set(commands)];
}

function assertArgumentBearingVerifyCommands(source, label) {
  const commands = extractCopyableVerifyCommands(source);
  let bearing = 0;
  for (const cmd of commands) {
    const result = classifyVerifyCommand(cmd);
    if (result.kind === 'bare' || result.kind === 'not-command') continue;
    bearing += 1;
    assert.equal(
      result.kind,
      'ok',
      `${label}: invalid verify command ${JSON.stringify(cmd)} (${result.reason})`,
    );
  }
  return bearing;
}

function assertVerifyHasTargetAndUrl(source, label) {
  const bearing = assertArgumentBearingVerifyCommands(source, label);
  assert.ok(bearing > 0, `${label}: expected at least one argument-bearing /lamina-verify`);
}

function snapshotGenerated() {
  return {
    txt: fs.existsSync(LLMS_TXT) ? read(LLMS_TXT) : null,
    full: fs.existsSync(LLMS_FULL) ? read(LLMS_FULL) : null,
  };
}

function restoreGenerated(before) {
  if (before.txt === null) fs.rmSync(LLMS_TXT, { force: true });
  else fs.writeFileSync(LLMS_TXT, before.txt);
  if (before.full === null) fs.rmSync(LLMS_FULL, { force: true });
  else fs.writeFileSync(LLMS_FULL, before.full);
}

/**
 * Run generate-llms, invoke assertFn({ llmsTxt, llmsFull }), always restore.
 * Restoration runs even when spawn or assertions fail.
 */
function withGeneratedLlms(assertFn) {
  const before = snapshotGenerated();
  try {
    const result = spawnSync(process.execPath, [GENERATE_LLMS], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `generate-llms failed: ${result.stderr || result.stdout}`);
    assertFn({
      llmsTxt: read(LLMS_TXT),
      llmsFull: read(LLMS_FULL),
    });
  } finally {
    restoreGenerated(before);
  }
}

async function main() {
  await check('README signals explicit invocation (not passive)', () => {
    const source = read(README);
    assertContains(source, /does not activate passively/i, 'not-passive signal');
    assertContains(source, /\*\*SHELL\*\*/i, 'SHELL context label');
    assertContains(source, /\*\*AGENT CHAT\*\*/i, 'AGENT CHAT context label');
    assertContains(source, /\*\*ORDINARY CODING MODE\*\*/i, 'ORDINARY CODING MODE context label');
    assert.equal(
      firstWorkflowCommandAfterInstall(source),
      '/lamina-init',
      'first post-install workflow command must be /lamina-init',
    );
    assert.match(
      source,
      /`?\/lamina\s*<[^>]+>`?\s*is an optional router/i,
      '/lamina described as optional router',
    );
    assert.match(
      source,
      /optional router\s*[—-]\s*not a required setup step/i,
      '/lamina must not be required setup',
    );
  });

  await check('README quickstart ordered loop + phase artifact ownership', () => {
    const source = read(README);
    const quickstart = extractSection(source, /^## Quickstart\s*$/m, /^## /m);
    assertOrderedWorkflow(quickstart, 'README Quickstart');
    assert.match(
      quickstart,
      /Design outputs:.*`run\.json`.*`run\.md`.*`implement\.md`/s,
      'design outputs',
    );
    assert.match(
      quickstart,
      /Verify outputs:.*`report\.md`.*`fix\.md`/s,
      'verify outputs',
    );
    assert.match(quickstart, /walkthrough[^`\n]*optional/i, 'walkthrough optional');
    // Design line must not claim report.md/fix.md as design outputs.
    const designLine = quickstart.match(/\*\*Design outputs:\*\*[^*]+/);
    assert.ok(designLine, 'design outputs line');
    assert.doesNotMatch(designLine[0], /report\.md|fix\.md/);
    assertVerifyHasTargetAndUrl(quickstart, 'README Quickstart');
  });

  await check('docs index signals not-passive + three contexts + ordered journey', () => {
    const source = read(DOCS_INDEX);
    assertContains(source, /does not activate passively/i, 'not-passive signal');
    assertContains(source, /\*\*Shell\*\*/i, 'Shell context');
    assertContains(source, /\*\*Agent chat\*\*/i, 'Agent chat context');
    assertContains(source, /\*\*Ordinary coding mode\*\*/i, 'Ordinary coding mode context');
    assert.equal(firstWorkflowCommandAfterInstall(source), '/lamina-init');
    assertContains(source, /optional router/i, '/lamina optional router');

    const journey = extractSection(source, /^## Canonical journey\s*$/m, /^## /m);
    const fence = firstFence(journey);
    assertOrderedWorkflow(fence, 'docs index canonical journey fence');
    assertVerifyHasTargetAndUrl(fence, 'docs index canonical journey fence');

    // Compact ownership map in the same section.
    assert.match(
      journey,
      /\/lamina-design\s*→\s*run\.json\s*\+\s*run\.md\s*\+\s*implement\.md/,
      'design ownership line',
    );
    assert.match(
      journey,
      /\/lamina-verify[\s\S]*?→\s*report\.md\s*\+\s*fix\.md/,
      'verify ownership line',
    );
    assert.match(journey, /optional walkthrough/i, 'optional walkthrough');
  });

  await check('installation directs to /lamina-init (not /lamina as setup)', () => {
    const source = read(INSTALLATION);
    assertContains(
      source,
      /does not cause Lamina to activate|not with passive/i,
      'not passive after install',
    );
    assertContains(source, /run `?\/lamina-init/i, 'direct /lamina-init');
    assertContains(source, /optional router/i, '/lamina optional');
    assertContains(
      source,
      /not a (required setup step|substitute for `?\/lamina-init)/i,
      'not substitute for init',
    );
    assert.equal(firstWorkflowCommandAfterInstall(source), '/lamina-init');
  });

  await check('quickstart ordered sequence + phase-scoped artifacts', () => {
    const source = read(QUICKSTART);
    assertContains(source, /does not activate passively/i, 'not-passive');

    const canonical = extractSection(source, /^## Canonical sequence\s*$/m, /^## /m);
    const fence = firstFence(canonical);
    assertContains(fence, /^SHELL$/m, 'SHELL label');
    assertContains(fence, /^AGENT CHAT/m, 'AGENT CHAT label');
    assertContains(fence, /^ORDINARY CODING MODE$/m, 'ORDINARY CODING MODE label');
    assertOrderedWorkflow(fence, 'quickstart canonical sequence');
    assert.equal(firstWorkflowCommandAfterInstall(fence), '/lamina-init');
    assertVerifyHasTargetAndUrl(fence, 'quickstart canonical sequence');

    const design = extractSection(source, /^## 3\. Design/m, /^## /m);
    const designTree = firstFence(
      design.slice(design.search(/Success state|run artifacts|\.lamina\/runs/i)),
    );
    assertContains(designTree, /run\.json/, 'design run.json');
    assertContains(designTree, /run\.md/, 'design run.md');
    assertContains(designTree, /implement\.md/, 'design implement.md');
    assert.doesNotMatch(designTree, /report\.md/, 'design tree must not list report.md');
    assert.doesNotMatch(designTree, /fix\.md/, 'design tree must not list fix.md');
    assert.match(design, /report\.md.*produced by verify|verify, not design/i);

    const verify = extractSection(source, /^## 5\. Verify/m, /^## /m);
    assertVerifyHasTargetAndUrl(verify, 'quickstart verify section');
    const verifyTree = firstFence(
      verify.slice(verify.search(/produces:|\.lamina\/runs/i)),
    );
    assertContains(verifyTree, /run\.json/, 'verify updated run.json');
    assertContains(verifyTree, /report\.md/, 'verify report.md');
    assertContains(verifyTree, /fix\.md/, 'verify fix.md');
    assertContains(verifyTree, /walkthrough\//, 'verify walkthrough path');
    assert.match(verifyTree, /optional/i, 'walkthrough optional in verify tree');
  });

  await check('getting-started _meta lists Quickstart before Installation', () => {
    const source = read(GETTING_STARTED_META);
    const quickstartIdx = source.indexOf('quickstart');
    const installationIdx = source.indexOf('installation');
    assert.ok(quickstartIdx >= 0 && installationIdx >= 0, 'both keys present');
    assert.ok(quickstartIdx < installationIdx, 'quickstart must precede installation');
  });

  await check('canonical workflow sections are ordered init→design→implement→verify', () => {
    const cases = [
      {
        file: README,
        start: /^## Quickstart\s*$/m,
        label: 'README Quickstart',
        ordered: true,
      },
      {
        file: DOCS_INDEX,
        start: /^## Canonical journey\s*$/m,
        label: 'docs index Canonical journey',
        useFence: true,
      },
      {
        file: QUICKSTART,
        start: /^## Canonical sequence\s*$/m,
        label: 'quickstart Canonical sequence',
        useFence: true,
      },
      {
        file: COMMANDS_INDEX,
        start: /^## Quick path\s*$/m,
        label: 'commands Quick path',
        useFence: true,
        // commands quick path uses "# your agent implements" rather than "Implement"
        needles: ['/lamina-init', '/lamina-design', 'implement', '/lamina-verify'],
      },
      {
        file: THE_LOOP,
        start: /^## Quick path\s*$/m,
        label: 'the-loop Quick path',
        useFence: true,
        needles: ['/lamina-init', '/lamina-design', 'implement', '/lamina-verify'],
      },
      {
        file: PAIR_SPEC_KIT,
        start: /^## Recommended workflow\s*$/m,
        label: 'pair-with-spec-kit Recommended workflow',
        useFence: true,
        needles: ['/lamina-init', '/lamina-design', 'implements', '/lamina-verify'],
      },
      {
        file: PAIR_UI,
        start: /^## Recommended workflow\s*$/m,
        label: 'pair-with-ui-skills Recommended workflow',
        // fallback: quick path numbered list if no recommended workflow heading
        altStart: /^## Quick path\s*$/m,
        needles: ['/lamina-init', '/lamina-design', '/lamina-verify'],
        requireImplement: true,
      },
    ];

    for (const item of cases) {
      const source = read(item.file);
      let section;
      try {
        section = extractSection(source, item.start, /^## /m);
      } catch {
        if (item.altStart) section = extractSection(source, item.altStart, /^## /m);
        else throw new Error(`${item.label}: missing section`);
      }
      const body = item.useFence ? firstFence(section) : section;
      const needles = item.needles ?? [
        '/lamina-init',
        '/lamina-design',
        'Implement',
        '/lamina-verify',
      ];
      assertOrderedNeedle(body, needles, item.label);
      if (item.requireImplement) {
        assert.match(
          body,
          /implement/i,
          `${item.label}: expected ordinary implementation step`,
        );
      }
    }
  });

  await check('verify helper positive/negative target cases', () => {
    const reject = [
      '/lamina-verify http://localhost:3000',
      '/lamina-verify <base_url>',
      '/lamina-verify <base_url> at http://localhost:3000',
      '/lamina-verify again',
    ];
    for (const cmd of reject) {
      const result = classifyVerifyCommand(cmd);
      assert.equal(result.kind, 'invalid', `expected reject: ${cmd}`);
      assert.equal(isValidVerifyWithArgs(cmd), false, `isValid reject: ${cmd}`);
    }

    const accept = [
      '/lamina-verify guest checkout at http://localhost:3000',
      '/lamina-verify hall ticket download at http://localhost:3000',
      '/lamina-verify <one feature or flow> at <base_url>',
      '/lamina-verify guest checkout at http://localhost:3000 again',
    ];
    for (const cmd of accept) {
      const result = classifyVerifyCommand(cmd);
      assert.equal(result.kind, 'ok', `expected accept: ${cmd} (${result.reason || ''})`);
      assert.equal(isValidVerifyWithArgs(cmd), true, `isValid accept: ${cmd}`);
    }

    assert.equal(classifyVerifyCommand('/lamina-verify').kind, 'bare');
  });

  await check('all copyable verify commands have named target and URL', () => {
    const files = [README, ...collectDocsSources()];
    let total = 0;
    for (const file of files) {
      total += assertArgumentBearingVerifyCommands(
        read(file),
        path.relative(root, file),
      );
    }
    assert.ok(total > 0, 'expected argument-bearing verify commands in README/docs');
  });

  await check('cross-page ops semantics and product/contract exit', () => {
    const pages = [LAMINA_VERIFY, THE_LOOP, WORKING_FINDINGS, GLOSSARY];
    for (const file of pages) {
      const source = read(file);
      const label = path.relative(root, file);

      assert.match(source, /\bproduct\b/, `${label}: mentions product`);
      assert.match(source, /\bcontract\b/, `${label}: mentions contract`);
      assert.match(source, /\bops\b/, `${label}: mentions ops`);
      assert.match(
        source,
        /report-only|stays in `report\.md`|`report\.md` only|report\.md` and do not/i,
        `${label}: ops report-only behavior`,
      );
      assert.match(
        source,
        /(?:(?:no|zero)\s+open\s+product\s+or\s+contract|does not block\s+product\/?contract\s+exit)/i,
        `${label}: no-open-product-or-contract exit`,
      );
      assert.doesNotMatch(
        source,
        /product\s*\(default\)/i,
        `${label}: must not say product (default)`,
      );
      assert.doesNotMatch(
        source,
        /(?:until|when|loop until)\s+(?:all\s+)?(?:`?findings(?:\[\])?`?|findings)\s+(?:are\s+)?empty|empty\s+(?:`?findings(?:\[\])?`?|findings).*(?:exit|pass|complete)|(?:exit|pass|complete).*(?:all\s+)?(?:`?findings(?:\[\])?`?)\s+(?:are\s+)?empty/i,
        `${label}: must not use empty-all-findings exit`,
      );
    }
  });

  await check('human-facing docs reject equal-path natural-language phrases', () => {
    const targets = [README, ...collectDocsSources()];
    for (const file of targets) {
      const source = read(file);
      for (const phrase of EQUAL_PATH_PHRASES) {
        assert.doesNotMatch(
          source,
          phrase,
          `${path.relative(root, file)} must not contain ${phrase}`,
        );
      }
    }
  });

  await check('stale run.yaml/personas.yaml only in labeled legacy HavenStay demo', () => {
    const demo = read(DEMO_HAVENSTAY);
    assert.match(demo, /archived legacy/i, 'demo must label archived legacy context');
    assert.match(demo, /personas\.yaml/, 'legacy demo may list personas.yaml');
    assert.match(demo, /run\.yaml/, 'legacy demo may list run.yaml');

    const readme = read(README);
    assert.match(readme, /verify-report\.md/, 'README may link legacy demo verify-report.md');
    assert.doesNotMatch(
      readme,
      /(?:current|canonical).*(?:run\.yaml|personas\.yaml)|(personas\.yaml|run\.yaml).*(?:current|canonical)/i,
      'README must not present yaml names as current/canonical',
    );

    for (const file of collectDocsSources().filter((f) => f !== DEMO_HAVENSTAY)) {
      const source = read(file);
      assert.doesNotMatch(
        source,
        /personas\.yaml/,
        `${path.relative(root, file)} must not mention personas.yaml outside legacy demo`,
      );
      assert.doesNotMatch(
        source,
        /run\.yaml/,
        `${path.relative(root, file)} must not mention run.yaml outside legacy demo`,
      );
    }
  });

  await check('SITE.loop and invocation metadata are commands-first', async () => {
    const site = await import(pathToFileURL(SITE_DATA).href);
    assert.equal(site.SITE.loop, CANONICAL_LOOP);
    assert.match(site.SITE.productSummary, /does not activate passively/i);
    assert.match(site.SITE.productSummary, /slash commands explicitly/i);
    assert.ok(
      site.SITE.commands.includes('/lamina-init'),
      'commands list includes /lamina-init',
    );
    assert.ok(
      site.SITE.commands.some((c) => /optional router/i.test(c)),
      'commands list marks /lamina as optional router',
    );
    assert.match(site.SITE.description, /\/lamina-init/);
  });

  await check('generate-llms txt + full preserve commands-first contract', () => {
    const generatorSource = read(GENERATE_LLMS);
    assert.match(generatorSource, /SITE\.loop/);
    assert.match(generatorSource, /does not activate passively/i);
    assert.match(generatorSource, /Run slash commands explicitly/i);

    withGeneratedLlms(({ llmsTxt, llmsFull }) => {
      assert.match(
        llmsTxt,
        /\/lamina-init → \/lamina-design → implement → \/lamina-verify → fix/,
      );
      assert.match(llmsTxt, /does not activate passively/i);
      assert.match(llmsTxt, /Run slash commands explicitly/i);
      assert.match(llmsTxt, /\/lamina-init/);

      // Representative metavariables preserved in full export (fenced-code safe strip).
      assert.match(
        llmsFull,
        /\/lamina-init\s+<(?:your product domain and primary users|domain)>/,
        'llms-full preserves domain metavariable',
      );
      assert.match(
        llmsFull,
        /\.lamina\/runs\/<run_id>\//,
        'llms-full preserves <run_id> path',
      );
      assert.match(
        llmsFull,
        /\/lamina-verify\s+.+?\s+at\s+<base_url>/,
        'llms-full preserves verify target + <base_url>',
      );

      const llmsBearing = assertArgumentBearingVerifyCommands(llmsFull, 'llms-full.txt');
      assert.ok(llmsBearing > 0, 'llms-full has argument-bearing verify commands');

      // Glossary three-target model must survive AI export.
      assert.match(
        llmsFull,
        /## fix_target[\s\S]*?\bproduct\b[\s\S]*?\bcontract\b[\s\S]*?\bops\b[\s\S]*?report-only/i,
        'llms-full glossary fix_target includes product/contract/ops report-only',
      );
      assert.match(
        llmsFull,
        /fix_target:\s*ops[\s\S]*?report\.md/i,
        'llms-full glossary Finding entry mentions ops in report.md',
      );

      assert.doesNotMatch(llmsFull, /import\s+from\s+['"]/, 'no corrupted import  from');
      assert.doesNotMatch(llmsFull, /^import\s+/m, 'no leaked raw import line');
      assert.doesNotMatch(llmsFull, /<\/?Callout\b/i, 'no leaked Callout wrapper');
    });
  });

  await check('generated llms files restore after assertion failure', () => {
    const before = snapshotGenerated();
    try {
      // Ensure files exist so we can detect overwrite; write a unique sentinel baseline.
      const marker = `# onboarding-test-sentinel-${Date.now()}\n`;
      fs.mkdirSync(path.dirname(LLMS_TXT), { recursive: true });
      fs.writeFileSync(LLMS_TXT, marker);
      fs.writeFileSync(LLMS_FULL, marker);
      const marked = snapshotGenerated();

      let sawDeliberate = false;
      try {
        withGeneratedLlms(() => {
          // Generator has overwritten the sentinel; now fail deliberately.
          assert.notEqual(read(LLMS_TXT), marker, 'precondition: generator overwrote sentinel');
          throw new Error('deliberate onboarding assertion failure');
        });
      } catch (error) {
        if (error.message === 'deliberate onboarding assertion failure') {
          sawDeliberate = true;
        } else {
          throw error;
        }
      }

      assert.ok(sawDeliberate, 'expected deliberate failure to surface');
      // Inner helper must have restored the sentinel snapshot after the deliberate failure.
      assert.equal(read(LLMS_TXT), marked.txt, 'llms.txt restored after failure');
      assert.equal(read(LLMS_FULL), marked.full, 'llms-full.txt restored after failure');
    } finally {
      // Always put the true pre-test content back, even if postconditions fail.
      restoreGenerated(before);
    }
  });

  if (failures.length > 0) {
    console.error(`\n${failures.length} onboarding contract check(s) failed`);
    process.exit(1);
  }

  console.log('\nAll onboarding contract checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
