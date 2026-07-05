---
id: platform-posture
problems:
  - "choosing product density and stance"
  - "sovereign vs transient vs augmentation"
  - "platform attention mismatch"
  - "defining new product stance"
  - "density mismatch complaints"
related:
  - product-behavior
  - feature-prioritization
  - mobile-interaction
---

# Platform Posture

## When to load

- choosing product density and stance
- sovereign vs transient vs augmentation
- platform attention mismatch
- defining new product stance
- density mismatch complaints

## Decision frameworks

- **Product Platforms**: Desktop, web, mobile, and embedded platforms each constrain and enable different interaction models. - Use when scoping a new product or port. - How: Choose platform based on user context and goals, not technical convenience alone.
- **Product Postures**: Sovereign (full-screen primary work), transient (quick auxiliary tasks), daemonic (background/invisible). - Use when defining scope and UI density for any app. - How: Classify the app's role in users' workflow; design to posture constraints.
- **Postures for the Desktop / Web / Mobile / Other Platforms**: Platform-specific posture guidance. - Sovereign: conservative visual style, rich input, maximize document views. - Transient: single window, previous position on launch, simple and to the point. - Kiosks: optimized for first-time use.
- **Daemonic Applications**: Background processes—invisible when working, unobtrusive when attention needed. - Use for sync, backup, and monitoring tools. - How: Notify only on failure or completion requiring user action; otherwise stay silent.

## Checklists

1. Decide platform and posture in concert with interaction design efforts.
2. Sovereign apps: full-screen, conservative visuals, rich input, maximize document views.
3. Transient apps: simple, single-window, launch to previous configuration.
4. Mobile, web, and desktop each demand posture-specific patterns.
5. Give your apps good posture—match interaction depth to the user's primary intent.

## Heuristics

- **Sovereign applications**: Primary work environments—Word, Photoshop, IDE.
- **Transient applications**: Calculator, dialogs, utilities—brief, focused interactions.
- **Daemonic applications**: Background sync, print spooler—invisible when working.
- **Posture mismatch**: Building sovereign complexity in a transient shell frustrates users.
- **Platform-posture matrix**: Same app may need different postures on desktop vs. mobile.
- Posture is**social role**—sovereign is the office; transient is the quick question in the hallway.
- **Optimize sovereign for full-screen**;**optimize transient for speed and exit**.
- Wrong posture feels like**bringing a filing cabinet to a coffee chat**.
- **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.

## Evaluation rubrics

### Product Engagement Posture
- **When**: Defining a new digital product's behavioral stance relative to user attention.
- **Process**: Assess attention level  ->  choose posture (sovereign/transient/augmentation for desktop; informational/transactional/editorial for web)  ->  design density accordingly.
- **Pass**: Posture documented; interaction density matches attention pattern.
- **Failure signals**: Sovereign density on transient tasks; posture mismatch causes chronic friction.

## Anti-patterns

- **Feature creep in transient apps**: Adding sovereign complexity to utilities.
- **Transient dialogs for sovereign tasks**: Modal boxes doing primary work.
- **Ignoring platform conventions**: Reinventing navigation idioms users already know.
- **Platform decided without design input**: Engineering picks stack before posture analysis.

## Examples

- **Platform And Posture**: A team builds a photo editor as a browser transient popup—single small window, limited tools. Users abandon it because editing is sovereign work needing full-screen canvas, rich input, and persistent tool palettes. reframes it as a sovereign web app with full viewport, keyboard shortcuts, and session persistence—matching posture to the persona's goal of serious image refinement.

## Related capabilities

- [Product Behavior](product-behavior.md)
- [Feature Prioritization](feature-prioritization.md)
- [Mobile Interaction](mobile-interaction.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](decision-making.md).
