# Lamina Detailed Implementation Plan

## 0. Implementation Strategy

Lamina should be implemented as a **platform-agnostic core engine** with thin adapters for different AI coding tools.

Instead of building separate plugins for Claude Code, Cursor, Pi, Codex, OpenCode, etc., the recommended architecture is:

```text
AI Coding Tool / Editor
        ↓
Thin Adapter / Slash Command
        ↓
Lamina CLI / JSON Contract / Artifacts
        ↓
Core Orchestrator
        ↓
Context Discovery + Synthesis + Artifact Manager + Task Generator
        ↓
.lamina/ artifacts
```

This gives Lamina one durable core while allowing each platform to expose it through `/lamina`, a shell command, MCP, or plain artifact handoff. SDKs and native plugins are optional convenience layers.

## 0.1 Non-Opinionated Skill/Plugin Requirement

Lamina must primarily enforce **WHAT needs to happen**, not **HOW it must happen**.

This is a hard requirement for supporting many tech stacks and coding tools. Orchestration, codebase exploration, task execution, file editing, search, planning, and validation are all performed differently by different tools and ecosystems.

Lamina should define portable outcomes such as:

- Discover relevant context.
- State confidence and gaps.
- Ask targeted questions.
- Preserve assumptions and decisions.
- Generate UX requirements.
- Generate edge cases.
- Generate implementation-ready tasks.
- Require human checkpoints before committing artifacts.

Lamina should avoid prescribing tool-specific implementation mechanics such as:

- Which agent loop to use.
- Which files must be read first.
- Which search command must be used.
- Which AST parser must be used.
- Which planning strategy must be used.
- Which editor/plugin API must be used.
- Which framework-specific route discovery algorithm must be used.

The default implementation can include helpful heuristics, but adapters and end users must be free to replace those heuristics with stack-specific or tool-specific approaches while still producing the same artifacts and JSON contract.

---

# 1. Goals for Version 1.0

## Primary V1 Goal

A developer can run:

```bash
lamina
```

or trigger:

```text
/lamina
```

Then, within one guided session, Lamina should:

1. Discover relevant project context.
2. Ask what the developer is trying to build or improve.
3. Route the conversation into one of three flows:
   - Ideate from scratch
   - Optimize existing flow
   - Add new feature
4. Generate or update `.lamina/` artifacts.
5. Produce implementation-ready tasks in:

```text
.lamina/implementation-tasks.md
```

## V1 Scope

### In Scope

- CLI-first implementation.
- Adapter-ready architecture.
- `.lamina/` artifact system.
- Basic project context discovery.
- Guided conversational UX.
- Three core flows.
- Web and mobile interface support.
- Edge case generation.
- Implementation task generation.
- Markdown + YAML frontmatter artifacts.
- Human checkpoints.
- UX-only output boundaries.

### Out of Scope for Initial V1

- Full visual design generation.
- Component code generation.
- Deep analytics querying across all providers.
- Real-time collaboration.
- Hosted backend.
- Full GUI.
- Automatic user testing.
- Advanced research repository search.

---

# 2. Recommended Implementation Stack

## Core Runtime Position

TypeScript is **not inherently required** for Lamina's product value.

Lamina's durable product surface is:

```text
.lamina/ markdown artifacts + CLI commands + JSON I/O contract
```

The V1 implementation may use **TypeScript + Node.js as a reference implementation**, but the architecture should not depend on TypeScript-specific concepts. Any coding tool should be able to use Lamina by executing a command or reading/writing files.

## Why TypeScript/Node Is Still a Reasonable Reference Implementation

- Easy to package through npm for most developer machines.
- Good Markdown/YAML/schema tooling.
- Good fit for cross-platform CLIs.
- Familiar to many AI coding tools and editor ecosystems.
- Can expose both CLI and SDK surfaces from one codebase.

## Why TypeScript Should Not Be a Product Requirement

- Some users and agents operate in Python, Go, Rust, Java, Ruby, .NET, or shell-first environments.
- Some coding tools cannot import an npm SDK but can run shell commands.
- Universal tool support is easier with process-level contracts than language-level SDKs.
- Artifacts should remain plain Markdown/YAML so they are useful without any runtime.

## Required Portability Rule

Every important capability must be available through the CLI and file artifacts, not only through a TypeScript SDK.

```bash
lamina scan --json
lamina start --json
lamina tasks --print
```

If an SDK exists, it is convenience only. The CLI JSON contract is the stable integration layer.

## Suggested Libraries for the TypeScript Reference Implementation

```text
commander            CLI command handling
prompts/inquirer     conversational terminal prompts
zod                  schema validation
gray-matter          Markdown frontmatter parsing
fast-glob            project scanning
picomatch            ignore pattern handling
yaml                 YAML parsing
chalk                terminal formatting
ora                  loading indicators
execa                shell command execution where needed
```

## Optional Later

```text
tree-sitter          deeper code parsing
@babel/parser        JS/TS/React parsing
openapi-types        API/schema inspection
```

Avoid making optional parsing libraries central to the product. They should improve discovery confidence, not determine whether Lamina works.

---

# 3. High-Level Architecture

## Core Modules

The module boundaries below are language-neutral. Filenames use `.ts` only for the TypeScript reference implementation; another implementation could use Python, Go, Rust, or any runtime that preserves the same CLI/artifact contracts.

## 3.1 Orchestration Contract, Not Orchestration Policy

The orchestrator should not impose a universal agent workflow. Its job is to maintain session state and ensure required outcomes are produced.

The orchestrator may enforce:

- Required phases exist: context, user intent, synthesis, checkpoint, artifacts, tasks.
- Required artifact sections are present.
- Required confidence/gap/assumption fields are present.
- Human checkpoints happen before writes when configured.
- Output boundaries are respected.

The orchestrator should not enforce:

