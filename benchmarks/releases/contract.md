# Web release contract

Version **1.0.0** — discriminated union for public benchmark facts vendored into the Lamina website.

## States

| Status | Purpose | Result fields |
|---|---|---|
| `running` | Locked methodology; runs in progress | **Forbidden** — no `results`, scores, or coverage |
| `published` | Frozen, human-approved claim | Required complete `results` + `coverage` |
| `withheld` | Retracted or unavailable claim | **Forbidden** — no result fields |

## Shared shape (`ReleaseBase`)

Every release artifact includes:

- `contractVersion` — supported contract version (`1.0.0`)
- `releaseKey` — stable website copy key
- `benchmarkId` — benchmark family identifier
- `benchmarkVersion` — methodology version (e.g. `harbor-v4`)
- `status` — `running` | `published` | `withheld`
- `generatedAt` — ISO-8601 timestamp from the release manifest (not wall-clock nondeterminism)
- `construct` — tested product-behavior construct
- `measurement` — primary metric name
- `source` — `{ repository, commit, protocolSha256 }` with commit-pinned provenance
- `runtime` — `{ agent, model, attemptsPerArm, totalBudgetSecondsPerArm }`
- `arms` — matched arm ledger (sorted by `id`)
- `tasks` — public task corpus facts (sorted by `id`; no golden expects). Each task includes `title` and `summary` derived deterministically from the first Markdown H1 and first non-heading paragraph of its declared public brief under `benchmarks/corpus/`.
- `controls` — fairness and validity controls (sorted by `id`)
- `artifacts` — commit-pinned public source links (sorted by `id`)

## State extensions

### `running`

```json
{
  "status": "running",
  "methodologyLockedAt": "2026-07-22T00:00:00.000Z"
}
```

Must **not** contain `results`, `coverage`, `scores`, `aggregate`, or `perTask`.

### `published`

Adds `publishedAt`, `coverage`, and `results` with complete task × arm cells. Deferred until benchmark freeze.

### `withheld`

Adds `withheldAt` and `reasonCode`. Must not contain result fields.

## Invariants (enforced by exporter and validator)

1. The release manifest is the **only** publication selector — no directory scanning or latest-file logic.
2. All GitHub source links use the recorded commit, never `main` or `master`.
3. Task, arm, control, and artifact IDs are unique; manifest `expectedTasks` / `expectedArms` must match the corpus exactly.
4. `protocolSha256` matches the manifest-declared protocol paths at export time, including manifest-declared public task briefs under `benchmarks/corpus/`.
5. Identical manifest inputs produce byte-stable JSON output.
6. No local paths, secrets, raw job IDs, transcripts, or unpublished golden expects in public artifacts.
7. `source.repository` must be the trusted GitHub origin; artifact URLs must resolve at the frozen commit when Git metadata is available.
8. Timestamps must be valid ISO-8601 instants; foreign state fields are rejected per status.
9. Export validates the complete payload before replacing `current/release.json`.
10. Advertised artifact paths must exist at `source.commit` when Git metadata is available; export remains manifest-pinned when it is not.
11. Each artifact `url` must exactly equal the canonical trusted blob URL derived from `source.repository`, `source.commit`, and `artifact.path`; unsafe or traversal paths are rejected.
12. Each task `title` and `summary` are derived from the manifest-declared brief path; both must be non-empty. Task `briefPath` must be a safe repository-relative path with exact shape `benchmarks/corpus/<task-id>/brief.md` (no traversal, absolute paths, or backslashes).
13. `arms`, `tasks`, `controls`, and `artifacts` are sorted by `id`; arms expose non-empty workflow metadata with step budgets that reconcile to `runtime.totalBudgetSecondsPerArm`; runtime attempt and budget fields are positive.
14. Public task title/summary inputs are read from `source.commit` when Git metadata exists; working-tree drift from that commit fails export.
15. Contract v1 uses exact allowed-key validation recursively; unknown score-shaped or golden-shaped fields fail closed.

## Publication commands

```bash
npm run bench:release:export    # manifest → benchmarks/releases/current/release.json
npm run bench:release:validate  # contract + fixture checks
```
