---
name: lamina-information-architecture
description: "Information Architecture UX guidance. Use when structuring content and data; working with complex data displays; IA for task-oriented products."
metadata:
  lamina:
    id: information-architecture
    problems:
      - "structuring content and data"
      - "working with complex data displays"
      - "IA for task-oriented products"
    related:
      - lamina-task-analysis
      - lamina-navigation
      - lamina-content-design
---
# Information Architecture

## Decision frameworks

- **Unified File Model**: Applications own persistence; users work on documents, not files. - Use when users shouldn't manage paths, extensions, or Save As. - How: Auto-save continuously; app-native document browsers; eliminate "Do you want to save?"
- **Rethinking Data Storage**: Automatic save, session-level undo, no exposed file system. - Use when data loss anxiety drives unnecessary confirmations. - How: Persist every few seconds; show documents in Recent lists with readable titles.
- **Rethinking Data Retrieval**: Find by content, recency, thumbnails, search—not folder hierarchy alone. - Use when users can't locate saved work. - How: Timelines, facets, visual browse, smart recents.
- **Session-Level Undo**: Reversing changes across sessions, not just within one editing period.
- **Rethinking Data Retrieval**: Thumbnails, timelines, search facets, and smart recents replace folder drilling. - Use when users lose work or can't find saved content. - How: Default views show recent and visual browse; search across content not paths.

## Checklists

1. Save documents and settings automatically.
2. Put files where users can find them—recents, search, thumbnails.
3. The file system should not be a surrogate for Undo.
4. Unified file model—users manipulate documents, not paths.
5. Retrieval should match human memory—recency, visuals, and search.

## Heuristics

- **Automatic Save**: Persistence without user-initiated save commands.
- **Save documents and settings automatically.**
- **The file system should not be a surrogate for Undo.**
- **Retrieval by browsing vs. search**: Thumbnails for visual scan; query for targeted find.
- **Where did it go?**is a design failure, not a user education problem.
- Users work on**documents**; developers think in**files**—hide the gap.
- Save dialogs are**anxiety artifacts**from missing auto-save and undo.
- **Recency and visuals**match how humans remember content—not paths. - **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.

## Anti-patterns

- **"Do you want to save changes?"**: After obvious extended work.
- **Exposing the file system**: Paths, extensions, folders as user concepts.
- **Save As for versioning**: File-system gymnastics instead of in-app history.
- **Deep folder drilling**: Only retrieval path for photos and documents.

## Examples

- **Working With Data**: A mother closes a word processor after typing a letter. Instead of "Do you want to save?", model auto-saves every few seconds, shows the letter in Recent Documents with a readable title, and offers session-level undo if she deletes content accidentally. Photo libraries show thumbnails and timelines—not folder trees users never organized.

## Related capabilities

- [Task Analysis](../lamina-task-analysis/SKILL.md)
- [Navigation](../lamina-navigation/SKILL.md)
- [Content Design](../lamina-content-design/SKILL.md)