- A fixed sequence of file reads.
- A fixed number of exploration steps.
- A fixed search strategy.
- A fixed LLM prompting strategy.
- A fixed implementation planner.
- A framework-specific discovery path.

Different adapters may delegate orchestration to the host tool when that tool already has strong planning/exploration behavior. In that case, Lamina acts as a contract validator and artifact writer rather than as the primary agent loop.

```text
src/
  cli/
    index.ts
    commands/
      lamina.ts

  core/
    orchestrator.ts
    session.ts
    modes.ts
    flow-router.ts

  discovery/
    context-discovery-engine.ts
    schema-scanner.ts
    route-scanner.ts
    frontend-flow-scanner.ts
    permission-scanner.ts
    dependency-scanner.ts

  interfaces/
    interface-context-layer.ts
    web.ts
    mobile.ts
    cli.ts
    bots.ts
    desktop.ts

  synthesis/
    synthesis-engine.ts
    insight-generator.ts
    edge-case-generator.ts
    journey-generator.ts
    assumption-tracker.ts
    risk-generator.ts

  tasks/
    task-generator.ts
    prioritizer.ts
    task-template.ts

  artifacts/
    artifact-manager.ts
    artifact-schemas.ts
    markdown-writer.ts
    frontmatter.ts
    migration-manager.ts

  analytics/
    connector.ts
    posthog.ts
    mock-connector.ts

  handoff/
    ux-requirements-formatter.ts
    ui-skill-formatter.ts

  llm/
    provider.ts
    prompt-builder.ts
    structured-output.ts

  config/
    config-loader.ts
    defaults.ts

  utils/
    git.ts
    paths.ts
    logger.ts
```

---

# 4. Core Data Model

The following shapes are illustrative schemas. They should be enforced at the CLI JSON/artifact boundary regardless of implementation language.

## 4.1 Session Model

```ts
type LaminaSession = {
  id: string;
  projectRoot: string;
  startedAt: string;
  mode: "guided" | "expert";
  flow: "ideate" | "optimize" | "add-feature" | null;
  targetInterfaces: InterfaceType[];
  problemStatement?: string;
  assumptions: Assumption[];
  discoveredContext: DiscoveredContext;
  userConfirmations: UserConfirmation[];
};
```

## 4.2 Interface Type

```ts
type InterfaceType =
  | "web"
  | "mobile"
  | "desktop"
  | "cli"
  | "bot"
  | "tv"
  | "wearable"
  | "api"
  | "unknown";
```

## 4.3 Discovered Context

```ts
type DiscoveredContext = {
  projectType: string | null;
  frameworks: string[];
  packageManager?: "npm" | "pnpm" | "yarn" | "bun";
  schemas: SchemaSummary[];
  routes: RouteSummary[];
  frontendFlows: FrontendFlowSummary[];
  permissions: PermissionSummary[];
  existingArtifacts: LaminaArtifactSummary[];
  confidence: "low" | "medium" | "high";
  gaps: string[];
};
```

## 4.4 UX Insight

```ts
type UXInsight = {
  id: string;
  title: string;
  summary: string;
  evidence: string[];
  assumptions: string[];
  userImpact: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  relatedFlows: string[];
};
```

## 4.5 Edge Case

```ts
type EdgeCase = {
  id: string;
  scenario: string;
  userGoal: string;
  trigger: string;
  expectedBehavior: string;
  riskIfUnhandled: string;
  priority: "P0" | "P1" | "P2";
};
```

## 4.6 Implementation Task

```ts
type ImplementationTask = {
  id: string;
  title: string;
  priority: "P0" | "P1" | "P2";
  userRationale: string;
  description: string;
  acceptanceCriteria: string[];
  edgeCases: string[];
  filesLikelyAffected?: string[];
  dependencies?: string[];
  verificationSteps: string[];
  uxNotes: string[];
};
```

---

# 5. Artifact System

All artifacts live in:

```text
.lamina/
```

## 5.1 Initial Artifact Structure

```text
.lamina/
  current-state.md
  research-questions.md
  insights.md
  personas.md
  edge-cases.md
  requirements.md
  implementation-tasks.md
  decisions.md
  config.yml
  journeys/
    README.md
```

## 5.2 Artifact Rules

Each file should use:

```md
---
artifact: implementation-tasks
version: 1
updated: 2026-07-03T00:00:00.000Z
session_id: lamina_abc123
status: draft
---

# Implementation Tasks

...
```

## 5.3 Required Artifact Contents

### `.lamina/current-state.md`

Purpose: Describe what Lamina currently understands about the product.

Sections:

```md
# Current State

## Project Summary

## Detected Stack

## Existing User Flows

## Data Model Summary

## API/Backend Summary

## Permissions & Roles

## Known Gaps

## Assumptions
```

---

### `.lamina/research-questions.md`

Purpose: Capture open questions that should inform implementation.

Sections:

```md
# Research Questions

## Critical Questions

## Nice-to-Know Questions

## Questions Answered This Session

## Questions Deferred
```

---

### `.lamina/insights.md`

Purpose: Store synthesized UX insights.

Sections:

```md
# Insights

## Key Insights

## Evidence

## Assumptions

## Confidence Levels

## Reusable Insights
```

---

### `.lamina/personas.md`

Purpose: Lightweight user archetypes.

Sections:

```md
# Personas

## Primary Users

## Secondary Users

## User Goals

## Pain Points

## Mental Models
```

---

### `.lamina/journeys/`

Purpose: Store journey maps by flow or feature.

Example:

```text
.lamina/journeys/onboarding.md
.lamina/journeys/checkout.md
.lamina/journeys/invite-user.md
```

Template:

```md
---
artifact: journey
flow: invite-user
version: 1
---

# Journey: Invite User

## User Goal

## Entry Points

## Steps

## Decision Points

## Failure States

## Recovery Paths

## Opportunities
```

---

### `.lamina/edge-cases.md`

