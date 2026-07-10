#!/usr/bin/env node
/**
 * Shared helpers for vendoring full OSS fixture trees into evals/fixtures/_base/.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/** Directory names excluded from vendored fixtures (not product trimming). */
export const EXCLUDE_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  '.turbo',
  'coverage',
  '.cache',
  '.vercel',
  '.output',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.venv',
  'venv',
]);

export function rimraf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

export function shouldExcludeDir(name) {
  return EXCLUDE_DIR_NAMES.has(name);
}

export function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

export function copyTree(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.lstatSync(src);

  if (stat.isSymbolicLink()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.symlinkSync(fs.readlinkSync(src), dest);
    return;
  }

  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (shouldExcludeDir(name)) continue;
      copyTree(path.join(src, name), path.join(dest, name));
    }
    return;
  }

  copyFile(src, dest);
}

export function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function dirSize(dir) {
  let total = 0;
  for (const file of walk(dir)) {
    total += fs.statSync(file).size;
  }
  return total;
}

export function getCommitSha(cloneDir) {
  return execSync('git rev-parse HEAD', { cwd: cloneDir, encoding: 'utf8' }).trim();
}

export function parseRefArg(argv, defaultRef) {
  const idx = argv.indexOf('--ref');
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : defaultRef;
}

/**
 * Clone repo, copy full working tree to outDir, write ATTRIBUTION.md.
 */
export function vendorFixture({
  root,
  repoUrl,
  repoSlug,
  outDir,
  ref,
  licenseNote,
  cloneSubdir = 'repo',
}) {
  const tmp = fs.mkdtempSync(path.join(root, 'evals/fixtures/.vendor-tmp-'));
  const cloneDir = path.join(tmp, cloneSubdir);

  console.log(`Cloning ${repoUrl} (ref: ${ref})...`);
  execSync(`git clone --depth 1 --branch ${ref} ${repoUrl} ${cloneDir}`, { stdio: 'inherit' });

  const commit = getCommitSha(cloneDir);
  rimraf(outDir);
  fs.mkdirSync(outDir, { recursive: true });

  for (const name of fs.readdirSync(cloneDir)) {
    if (name === '.git' || shouldExcludeDir(name)) continue;
    copyTree(path.join(cloneDir, name), path.join(outDir, name));
  }

  const attribution = `# Attribution

Source: [${repoSlug}](https://github.com/${repoSlug})
Commit: \`${commit}\`
Ref: \`${ref}\`
${licenseNote}

Full source tree vendored for Lamina eval/benchmark fixtures — excludes \`.git\`, \`node_modules\`, and build/cache directories only.
Refresh: \`npm run fixtures:vendor\`
`;
  fs.writeFileSync(path.join(outDir, 'ATTRIBUTION.md'), attribution);

  rimraf(tmp);

  const fileCount = walk(outDir).length;
  const size = formatBytes(dirSize(outDir));
  console.log(`\nVendored ${fileCount} files (${size}) → ${path.relative(root, outDir)}`);
  console.log(`Commit: ${commit}`);

  return { commit, fileCount, size };
}
