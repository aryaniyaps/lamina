# Blinded judging protocol

Strip arm names, Lamina paths, generated headings, and reviewer metadata before assigning random artifact IDs. Preserve contract content and native structure; do not canonicalize one arm into another.

Each contract and transfer product receives two independent ratings from product-minded judges who do not know the arm. Judges use `product-contract-rubric.json` and `human-rating.schema.json`. A third judge adjudicates any dimension whose ratings differ by more than one point. Critical omissions and failures require a concrete description rather than a count-only judgment.

Automated model ratings are secondary. Run them on the same blinded artifacts with a frozen prompt and model, record them separately as `contract_model_score`, and use them only for direction agreement and sensitivity analysis. The human median remains the primary quality outcome.

Do not let judges see founder-intent goldens before rating coherence and actionability. A separate adjudication pass may use the sealed golden to classify whether an omission contradicts founder intent, is an acceptable alternative, or is genuinely unspecified.