Purpose: Track risks and edge conditions.

Sections:

```md
# Edge Cases

## P0 Edge Cases

## P1 Edge Cases

## P2 Edge Cases

## Error States

## Permission Issues

## Empty States

## Loading States

## Recovery Paths
```

---

### `.lamina/requirements.md`

Purpose: UX requirements before design/code.

Sections:

```md
# Requirements

## User Requirements

## Functional UX Requirements

## Non-Goals

## Constraints

## Interface-Specific Requirements

## Accessibility Requirements

## Analytics/Instrumentation Requirements

## UX Requirements Block for UI Skills
```

---

### `.lamina/implementation-tasks.md`

Purpose: Primary developer-facing output.

Sections:

```md
# Implementation Tasks

## Summary

## P0 Tasks

## P1 Tasks

## P2 Tasks

## Verification Checklist

## Edge Cases to Test

## What to Verify With Humans

## Assumptions
```

---

### `.lamina/decisions.md`

Purpose: Audit trail of important decisions.

Sections:

```md
# Decisions

## Active Decisions

## Superseded Decisions

## Decision Log
```

---

# 6. Main User Flow

## 6.1 `/lamina` Entry Point

When a user runs Lamina:

```text
/lamina
```

or:

```bash
lamina
```

The system should execute:

```text
Start Session
  ↓
Load .lamina artifacts if present
  ↓
Scan project context
  ↓
Show discovery summary
  ↓
Ask user what they are working on
  ↓
Determine flow
  ↓
Ask targeted questions
  ↓
Generate synthesis
  ↓
Show checkpoint
  ↓
Generate/update artifacts
  ↓
Show final implementation tasks
```

---

# 7. Conversational Flow Design

## 7.1 Initial Prompt

```text
What are you working on?

You can describe it naturally, or choose one:

1. Ideate from scratch
2. Optimize an existing flow
3. Add a new feature
```

## 7.2 Flow Routing Logic

Use simple intent detection first.

Examples:

### Ideate from Scratch

Triggered by:

```text
I have an idea...
I want to explore...
I’m not sure what to build...
Help me define...
```

### Optimize Existing Flow

Triggered by:

```text
Improve checkout
Users are dropping off
This flow is confusing
Make onboarding better
```

### Add New Feature

Triggered by:

```text
Add team invites
Build comments
Implement billing
Create notification preferences
```

If uncertain, ask:

```text
Is this primarily about:

1. Defining a new product/flow
2. Improving something that already exists
3. Adding a specific new capability
```

---

# 8. Flow 1: Ideate From Scratch

## Purpose

Help users convert a vague idea into UX requirements and implementation tasks.

## Questions

Ask only the minimum necessary in Guided Mode:

1. Who is this for?
2. What problem are they trying to solve?
3. What should users be able to do when this is done?
4. What interface is this for?
5. Are there any constraints?

## Outputs

- Problem framing
- Assumptions
- Primary user goals
- Initial journey
- UX requirements
- Edge cases
- Implementation tasks

## Acceptance Criteria

The flow is successful when Lamina produces:

- A clear problem statement.
- At least one primary user goal.
- At least one suggested journey.
- Prioritized P0/P1/P2 implementation tasks.
- Explicit assumptions and verification points.

---

# 9. Flow 2: Optimize Existing Flow

## Purpose

Analyze and improve an existing user flow.

## Questions

1. Which flow should we optimize?
2. What problem are users experiencing?
3. Do you have evidence, analytics, support tickets, or anecdotes?
4. What outcome should improve?
5. Are there known technical constraints?

## Context Discovery Emphasis

This flow should prioritize:

- Existing routes/pages.
- Current components.
- State transitions.
- Form validation.
- API calls.
- Error handling.
- Permissions.
- Drop-off points if analytics are available.

## Outputs

- Current flow summary.
- Friction points.
- UX risks.
- Edge cases.
- Improvement opportunities.
- Implementation tasks.

## Acceptance Criteria

The flow is successful when Lamina produces:

- Current flow summary.
- Prioritized friction points.
- Improvements tied to user rationale.
- Verification checklist.
- Tasks that can be handed to a coding agent.

---

# 10. Flow 3: Add New Feature

## Purpose

Turn a feature idea into implementation-ready UX requirements.

## Questions

1. What feature are you adding?
2. Who will use it?
3. Where should it fit into the current product?
4. What must the user be able to do?
5. What should happen in error, empty, loading, and permission states?
6. Which interface is this for?

## Context Discovery Emphasis

This flow should prioritize:

- Existing product patterns.
- Related routes.
- Relevant data models.
- Permissions.
- Backend endpoints.
- Component reuse opportunities.

## Outputs

- Feature summary.
- User goals.
- Integration points.
- Requirements.
- Edge cases.
- Task breakdown.

## Acceptance Criteria

The flow is successful when Lamina produces:

- Clear feature scope.
- Non-goals.
- Integration requirements.
- P0 implementation tasks.
- Edge cases and verification steps.

---

# 11. Guided Mode vs Expert Mode

## Guided Mode

Default mode.

Characteristics:

- Minimal questions.
- Smart defaults.
- Plain language.
- Avoids UX jargon.
- Optimized for speed.
- Produces usable tasks quickly.

## Expert Mode

Activated by:

```bash
lamina --expert
```

or selected during conversation.

Characteristics:

- More control over research methods.
- Explicit prioritization frameworks.
- More detailed journey mapping.
- More granular assumptions.
- Additional research artifacts.
- Advanced synthesis options.

## Implementation Detail

```ts
type LaminaMode = "guided" | "expert";
```

Guided mode should cap the number of required user questions.

Expert mode may allow deeper branching.

---

# 12. Context Discovery Engine

## 12.1 Discovery Contract

Context discovery must be non-opinionated. Lamina defines the context categories it wants, but not the exact exploration method every tool must use.

