# Product behavior judge context

## Task description
Design and implement a full multi-specialty clinic scheduling product — not a booking stub: domain model, illegal states, actors and permissions, book/reschedule/cancel/waitlist/front-desk workflows, edge cases, named trade-offs, and a buildable patient + staff product surface.

## Behavioral reference checklist
Use as a **rubric for product behavior**, not a phrase hunt.
Credit implemented behavior (types, handlers, UI, validation, filters, empty/error states).
Do **not** require checklist id strings or slogan comments.
Negations/bans: absence or explicit rejection counts — the ban phrase need not appear.
Trade-offs/a11y: look for chosen behavior and accessible hooks, not snake_case labels.
Cite evidence (path/symbol/control) in criterion reasoning.

### required_entities
- patient
- appointment
- provider
- insurance_plan
- location
- waitlist_entry
- dependent

### required_invariants
- no_phi_in_urls
- insurance_gate_before_booking
- one_booking_per_slot

### required_personas
- patient
- caregiver
- front_desk_staff

### required_flows
- book_appointment
- reschedule
- cancel
- insurance_check
- waitlist_join
- front_desk_override

### required_rules
- cancellation_policy
- insurance_verification_gate
- provider_availability

### required_scenarios
- insurance_denied_recovery
- timezone_confusion_handling
- no_availability_waitlist
- caregiver_books_for_dependent

### required_edge_cases
- no_availability
- insurance_denied
- same_day_cancellation
- timezone_confusion

### required_a11y
- keyboard_navigation
- form_error_announcement
- contrast_compliance

### required_tradeoffs
- real_time_eligibility_vs_booking_speed
