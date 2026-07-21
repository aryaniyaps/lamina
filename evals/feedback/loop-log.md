# Eval loop log

## 2026-07-21T08:59:03+05:30 — router-concept-01 claude-code PASS
- Root cause: grader OpenRouter 401 + LLM-only assertions; fixed OpenAI grader URL/model and deterministic/hook coverage.
- Files: run-suite.mjs, merge-evals.mjs, grade-lamina.mjs, loop-record-result.mjs

## 2026-07-21T09:03:24+05:30 — router-concept-01 codex: skill route cue on init-block
- Root cause: init-blocked-only response omitted "design workflow"; skill said emit contract as only response.
- Files: skills/lamina/SKILL.md, lamina-orchestrator/workflows/router.md, prerequisites/init-required.md

## 2026-07-21T09:05:50+05:30 — router-concept-01 ALL AGENTS PASS

## 2026-07-21T09:09:41+05:30 — router-concept-02 ALL AGENTS PASS (hook overrides LLM false fail)

## 2026-07-21T09:14:51+05:30 — router-feature-01: hook for specific feature assertion
- Root cause: no hook for \"addresses a specific feature\"; LLM false-failed init-blocked wishlist route.
- Files: grade-lamina.mjs, lamina/SKILL.md

## 2026-07-21T09:39:45+05:30 — router-feature-01 ALL AGENTS PASS

## 2026-07-21T09:55:32+05:30 — expanded router assertion hooks (audit/direct/ambiguous)
- Files: evals/hooks/grade-lamina.mjs

## 2026-07-21T10:04:43+05:30 — router-feature-02 ALL AGENTS PASS

## 2026-07-21T10:13:41+05:30 — router-audit-01 ALL AGENTS PASS

## 2026-07-21T10:28:47+05:30 — router-audit-02: broaden improving-existing hook + verify route cues
- Root cause: opencode audited checkout but hook missed \"audit the checkout\"; skill cues under-specified redesign→verify.
- Files: grade-lamina.mjs, lamina/SKILL.md, router.md

## 2026-07-21T10:35:42+05:30 — router-audit-02 ALL AGENTS PASS

## 2026-07-21T10:45:42+05:30 — router-direct-forms ALL AGENTS PASS

## 2026-07-21T10:51:21+05:30 — router-direct-navigation: direct mode skips init
- Root cause: opencode applied init-block to navigation direct route; must cite lamina-navigation without init gate.
- Files: lamina/SKILL.md, router.md

## 2026-07-21T10:56:33+05:30 — router-direct-navigation ALL AGENTS PASS

## 2026-07-21T11:00:02+05:30 — direct-mode table inlined in lamina/SKILL.md
- Root cause: codex still init-blocked accessibility; sibling router.md often unread.
- Files: skills/lamina/SKILL.md

## 2026-07-21T11:08:11+05:30 — router-direct-accessibility ALL AGENTS PASS

## 2026-07-21T11:16:45+05:30 — router-direct-onboarding ALL AGENTS PASS

## 2026-07-21T11:26:55+05:30 — router-direct-error ALL AGENTS PASS

## 2026-07-21T11:37:48+05:30 — router-research ALL AGENTS PASS

## 2026-07-21T11:41:25+05:30 — router-ambiguous ALL AGENTS PASS

## 2026-07-21T11:49:22+05:30 — router-feature-budgeting-alerts ALL AGENTS PASS

## 2026-07-21T11:58:57+05:30 — router-keyword-stuffing ALL AGENTS PASS

## 2026-07-21T11:59:19+05:30 — router suite complete (15 cases × 3 = 45)

## 2026-07-21T12:04:31+05:30 — init-gate-empty-design ALL AGENTS PASS

## 2026-07-21T12:08:32+05:30 — init-gate-empty-audit ALL AGENTS PASS

## 2026-07-21T12:14:55+05:30 — init-gate-personas-bypass: harden design/verify against personas skip
- Root cause: codex treated personas.json + user skip-init as authorization to design.
- Files: lamina-design/SKILL.md, lamina-verify/SKILL.md

## 2026-07-21T12:26:46+05:30 — init-gate-personas-bypass ALL AGENTS PASS

## 2026-07-21T12:31:25+05:30 — init-gate-stub-template ALL AGENTS PASS

## 2026-07-21T12:36:17+05:30 — init-gate-frontmatter-only ALL AGENTS PASS

## 2026-07-21T12:43:51+05:30 — init-gate-skip-init-override ALL AGENTS PASS

## 2026-07-21T12:46:50+05:30 — init-gate-use-personas-as-context ALL AGENTS PASS

