import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { digest, repositoryContext } from './graph-runtime/util.mjs';

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js',
  '.jsx', '.json', '.kt', '.md', '.mjs', '.php', '.py', '.rb', '.rs', '.scss',
  '.sql', '.swift', '.ts', '.tsx', '.vue', '.yaml', '.yml',
]);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_RESULTS = 12;

function tokens(value) {
  return [...new Set(String(value).toLowerCase().match(/[a-z_][a-z0-9_-]{2,}/g) || [])];
}

function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).split('\0').filter(Boolean);
}

export function contextCatalog(cwd = process.cwd()) {
  const repo = repositoryContext(cwd);
  return {
    schema: 'lamina.context-catalog/v1',
    source_revision: repo.source_revision,
    authority: {
      graph: 'exact_graph_closure',
      provenance: 'direct_supportedBy_edges',
      source_localization: 'derived_non_authoritative_index',
    },
    retrieval: {
      order: ['exact_graph_closure', 'direct_provenance', 'lexical_source_candidates', 'dense_source_candidates'],
      lexical: { engine: 'deterministic_term_rank', availability: 'available' },
      dense: {
        engine: 'local_checksum_managed_model',
        preferred_model: 'jinaai/jina-embeddings-v2-base-code',
        availability: 'unavailable',
        fallback: 'lexical_degraded',
        authoritative: false,
      },
    },
    storage: path.join(repo.runtime_dir, 'context'),
    privacy: 'repository_local_git_common_dir',
  };
}

export function sourceCandidates(query, cwd = process.cwd()) {
  const repo = repositoryContext(cwd);
  const terms = tokens(query);
  if (!terms.length) return [];
  const rows = [];
  for (const relative of trackedFiles(repo.root)) {
    const absolute = path.join(repo.root, relative);
    if (!TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue;
    let stat;
    try { stat = fs.statSync(absolute); } catch { continue; }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
    let content;
    try { content = fs.readFileSync(absolute, 'utf8'); } catch { continue; }
    const lower = content.toLowerCase();
    const pathLower = relative.toLowerCase();
    let score = 0;
    const matched = [];
    for (const term of terms) {
      const pathHits = pathLower.includes(term) ? 1 : 0;
      const contentHits = lower.split(term).length - 1;
      if (pathHits || contentHits) matched.push(term);
      score += pathHits * 8 + Math.min(contentHits, 12);
    }
    if (!score) continue;
    const first = matched.length ? lower.indexOf(matched[0]) : 0;
    const line = first < 0 ? 1 : lower.slice(0, first).split('\n').length;
    rows.push({
      path: relative,
      line,
      score,
      matched_terms: matched,
      content_digest: digest('chunk', content),
    });
  }
  return rows.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, MAX_RESULTS);
}
