---
title: Markdown Renderer Pack
---
# Markdown Renderer Pack

This artifact checks GFM and code rendering.

- Bulleted list
- `inline code`
- A table below

| Column | Value |
| --- | --- |
| Confidence | medium |
| Evidence mode | assumption_allowed |

```mermaid
sequenceDiagram
  participant Reviewer
  participant Studio
  Reviewer->>Studio: Open Artifacts tab
  Studio-->>Reviewer: Render markdown body
```
