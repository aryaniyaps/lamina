---
name: lamina-error-handling
description: "Error Handling UX guidance. Use when high error rates blamed on users; error message design; slip vs mistake diagnosis."
metadata:
  lamina:
    id: error-handling
    problems:
      - "high error rates blamed on users"
      - "error message design"
      - "slip vs mistake diagnosis"
      - "error analysis"
      - "high error rates"
      - "blaming users"
      - "error states"
      - "failed form submission"
    related:
      - lamina-forms
      - lamina-controls-and-menus
      - lamina-feedback-and-status
    tags:
      - audit-default
---
# Error Handling

## When to load

- high error rates blamed on users
- error message design
- slip vs mistake diagnosis
- error analysis
- high error rates
- blaming users
- error states
- failed form submission

## Decision frameworks

- **Slips vs. Mistakes**:
- **Slip**: Correct intention, wrong execution—especially under distraction or automaticity.
- **Mistake**: Wrong intention or plan—problem in mental model or decision. - When to use: Incident analysis, error-proofing strategy. - How: Slips → constraints, forcing functions, better feedback; Mistakes → better conceptual models, training, decision support.
- **Root Cause Analysis**: Investigate underlying systemic and design causes—not "human error" as terminal explanation. - When to use: Accidents, near-misses, support tickets, usability failures. - How: Five Whys; ask what in design/process enabled the error.
- **Swiss Cheese Model**: Multiple layered failures align to permit accident—fix layers, not one "root" person. - When to use: Complex system failures (healthcare, aviation, automation). - How: Strengthen each defensive layer; design for resilience.

## Checklists

1. Label "human error" as design failure until proven otherwise.
2. Slips need constraints and feedback; mistakes need better models.
3. Root cause analysis must go beyond blaming the last human touch.
4. Swiss Cheese Model—multiple layers must align for disaster.
5. Design for error—assume slips will happen.
6. Automation must keep users informed and recoverable.
7. Five Whys connects surface errors to design decisions.

## Heuristics

- **Law**: If system designed for human error, error rates drop dramatically.
- **Automation surprise**: User "out of the loop" when automation fails—slow to notice and respond.
- **Confirmation bias in RCA**: Stopping when human blamed.
- **Poka-yoke**: Error-proofing from manufacturing—applied to interaction design.
- **Learned helplessness**: Users assume they're stupid when design fails repeatedly.
- Think**"human error" as design symptom**, not root cause category.
- Use slip/mistake distinction to**pick the right fix**—constraints vs. mental models.
- Treat automation failures as**design responsibility**—keep human in informed loop.

## Evaluation rubrics

### Slip Vs Mistake Response
- **When**: Diagnosing errors and choosing design response.
- **Process**: Classify as slip (right goal, wrong execution) or mistake (wrong goal/plan). Slips  ->  undo, constraints, confirmations. Mistakes  ->  better signifiers, training, conceptual model.
- **Pass**: Design response matches error type.
- **Failure signals**: Blaming users; confirmations for mistakes; training for slips.

### Error Message Design
- **When**: Users encounter slips or system failures.
- **Process**: State what happened plainly  ->  explain why  ->  suggest fix  ->  preserve user input  ->  never blame user.
- **Pass**: User can recover without losing work or guessing.
- **Failure signals**: Error codes; vague messages; cleared form data.

## Anti-patterns

- **Blame the user**: "Operator error" closes investigation prematurely.
- **Alert fatigue**: Warnings users dismiss—slip enablers.
- **Out-of-the-loop automation**: No feedback until catastrophic failure.
- **Identical controls for different functions**: Slip magnets.
- **Training as band-aid**: Teaching users to work around bad design.

## Examples

- **Human Error Bad Design**: Royal Majesty cruise ship grounding (1997): GPS cable disconnected; system switched to dead reckoning without alerting crew—automation failure invisible for days. Root cause isn't "navigator error" but design of silent mode switch and lack of Gulf of Evaluation bridging. Design fix: prominent mode indicators, alerts when GPS lost, forcing acknowledgment.

## Related capabilities

- [Forms](../lamina-forms/SKILL.md)
- [Controls And Menus](../lamina-controls-and-menus/SKILL.md)
- [Feedback And Status](../lamina-feedback-and-status/SKILL.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](../lamina-decision-making/SKILL.md).
