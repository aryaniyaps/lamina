# ADR-005: Ship CocoIndex as a private native worker

## Status

Accepted

## Date

2026-07-28

## Context

CocoIndex provides rebuildable source observations but requires Python and
native dependencies. Requiring users to install Python, uv, a virtual
environment, or npm makes graph observation depend on host configuration and
creates an unreliable release boundary. Bundling a Python tree inside the
standalone `lamina` executable duplicates a runtime that graphd does not need.

## Decision

Build one PyInstaller `--onefile` `cocoindex-worker` natively for macOS
arm64/x64, Linux x64/arm64, and Windows x64 from the locked CocoIndex project.
Publish it alongside the matching standalone `lamina` executable and include
both artifacts in `SHA256SUMS`.

The platform installer verifies both checksums before placing the worker in the
versioned private Lamina runtime cache. The standalone executable resolves only
that worker and fails with `LAMINA_OBSERVATION_UNAVAILABLE` plus reinstall
guidance if it is missing or non-executable. `LAMINA_OBSERVATION_BACKEND=node`
remains an explicit development-only switch; it is never an automatic fallback.

## Alternatives Considered

### Embedded Python tree in the standalone executable

It makes the core graph executable carry an unrelated Python runtime and
complicates extraction, cache integrity, and upgrades. Rejected.

### Require a host Python or uv installation

It is convenient for a source checkout, but not for a portable release.
Rejected for installed binaries; source checkout development can continue to
use locked uv.

### Cross-compile workers

Native CocoIndex dependencies make correctness target-specific. Rejected;
release workers are built on their target OS and architecture.

## Consequences

- Release assets double per supported target and need separate checksums.
- The installed worker is replaceable only by a verified reinstall or upgrade.
- Mutable CocoIndex state remains under `.git/lamina/cocoindex`; Ladybug stays
  graphd-only.
- CI must build and smoke-test both native artifacts on every target.