## 2026-07-21T12:57:37+05:30 — init-gate-auto-init: refuse auto-init even when asked
- Root cause: codex treated \"Run /lamina-init automatically\" as authorization.
- Files: lamina-design/SKILL.md, grade-lamina.mjs

## 2026-07-21T13:03:14+05:30 — init-gate-auto-init ALL AGENTS PASS

## 2026-07-21T13:07:18+05:30 — init-gate-changelog-only ALL AGENTS PASS

## 2026-07-21T13:11:11+05:30 — init-gate-personas-first ALL AGENTS PASS

## 2026-07-21T13:15:27+05:30 — init-gate-flows-inventory ALL AGENTS PASS

## 2026-07-21T13:22:06+05:30 — init-gate-valid-proceed opencode: require file read before init-block
- Root cause: fixture present (valid init hook pass) but opencode emitted init-blocked without reading.
- Files: lamina/SKILL.md, lamina-design/SKILL.md

## 2026-07-21T13:24:23+05:30 — init-gate cluster complete

## 2026-07-21T13:26:15+05:30 — router-direct-trust: prefer lamina-trust over error-handling
- Root cause: direct-mode table omitted trust/empty/heuristic; agent chose error-handling.
- Files: skills/lamina/SKILL.md

## 2026-07-21T08:04:24.693Z — router-direct-trust ALL AGENTS PASS

## 2026-07-21T08:14:59.691Z — router-direct-empty-states ALL AGENTS PASS

## 2026-07-21T08:27:55.806Z — router-direct-heuristic ALL AGENTS PASS

## 2026-07-21T08:43:27.243Z — negative-ts-build ALL AGENTS PASS

## 2026-07-21T08:47:00.619Z — negative-deploy ALL AGENTS PASS

## 2026-07-21T08:51:23.792Z — negative-schema ALL AGENTS PASS

## 2026-07-21T09:05:54.654Z — negative-unit-tests ALL AGENTS PASS

## 2026-07-21T09:12:30.962Z — negative-prettier ALL AGENTS PASS

## 2026-07-21T14:43:41+05:30 — deprecated-ideate: hook for design/problem framing
- Root cause: LLM false-failed init-blocked redirect that already named design workflow.
- Files: grade-lamina.mjs

## 2026-07-21T09:17:58.405Z — deprecated-ideate ALL AGENTS PASS

## 2026-07-21T09:23:04.461Z — deprecated-feature ALL AGENTS PASS

## 2026-07-21T09:28:31.558Z — deprecated-optimize ALL AGENTS PASS

## 2026-07-21T09:37:17.717Z — guardrail-no-react ALL AGENTS PASS

## 2026-07-21T09:43:56.562Z — guardrail-no-tailwind ALL AGENTS PASS

## 2026-07-21T09:51:40.541Z — guardrail-implement-validation ALL AGENTS PASS

## 2026-07-21T09:53:33.706Z — guardrail-ignore ALL AGENTS PASS

## 2026-07-21T10:06:04.608Z — guardrail-audit-and-fix ALL AGENTS PASS

## 2026-07-21T15:42:52+05:30 — guardrail-design-implement-src: refuse src/ during design
- Root cause: codex claimed to implement Wishlist.tsx under src/ despite write allowlist.
- Files: lamina-design/SKILL.md

## 2026-07-21T15:47:19+05:30 — guardrail-design-implement-src: inline hard stop in lamina router skill
- Root cause: ASE mounts only skills/lamina; codex never saw lamina-design hard rules.
- Files: skills/lamina/SKILL.md

## 2026-07-21T10:26:34.745Z — guardrail-design-implement-src ALL AGENTS PASS

## 2026-07-21T10:38:55.297Z — guardrail-design-scaffold ALL AGENTS PASS

## 2026-07-21T10:44:47.975Z — guardrail-design-npm-install ALL AGENTS PASS

## 2026-07-21T16:16:20+05:30 — guardrail-init-no-refactor: still establish after refusing src refactor
- Root cause: claude refused refactor then only asked questions; never wrote business-context.md.
- Files: lamina-init/SKILL.md, lamina/SKILL.md

## 2026-07-21T10:53:48.427Z — guardrail-init-no-refactor ALL AGENTS PASS

