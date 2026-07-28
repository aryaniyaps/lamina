# ADR-004: Bootstrap greenfield repositories without a commit

## Status

Accepted

## Date

2026-07-28

## Context

Lamina stores its clone-local graph under Git metadata, but first-time users
often start in a non-Git folder. Requiring both `git init` and an artificial
initial commit interrupts init and changes user history. Observation also must
not compare two independently implemented filesystem walkers: installation
artifacts and incremental source snapshots can make those counts disagree.

## Decision

`/lamina-init` initializes a missing repository as `main` without staging or
committing files. The CLI represents that as an unborn source revision derived
from the working tree. CocoIndex remains the source of observation completion;
graphd keeps one active observation per source key and extractor, replacing
superseded snapshots atomically.

## Consequences

Fresh projects can initialize in one flow while retaining normal Git ownership.
No application source or commit history is manufactured by Lamina. Historical
observations remain available when referenced as evidence, but stale duplicate
records cannot make the active observation view incomplete.
