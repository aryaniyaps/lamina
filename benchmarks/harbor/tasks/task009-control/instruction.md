# Offline Editing

Design and implement complete offline editing for a collaborative document editor: edit while offline, visible status, queued sync, and defined conflict resolution on reconnect.

## Requirements

- Continue editing when connectivity drops; offline/online indicator always visible
- Queue edits and sync on reconnect with no silent data loss; define conflict policy (merge vs manual)
- Flows: edit offline, view offline, reconnect sync, conflict resolution
- Handle extended offline (queue overflow), storage full, conflicting edits, and auth expiry while offline
- Status announcements for screen readers
- Trade-off: last-write-wins vs manual merge; queue size vs storage

## Deliverable

A coherent, **buildable application codebase** that implements the product behaviors in this brief: domain model, primary workflows end-to-end, edge/recovery paths, and a usable product surface in source.

Prefer one pragmatic stack you can finish (TypeScript/Node + simple web UI is fine for mobile-first briefs — keep the UI mobile-friendly). Scoring judges **application source**, not CI/CD, app-store packaging, push infrastructure, or production ops — those are out of scope.

Do not stop at a single-screen or thin demo stub. Do not refuse for scope or only write plans.

## Context

## Business goals
Support low-connectivity users (field, travel, remote) without data loss or silent overwrite.

## Users
- Frequent editors working through flaky networks
- Occasional viewers who may open docs offline

## Constraints
- Assume a CRDT-based sync engine exists — design product behavior around it, do not reimplement CRDTs
- Mobile and desktop clients
- Auth can expire while offline; recovery must preserve queued work
