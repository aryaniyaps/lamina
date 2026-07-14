# Clinic Appointment Scheduling

Design and implement a full patient-facing scheduling product for a multi-specialty clinic network — not a booking stub. Cover book, reschedule, cancel, waitlist, insurance gating, and staff exception handling as one coherent product.

## Requirements

- Domain: patients, caregivers, dependents, providers, locations, appointments, insurance plans, waitlist entries
- Support patients and caregivers booking for dependents; front-desk staff handle exceptions the self-serve flow cannot
- Enforce one booking per slot; gate booking on insurance verification status
- Primary flows: book, reschedule, cancel (with policy), insurance check, waitlist when no availability, front-desk override
- Secondary surfaces: appointment detail, confirmation/reminder copy, no-availability empty states, denied-insurance recovery
- No PHI in URLs or notifications; handle timezone confusion and same-day cancellations
- Recover when insurance is denied; offer waitlist when no slots exist
- Keyboard-accessible forms with announced errors and adequate contrast

## Deliverable

A coherent, **buildable application codebase** that implements the product behaviors in this brief: domain model, primary workflows end-to-end, edge/recovery paths, and a usable product surface in source.

Prefer one pragmatic stack you can finish (TypeScript/Node + simple web UI is fine for mobile-first briefs — keep the UI mobile-friendly). Scoring judges **application source**, not CI/CD, app-store packaging, push infrastructure, or production ops — those are out of scope.

Do not stop at a single-screen or thin demo stub. Do not refuse for scope or only write plans.

## Context

## Business goals
Cut call-center scheduling volume by 50% within 6 months without increasing no-shows or compliance risk.

## Users
- Patients (18+) booking for themselves
- Caregivers booking for dependents
- Front-desk staff resolving exceptions the self-serve flow cannot

## Constraints
- HIPAA-aware UX (no PHI in URLs or push/SMS bodies)
- Integrates with an existing EHR scheduling backend (assume API exists)
- English and Spanish at launch
- Trade-off: real-time eligibility accuracy vs booking speed — pick and document one