Discovery can be performed by:

- Lamina's built-in scanner.
- A host coding tool's own codebase exploration.
- A user-provided summary.
- A stack-specific adapter.
- A combination of all of the above.

The required output is a transparent context summary with evidence, confidence, and gaps. The required output is more important than the internal scanning algorithm.

## 12.2 Discovery Goals

Identify when possible:

- Project type.
- Framework.
- Package manager.
- Frontend routes.
- Backend routes.
- Data schemas/models.
- Auth/permission logic.
- Existing `.lamina/` artifacts.
- Possible user flows.

## 12.3 Example Discovery Inputs

The following are default heuristics for the reference implementation, not mandatory rules for every adapter or tech stack.

Prioritize when relevant:

```text
package.json
pnpm-lock.yaml
yarn.lock
bun.lockb
src/
app/
pages/
routes/
components/
lib/
server/
api/
prisma/
schema.prisma
drizzle/
supabase/
models/
controllers/
middleware/
```

## 12.4 Ignore Patterns

Respect:

```text
.git/
node_modules/
dist/
build/
coverage/
.next/
.nuxt/
.cache/
vendor/
```

Also read `.gitignore` where possible.

## 12.5 Framework Detection

Examples for the reference scanner:

```ts
if package.json contains "next" => Next.js
if package.json contains "react-router" => React Router
if package.json contains "express" => Express
if package.json contains "fastify" => Fastify
if package.json contains "@prisma/client" => Prisma
if package.json contains "drizzle-orm" => Drizzle
```

## 12.6 Route Detection Examples

These examples should not be treated as the only supported routing systems. Adapters may provide route summaries from any framework, including Rails, Django, Laravel, Phoenix, Spring, ASP.NET, mobile navigation stacks, API gateways, or custom architectures.

### Next.js App Router

Scan:

```text
app/**/page.tsx
app/**/route.ts
```

### Next.js Pages Router

Scan:

```text
pages/**/*.tsx
pages/api/**/*.ts
```

### Express/Fastify

Search for:

```text
app.get(
app.post(
router.get(
router.post(
fastify.get(
fastify.post(
```

## 12.7 Schema Detection

Default scanner may look for:

```text
schema.prisma
drizzle schema files
mongoose models
zod schemas
database migrations
SQL files
```

## 12.8 Permission Detection

Default scanner may search for common patterns:

```text
role
roles
permission
permissions
canAccess
authorize
requireAuth
middleware
isAdmin
ownerId
tenantId
organizationId
```

## 12.9 Discovery Summary Output

Before synthesis, show the discovered facts, evidence level, confidence, and gaps. The exact method used to discover them can vary by tool and tech stack.

```md
## What I found

- Framework: Next.js
- Data layer: Prisma
- Auth: Clerk
- Relevant routes:
  - /settings/team
  - /api/invitations
- Relevant models:
  - User
  - Organization
  - Invitation

## Confidence

Medium

## Gaps

- I could not find explicit role permission rules.
- I did not find analytics configuration.
```

This satisfies the transparency requirement.

---

# 13. Interface Context Layer

## Purpose

Prevent Lamina from assuming every product is a web app.

## V1 Interfaces

P0:

```text
web
mobile
```

P1/P2:

```text
desktop
cli
bot
tv
wearable
api
```

## Interface-Specific Reasoning

### Web

Focus on:

- Routes.
- Forms.
- Navigation.
- Empty/loading/error states.
- Accessibility.
- Responsive behavior.

### Mobile

Focus on:

- Small-screen constraints.
- Gestures.
- Offline/intermittent connectivity.
- Permission prompts.
- Push notifications.
- App store expectations.

### CLI

Focus on:

- Command syntax.
- Defaults.
- Error messages.
- Recoverability.
- Help text.
- Exit codes.

### Bots

Focus on:

- Conversation state.
- Misunderstanding recovery.
- Confirmation patterns.
- Human handoff.
- Latency.

---

# 14. Synthesis Engine

## Responsibilities

The Synthesis Engine converts:

```text
user input + discovered context + existing artifacts
```

into:

```text
insights + requirements + edge cases + tasks
```

## Required Synthesis Outputs

Each session should produce:

1. Problem framing.
2. User goals.
3. Current or proposed journey.
4. Key insights.
5. Assumptions.
6. Risks.
7. Edge cases.
8. Requirements.
9. Implementation tasks.

## Required Sections for Every Insight

```md
## Insight

### What this means

### Why this matters

### Evidence

### Assumptions

### What to verify
```

This mitigates over-reliance on AI output.

---

# 15. Edge Case Generator

## Edge Case Categories

Generate edge cases for:

```text
empty states
loading states
error states
permission states
validation failures
network failures
partial completion
duplicate actions
race conditions
abuse/misuse
accessibility needs
cross-device/session behavior
data conflicts
analytics/instrumentation gaps
```

## Example Output

```md
### P0: User tries to invite an existing team member

**Scenario:** A user enters an email address already associated with the workspace.

**Expected behavior:** The system should explain that the user is already a member and avoid creating a duplicate invitation.

**Risk if unhandled:** Confusion, duplicate records, support tickets.

**Verification:** Test invite flow with an existing member email.
```

---

# 16. Task Generator

## Task Generation Rules

Every implementation task must include:

```text
Title
Priority
User rationale
Description
Acceptance criteria
Edge cases
Likely files/components affected, when known
Verification steps
Assumptions
```

## Example Task Format

