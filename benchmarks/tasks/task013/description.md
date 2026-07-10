# Document Sharing Audit

Audit Outline document sharing and permissions for product-behavior gaps, then implement a **minimal vertical slice** of the highest-priority fixes.

## Scope

- Share dialog, permission levels, collection vs document permissions, public links
- Inheritance bounds (document permissions bounded by collection), immediate revocation
- Permission downgrade propagation, link leak after revoke, access after document move
- Share-dialog focus and visible permission status

## Deliverable

- Findings on inheritance gaps, invariant violations, revocation failures, multi-view inconsistency
- Prioritized fixes; implement the top slice that hardens sharing invariants in code
