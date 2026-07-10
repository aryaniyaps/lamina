# Expense Reimbursement Workflow

Design and implement a complete multi-step expense reimbursement product: employee submit → manager approve → finance review → payment, with policy enforcement and an immutable audit trail.

## Requirements

- Receipt required above $25; category/role policy limits; no payment without finance approval
- Flows: submit, manager approve/reject-with-reason, finance review, payment initiated
- Handle policy-violation escalation, manager OOO delegation, duplicate submission idempotency, currency conversion rounding
- Partial approvals allowed where policy permits; auditors can read the trail but not alter it
- Clear form validation and status tracking
- Trade-off: approval speed vs policy enforcement; delegation flexibility vs audit clarity

## Deliverable

A coherent, buildable **full-product** implementation of the brief: domain model, all primary workflows end-to-end, edge/recovery paths, and a usable product surface. Do not stop at a single-screen or thin demo stub.