```md
## P0-01: Add duplicate invitation handling

**User rationale:** Users need clear feedback when inviting someone who already belongs to the workspace.

**Description:** Detect when an invitee email already belongs to an active workspace member and show a clear, non-blocking message.

**Acceptance criteria:**

- If the email belongs to an existing member, no new invitation is created.
- The user sees a clear message explaining the person is already a member.
- The message does not expose sensitive account details.
- The behavior is covered by automated tests.

**Edge cases:**

- Email casing differs.
- User is pending invitation already.
- User belongs to another workspace.
- Request is submitted twice quickly.

**Likely files affected:**

- `app/settings/team/page.tsx`
- `app/api/invitations/route.ts`
- `prisma/schema.prisma`

**Verification steps:**

- Invite an existing member.
- Invite a pending member.
- Invite a new user.
- Submit the same invite twice.
```

---

# 17. Analytics Connector System

## 17.1 Non-Opinionated Analytics Requirement

The same **WHAT, not HOW** rule applies to product analytics.

Lamina should not assume a specific analytics provider, tracking schema, event naming convention, funnel model, identity model, warehouse, or experimentation tool. Different products use PostHog, Mixpanel, Amplitude, Segment, GA4, RudderStack, Snowplow, Heap, FullStory, LogRocket, Datadog, custom warehouses, SQL dashboards, spreadsheets, or no analytics at all.

Lamina's analytics layer should ask for and normalize portable evidence categories, such as:

- Relevant event names, when available.
- Funnel or journey summaries, when available.
- Aggregate counts or trends, when available.
- Drop-off points, when available.
- User-reported evidence, support tickets, or anecdotes.
- Confidence and data-quality caveats.
- What data was not available.

Lamina should avoid prescribing:

- Required event names.
- Required analytics providers.
- Required funnel definitions.
- Required tracking libraries.
- Required query languages.
- Required dashboards.
- Required data warehouse schemas.

Analytics connectors are evidence adapters. They provide optional context for UX synthesis; they do not determine the product workflow.

## 17.2 V1 Recommendation

Make analytics connector architecture available in V1, but treat any provider-specific connector as optional. PostHog can be the first reference connector, not the analytics standard for Lamina.

## 17.3 Connector Interface

```ts
interface AnalyticsConnector {
  id: string;
  name: string;

  isConfigured(projectRoot: string): Promise<boolean>;

  getAvailableEvents(): Promise<AnalyticsEvent[]>;

  getFunnel?(params: FunnelQuery): Promise<FunnelResult>;

  getTrends?(params: TrendQuery): Promise<TrendResult>;
}
```

## 17.4 Provider Connector Scope

A provider connector should support, where possible:

- Detecting whether the provider appears configured.
- Listing known event names or screens.
- Returning aggregate funnel/journey summaries.
- Returning aggregate trend summaries.
- Reporting data-quality caveats.
- Safe failure when credentials or configuration are missing.

## 17.5 PostHog Reference Connector Scope

Initial PostHog connector should support:

- Detecting config.
- Listing known event names if configured.
- Optional funnel data if credentials are available.
- Safe failure if credentials are missing.

## 17.6 Privacy Requirement

Never automatically send analytics data to an LLM without user confirmation.

Prompt:

```text
I found possible product analytics evidence. Do you want me to use analytics signals for this session?

Source:
- [provider or user-provided summary]

Data used, if available:
- Event or screen names
- Funnel/journey summaries
- Aggregate counts or trends
- Data-quality caveats

I will not include raw user-level data.
```

---

# 18. Handoff Formatter

## Purpose

Produce a clean block that UI/design-oriented tools can consume.

## UX Requirements Block

````md
## UX Requirements Block

```yaml
feature: Team invitations
interface: web
users:
  - workspace admin
goals:
  - invite a teammate by email
  - understand whether the invite succeeded
states:
  empty:
    required: true
  loading:
    required: true
  error:
    required: true
  success:
    required: true
edge_cases:
  - duplicate invitation
  - already active member
  - invalid email
  - insufficient permissions
non_goals:
  - visual design
  - component implementation
```
````

Important: The block should describe UX logic and states, not visual styling.

---

# 19. Human Checkpoints

Lamina should include three lightweight checkpoints.

## Checkpoint 1: Problem Framing

```text
Here is how I understand the problem:

[summary]

Is this accurate?
1. Yes
2. Mostly, but I want to edit
3. No, restart framing
```

## Checkpoint 2: Synthesis Validation

```text
Here are the main UX insights and assumptions:

[insights]

Do these feel accurate enough to generate tasks?
```

## Checkpoint 3: Task Commit

```text
I generated implementation tasks.

Should I write these to .lamina/implementation-tasks.md?
1. Yes
2. Edit first
3. Show only, don’t write
```

---

# 20. Slash Command / Adapter Strategy

## 20.1 CLI First

Implement:

```bash
lamina init
lamina start
lamina scan
lamina tasks
lamina doctor
```

The CLI is the primary adapter surface because nearly every coding tool can run shell commands or ask the user to run them.

## 20.2 Universal Tool Support Strategy

Do not try to build a bespoke plugin for every coding tool in V1. Instead, support tools through layered compatibility surfaces:

```text
P0: Plain files in .lamina/          Works everywhere
P0: CLI text output                  Works in terminals and agent shells
P0: CLI JSON output                  Works in scripted adapters
P1: MCP server                       Works with MCP-capable coding tools
P1: Slash-command recipes            Works where tools support custom commands
P2: Native extensions/plugins        Only for highest-value tools
P2: Language SDKs                    Convenience, not required
```

This makes Lamina usable by Claude Code, Cursor, Pi, Codex-style CLIs, OpenCode, Continue, Aider, Cline/Roo-style agents, Zed/VS Code extensions, JetBrains tools, terminal agents, and future tools without making Lamina depend on their private APIs.

Adapters are responsible for translating Lamina's WHAT-level contract into the host tool's HOW-level behavior. For example, one adapter may ask its host agent to explore the repo, another may call `lamina scan`, and another may rely on user-provided context. All are valid if they produce transparent context, assumptions, requirements, edge cases, and tasks.

## 20.3 Universal Adapter Contract

Each editor/tool adapter should be able to call only:

```bash
lamina start --json
```

