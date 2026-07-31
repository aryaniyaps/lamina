# feedback loops

> Migrated intact from `skills/lamina-feedback-loops/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# Feedback Loops

Product behavior emerges from feedback: outputs that influence future inputs. Map balancing loops (stability) and reinforcing loops (growth or collapse) before designing recovery UX.

## Decision frameworks

- **Balancing feedback loop**: Goal-seeking; opposes deviation from a target (capacity limits, approval workflows, inventory caps).
  - When to use: Self-correction, quotas, rate limits, approval gates.
  - How: Stock → discrepancy vs goal → action on flows → stock adjusts.

- **Reinforcing feedback loop**: Amplifies change — more begets more, less begets less (referrals, viral sharing, compounding errors).
  - When to use: Growth features or collapse patterns (error cascades, duplicate submissions).
  - How: Mark reinforcing loops; watch for dominance shifts when balancing loops engage.

- **Delays cause oscillation**: Long gaps between action and visible effect produce overshoot (overbooking then mass cancellation).
  - When to use: Async workflows, batch processing visible to users, multi-step approvals.

## Checklists

1. For each stock in the domain, identify balancing and reinforcing loops.
2. Note delays between user action and system response.
3. Design feedback visible to users when loops affect their tasks (status, progress, limits).
4. Check whether a "fix" addresses symptoms (balancing) or root drivers (reinforcing).
5. Test what happens when a loop is broken (notification fails, approval stuck).

## Heuristics

- **Delays are invisible until they bite**: Surface expected wait times when loops have long delays.
- **Dominant loop wins**: When reinforcing and balancing loops conflict, identify which dominates at each scale.

## Anti-patterns

- **Symptom-only fixes**: Adding error messages without fixing the loop that generates errors.
- **Hidden reinforcing loops**: Duplicate-submit buttons that each create a new record.
- **Ignoring delay**: Promising instant results when stock inertia requires time.

## Examples

- **Venue capacity**: Balancing loop — registrations rise → available seats fall → registration closes. Reinforcing loop — if waitlist notifications fail, frustrated users share workarounds that increase duplicate registrations.

## Related capabilities

- System Structure
- System Traps
- Feedback and Status
