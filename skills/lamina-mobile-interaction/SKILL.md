---
name: lamina-mobile-interaction
description: "Mobile Interaction UX guidance. Use when mobile-specific interaction patterns; touch and gesture design; new interaction approaches."
metadata:
  lamina:
    id: mobile-interaction
    problems:
      - "mobile-specific interaction patterns"
      - "touch and gesture design"
      - "new interaction approaches"
    related:
      - lamina-platform-posture
      - lamina-navigation
      - lamina-forms
    tags:
      - interaction
---
# Mobile Interaction

## When to load

- mobile-specific interaction patterns
- touch and gesture design
- new interaction approaches

## Decision frameworks

- **Anatomy of a Mobile App**: Structure for sovereign and transient mobile postures—tab bars, navigation bars, content areas. - Use when designing native or responsive mobile apps. - How: Limit top-level sections; maximize content; minimize chrome.
- **Mobile Navigation, Content, and Control Idioms**: Tabs, stacks, drawers, and contextual toolbars. - Use for wayfinding on small screens. - How: Follow platform HIG; preserve context during drill-down.
- **Multi-Touch Gestures**: Pinch, swipe, flick— invisible modality requiring discovery. - Use when gestures add speed without hiding sole path. - How: Provide visible alternatives; teach gestures through use.
- **Inter-App Integration**: Share sheets, deep links, handoff between apps. - Use when tasks span multiple applications. - How: Support platform integration patterns; don't rebuild the OS.
- **Other Devices**: Wearables, TV, kiosk—each demands posture-specific interaction models. - Use when extending beyond phone/tablet. - How: Kiosk = first-time optimized; wearable = glanceable micro-interactions.
- **Page-Based Interactions (Web)**: Task flows across linked pages—stateless constraints, bookmarkable destinations. - Use when designing web applications. - How: Optimize key paths; maintain context across pages; thoughtful URL structure.
- **The Mobile Web**: Responsive design bridging phone, tablet, and desktop browsers. - Use when one codebase serves multiple viewports. - How: Progressive enhancement; touch-friendly controls; performance budget.
- **Design Details: Controls and Dialogs**: Web-native controls, modal patterns, and error elimination. - Use when implementing interaction details on web. - How: Prefer modeless feedback; eliminate unnecessary alerts and confirmations.
- **The Future**: Emerging patterns—voice, ambient, wearable—extend behavior-first principles to new contexts. - Use when exploring novel platforms. - How: Anchor on persona goals; adapt posture and idioms to new constraints.
- **Eliminating Errors, Alerts, and Confirmations (Web)**: Web apps especially prone to alert fatigue—replace with inline validation and undo. - Use on any web form or transactional flow. - How: Inline field feedback; summary on submit; undo for destructive actions.

## Checklists

1. Design mobile anatomy for touch, thumb reach, and limited attention.
2. Use platform navigation idioms—tabs, stacks, drawers—not desktop ports.
3. Gestures accelerate but need visible alternatives for discoverability.
4. Support inter-app integration via platform share and deep-link patterns.
5. Match mobile posture (sovereign vs. transient) to task duration and focus.
1. Web interaction is page-based—optimize flows, URLs, and cross-page context.
2. Mobile web needs responsive postures, not shrunken desktop layouts.
3. Eliminate web alert/confirm patterns—use modeless feedback and undo.
4. Control and dialog details compound—design them against persona goals.
5. Apply behavior-first principles to emerging platforms—goals persist, idioms evolve.

## Heuristics

- **Thumb-driven design**: Primary actions within comfortable reach zones.
- **Postures for Mobile Devices**: Sovereign mobile (photo editing) vs. transient (quick capture).
- **Space constraints**: Pedagogic menus rare—rely on idioms and progressive disclosure.
- **Touch targets**: Adequate size and spacing for fingers, not mouse cursors.
- **Latency accommodation**: Optimistic UI and skeleton states during network waits.
- Mobile is**interrupt-driven**—design for quick in, quick out unless sovereign.
- Gestures are**invisible commands**—always offer a visible path too.
- **Content is the interface**on mobile—chrome is costly. - **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.
- **Web vs. native tradeoffs**: Reach vs. capability; choose by persona context.
- **Responsive posture**: Same product, different postures per viewport.
- **Eliminating Errors, Alerts, and Confirmations**: Web apps especially prone to alert fatigue.
- **The Devil Is in the Details**: Small control choices compound across flows.
- **Standards and consistency**: Web idioms (links, forms, buttons) users already know.
- Web pages are**rooms in a building**—users need consistent signage between them.
- Responsive design is**multiple postures**, not**shrunken desktop**.
- Future platforms still need**personas and goals**—technology changes, humans don't.

## Anti-patterns

- **Desktop ports**: Shrunken menus and toolbars on phone screens.
- **Gesture-only critical paths**: Functions discoverable only by swipe.
- **Tiny touch targets**: Mouse-sized controls on touch devices.
- **Ignoring platform idioms**: Reinventing tab bars and back navigation.
- **Web as desktop clone**: Porting sovereign desktop patterns to browsers.
- **Alert-heavy web apps**: JavaScript confirm for everything.
- **Non-bookmarkable critical states**: Losing context on refresh or share.
- **Chasing novelty without goals**: Voice UI because it's trendy, not because personas benefit.

## Examples

- **New Approaches**: The team presents findings in a debrief with video clips and a prioritized issue list—assigned owners leave the room with fixes scheduled for the next sprint, not a PDF archived in email.

## Related capabilities

- [Platform Posture](../lamina-platform-posture/SKILL.md)
- [Navigation](../lamina-navigation/SKILL.md)
- [Forms](../lamina-forms/SKILL.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](../lamina-decision-making/SKILL.md).
