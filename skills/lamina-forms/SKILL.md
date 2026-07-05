---
name: lamina-forms
description: "Forms UX guidance. Use when designing data entry forms; validation blocking users; form abandonment and errors."
metadata:
  lamina:
    id: forms
    problems:
      - "designing data entry forms"
      - "validation blocking users"
      - "form abandonment and errors"
      - "data collection"
      - "form abandonment"
      - "validation errors"
    related:
      - lamina-error-handling
      - lamina-flow-design
      - lamina-controls-and-menus
    tags:
      - audit-default
      - interaction
---
# Forms

## When to load

- designing data entry forms
- validation blocking users
- form abandonment and errors
- data collection
- form abandonment
- validation errors

## Decision frameworks

- **Rethinking Data Entry**: Forms oriented to human mental models, not database schemas. - Use when designing any data collection interface. - How: Accept varied formats; defer strict validation; annotate uncertainty.
- **Data Integrity versus Data Immunity**: Integrity rejects bad data at entry; immunity tolerates gaps and corrects intelligently later. - Use when clerical speed matters more than perfect keystroke validation. - How: Flag anomalies modelessly; queue for audit rather than blocking entry.
- **Bounded Controls**: Appropriate input widgets for data type—don't use free text where selection suffices. - Use when constraining input improves speed and accuracy. - How: Match control to data semantics; allow override when needed.
- **Audit, Don't Edit**: Batch-review anomalies instead of halting entry for each error.
- **Data Integrity versus Data Immunity**: Choose immunity when throughput and user dignity matter more than keystroke perfection. - Use for high-volume clerical and consumer data entry. - How: Accept input, flag confidence, audit batch—never halt proceedings for recoverable errors.

## Checklists

1. Prefer data immunity over data integrity at the keyboard.
2. Audit, don't edit—batch-review anomalies instead of blocking entry.
3. Use bounded controls matched to data semantics.
4. Allow input wherever you have output.
5. Never halt flow for recoverable validation issues.

## Heuristics

- **Missing data handling**: Flag incomplete records without locking the steering wheel.
- **Annotation**: Machine-readable notes on uncertain or corrected data.
- **Input focus and control**: Place input where output appears.
- **Don't stop proceedings with idiocy**: Never halt batch entry for one bad field.
- **An error may not be your application's fault, but it is your application's responsibility.**
- Forms are**conversations**, not**database inserts**.
- Border-patrol validation is**excise dressed as quality control**.
- **Audit later**beats**block now**for high-volume entry. - **Decision filter**: Ask whether this finding changes a specific design or business decision—if not, dig deeper or stop.

## Evaluation rubrics

### Form Design Pattern
- **When**: Collecting structured user input.
- **Process**: Minimize fields  ->  label above field  ->  inline validation  ->  smart defaults  ->  group related fields  ->  explain format  ->  preserve data on error.
- **Pass**: High completion rate; errors recoverable without data loss.
- **Failure signals**: Unnecessary fields; labels inside fields; cleared on error.

## Anti-patterns

- **Keystroke-level rejection**: Error dialogs on every format mismatch.
- **Required fields for non-critical data**: Blocking save because optional metadata is empty.
- **Free-text where bounded controls fit**: Inviting inconsistency and validation pain.
- **Stopping batch entry**: One bad ZIP code halts the afternoon's work.

## Examples

- **Data Entry Forms**: Enterprise clerks enter "TZ" instead of "TX" with city "Dallas." An integrity system stops them with a modal error. An immune system accepts the entry, infers the correction with lower confidence, annotates it, and queues for audit—never stopping the batch. The clerk finishes the afternoon; auditors fix three flagged records in minutes.

## Related capabilities

- [Error Handling](../lamina-error-handling/SKILL.md)
- [Flow Design](../lamina-flow-design/SKILL.md)
- [Controls And Menus](../lamina-controls-and-menus/SKILL.md)

## Cross-cutting

For prioritization and evidence triage, see [Decision Making](../lamina-decision-making/SKILL.md).