or:

```bash
lamina scan --json
lamina tasks --print
```

The JSON output is the stable contract. A TypeScript SDK may wrap this contract, but adapters must not require importing TypeScript code.

## 20.4 Adapter Output

Adapters should return JSON shaped like:

```json
{
  "summary": "Generated implementation tasks for team invitations.",
  "artifactsChanged": [".lamina/implementation-tasks.md", ".lamina/edge-cases.md"],
  "implementationTasksPath": ".lamina/implementation-tasks.md",
  "nextAction": "Ask your coding tool to implement the P0 tasks."
}
```

## 20.5 Tool Recipe Outputs

Lamina should ship copy-pasteable recipes rather than only native plugins:

```text
adapters/
  generic-agent.md
  claude-code.md
  cursor.md
  pi.md
  codex-cli.md
  opencode.md
  aider.md
  continue.md
  cline-roo.md
  vscode.md
  jetbrains.md
```

Each recipe should explain:

- How to run `lamina start`.
- How to read `.lamina/implementation-tasks.md`.
- How to ask the coding tool to implement tasks without overwriting UX artifacts.
- How to preserve Lamina's UX-only boundaries.

## 20.6 Example Commands

```bash
lamina init
lamina scan
lamina scan --json
lamina start
lamina start --json
lamina start --expert
lamina start --interface mobile
lamina start --flow add-feature
lamina tasks --print
```

## 20.7 Skill/Plugin Conformance Rule

A Lamina skill/plugin is conformant if it produces the required Lamina outputs and respects the boundaries, even if it uses a completely different internal process from the reference CLI.

Conformance should be judged by outputs:

- Did it capture project/user context?
- Did it state evidence, assumptions, confidence, and gaps?
- Did it ask only necessary clarifying questions?
- Did it generate UX requirements and edge cases?
- Did it generate implementation-ready tasks?
- Did it preserve artifacts safely?
- Did it avoid visual design and code-generation leakage?

Conformance should not be judged by internal mechanics:

- Which search commands were used.
- Which files were read first.
- Whether an AST parser was used.
- Whether the host tool or Lamina performed planning.
- Whether exploration was automatic, adapter-provided, or user-provided.

---

# 21. Configuration

## `.lamina/config.yml`

```yaml
version: 1

mode: guided

default_interfaces:
  - web

enabled_discovery:
  schema: true
  routes: true
  frontend_flows: true
  permissions: true
  analytics: false

analytics:
  provider: null

output:
  write_artifacts: true
  require_confirmation: true

boundaries:
  allow_visual_design: false
  allow_code_generation: false
```

---

# 22. Implementation Phases

# Phase 0 — Foundation MVP

## Objective

Build the minimum useful version that can run locally, collect or accept project context, guide a user, create `.lamina/`, and generate implementation tasks.

## Duration

1–2 weeks.

## Deliverables

### 22.1 CLI Entrypoint

Implement:

```bash
lamina init
lamina start
lamina scan
```

### 22.2 Artifact Manager

Capabilities:

- Detect project root.
- Create `.lamina/`.
- Create missing artifact files.
- Read existing artifacts.
- Write Markdown with YAML frontmatter.
- Append decision log entries.

### 22.3 Basic Context Discovery

Implement default context collectors for common cases, while keeping discovery replaceable by adapters or user-provided context:

- `package.json` hints when present
- framework detection hints
- route detection hints
- schema/model detection hints
- permission keyword hints

These collectors are heuristics, not requirements for every stack.

### 22.4 Guided Conversation

Implement minimal guided flow:

- Ask what user is working on.
- Determine flow.
- Ask 3–5 questions.
- Confirm framing.
- Generate output.

### 22.5 Task Generator

Generate:

- P0/P1/P2 tasks.
- User rationale.
- Acceptance criteria.
- Edge cases.
- Verification steps.

### 22.6 Web + Mobile Interface Support

Add interface-specific prompts and edge case categories.

## Phase 0 Acceptance Criteria

- Running `lamina init` creates `.lamina/`.
- Running `lamina scan` prints a context summary with confidence and gaps.
- Context may come from built-in discovery, adapter-provided discovery, or user-provided summaries.
- Running `lamina start` guides the user through a session.
- `implementation-tasks.md` is created or updated.
- Output includes assumptions, edge cases, and verification steps.
- No visual design instructions are generated.

---

# Phase 1 — Core Value

## Objective

Make Lamina meaningfully useful across real feature work.

## Duration

2–4 weeks.

## Deliverables

### 22.7 Three Complete Flows

Fully support:

- Ideate from scratch
- Optimize existing flow
- Add new feature

Each flow should have:

- Specific prompts.
- Specific synthesis behavior.
- Specific task templates.

### 22.8 Expert Mode

Implement:

```bash
lamina start --expert
```

Expert mode should support:

- More detailed research questions.
- More explicit assumptions.
- Optional personas.
- Optional journey maps.
- More granular task decomposition.

### 22.9 Edge Case Generator

Generate structured edge cases by:

- Interface type.
- Existing routes.
- Schema.
- Permissions.
- User goal.

### 22.10 Analytics Evidence Adapter

Implement a provider-neutral analytics evidence adapter contract, with PostHog as an optional reference connector if useful:

- Provider/config detection when possible.
- Event/screen name discovery when possible.
- Optional aggregate summaries when credentials are available.
- Data-quality caveats and confidence levels.
- Safe failure when analytics are unavailable.
- User confirmation before using analytics evidence.

Do not require a specific provider, tracking taxonomy, funnel definition, or query mechanism.

### 22.11 Handoff Formatter

Generate:

```md
## UX Requirements Block
```

for external UI/design skills.

### 22.12 Artifact Reuse

Before generating new outputs, Lamina should read existing:

```text
insights.md
personas.md
decisions.md
requirements.md
```

and reuse relevant information.

