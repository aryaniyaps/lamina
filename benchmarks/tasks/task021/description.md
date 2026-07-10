# Offline Editing

Build a **minimal vertical slice** of offline editing for a collaborative document editor: edit while offline, visible status, queued sync, and defined conflict resolution on reconnect.

## Requirements

- Continue editing when connectivity drops; offline/online indicator always visible
- Queue edits and sync on reconnect with no silent data loss; define conflict policy (merge vs manual)
- Flows: edit offline, view offline, reconnect sync, conflict resolution
- Handle extended offline (queue overflow), storage full, conflicting edits, and auth expiry while offline
- Status announcements for screen readers
- Trade-off: last-write-wins vs manual merge; queue size vs storage
