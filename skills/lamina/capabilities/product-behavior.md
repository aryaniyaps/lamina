---
id: product-behavior
problems:
  - "defining product behavior before build"
  - "UI mirrors database or org structure"
  - "behavior-first design process"
  - "new digital product"
  - "major redesign"
  - "UI mirrors internal structure"
related:
  - flow-design
  - user-modeling
  - platform-posture
---

# Product Behavior

## When to load

- defining product behavior before build
- UI mirrors database or org structure
- behavior-first design process
- new digital product
- major redesign
- UI mirrors internal structure

## Decision frameworks

- **behavior-first design process**: A six-phase process (Research → Modeling → Requirements Definition → Framework Definition → Refinement → Development Support) that translates user understanding into product behavior before construction. - When to use: Any interactive product where desirability, not just feasibility, determines success. - How: Designers participate in research, synthesize personas, derive scenarios and design requirements, define frameworks, refine detail, then support developers during build.
- **Capability / Viability / Desirability triad**: Successful products balance what people need, what sustains a business, and what technology can build. - When to use: Framing tradeoffs with stakeholders who overweight engineering or marketing alone. - How: Run user, business, and technology modeling in parallel; desirability (interaction design) must be equal to the other two pillars.
- **Implementation model vs mental model vs represented model**: Engineers build to implementation models; users think in mental models; designers craft represented models that bridge the gap. - When to use: Every interface decision—especially when developers want the UI to mirror data structures. - How: Make the represented model simpler than the implementation model and aligned with how users conceive their tasks and goals.
- **Design Values**: Foundational beliefs about how products should treat users (e.g., don't make users feel stupid). - Use when resolving design conflicts or prioritizing features. - How: Articulate values early; use them as decision filters with personas.
- **Interaction Design Principles**: Actionable rules derived from decades of practice (e.g., the computer does the work, the person does the thinking). - Use when evaluating interface proposals. - How: Apply principles as checklist during design reviews.
- **Interaction Design Patterns**: Recurring solutions to common interaction problems (e.g., modeless feedback, reversible actions). - Use when designing familiar constructs—forms, navigation, selection. - How: Adapt proven patterns to persona goals rather than inventing from scratch.
- **Interaction Design Patterns**: Reusable solutions—modeless feedback, reversible actions, bounded controls—for recurring problems. - Use when designing familiar constructs rather than inventing from scratch. - How: Adapt patterns to persona goals; document deviations with rationale.
- **HCD in Business Context**: Human needs are one constraint among many—shape, cost, reliability, time-to-market, profitability. - When to use: Enterprise and startup product development. - How: Articulate user impact in business terms; incremental HCD within releases.
- **Design as Competitive Advantage**: Usability and experience differentiate when features commoditize. - When to use: Strategy discussions with executives. - How: Connect design quality to retention, conversion, support cost reduction.
- **Incremental Improvement Path**: Perfect HCD product rare—ship viable, measure, iterate under business pressure. - When to use: Constrained roadmaps. - How: Prioritize highest-impact usability fixes; continuous discovery alongside delivery.

## Checklists

1. Poor product behavior (rude, forgetful, implementation-shaped) stems from absent or late design—not bad engineering intent.
2. Four failure drivers: misplaced priorities, ignorance of real users, design/build conflict of interest, no repeatable desirability process.
3. Goals change slowly; tasks change with every technology shift—design for goals.
4. The represented model is the designer's primary lever; match it to mental models, hide implementation ugliness.
5. behavior-first design process answers who users are, what they want, how they think, and how the product should behave—before pixels or code.
6. Interaction design is not guesswork when grounded in research, personas, scenarios, principles, and patterns.
1. Design values, principles, and patterns form a hierarchy of behavioral guidance.
2. Interaction design principles encode decades of learned lessons—use them actively.
3. Patterns accelerate consistency but must serve persona goals, not replace thinking.
4. Good product behavior is designed deliberately—not emergent from feature lists.
5. Reference Appendix A principles during reviews to keep teams aligned.
1. HCD operates alongside cost, schedule, and market constraints.
2. Translate user needs into business metrics for stakeholder influence.
3. Incremental HCD beats blocked pursuit of perfection.
4. Design differentiates when features commoditize.
5. Organizational politics require persistence—same as research impact.
6. Global products need culturally informed HCD.
7. Deadlines are real—prioritize highest-impact human-centered fixes.

## Heuristics

- **Goals vs tasks vs activities**: Goals are stable end conditions (travel safely); tasks are technology-dependent steps that good design can eliminate.
- **activity breakdown analysis**: Useful for breaking down behaviors but insufficient without asking *why* users perform activities.
- **Computer literacy**: A euphemism for forcing humans to think like machines rather than stretching software to human cognition.
- **Design as product definition**: Design is not a visual facelift on an implementation model—it specifies what the product does and how it behaves.
- **Designers as researchers**: Empathy requires direct exposure to users; separating research from design breaks the synthesis chain.
- Think of product development evolution as four stages: build-only → managers add specs → QA + cosmetic design → behavior-first design process *before* code.
- Treat the represented model as a translation layer: closer to mental model = easier learning; closer to implementation model = user alienation.
- Use goals as a lens: tasks that don't serve goals are candidates for removal when technology allows.
- **Principles vs. patterns**: Principles are why; patterns are how for specific situations.
- **Goal-directed interactions**: Behavior reflects user mental models, not implementation models.
- **Consistency through patterns**: Reuse reduces learning burden for perpetual intermediates.
- **Values as north star**: When principles conflict, values break ties.
- Principles are**guardrails**; patterns are**prefab sections**—both speed good decisions.
- A product without stated values drifts toward**implementation-model defaults**.
- Patterns learned once should**transfer across features**—that's idiomatic design.
- **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.
- **Featuritis**: Feature arms race ignoring coherent experience.
- **Deadline pressure**: Design appears only in last 24 hours before ship—universal pattern.
- **Organizational silos**: Engineering, marketing, design misaligned incentives.
- **Legacy constraints**: Existing systems limit ideal interaction.
- **Global products**: HCD must span cultures while sharing platform.
- **Sustainability and social impact**: Emerging business constraints on design.
- Think of business constraints as**design material**, not enemies—shape within them.
- Use**user need translations**: retention risk, support tickets, NPS—not just "better UX."
- Treat shipping as**beginning of iteration**, not end of design—if business allows.

## Evaluation rubrics

### Behavior Design Process
- **When**: Defining product behavior before construction; UI mirrors database or org charts.
- **Process**: Research  ->  modeling  ->  requirements  ->  framework  ->  refinement  ->  development support. Design represented models aligned to user mental models, not implementation structure.
- **Pass**: Behavior specified before build; decisions trace to user goals.
- **Failure signals**: UI after coding; implementation-model defaults; elastic generic user.

## Anti-patterns

- **Elastic user**: The generic "user" who is a power user when convenient and a novice when wizards are easier—license to build whatever the team prefers.
- **Feature lists from marketing**: Requirements documents that chase competitors without connecting to user goals produce orchestration failures.
- **Customers designing the product**: Domain knowledge → design knowledge; users describe problems, not solutions (the doctor/patient analogy).
- **UI after coding**: Like designing a building after construction starts—inflexible and goal-hostile.
- **Business goals without personal goals**: Products that serve employers' tasks but ignore clerks' dignity and engagement ultimately fail both sides.
- **Inventing new patterns for solved problems**: Custom date pickers when standards exist.
- **Principles as posters**: Stated values nobody references in sprint decisions.
- **Pattern cargo-culting**: Copying controls without understanding the underlying principle.
- **Purity over shipping**: Perfect HCD that never launches.
- **Feature checklist from sales**: Each deal adds complexity.
- **Design bypassed at deadline**: Engineers ship without evaluation gulf bridging.
- **Ignoring business case**: Designers can't advocate without speaking revenue/churn.
- **One-size global**: Cultural constraints ignored for cost savings.

## Examples

- **Behavior First Design Process**: An accounting clerk's stated task is "process invoices efficiently"—but that's the employer's goal. Her personal goals: appear competent, stay engaged during repetitive work, not look stupid. A product optimized only for throughput (batch entry screens mirroring database tables) may process invoices yet leave her resentful and error-prone. behavior-first design process asks what she is trying to accomplish emotionally and professionally, then designs behaviors (automation from invoicing system, exception highlighting) that serve *her* goals—which in turn improves business outcomes.
- **Design In Business**: Keyboard manufacturer under cost pressure: ideal HCD keyboard has optimal key travel, clear signifiers, natural mapping of function keys—but mechanical constraints and price point force compromises. Designer documents which compromises hurt gulf of execution most (key labeling, feedback on press) vs. acceptable trade-offs (plastic vs. Ships v1 with critical signifiers; v2 improves mapping based on return data—HCD within business reality.

## Related capabilities

- [Flow Design](flow-design.md)
- [User Modeling](user-modeling.md)
- [Platform Posture](platform-posture.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](decision-making.md).
