# Healthcare Scheduling with Insurance Rules

Design and implement a complete insurance-gated scheduling product — not general clinic booking. Eligibility, prior auth, network status, and copay disclosure control whether and how a patient can book.

## Requirements

- Verify eligibility before booking; prior auth can block scheduling until approved (24–72h)
- Distinct flows: in-network book, out-of-network option, prior-auth wait, eligibility retry on timeout
- Display estimated copay before confirm; never guarantee coverage — show disclaimers
- Handle partial coverage messaging, auth denial with alternatives, and plan change mid-booking
- Plain-language insurance copy and recoverable error paths
- Trade-off: real-time eligibility wait vs booking speed; in-network restriction vs patient choice

## Deliverable

A coherent, **buildable application codebase** that implements the product behaviors in this brief: domain model, primary workflows end-to-end, edge/recovery paths, and a usable product surface in source.

Prefer one pragmatic stack you can finish (TypeScript/Node + simple web UI is fine for mobile-first briefs — keep the UI mobile-friendly). Scoring judges **application source**, not CI/CD, app-store packaging, push infrastructure, or production ops — those are out of scope.

Do not stop at a single-screen or thin demo stub. Do not refuse for scope or only write plans.

## Context

## Business goals
Reduce no-shows and day-of insurance surprises; stay compliant while keeping scheduling usable.

## Users
- Patients booking under insurance constraints
- Scheduling staff assisting when automation blocks
- Insurance coordinators working prior-auth queues

## Constraints
- This task is about insurance rules as the workflow edge — not multi-provider calendar UX broadly
- Cannot guarantee coverage; prior auth may take 24–72 hours
- Eligibility APIs can time out and must be retryable
