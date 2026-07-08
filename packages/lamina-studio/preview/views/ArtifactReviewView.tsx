import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStudio } from '../studio/StudioContext.js';
import type { RunArtifactDocument } from '../studio/types.js';

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return markdown;
  return markdown.slice(end + 4).trimStart();
}

function mermaidBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```mermaid\n([\s\S]+?)```/g)].map((m) => m[1].trim());
}

function withoutMermaid(markdown: string): string {
  return stripFrontmatter(markdown).replace(/```mermaid\n[\s\S]+?```/g, '[Mermaid diagram shown below]');
}

function documentBadge(doc: RunArtifactDocument): string {
  if (doc.kind === 'handoff') return 'Handoff';
  if (doc.kind === 'report') return 'Report';
  return doc.pack ?? 'Artifact';
}

function MarkdownDocument({ content }: { content: string }) {
  return (
    <div className="sub-studio-markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{withoutMermaid(content)}</ReactMarkdown>
    </div>
  );
}

export function ArtifactReviewView({ mode }: { mode: 'artifacts' | 'handoff' }) {
  const { artifacts } = useStudio();
  const docs = useMemo(() => {
    const all = artifacts?.documents ?? [];
    if (mode === 'handoff') return all.filter((doc) => doc.kind === 'handoff');
    return all;
  }, [artifacts, mode]);
  const [activeId, setActiveId] = useState('');
  const active = docs.find((doc) => doc.id === activeId) ?? docs[0] ?? null;
  const diagrams = active ? mermaidBlocks(active.content) : [];

  if (!docs.length) {
    return (
      <div className="sub-studio-empty">
        <p>No {mode === 'handoff' ? 'handoff' : 'artifact'} markdown found for this run.</p>
      </div>
    );
  }

  return (
    <div className="sub-studio-artifacts">
      <aside className="sub-studio-artifacts-list" aria-label="Artifact documents">
        <h3>{mode === 'handoff' ? 'Developer handoff' : 'Artifacts'}</h3>
        <ul>
          {docs.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                className={active?.id === doc.id ? 'active' : ''}
                onClick={() => setActiveId(doc.id)}
              >
                <span className="sub-studio-artifact-title">{doc.title}</span>
                <span className="sub-studio-artifact-meta">
                  {documentBadge(doc)}
                  {doc.confidence ? ` · ${doc.confidence}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="sub-studio-artifact-document" aria-label="Artifact content">
        {active ? (
          <>
            <header className="sub-studio-artifact-header">
              <div>
                <h2>{active.title}</h2>
                <p className="sub-studio-muted">
                  <code>{active.path}</code>
                  {active.evidenceMode ? ` · ${active.evidenceMode}` : ''}
                  {active.diagram ? ` · ${active.diagram}` : ''}
                </p>
              </div>
              <span className="sub-studio-artifact-kind">{documentBadge(active)}</span>
            </header>

            <MarkdownDocument content={active.content} />

            {diagrams.length ? (
              <section className="sub-studio-mermaid-section">
                <h3>Mermaid diagrams</h3>
                {diagrams.map((diagram, index) => (
                  <pre key={`${active.id}-${index}`} className="sub-studio-mermaid-preview">
                    {diagram}
                  </pre>
                ))}
              </section>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
