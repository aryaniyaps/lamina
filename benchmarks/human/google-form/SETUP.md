# Google Form human evaluation (verifiable)

Use Google Forms when you want a **hosted submission flow** with timestamps and an auditable response sheet. LaminaBench ties submissions to a **published manifest** so outsiders can verify scores match a specific benchmark run.

## Overview

| Step | What |
|------|------|
| 1 | `npm run bench:human-packet` → generates `packet.html`, manifest, form spec |
| 2 | Publish `human-eval-manifest.json` (commit or release page) **before** raters start |
| 3 | Create Google Form from `form-checklist.txt` / `form-spec.json` |
| 4 | Raters read implementations in `packet.html`, submit **10 times** (once per task) |
| 5 | Export Google Sheet → CSV → `npm run bench:import-google-form` |
| 6 | Publish `human-eval-audit.json` with release results |

## 1. Generate the packet

After a live `bench:run`:

```bash
npm run bench:human-packet
```

This writes:

- `review-packet/packet.html` — blind implementations (host or share as file)
- `review-packet/human-eval-manifest.json` — **publish this** (eval ID + artifact hashes)
- `google-form/form-spec.json` — machine-readable question list
- `google-form/form-checklist.txt` — copy-paste checklist for building the form

Note the **`eval_id`** printed in the console. Every rater must enter it on every submission.

## 2. Create the Google Form

1. Go to [Google Forms](https://forms.google.com) → Blank form
2. Title: `LaminaBench blind review — <eval_id first 8 chars>`
3. Form description: link to hosted `packet.html` + link to [rubric](../../judges/rubric.md)
4. Settings:
   - **Collect email addresses** — your choice (helps internal audit; turn off if publishing raters anonymously)
   - **Limit to 1 response** — **OFF** (each rater submits 10 times)
   - **Response receipts** — optional
5. Link to **Google Sheets** (Responses tab → spreadsheet icon)

### Questions (exact titles recommended)

Add in this order:

1. **Short answer** — `Evaluation ID (do not edit)` — put the full `eval_id` in the question description; raters copy-paste from manifest
2. **Short answer** — `Rater code` — e.g. R1, R2, R3 (assigned by you)
3. **Dropdown** — `Task ID` — options: `task001`, `task002`, `task006`, `task007`, `task011`, `task012`, `task016`, `task017`, `task021`, `task023`

Then for **Artifact A**, add **Linear scale 1–5** for each:

- `A — Domain / system structure (1-5)`
- `A — Invariants and product rules (1-5)`
- `A — Actors and permissions (1-5)`
- `A — Workflow quality (1-5)`
- `A — Scenario / edge coverage (1-5)`
- `A — Systems judgment (1-5)`
- `A — UX expression under rules (1-5)`
- `A — Brownfield fit (1-5)`
- `A — Implementation readiness (1-5)`
- `A — Overall product-behavior quality (1-5)`
- **Paragraph** — `A — Notes (optional; required if any score ≤2 or ≥4)`

Repeat the same for **Artifact B** (replace `A` with `B`).

> Tip: Use **Sections** in Google Forms (“Add section”) with text: “Open packet.html for this task’s artifacts” to reduce fatigue.

Full list is in `form-checklist.txt` and `form-spec.json`.

## 3. Rater instructions

Send raters:

1. Link to **packet.html** (GitHub Pages, internal static host, or zipped file)
2. Link to **Google Form**
3. Their **Rater code**
4. The **Evaluation ID** from the published manifest
5. Rubric link

Rules:

- Score **A** and **B** independently; do not infer which used Lamina
- Submit the form **10 times** (one per task)
- Use the same Evaluation ID and Rater code every time
- Add notes when any criterion is ≤2 or ≥4

## 4. Import responses

When all raters finish:

1. In Google Sheets: **File → Download → Comma Separated Values (.csv)**
2. Import:

```bash
npm run bench:import-google-form -- --csv "/path/to/Form Responses 1.csv"
npm run bench:analyze
```

Optional — copy audit files into the release folder:

```bash
npm run bench:import-google-form -- --csv responses.csv --publish-audit
```

## 5. What makes it verifiable

| Artifact | Purpose |
|----------|---------|
| `human-eval-manifest.json` | Published **before** scoring: `eval_id`, git commit, rubric hash, SHA-256 of each blind artifact A/B |
| Google Sheet timestamps | Independent audit trail (who submitted when) |
| `human-eval-audit.json` | Generated on import: CSV file hashes, ratings fingerprint, eval_id match |
| `answer-key.json` | **Private** until study closes — maps A/B → control/treatment |

Anyone can verify:

1. Manifest `eval_id` matches every form row
2. Artifact hashes match the benchmark run they claim to score
3. Import audit fingerprint is reproducible from the published CSV export

After the study closes, publish `answer-key.json` so others can reproduce control vs treatment aggregation.

## Troubleshooting

**“No valid ratings found”** — Google Form column titles must match the checklist (especially em dash `—` vs hyphen `-`). Re-download CSV and compare headers to `form-spec.json`.

**Evaluation ID mismatch** — Raters used an old form or wrong manifest. Regenerate packet or fix submissions.

**Missing tasks** — Each rater should have 10 rows (one per task). Check Sheet for gaps.

## Alternatives

- **CSV template** (`scores-template.csv`) + `npm run bench:import-human` — same pipeline, no Google host
- **Google Sheets only** (no Form) — possible if you lock editing; Form is better for timestamps and rater UX