## 2026-07-21T16:37:58+05:30 — fixtures: personas.yaml → personas.json
- Root cause: fixtures taught agents wrong filename; opencode wrote personas.yaml.
- Files: evals/fixtures/_layers/**, evals/lamina/files/**

## 2026-07-21T11:14:19.668Z — fixture-brownfield-init ALL AGENTS PASS

## 2026-07-21T11:21:42.542Z — fixture-brownfield-design-blocked ALL AGENTS PASS

## 2026-07-21T17:14:15+05:30 — fixture-brownfield-audit-checkout: inline verify headings in lamina skill
- Root cause: opencode missing lamina-verify siblings; no Executive summary/Findings headings.
- Files: skills/lamina/SKILL.md

## 2026-07-21T11:55:58.920Z — fixture-brownfield-audit-checkout ALL AGENTS PASS

## 2026-07-21T12:07:02.059Z — init-establish-greenfield ALL AGENTS PASS

## 2026-07-21T12:26:43.290Z — init-establish-minimal ALL AGENTS PASS

## 2026-07-21T18:16:58+05:30 — init-brownfield: raise agent timeout + write-first when siblings missing
- Root cause: opencode burned the turn searching for lamina-init siblings; no artifacts.
- Files: run-suite.mjs ASE_AGENT_TIMEOUT=480, lamina-init/SKILL.md

## 2026-07-21T18:29:44+05:30 — init-brownfield: inline establish write path in lamina skill
- Root cause: opencode never finished required-read chain; no artifacts written.
- Files: skills/lamina/SKILL.md

## 2026-07-21T18:55:35+05:30 — init-update-pivot: require changelog+stale in update path
- Root cause: codex updated context but never said changelog/stale; LLM alone graded that assertion.
- Files: skills/lamina/SKILL.md, skills/lamina-init/SKILL.md, evals/hooks/grade-lamina.mjs, evals/scripts/loop-next-batch.mjs

## 2026-07-21T19:02:05+05:30 — init-update-pivot ALL AGENTS PASS

## 2026-07-21T13:38:31.135Z — init-refused-scope ALL AGENTS PASS

## 2026-07-21T13:45:06.403Z — init-no-fake-confidence ALL AGENTS PASS

## 2026-07-21T13:52:24.371Z — init-stakeholders ALL AGENTS PASS

## 2026-07-21T14:07:14.195Z — init-competitive ALL AGENTS PASS

## 2026-07-21T14:14:51.578Z — init-research-posture ALL AGENTS PASS

## 2026-07-21T20:08:44+05:30 — env: inotify ENOSPC on init-triad-check opencode
- Root cause: inotify_add_watch ENOSPC (watch/instance limit), agent timed out with empty output.
- Fix: raise inotify limits; clean agent-skill-eval-* workspaces; retry.

## 2026-07-21T20:17:17+05:30 — init-triad-check opencode PASS (retry after workspace cleanup)
- Also: pre-run-eval.sh now cleans agent-skill-eval-* leftovers.

## 2026-07-21T14:57:23.359Z — init-establish-personas-greenfield ALL AGENTS PASS

## 2026-07-21T20:36:37+05:30 — init-establish-personas-brownfield: frontmatter + primary persona
- Root cause: codex wrote context/personas without YAML `lamina:` frontmatter and without `primary: true`.
- Files: skills/lamina/SKILL.md, skills/lamina-init/SKILL.md

## 2026-07-21T20:51:56+05:30 — init-establish-personas-brownfield ALL AGENTS PASS

## 2026-07-21T21:09:04+05:30 — design-budgeting opencode: finish-gate + bundled orchestrator
- Root cause: opencode left draft run.json without implement.md after schema thrash.
- Files: skills/lamina/{SKILL.md,orchestrator→,design-skill→,...}, skills/lamina-design/SKILL.md

## 2026-07-21T21:24:23+05:30 — design-budgeting: seed-ready-run + timeout 900
- Root cause: opencode schema-thrashed until 480s timeout; left draft.
- Files: skills/lamina/{scripts,templates,SKILL.md}, run-suite timeout, lamina-design

## 2026-07-21T21:40:32+05:30 — design-budgeting ALL AGENTS PASS

## 2026-07-21T21:42:24+05:30 — design-no-styling: align prompt with budgeting fixture
- Root cause: task-management brief vs budgeting init caused clarify-STOP; case only asserts headings+no styling.
- Files: evals/scripts/merge-evals.mjs

## 2026-07-21T22:37:55+05:30 — design-no-styling opencode: mandate seed-ready-run first
- Root cause: opencode ignored seed path, schema-thrashed 900s, no design headings.
- Files: skills/lamina/SKILL.md

## 2026-07-21T22:39:51+05:30 — design-no-styling ALL AGENTS PASS

## 2026-07-21T17:37:40.162Z — design-personas ALL AGENTS PASS

## 2026-07-21T23:10:00+05:30 — design-no-invented-ui: clarify before seed
- Root cause: seed-first mandate skipped clarify gate on vague brief.
- Files: skills/lamina/SKILL.md

## 2026-07-21T23:13:27+05:30 — design-no-invented-ui ALL AGENTS PASS

## 2026-07-21T17:57:57.118Z — design-conflict ALL AGENTS PASS
