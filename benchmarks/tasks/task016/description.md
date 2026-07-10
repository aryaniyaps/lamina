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

A coherent, buildable **full-product** implementation of the brief: domain model, all primary workflows end-to-end, edge/recovery paths, and a usable product surface. Do not stop at a single-screen or thin demo stub.
