---
name: lamina-persuasion-and-groups
description: "Persuasion And Groups UX guidance. Use when designing for persuasion ethically; social and group product features; community onboarding paths."
metadata:
  lamina:
    id: persuasion-and-groups
    problems:
      - "designing for persuasion ethically"
      - "social and group product features"
      - "community onboarding paths"
    related:
      - lamina-trust
      - lamina-onboarding
      - lamina-product-behavior
---
# Persuasion and Groups

## Decision frameworks

- **Designing Smart Products**: Software that works hard when users aren't busy—proactive search, context-aware assistance, intelligent defaults. - Use when users perform repetitive information management tasks. - How: Use idle CPU cycles; make reasonable assumptions discardable if wrong.
- **Smart products put idle cycles to work**: Background indexing, prefetching, context-sensitive help levels. - Use when users wait while the processor idles. - How: Launch speculative work during pauses; abandon if user changes direction.
- **Smart products are perceptive**: Adjust help and complexity to user context—deadline pressure vs. exploratory noodling. - Use when one-size-fits-all assistance frustrates experts and novices alike. - How: Detect task urgency and skill signals; modulate intervention accordingly.
- **Smart products have good defaults**: Pre-fill, remember, and suggest without requiring explicit configuration. - Use when users repeat similar decisions. - How: Learn from past behavior; always allow easy override.
- **Smart products remember and infer**: Preferences, recent actions, and context inform proactive suggestions. - Use when users repeat decisions or workflows. - How: Pre-fill, highlight likely next action, offer one-click acceptance with visible override.
- **Designing Social Products**: Software where users interact with each other through shared artifacts, presence, or communication. - Use when products involve collaboration, sharing, or networks. - How: Distinguish social from market transactions; design for reciprocal relationships.
- **Social vs. Market Norms**: Social settings expect reciprocity and generosity; market settings expect fair exchange—mixing them is rude or illegal. - Use when monetizing or facilitating transactions in social contexts. - How: Match interaction patterns to the norm domain.
- **Social software lets users present their best side**: Identity, avatars, dynamic vs. static profiles. - Use when representing users to others. - How: User-controlled visuals; dynamic activity summaries over empty static bios.
- **Social products know when to shut the door**: Respect focus time; offer polite do-not-disturb. - Use when social features could overwhelm primary tasks. - How: Careful presence indicators; user-controlled interruption suspension.
- **Social products help networks grow organically**: Onboarding, mastery paths, graceful exit, and handling rejection without shame. - Use when designing community features. - How: Explicit rules for connection requests; gatekeeper roles; tools for suspending participation.

## Checklists

1. Smart products work proactively—use idle cycles for user benefit.
2. Persuade through considerate anticipation, not interruption.
3. Good defaults and memory reduce decision fatigue.
4. Context-aware assistance modulates help to user situation and skill.
5. Always provide easy override—smart doesn't mean presumptuous.
1. Social products must distinguish social norms from market transactions.
2. Let users present their best side—identity they control, profiles that reflect actions.
3. Collaboration tools should match real communication patterns.
4. Grow networks organically with onboarding, mastery, and graceful exit paths.
5. Know when to shut the door—respect user attention during primary tasks.

## Heuristics

- **Smart vs. intelligent**: Smart means working harder, not thinking for users.
- **Anticipate people's needs**: Considerate products act before being asked.
- **Context-aware help**: More assistance when struggling; less when expert and focused.
- **Positive defaults**: Sensible starting points users can change—not locked-in choices.
- **Modeless guidance**: Visual feedback that persuades without stopping proceedings.
- Persuasion through design is**helpful anticipation**, not dark patterns.
- Idle cycles are**unused influence**—prefetch, index, prepare.
- Defaults are**recommendations with an escape hatch**.
- **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.
- **User identity online**: Names aren't always unique; user-uploaded avatars beat random icons.
- **Dynamic profiles**: Actions speak louder—Timeline-style activity summaries.
- **Collaboration tools**: Threaded comments, resolve/reopen, fit real discussion patterns.
- **Organic network growth**: Onboarding, mastery paths, graceful exit, handling death and rejection.
- **Saving face on rejected connections**: Pass responsibility to rules or gatekeepers.
- Social software is a**host**—facilitate connection, don't dominate attention.
- **Actions over self-descriptions**—behavioral summaries beat empty profile fields.
- Networks need**onboarding paths**for new, intermediate, and senior members. - **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.

## Anti-patterns

- **Nagging dialogs**: Modal interruptions that demand attention for non-critical guidance.
- **Assumptions without override**: Smart features users can't easily reject.
- **Same help level always**: Tutorial overlays for expert users under deadline.
- **Dark patterns**: Manipulation that violates user goals for business metrics.
- **Blinking presence alerts**: Notifications that destroy focus during primary work.
- **Market norms in friend contexts**: Payment prompts after a dinner party.
- **Random avatars**: Cognitive load matching icons to people.
- **Forced connection acceptance**: No graceful way to decline without social cost.

## Examples

- **Designing For Persuasion**: OS X Spotlight searches while the user types elsewhere—idle cycles build an index so results feel instantaneous when queried. designs a project-management tool that detects a user struggling with a Gantt chart (many undo actions, long pauses) and modelessly surfaces a simplified timeline view—persuading toward a clearer tool without a "Would you like help?" dialog that breaks flow.
- **Designing For Groups**: Google Docs improves on Word's comment model: collaborators reply in threads, resolve issues with one click, and reopen resolved threads when needed—matching how teams actually discuss documents. adds a "focus mode" that suspends social notifications while preserving async collaboration—social products that know when to shut the door.

## Related capabilities

- [Trust](../lamina-trust/SKILL.md)
- [Onboarding](../lamina-onboarding/SKILL.md)
- [Product Behavior](../lamina-product-behavior/SKILL.md)
