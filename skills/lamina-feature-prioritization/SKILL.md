---
name: lamina-feature-prioritization
description: "Feature Prioritization UX guidance. Use when featuritis and scope creep; designing for intermediates not experts; expert-only feature density."
metadata:
  lamina:
    id: feature-prioritization
    problems:
      - "featuritis and scope creep"
      - "designing for intermediates not experts"
      - "expert-only feature density"
      - "learnability vs power features"
      - "expert mode debates"
    related:
      - lamina-decision-making
      - lamina-progressive-disclosure
      - lamina-platform-posture
---
# Feature Prioritization

## Decision frameworks

- **Perpetual Intermediates**: Users who master fundamentals but rarely advance to expert shortcuts. - Use when deciding how much beginner scaffolding to include. - How: Design default experience for intermediate skill; don't optimize for experts or beginners alone.
- **Inflecting the Interface**: Adapting UI emphasis based on typical vs. atypical navigation paths. - Use when some features are daily-use and others occasional. - How: Promote working-set functions; demote rarely used configuration.
- **Designing for Three Levels of Experience**: Beginner, intermediate, expert—serve intermediates as primary. - Use when structuring menus, shortcuts, and help. - How: Pedagogic commands for discovery; immediate/invisible commands for speed.
- **Designing for Three Levels of Experience**: Beginners need discovery; experts need shortcuts; intermediates need efficiency on working sets. - Use when structuring command modalities and help systems. - How: Default UI for intermediates; pedagogic paths available but not persistent; expert shortcuts discoverable.

## Checklists

1. Optimize for intermediates—the largest and most valuable user segment.
2. Don't weld on training wheels; nobody wants to stay a beginner.
3. Inflect the interface—promote typical navigation, demote edge functions.
4. Users make commensurate effort when rewards justify it—reduce excise on high-value paths.
5. Imagine users as very intelligent and very busy.

## Heuristics

- **Nobody wants to remain a beginner**: Training wheels should come off, not stay welded on.
- **Don't weld on training wheels**: Persistent beginner modes insult returning users.
- **Working set**: Functions users need daily—optimize these ruthlessly.
- **Commensurate effort**: Users invest effort when rewards justify it.
- **Imagine users as very intelligent and very busy**.
- Users are**perpetual intermediates**, not aspiring experts.
- The**working set**is the product—everything else is secondary.
- Beginner help should**graduate away**, not persist forever.
- **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.

## Evaluation rubrics

### Perpetual Intermediate Design
- **When**: Most users will never become experts; design for daily working-set tasks.
- **Process**: Optimize for intermediate proficiency  ->  inflect interface by expertise  ->  avoid expert-only density as default.
- **Pass**: Core workflows efficient for regular users; advanced features discoverable.
- **Failure signals**: Empty-first-run or expert-only interfaces; training as substitute for design.

## Anti-patterns

- **Expert-only shortcuts with no discovery path**: Invisible commands nobody learns.
- **Permanent simplified modes**: Treating all users as perpetual beginners.
- **Equal menu prominence**: Giving rare admin functions same weight as daily tasks.
- **Optimizing for the demo**: Features that impress in sales but not in daily use.

## Examples

- **Optimizing For Intermediates**: A spreadsheet app exposes pivot tables equally in menus for all users, but research shows 90% of perpetual intermediates only sort, filter, and chart. The team inflects the interface: primary toolbar holds sort/filter/chart; pivot tables move to an Analysis menu with a one-time pedagogic tooltip. Experts retain keyboard accelerators; beginners find basics without wading through advanced statistics.

## Related capabilities

- [Decision Making](../lamina-decision-making/SKILL.md)
- [Progressive Disclosure](../lamina-progressive-disclosure/SKILL.md)
- [Platform Posture](../lamina-platform-posture/SKILL.md)
