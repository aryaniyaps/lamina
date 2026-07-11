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

A coherent, buildable **full-product** implementation of the brief: domain model, all primary workflows end-to-end, edge/recovery paths, and a usable product surface. Do not stop at a single-screen or thin demo stub.

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
