# Publication execution custody

`run-matrix.mjs` is a development runner. It deliberately refuses publication cells because its host processes can read the repository. A held-out claim is invalid if an agent can inspect goldens, founder-intent files, other publication briefs, previous arms, or prior repeats.

The publication custodian exports the frozen matrix, then runs each cell in a clean isolated environment containing only:

- the assigned brief and starter fixture;
- the arm-specific skill payload (`lamina` only for the Lamina arm);
- one empty writable workspace;
- the frozen agent CLI and model credentials;
- an oracle broker that accepts at most three schema-valid questions and returns only matching facts.

The agent cannot access the corpus repository, task goldens, oracle fact store, other cells, host filesystem, previous sessions, or scoring code. Contract reviewers run in separate empty environments and receive only their supplied context and blinded contract slice. Transfer builders receive a fresh copy of the starter fixture, original brief, and frozen native contract.

The custodian returns product workspaces, contract snapshots, reviewer reports, telemetry, command versions, exit state, and an environment digest. Human judges receive separately blinded artifacts. Do not set `release.status` to `frozen` or market publication results until this custody protocol is independently checked.
