# Guardrails

Lamina slash commands do not edit product source. They may write business evidence under `.lamina/`, graph runtime state under the shared Git common directory’s `lamina/`, and generated query projections explicitly requested by the user.

Ladybug is canonical. `graphd` is its only read-write owner. Agents and
CocoIndex communicate through the authenticated local Unix socket or
repository-specific Windows named pipe and never open the database directly.

Do not:

- discover or select legacy run files as runtime state;
- expose raw Cypher writes;
- let callers provide epistemic class or approval;
- treat missing static observations as proof of absence;
- mix mutable state between Mission Runs;
- store graph state in Git or dual-write legacy artifacts;
- allow design or verification commands to edit application source.
