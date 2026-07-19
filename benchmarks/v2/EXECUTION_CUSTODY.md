# Publication execution custody

`run-matrix.mjs` is a development runner. It deliberately refuses publication cells because its host processes can read the repository. A held-out claim is invalid if an agent can inspect goldens, founder-intent files, other publication briefs, previous arms, or prior repeats.

The publication custodian exports the frozen matrix, then runs each cell in a clean isolated environment containing only:

- the assigned brief and starter fixture;
- the arm-specific skill payload (`lamina` only for the Lamina arm);
- one empty writable workspace;
- the frozen agent CLI and model credentials;
- an oracle broker that accepts at most three schema-valid questions and returns only matching facts.

The agent cannot access the corpus repository, task goldens, oracle fact store, other cells, host filesystem, previous sessions, or scoring code. Contract reviewers run in separate empty environments and receive only their supplied context and blinded contract slice. Transfer builders receive a fresh copy of the starter fixture, original brief, and frozen native contract.

The custodian returns product workspaces, contract snapshots, reviewer reports, telemetry, command versions, exit state, and an environment digest. A separate judging custodian creates an explicitly selected rectangular blinded package, keeps its mode-600 key outside every judge-visible location, and verifies the exact manifest and artifact hashes again before reconstruction. Human judges receive only the public package; secondary model judges run in fresh isolated sessions against the same artifacts. Do not set `release.status` to `frozen` or market publication results until this custody protocol is independently checked.

Before real publication cells, the custodian runs leakage canaries proving that a cell can read its assigned brief and writable workspace but cannot resolve a host-repository marker, a second task marker, a golden marker, a founder-intent-store marker, a previous-arm marker, or the scoring-code marker. The returned attestation names each canary, expected visibility, observed exit state, executor image digest, mount list, network policy, and recursive assigned-package hash. Any unexpected visibility invalidates the executor and all cells it has produced.

Resumption is allowed only from a custodian checkpoint whose protocol hash, assigned-package hash, model lock, clean-workspace digest, and prior raw event prefix all match. A completed result is never accepted merely because a status file exists. The frozen protocol permits only its bounded same-phase transient-provider continuations; every constituent event stream is retained and charged to the cell. Any attempt-level infrastructure rerun preserves the failed attempt, uses a preregistered whole-scope policy, and cannot be selected by observed quality. Quality-driven selective reruns are prohibited.
