# time concurrency consistency

This is a routing index. Select a leaf from the problem signal; do not load the pack wholesale.

| Signal | Reference | Purpose |
|---|---|---|
| `time_semantics` | [time-semantics](time-concurrency-consistency/time-semantics.md) | Define trustworthy date, time, deadline, expiry, recurrence, and timezone behavior. Use when a product accepts local times, crosses actor timezones, schedules recurring work, or triggers behavior from a clock. |
| `idempotency_concurrency` | [idempotency-concurrency](time-concurrency-consistency/idempotency-concurrency.md) | Duplicate actions and simultaneous edits — double-submit, concurrent admin updates, and safe retries in product behavior. Use when shared resources can be mutated by multiple actors or requests. |
| `consistency_guarantees` | [consistency-guarantees](time-concurrency-consistency/consistency-guarantees.md) | Product-facing consistency — what users and actors may see when, stale vs fresh data, and acceptable lag. Use when multiple views must agree without prescribing storage technology. |