## Phase 1 Acceptance Criteria

- All three flows produce distinct, useful outputs.
- Expert mode produces deeper artifacts than guided mode.
- Edge cases are clearly tied to user goals/system context.
- Analytics evidence adapter fails safely when analytics are unavailable or not configured.
- UI handoff block contains UX requirements only.
- Existing `.lamina/` insights influence new sessions.

---

# Phase 2 — Maturity

## Objective

Improve extensibility, quality, and long-term artifact intelligence.

## Duration

4–8 weeks.

## Deliverables

### 22.13 Additional Interfaces

Add support for:

- CLI
- Bots
- Desktop
- TV
- Wearables

### 22.14 Additional Analytics Evidence Sources

Add optional connectors or import paths for:

- Mixpanel
- Amplitude
- GA4
- Segment/RudderStack-style event catalogs
- SQL/warehouse summaries
- CSV/manual analytics summaries
- Custom connector interface

All sources should normalize into the same evidence format with confidence and caveats.

### 22.15 Consistency Checker

Validate that:

- Requirements match tasks.
- Edge cases are covered by tasks.
- Decisions are reflected in requirements.
- No visual design leakage occurred.
- P0 edge cases have verification steps.

### 22.16 Artifact Compaction

Prevent artifact bloat by:

- Summarizing stale sessions.
- Marking superseded decisions.
- Moving old tasks to archive.
- Keeping current artifacts focused.

### 22.17 Stable Integration Surfaces

Expose a stable CLI/JSON contract first:

```bash
lamina scan --json
lamina start --json
lamina tasks --json
lamina artifacts --json
```

Optional SDKs may wrap the same contract:

```text
startSession()
scanProject()
generateTasks()
readArtifacts()
writeArtifacts()
```

Do not make SDK usage mandatory for adapters.

### 22.18 Tool Adapters and Recipes

Build official lightweight recipes/adapters for:

- Generic terminal agents
- Claude Code
- Cursor
- Pi
- Codex-style CLIs
- OpenCode
- Aider
- Continue
- Cline/Roo-style tools
- VS Code
- JetBrains IDEs

Prefer command recipes, slash-command templates, and MCP support before native plugins.

## Phase 2 Acceptance Criteria

- New interfaces can be added without changing core orchestration.
- Analytics connectors follow a common interface.
- Consistency checker catches missing edge case coverage.
- CLI JSON contract can be used by external tools.
- Optional SDKs wrap the CLI/artifact contract rather than replacing it.
- Adapter implementation is thin and reusable.

---

# 23. Suggested Initial File Tree

This is the TypeScript reference implementation layout, not a universal requirement.

```text
lamina/
  package.json
  tsconfig.json
  README.md

  src/
    cli/
      index.ts
      commands/
        init.ts
        start.ts
        scan.ts
        tasks.ts
        doctor.ts

    core/
      orchestrator.ts
      session.ts
      flow-router.ts
      checkpoints.ts

    discovery/
      context-discovery-engine.ts
      package-scanner.ts
      route-scanner.ts
      schema-scanner.ts
      permission-scanner.ts
      frontend-flow-scanner.ts

    interfaces/
      types.ts
      interface-context-layer.ts
      web.ts
      mobile.ts

    synthesis/
      synthesis-engine.ts
      insight-generator.ts
      edge-case-generator.ts
      requirement-generator.ts

    tasks/
      task-generator.ts
      task-prioritizer.ts
      templates.ts

    artifacts/
      artifact-manager.ts
      artifact-schemas.ts
      markdown.ts
      frontmatter.ts
      templates/
        current-state.md
        research-questions.md
        insights.md
        personas.md
        edge-cases.md
        requirements.md
        implementation-tasks.md
        decisions.md

    analytics/
      connector.ts
      posthog.ts

    handoff/
      ux-requirements-formatter.ts

    config/
      config-loader.ts
      defaults.ts

    llm/
      provider.ts
      prompt-builder.ts

    utils/
      paths.ts
      git.ts
      logger.ts

  tests/
    artifact-manager.test.ts
    context-discovery-engine.test.ts
    flow-router.test.ts
    task-generator.test.ts
```

---

# 24. Testing Plan

## Unit Tests

Test:

- Artifact creation.
- Frontmatter parsing.
- Flow routing.
- Project type hint detection.
- Route context collection.
- Schema context collection.
- Edge case generation.
- Task generation.
- Config loading.

## Integration Tests

Use fixture projects:

```text
tests/fixtures/
  next-prisma-app/
  express-api/
  react-spa/
  mobile-react-native/
```

Test that Lamina can:

- Scan each fixture.
- Generate a discovery summary.
- Produce valid artifacts.
- Avoid writing visual design instructions.

## Golden Output Tests

For known prompts, verify generated Markdown contains:

- `User rationale`
- `Acceptance criteria`
- `Edge cases`
- `Verification steps`
- `Assumptions`
- `What to verify`

## Manual QA Scenarios

1. Add team invitation feature to a Next.js app.
2. Optimize onboarding flow.
3. Ideate a new mobile habit-tracking flow.
4. Run Lamina in an empty repo.
5. Run Lamina in a repo with existing `.lamina/`.
6. Run Lamina with incomplete project context.
7. Run Lamina with analytics unavailable or provider credentials missing.

---

# 25. UX Quality Guardrails

Lamina should enforce these output rules:

## Always Include

- User rationale.
- Assumptions.
- Edge cases.
- Verification steps.
- What to validate with humans.
- Confidence level where appropriate.

## Never Include

- Visual styling directions.
- Color choices.
- Typography choices.
- Component implementation code.
- Pixel-level layout guidance.
- Unverified claims presented as fact.

## Required Disclaimer Pattern

When confidence is low:

```md
## Assumption

I did not find enough project context to verify this. Please confirm before implementation.
```

---

# 26. Definition of Done for V1

