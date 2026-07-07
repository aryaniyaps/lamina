#!/usr/bin/env node
/**
 * Vendor a trimmed Vercel Commerce tree into evals/fixtures/_base/nextjs-commerce/.
 * Usage: node evals/scripts/vendor-nextjs-fixture.mjs [--ref main]
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'evals/fixtures/_base/nextjs-commerce');
const REPO = 'https://github.com/vercel/commerce.git';
const ref = process.argv.includes('--ref')
  ? process.argv[process.argv.indexOf('--ref') + 1]
  : 'main';

const COPY_DIRS = ['app', 'components', 'lib', 'public'];
const COPY_FILES = [
  'package.json',
  'tsconfig.json',
  'next.config.ts',
  'next.config.js',
  'postcss.config.mjs',
  'postcss.config.js',
  'tailwind.config.ts',
  'tailwind.config.js',
  'components.json',
  'middleware.ts',
  'license.md',
  'README.md',
];

const EXCLUDE_PUBLIC = new Set(['favicon.ico']);

function rimraf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest, { skipPublicHeavy = false } = {}) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, { skipPublicHeavy });
      continue;
    }
    if (skipPublicHeavy && path.basename(src) === 'public') {
      const ext = path.extname(entry.name).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.ico'].includes(ext)) {
        if (!EXCLUDE_PUBLIC.has(entry.name)) continue;
      }
    }
    copyFile(srcPath, destPath);
  }
}

function getCommitSha(cloneDir) {
  return execSync('git rev-parse HEAD', { cwd: cloneDir, encoding: 'utf8' }).trim();
}

function main() {
  const tmp = fs.mkdtempSync(path.join(ROOT, 'evals/fixtures/.vendor-tmp-'));
  const cloneDir = path.join(tmp, 'commerce');

  console.log(`Cloning ${REPO} (ref: ${ref})...`);
  execSync(`git clone --depth 1 --branch ${ref} ${REPO} ${cloneDir}`, { stdio: 'inherit' });

  const commit = getCommitSha(cloneDir);
  rimraf(OUT);
  fs.mkdirSync(OUT, { recursive: true });

  for (const dir of COPY_DIRS) {
    const src = path.join(cloneDir, dir);
    const dest = path.join(OUT, dir);
    if (dir === 'public') {
      fs.mkdirSync(dest, { recursive: true });
      if (fs.existsSync(src)) {
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext)) continue;
          const srcPath = path.join(src, entry.name);
          const destPath = path.join(dest, entry.name);
          if (entry.isDirectory()) copyDir(srcPath, destPath);
          else copyFile(srcPath, destPath);
        }
      }
    } else {
      copyDir(src, dest);
    }
    console.log(`Copied ${dir}/`);
  }

  for (const file of COPY_FILES) {
    const src = path.join(cloneDir, file);
    if (fs.existsSync(src)) {
      copyFile(src, path.join(OUT, file));
      console.log(`Copied ${file}`);
    }
  }

  const attribution = `# Attribution

Source: [vercel/commerce](https://github.com/vercel/commerce)
Commit: \`${commit}\`
Ref: \`${ref}\`
License: MIT (see license.md in this directory if vendored)

Trimmed for Lamina eval fixtures — app source only, no node_modules or lockfiles.
Refresh: \`npm run fixtures:vendor\`
`;
  fs.writeFileSync(path.join(OUT, 'ATTRIBUTION.md'), attribution);

  rimraf(tmp);
  const fileCount = walk(OUT).length;
  console.log(`\nVendored ${fileCount} files → ${path.relative(ROOT, OUT)}`);
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

main();
