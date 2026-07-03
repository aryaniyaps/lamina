# Phase 1A Artifact Reuse Design

## Goal

Make `lamina start` reuse prior `.lamina/` knowledge so new sessions carry forward useful decisions, insights, and requirements instead of starting from scratch.

## Scope

In scope:

- Read existing `.lamina/insights.md`, `.lamina/decisions.md`, and `.lamina/requirements.md`.
- Parse Markdown headings into simple named sections.
- Build a compact prior-context object with active decisions, prior insights, and prior requirements.
- Include reused context in generated `current-state.md`, `requirements.md`, and `implementation-tasks.md`.
- Keep behavior dependency-free and deterministic.
- Keep UX-only guardrails active.

Out of scope:

- Semantic relevance scoring.
- LLM summarization.
- Artifact compaction or archiving.
- Native adapters, MCP, SDKs, or analytics connectors.

## Architecture

Add a small artifact reading layer to `src/artifacts.js` because artifact file ownership already lives there. Add a focused `src/prior-context.js` module that converts raw artifact text into reusable context. Pass that context through `startGuidedSession()` into `generateSessionArtifacts()`.

This keeps the change boring: file reads, Markdown heading splits, string inclusion. No new dependency, no persistence migration, no extra command.

## Data Flow

```text
startGuidedSession(projectRoot, io)
  -> initArtifacts(projectRoot)
  -> readArtifacts(projectRoot)
  -> buildPriorContext(artifacts)
  -> scanProject(projectRoot)
  -> ask guided questions
  -> generateSessionArtifacts({ ..., priorContext })
  -> write selected artifacts
```

## Interfaces

### `readArtifacts(projectRoot)`

Defined in `src/artifacts.js`.

Returns:

```js
{
  insights: string,
  decisions: string,
  requirements: string
}
```

Missing files return an empty string for that key.

### `parseMarkdownSections(markdown)`

Defined in `src/prior-context.js`.

Returns:

```js
{
  "Section Name": "section body"
}
```

It parses `##` headings only. Content before the first `##` is ignored.

### `buildPriorContext(artifacts)`

Defined in `src/prior-context.js`.

Input:

```js
{
  insights: string,
  decisions: string,
  requirements: string
}
```

Returns:

```js
{
  activeDecisions: string[],
  priorInsights: string[],
  priorRequirements: string[]
}
```

Each list contains trimmed bullet lines from the matching artifact section. Empty or placeholder bullets such as `- None recorded yet.` are omitted.

## Output Changes

Generated artifacts include a reused-context section when prior context exists.

`current-state.md` gains:

```md
## Reused Context

### Prior Insights

- ...

### Active Decisions

- ...

### Prior Requirements

- ...
```

`requirements.md` gains:

```md
## Prior Requirements Reused

- ...
```

`implementation-tasks.md` gains:

```md
## Reused Context

- Prior insight: ...
- Active decision: ...
- Prior requirement: ...
```

If there is no prior context, these sections are omitted except existing required artifact sections remain unchanged.

## Error Handling

Artifact reads fail soft. Missing `.lamina/` files produce empty strings. Malformed Markdown simply yields no reusable context. This matches Lamina’s confidence-and-gaps posture and avoids blocking sessions over old notes.

## Testing

Add tests for:

- `readArtifacts()` returns known artifact text and empty strings for missing files.
- `parseMarkdownSections()` extracts `##` sections.
- `buildPriorContext()` extracts non-empty bullets from active decisions, key insights, and user requirements.
- `generateSessionArtifacts()` includes reused context when supplied.
- `startGuidedSession()` writes tasks containing reused prior decisions from `.lamina/decisions.md`.

## Acceptance Criteria

- Existing `.lamina/` insights influence new generated artifacts.
- Active decisions are preserved in generated implementation tasks.
- Prior requirements are carried forward into generated requirements/tasks.
- Missing artifacts do not crash `lamina start`.
- No visual design or component code leakage is introduced.
- `npm test` passes.
