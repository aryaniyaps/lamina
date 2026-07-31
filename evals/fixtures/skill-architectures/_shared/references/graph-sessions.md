# Graph sessions

All design mutations use sessions: begin from the current GraphVersion, propose typed operations, validate, and publish. Rebase independent later sessions when required. Never write Ladybug directly or treat legacy run files as graph state.

# Transactional product-graph design

1. Resolve HEAD with `lamina graph status`.
2. Query the active graph and source observation coverage.
3. For a new feature, transactionally seed only the proposed Workflow, active Persona roster, assumed Actors, and ordered Operations.
4. Run one `lamina design prepare-walk` task in an isolated subagent/context per Persona and publish each result through `lamina design record-walk`.
5. Union discoveries and expand generic Resources and normalized Statements. Workflow ordering is a `lamina:hasStep` Statement with a `position` qualifier.
6. If any discovery array is non-empty, expand the graph and rerun every affected walk until a complete round returns empty discovery arrays under the current coverage digest.
7. Record one current `persona_walk` Resource per active Persona. Experience Cases compile mechanically from those walks; never duplicate them into an authored Experience Contract.
8. Preserve epistemic separation. Public agent proposals remain inferred; Persona-walk interpretation is simulated; callers cannot select epistemic ingress.
9. Compile independent runtime Missions only after all current walks validate. Never cap Persona count.
10. Validate the full affected closure. If completeness cannot be proven, validate the whole branch.
11. Preserve conflicts and create Contradictions. Contradictions block approval, not history.
12. Publish atomically. Rebase after a compare-and-swap failure.
13. Render implementation Markdown only from a resolved GraphVersion query.
