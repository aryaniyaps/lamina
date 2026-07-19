# Publication task authoring contract

An independent evaluation custodian creates the 12 publication packages after the authoring protocol and candidate skill are frozen, or holds packages that were created earlier. The skill implementer must not see publication briefs, goldens, or oracle facts and cannot revise the candidate after tasks are sealed. Each package contains `task.json`, `brief.md`, `founder-intent.json`, and `golden.json`. `task.json` carries kind and recursive fixture identity; `golden.json` carries critical promises, structural hazards, open policy decisions, and acceptable alternatives.

Briefs must sound like incomplete founder requests and must not enumerate rubric dimensions. Goldens separate founder facts, critical promises, structural hazards, open policy decisions, and acceptable alternatives. Scoring rewards coherent alternatives and propagated consequences rather than matching an author's preference.

Hash the complete recursive package, place the digest in `manifest.json`, and keep package contents unavailable to the skill implementer through execution. After hashes are inserted, freeze the full release: skill commit, prompts, runtime adapters, oracle, rubric, analysis, models, and runtime fingerprint. Publish mode refuses null or mismatched hashes.
