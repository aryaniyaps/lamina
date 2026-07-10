# Expense Reimbursement Workflow

Build a **minimal vertical slice** of multi-step expense reimbursement: employee submit → manager approve → finance review → payment, with policy enforcement and an immutable audit trail.

## Requirements

- Receipt required above $25; category/role policy limits; no payment without finance approval
- Flows: submit, manager approve/reject-with-reason, finance review, payment initiated
- Handle policy-violation escalation, manager OOO delegation, duplicate submission idempotency, currency conversion rounding
- Partial approvals allowed where policy permits; auditors can read the trail but not alter it
- Clear form validation and status tracking
- Trade-off: approval speed vs policy enforcement; delegation flexibility vs audit clarity
