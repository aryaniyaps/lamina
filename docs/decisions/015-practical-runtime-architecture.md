# ADR 015: Practical runtime architecture

- Status: Draft (Slice 3 — Spike evidence recorded; Decision in Slice 4)
- Date: 2026-08-03
- Tracks: [#49](https://github.com/aryaniyaps/lamina/issues/49) epic, [#52](https://github.com/aryaniyaps/lamina/issues/52) open ADR, [#60](https://github.com/aryaniyaps/lamina/issues/60) baseline
- Related: [ADR-012](012-use-local-hybrid-retrieval.md), [ADR-014](014-crash-safe-resource-supervision.md), [runtime baseline v1](../../benchmarks/runtime-baseline-v1/BASELINE.md), [attribution report](../../benchmarks/runtime-baseline-v1/attribution/small.json)

## Context

Epic #49 requires a practical standalone runtime that meets fixed quality,
resource, and latency gates on Linux while remaining offline-capable. The
foundation issues ([#59](https://github.com/aryaniyaps/lamina/issues/59),
[#50](https://github.com/aryaniyaps/lamina/issues/50),
[#60](https://github.com/aryaniyaps/lamina/issues/60),
[#51](https://github.com/aryaniyaps/lamina/issues/51),
[#61](https://github.com/aryaniyaps/lamina/issues/61)) are merged. They
establish:

- the [#60](benchmarks/runtime-baseline-v1/BASELINE.md) real-repository
  measurement harness and promotion fence (small → medium → large);
- the [#51](benchmarks/semantic-oracle-v1/README.md) semantic-behavior oracle
  (compact fixture, no architecture waiver);
- the [#61](benchmarks/real-repository-oracle-v1/README.md) real-repository
  oracle (discovery, scenarios, 72-case expectation contract, candidate
  execution boundaries).

ADR-012 already selected one local **hybrid** retrieval system: exact
id/alias, Ladybug FTS/BM25, shared INT8 ONNX embeddings, reciprocal-rank
fusion, and exact graph closure. graphd remains the sole Ladybug writer; the
native CocoIndex worker performs chunking and ONNX inference but never opens
either database.

ADR-014 requires resource-intensive commands to run inside the safe runner with
cgroup-v2 aggregate `memory.max`, `memory.high`, and `pids.max` enforcement.
On the qualification host the baseline hard limit is **64 tasks** (threads and
processes count toward the same cgroup `TasksMax` budget per ADR-014).

### #60 baseline truth (small fixture, unchanged limits)

Pinned fixture: `alan2207/bulletproof-react` at
`9506629ed003a561c6627735480cce4994244bb4` (20,450 nonblank source LOC, 535
observation candidates). Runtime assets: `cli-v0.3.5` worker (88.7 MiB) and
INT8 model (161.9 MiB).

| Scenario | Status | Notes |
| --- | --- | --- |
| Installation footprint | Valid | ~405 MiB cgroup peak; 14–16 task peak |
| Doctor / status / graphd startup | Valid | Median 459 ms cold; 46-task peak; graphd present |
| Initial observation | **Invalid** | Aggregate PID safety refusal; blocks all later scenarios |
| Medium / large tiers | Not dispatched | Promotion fence after small failure |

The refusal is a **safety envelope**, not a latency sample. Raising PID limits
or bypassing the safe runner would measure a different product.

### Slice 1 attribution (machine-readable)

Committed report:
[`benchmarks/runtime-baseline-v1/attribution/small.json`](../../benchmarks/runtime-baseline-v1/attribution/small.json)
(schema `lamina.runtime-baseline-attribution/v1`, Lamina `a85df76b`, same
fixture pin).

Dominant costs named across valid and refused scenarios:

| Role | Peak threads (sampled) | Peak RSS (refusal scenario) | Scenarios |
| --- | ---: | ---: | --- |
| graphd | 29 | 376 MiB | doctor-status, initial-observation |
| asset extraction worker (CocoIndex) | 22 | 43 MiB | all measured |
| observation worker | 7 (up to 3 processes during observation) | 148 MiB | all measured |
| CLI dispatch | 7 | 54 MiB | all measured |

Initial-observation refusal envelope: `safety_limit_exceeded` / `pids`;
`peak_pids` 48 (sampled), `peak_memory_bytes` 683 MiB — well under the 3 GiB
cgroup ceiling. Memory is **not** the blocking dimension on small; aggregate
task count is.

Phase mapping shows the refusal occurs in the `startup` + `observation`
lifecycle phases, before `retrieval_readiness` or `preparation` run. ONNX
embedder subprocess launches were **not** attributed separately in this run;
dominant native demand is already present from graphd startup and observation
orchestration.

### Quality gates that constrain architecture (not weakened)

These gates apply to every Slice 3 spike and every Phase 2 leaf. This
elimination analysis does not relax them.

**#51 / retrieval held-out (ADR-012, `benchmarks/retrieval-v1/`):**

- Hybrid Workflow and source recall on held-out rows;
- dense Recall@5 within 1 percentage point of the qualified FP16 reference;
- deterministic ranking; INT8 packaging gate already met at 0.96 pp loss.

**#61 real-repository oracle:**

- 72 digest-bound cases across three tiers (identity, semantic/source,
  accepted-state);
- scenario verification and fixture consistency are independent of runtime
  architecture but **production** observation and retrieval paths must remain
  gradeable when candidate execution is enabled.

**Epic #49 / #58 resource gates (targets for final qualification):**

- Peak RSS ≤ 2.0 GiB (8 GB profile) / ≤ 1.5 GiB (16 GB);
- idle ≤ 200 MiB; install ≤ 750 MiB;
- no orphan processes after shutdown;
- warm/cold/incremental latency ceilings per tier.

**#60 harness gates (measurement contract):**

- Same fixture commits, exclusion rules, and safe-runner limits until a
  reviewed runtime improvement completes small without refusal.

---

## Measured root causes (not symptoms)

| Symptom | Root cause | Evidence |
| --- | --- | --- |
| Small `initial-observation` invalid | Aggregate **task budget** exhausted during observation startup | Refusal `limit: pids`; memory 683 MiB ≪ 3 GiB cap; BASELINE.md refusal table |
| Doctor/status succeeds but observation fails | Observation adds **descendant fan-out** on top of near-saturated startup tree | Doctor peak 46 tasks vs footprint 16; observation spawns 3 observation-worker processes vs 1 |
| High thread counts before useful work | **Unbounded native thread pools** in graphd and CocoIndex worker | 29 + 22 sampled threads from two roles alone; ADR-014 counts threads toward `TasksMax` |
| 250 MiB sealed asset overhead | Packaged hybrid retrieval contract (ADR-012) | Worker 88.7 MiB + model 161.9 MiB in manifest; required for dense leg |
| Medium/large blocked | **Promotion fence**, not separate root cause | #60 policy; same topology will scale fan-out with repo size |
| Retrieval scenarios unmeasured | Observation refusal blocks promotion | `scenario_phase_map` never reaches `retrieval_readiness` or `preparation` |

**Not root causes (eliminated as primary hypotheses):**

- **OOM on small** — cgroup memory peak ~683 MiB at refusal.
- **Safe-runner misconfiguration** — production self-test passed; footprint and doctor scenarios valid.
- **Fixture defect** — inventory digests and pins reviewed in #60; refusal is reproducible post-#66.
- **Missing hybrid retrieval quality** — retrieval phases never reached; quality is unknown at runtime baseline but ADR-012 and retrieval-v1 calibrations are the standing contract.

---

## Alternative families

Four families are evaluated against the same #60 small fixture, Slice 1
attribution, ADR-012 retrieval contract, and #51/#61 gate summaries above.

### Family A — Tuned current (graphd + CocoIndex + ADR-012 hybrid)

**Hypothesis:** Keep ADR-012 architecture; add explicit thread-pool caps,
worker concurrency limits, and idle lifecycle tuning so the descendant tree
stays within the 64-task envelope without changing storage topology or
retrieval semantics.

| Factor | Assessment |
| --- | --- |
| Addresses PID refusal | **Partial** — caps directly target 29 + 22 sampled threads |
| Addresses 250 MiB assets | No — model and worker remain mandatory for hybrid |
| #51 / #61 risk | **Lowest** — no semantic contract change |
| Medium/large outlook | Uncertain without caps proven on small |
| Implementation locus | graphd server, CocoIndex worker env, CLI dispatch (#53 concurrency policy) |

**Evidence for:** Doctor/status already runs graphd with 29 threads at 46/64
tasks; modest caps (e.g. ONNX `intra_op` / Ladybug worker pools) could recover
headroom if observation fan-out is bounded separately.

**Evidence against (as sole fix):** Only ~18 tasks of headroom remains before
observation starts; observation increases observation-worker **process** count
(1 → 3) and CLI descendants (6 processes). Thread caps alone do not reduce
process fan-out from multi-worker observation orchestration.

### Family B — Structural / lexical-first retrieval

**Hypothesis:** Remove or defer mandatory dense embedding indexing; serve
Workflow selection and source localization from FTS/BM25 and exact graph
traversal only (#55 / ADR-012 `lexical_degraded` path generalized).

| Factor | Assessment |
| --- | --- |
| Addresses PID refusal | **No** — refusal occurs in `observation` before retrieval indexing dominates; CocoIndex worker already at 22 threads during startup |
| Addresses 250 MiB assets | **Yes** — removes model + much worker surface |
| #51 / #61 risk | **High** — ADR-012 rejected dense-only and whole-file counting; hybrid held-out recall is the bar |
| Medium/large outlook | Smaller index build, but observation path unchanged |
| Implementation locus | retrieval-runtime, worker packaging, #56 keep/remove decision |

**Evidence for:** Install budget (750 MiB) and idle footprint improve if dense
leg is optional; #56 explicitly requires testing whether #55 alone meets
thresholds.

**Evidence against (as PID fix):** Attribution places refusal in observation
phase with graphd + observation workers, not in `retrieval_readiness`.
Lexical-first does not explain how small observation completes under 64 tasks.

### Family C — Lazy / hierarchical semantics

**Hypothesis:** Keep hybrid quality but defer dense work — query-time rerank,
smaller quantized model, cached chunk summaries, hierarchical index tiers
(#56 “cheapest bounded semantic stage”).

| Factor | Assessment |
| --- | --- |
| Addresses PID refusal | **No** — observation still runs CocoIndex / extractors eagerly in current product path |
| Addresses 250 MiB assets | **Partial** — smaller model or on-demand load helps install/RSS, not observation spike |
| #51 / #61 risk | **Medium** — depends on chosen lazy stage meeting held-out gates |
| Medium/large outlook | May help preparation latency once observation unblocks |
| Implementation locus | retrieval sync policy, generation activation, prepare-time batching |

**Evidence for:** Epic #56 lists this family for quality–cost tradeoffs after
structural retrieval exists.

**Evidence against (as unblock spike):** `scenario_phase_map` shows failure
before any retrieval phase; lazy semantics optimize a **downstream** cost not
present in the refusal envelope. Combining with Family A still leaves
observation fan-out unaddressed if indexing is merely deferred.

### Family D — Simplified topology / storage ownership

**Hypothesis:** Enforce single-writer durability, explicit process
supervision, configurable memory/task budgets, and reduced parallel
descendants (#53): one observation worker generation, graphd lifecycle tied to
CLI scope, derived stores disposable, no orphaned native trees.

| Factor | Assessment |
| --- | --- |
| Addresses PID refusal | **Yes** — directly targets multi-process fan-out and missing caps |
| Addresses 250 MiB assets | No — topology change, same assets |
| #51 / #61 risk | **Low** — canonical graph + ADR-012 semantics preserved |
| Medium/large outlook | **Required** — fan-out scales with repo size without ownership policy |
| Implementation locus | graph-runtime supervision, observation-runtime orchestration, safe-runner hooks (ADR-014 graphd reservation pattern) |

**Evidence for:** BASELINE.md nominates “concurrency control” without selecting
architecture; attribution identifies **roles** (graphd, observation_worker,
asset_extraction_worker, cli) not a single saturated component. ADR-014
graphd reservation and broker start gate exist but product lacks bounded
task policy. Issue #53 body matches this family.

**Evidence against:** Does not alone remove 250 MiB hybrid assets; does not
resolve #56 dense keep/remove without measurement.

---

## Root-cause matrix

Rows: measured bottleneck. Columns: whether the family **directly** addresses
the cause (not downstream symptoms).

| Root cause | A tuned current | B lexical-first | C lazy semantics | D simplified topology |
| --- | --- | --- | --- | --- |
| cgroup `pids.max` exceeded on observation | Partial (threads only) | No | No | **Yes** (process budget + supervision) |
| graphd 29-thread pool | **Yes** (caps) | No | No | Partial (lifecycle) |
| CocoIndex worker 22-thread pool | **Yes** (caps) | Partial (smaller worker) | Partial | Partial (single worker instance) |
| observation worker process fan-out (1→3) | No | No | No | **Yes** |
| 250 MiB sealed hybrid assets | No | **Yes** | Partial | No |
| #51 hybrid recall / #61 fixture contract | **Yes** | Uncertain | Uncertain | **Yes** |
| medium/large promotion without fence | Partial | Partial | Partial | **Yes** |

---

## Analytic elimination

Verdicts use: **retain** (merits Slice 3 spike), **merge** (necessary component
of retain), **eliminate** (insufficient leverage or contradicted by evidence),
**defer** (post-unblock optimization).

| Family | Verdict | Rationale |
| --- | --- | --- |
| **A — Tuned current alone** | **Merge** into combined spike | Necessary for thread pools but insufficient: doctor/status already at 46/64 tasks before observation adds processes. |
| **B — Structural / lexical-first** | **Retain** as second spike | Cannot fix #60 PID refusal analytically, but #56 requires evidence whether #55 meets #51/#61 thresholds; 250 MiB install headroom. |
| **C — Lazy / hierarchical semantics** | **Eliminate** as Slice 3 spike | Refusal precedes retrieval phases; defers cost not implicated in attribution envelope. Revisit after observation unblocks. |
| **D — Simplified topology** | **Retain** as primary spike | Only family that directly addresses observation process fan-out and missing task ownership; aligns with #53. |

**Combined position:** The product cannot stay on untuned current topology
(Family A alone eliminated). The winning near-term path is **D + A**: bounded
topology with explicit concurrency caps while retaining ADR-012 hybrid
semantics. Family B is a **quality–footprint** spike, not a PID-unblock spike.

**Explicit non-eliminations (gates preserved):**

- ADR-012 hybrid semantics are **not** rejected without a spike or #55 evidence.
- #51 and #61 gates are **not** weakened for spike convenience.
- Safe-runner 64-task ceiling is **not** raised for baseline promotion.

---

## Slice 3 spike recommendations (≤ 2)

### Spike 1 (primary): Bounded topology + tuned concurrency (D + A)

**Scope:** Configurable task/thread budgets, single observation worker per
generation, explicit graphd/worker lifecycle under ADR-014 supervision,
retain ADR-012 hybrid retrieval and canonical graph ownership (#53 topology
leaves).

**Success criteria:**

- Small #60 `initial-observation` completes without PID refusal under unchanged
  safe-runner limits.
- `npm run test:semantic-oracle` and `npm run test:real-repository-oracle`
  (fast contract subset) still pass on spike branch.
- Attribution report shows descendant peaks within envelope with phase timing
  for observation onward.

**Why this spike:** Highest leverage per attribution — addresses the only
refusal limit (`pids`) and the only phase (`observation`) implicated. Unblocks
the entire #60 matrix and enables medium/large promotion.

### Spike 2 (secondary): Structural / lexical-first retrieval (B)

**Scope:** Time-boxed branch where dense ONNX indexing is optional or removed;
FTS/BM25 + exact id/alias + graph closure only; run retrieval-v1 held-out
evaluation and #51 contract tests on identical fixture pins.

**Success criteria:**

- Measured held-out Workflow/source recall and dense Recall@5 vs ADR-012
  thresholds (pass or documented fail).
- Footprint and idle RSS recorded on small fixture.
- No claim of #60 unblock — spike isolates #56 keep/remove evidence.

**Why this spike:** Attribution cannot prove lexical-only meets #51; ADR-012
already rejected lexical-only for product reasons, but #56 requires measured
evidence before mandating 250 MiB assets in the final #57 package. Fails gate
→ implement Family C optimizations inside hybrid; passes → document ADR-012
supersession path.

**Not recommended for Slice 3:** Family C alone — eliminated above.

---

## Spike Results (Slice 3)

Bounded spikes ran on the identical #60 small fixture (`9506629e`) with
unchanged `pids.max=64` safe-runner limits. Gate tests:
`npm run test:semantic-oracle` and `npm run test:real-repository-oracle`
passed on the spike branch.

### Spike 1 — Bounded topology + tuned concurrency (D + A)

**Implementation (behind `LAMINA_RUNTIME_BOUNDED_TOPOLOGY=1`):**

- `packages/cli/lib/runtime-budget.mjs` — configurable graphd/worker thread
  caps, single observation worker attempt, deferred graphd compatibility restart.
- Wired into graphd spawn, CocoIndex/retrieval workers, and observation orchestration.
- Baseline workload passes bounded policy to CLI children; skips `seedGraph`
  before `initial-observation` to avoid duplicate graphd trees.

**Evidence:** [`benchmarks/runtime-baseline-v1/spikes/da-bounded-topology.json`](../../benchmarks/runtime-baseline-v1/spikes/da-bounded-topology.json);
updated attribution [`benchmarks/runtime-baseline-v1/attribution/small.json`](../../benchmarks/runtime-baseline-v1/attribution/small.json).

| Metric | Before (Slice 1) | After (Spike 1) |
| --- | ---: | ---: |
| `initial-observation` status | invalid (`pids` refusal) | **valid** |
| peak_pids | 48 (refusal envelope) | 47 |
| observation_worker processes | 3 | 1 |
| worker_attempts | 2 (retry fan-out) | 1 |
| graphd peak_threads | 29 | 29 (OMP caps do not bind Ladybug yet) |
| observation backend | cocoindex (default) | node (spike policy) |

**Findings:**

- Eliminating seedGraph graphd overlap, single worker attempt, and Node
  observation backend recovers enough headroom for small `initial-observation`
  under 64 tasks without raising safe-runner limits.
- Ladybug graphd still reports 29 threads; native pool caps remain a #53 leaf.
- CocoIndex production observation path still fans out without the Node backend
  switch; Phase 2 must add native worker concurrency caps or bounded CocoIndex
  packaging.
- `initial-retrieval-readiness` remained invalid in the spike run (promotion
  fence after observation); retrieval/indexing leaves are out of Slice 3 scope.

**Spike code disposition:** `runtime-budget.mjs` and observation lifecycle hooks
are **kept** as the production policy surface for #53; Node backend override
and seedGraph skip are **spike-only** in baseline `childEnvironment` until
CocoIndex caps land.

### Spike 2 — Structural / lexical-first retrieval (B)

**Evidence:** [`benchmarks/runtime-baseline-v1/spikes/b-lexical-first.json`](../../benchmarks/runtime-baseline-v1/spikes/b-lexical-first.json)

Held-out BM25-only evaluation on retrieval-v1 fixture (no mandatory dense ONNX):

| Gate | Threshold | BM25-only |
| --- | ---: | ---: |
| exact id/alias | 1.00 | 1.00 |
| multi-Workflow selection | ≥ 0.95 | 0.00 |
| incorrect new-Workflow attachment | ≤ 0.02 | 0.00 |
| Workflow Recall@5 | ≥ 0.98 (hybrid bar) | below threshold |
| source Recall@10 | ≥ 0.90 (hybrid bar) | 0.80 |

**Verdict:** `lexical_only_fails_held_out_gates_keep_hybrid_dense` — 250 MiB
hybrid assets remain mandatory for #51 quality; #56 should implement bounded
dense stage inside hybrid, not remove dense leg.

**Footprint headroom if dense were optional:** ~162 MiB model bytes; CocoIndex
worker (88.7 MiB) still required for production observation until #53/#56.

---

## Open questions (for Slice 3–4)

1. What minimum `TasksMax` headroom does small observation require after caps
   (target: stable completion at ≤ 56 tasks with margin)?
2. Does observation worker fan-out come from parallel extractors, retries, or
   generation overlap — and which #53 lifecycle rule removes it?
3. If Spike 2 fails #51 held-out gates, what is the cheapest hybrid dense stage
   (Family C) that stays within post-Spike-1 resource envelope?
4. At medium fixture scale, which descendant role grows fastest — informing
   #54 incremental observation vs #55 index sync split?

---

## Decision

*Intentionally omitted — Slice 4 will record the selected architecture,
component retain/replace/remove, memory/concurrency policy, offline asset
strategy, rejected alternatives with spike evidence, and component budgets
summing to #49 gates.*