Lamina V1 is complete when:

1. A developer can run `/lamina` or `lamina start`.
2. Lamina creates and maintains `.lamina/` artifacts.
3. Lamina supports the three core flows.
4. Lamina can collect or accept project schema/routes/basic permission context without requiring a specific discovery method.
5. Lamina supports web and mobile interface context.
6. Lamina generates prioritized implementation tasks.
7. Every task includes user rationale and edge cases.
8. Lamina includes human confirmation checkpoints.
9. Lamina does not generate visual design or implementation code.
10. Existing artifacts are reused across sessions.
11. The project has tests for context collection, artifacts, routing, and task generation.
12. Documentation explains how to install, run, and integrate Lamina with AI coding agents.

---

# 27. Recommended Build Order

## Step 1

Create CLI shell:

```bash
lamina init
lamina scan
lamina start
```

## Step 2

Implement `.lamina/` artifact manager.

## Step 3

Implement package/framework context hints.

## Step 4

Implement route/schema/permission context hints.

## Step 5

Implement discovery summary with evidence, confidence, and gaps.

## Step 6

Implement guided conversation.

## Step 7

Implement flow router.

## Step 8

Implement basic synthesis templates.

## Step 9

Implement task generator.

## Step 10

Implement edge case generator.

## Step 11

Implement artifact writing.

## Step 12

Add web/mobile interface context.

## Step 13

Add expert mode.

## Step 14

Add provider-neutral analytics evidence adapter; optionally add PostHog as the first reference connector.

## Step 15

Add UI handoff formatter.

---

# 28. MVP User Story Breakdown

## Epic 1: Project Initialization

### Story

As a developer, I want to initialize Lamina in my repo so that UX artifacts are version-controlled.

### Tasks

- Implement `lamina init`.
- Create `.lamina/`.
- Create default artifact files.
- Create `.lamina/config.yml`.

### Acceptance Criteria

- Command is idempotent.
- Existing artifacts are not overwritten without confirmation.
- Generated files contain valid frontmatter.

---

## Epic 2: Context Discovery

### Story

As a developer, I want Lamina to understand or accept my project context without forcing a specific exploration strategy.

### Tasks

- Detect project root when running locally.
- Parse `package.json` when present.
- Accept adapter-provided or user-provided context.
- Detect framework hints when possible.
- Collect route hints when possible.
- Collect schema/model hints when possible.
- Collect permission hints when possible.
- Generate discovery summary with evidence, confidence, and gaps.

### Acceptance Criteria

- Works on common Next.js projects as a reference case.
- Does not assume every project is Next.js, JavaScript, or web-first.
- Handles missing files gracefully.
- Accepts externally supplied context from adapters.
- Shows confidence and gaps.

---

## Epic 3: Guided Session

### Story

As a developer, I want to describe my product problem naturally and be guided to useful UX outputs.

### Tasks

- Implement conversational prompts.
- Detect flow intent.
- Ask flow-specific questions.
- Confirm problem framing.
- Store session state.

### Acceptance Criteria

- User can complete a session in fewer than 15 minutes.
- User can correct Lamina’s framing.
- Session does not require UX expertise.

---

## Epic 4: UX Synthesis

### Story

As a developer, I want Lamina to turn my inputs and project context into UX insights.

### Tasks

- Generate insights.
- Generate assumptions.
- Generate risks.
- Generate edge cases.
- Generate requirements.

### Acceptance Criteria

- Outputs include evidence and assumptions.
- Low-confidence claims are marked clearly.
- Edge cases are actionable.

---

## Epic 5: Implementation Tasks

### Story

As a developer, I want copy-pasteable implementation tasks for coding agents.

### Tasks

- Generate P0/P1/P2 tasks.
- Include acceptance criteria.
- Include edge cases.
- Include verification steps.
- Write to `.lamina/implementation-tasks.md`.

### Acceptance Criteria

- Tasks are implementation-ready.
- Tasks are ordered by priority.
- Each task includes user rationale.
- Tasks reference likely files when discovery supports it.

---

## Epic 6: Artifact Reuse

### Story

As a team, I want Lamina to reuse prior UX knowledge.

### Tasks

- Read existing artifacts.
- Summarize relevant prior insights.
- Carry forward active decisions.
- Avoid duplicating stale content.

### Acceptance Criteria

- Existing insights influence new sessions.
- Decisions are preserved.
- Superseded content is marked rather than silently deleted.

---

# 29. Key Risks During Implementation

## Risk 1: Too Much AI, Not Enough Structure

### Mitigation

Use schemas and templates for all outputs.

## Risk 2: Poor Codebase Discovery

### Mitigation

Start with transparent summaries and confidence levels rather than pretending full understanding.

## Risk 3: Output Becomes Too Verbose

### Mitigation

Make `implementation-tasks.md` concise and keep detailed synthesis in separate artifacts.

## Risk 4: Scope Creep Into Design

### Mitigation

Add validation checks for banned visual-design language.

## Risk 5: Platform Adapter Complexity

### Mitigation

Build CLI + artifact + JSON contracts first. Keep adapters thin. Treat SDKs and native plugins as convenience layers, not core dependencies.

---

# 30. Launch Checklist

Before releasing V1:

- [ ] `lamina init` works.
- [ ] `lamina scan` works.
- [ ] `lamina start` works.
- [ ] `.lamina/` artifact templates are stable.
- [ ] Web and mobile contexts are supported.
- [ ] Three core flows are implemented.
- [ ] Human checkpoints are included.
- [ ] Task output includes rationale, edge cases, and verification.
- [ ] Visual design boundaries are enforced.
- [ ] Tests exist for core modules.
- [ ] README includes installation and usage.
- [ ] Example output is documented.
- [ ] At least two fixture projects are tested.
- [ ] Existing artifact reuse works.
- [ ] Safe failure behavior is implemented for missing context.
