# Blinded judging protocol

Strip arm names, Lamina paths, generated headings, and reviewer metadata before assigning random artifact IDs. Preserve contract content and native structure; do not canonicalize one arm into another.

Each frozen contract, main product stage, and transfer product stage receives two independent ratings from product-minded judges who do not know the arm. Contract judges use `product-contract-rubric.json` with `human-rating.schema.json`; product judges use `product-quality-rubric.json` with `product-rating.schema.json`. A third judge adjudicates any artifact whose primary ratings differ by more than one point on any dimension. Until that adjudicator submits a rating, the artifact has no final score. Rater IDs must be unique. Critical omissions and failures require a concrete description rather than a count-only judgment.

Automated model ratings are secondary. Run `bench:v2:model-rate` on every artifact in the same blinded package with `protocol/model-rating-prompt.md` and the frozen `release.json` `model_judge`. Each artifact receives a fresh isolated session and produces a separately preserved rating and telemetry record. Score these one-rater secondary records with `--minimum-primary-raters 1`; this exception never applies to human ratings. Record model results separately as `contract_model_score` and use them only for direction agreement and sensitivity analysis. The two-human-primary median remains the primary quality outcome.

Judges rate the coherent current slice in the brief and artifact rather than requiring an imagined production backlog. Missing deployment, live credentials, vendor accounts, legal attestation, multi-tenancy, or unrelated CRUD is not automatically a critical omission. A runnable local identity or delivery adapter with truthful state, a concrete provider seam, and fail-closed production posture is valid evidence when deployment was not requested; self-asserted identity, fake delivery success, no invocation path, or authoritative state coupled to delivery remains a real defect.

Do not let judges see founder-intent goldens before rating coherence and actionability. A separate adjudication pass may use the sealed golden to classify whether an omission contradicts founder intent, is an acceptable alternative, or is genuinely unspecified.

`bench:v2:blind` requires an explicit protocol hash, track, and cohort and accepts explicit comma-separated task, arm, and repeat filters. It refuses incomplete or non-rectangular selections, creates the judge-visible randomized artifact package, and writes a separate mode-600 secret key. The secret key, selection metadata, arm names, method paths, reviewer metadata, other arms, and founder facts never enter the judge package. Native contract structure is retained. The key hashes the exact public manifest bytes; assembly re-verifies that hash plus every task and artifact before unblinding.

Example development workflow (replace paths and the protocol hash):

```bash
npm run bench:v2:blind -- \
  --results benchmarks/results/v2/development \
  --output /tmp/lamina-judging/blinded \
  --key-output /tmp/lamina-custody/blind-key.json \
  --protocol-hash HASH --track oracle --cohort openai-gpt-5.6-sol \
  --task dev-green-01 --arm raw,structured,lamina --repeat 1

npm run bench:v2:model-rate -- \
  --blinded /tmp/lamina-judging/blinded \
  --output /tmp/lamina-model/raw-ratings.json \
  --evidence /tmp/lamina-model/evidence

npm run bench:v2:score -- \
  /tmp/lamina-model/raw-ratings.contract.json /tmp/lamina-model/contract-scores.json \
  benchmarks/v2/scoring/product-contract-rubric.json \
  --minimum-primary-raters 1

npm run bench:v2:score -- \
  /tmp/lamina-model/raw-ratings.product.json /tmp/lamina-model/product-scores.json \
  benchmarks/v2/scoring/product-quality-rubric.json \
  --minimum-primary-raters 1

npm run bench:v2:assemble -- \
  --results benchmarks/results/v2/development \
  --blinded-manifest /tmp/lamina-judging/blinded/manifest.json \
  --blind-key /tmp/lamina-custody/blind-key.json \
  --human-scores HUMAN_CONTRACT_AND_PRODUCT_SCORES \
  --model-scores /tmp/lamina-model/contract-scores.json,/tmp/lamina-model/product-scores.json \
  --thresholds FROZEN_THRESHOLDS.json --output SCORED_TRIALS.jsonl
```

Score contract and product human rating files separately with the default two-primary minimum, complete required adjudications, and combine those score files at assembly. Human primary ratings and publication-key custody must come from the declared independent people; benchmark operators must never synthesize them. Automated ratings remain separate and never substitute for the two human primaries.
