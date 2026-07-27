# Graph-backed product verification

1. Resolve the active GraphVersion and source revision.
2. Query the workflow closure: Personas, Actors, Operations, invariants, dependencies, Surfaces, Scenarios, Proofs, evidence, and Contradictions.
3. Compile every relevant Persona Mission.
4. Select an adapter by capability manifest; modalities remain open strings.
5. Run each Mission in an isolated session and adapter context.
6. Normalize observed events. Store large artifacts in the evidence CAS and publish Evidence/HarnessResult resources.
7. Fail readiness for missing evidence, changed source snapshots, corrupt artifacts, capability failures, or blocking Contradictions.
8. Publish verification results transactionally and report the exact GraphVersion and source revision.

Legacy the active GraphVersion and generated Markdown are never verification inputs.
