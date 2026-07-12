# Document Sharing Audit

Audit Outline document sharing and permissions for product-behavior gaps, then implement the highest-priority fixes in code.

## Scope

- Share dialog, permission levels, collection vs document permissions, public links
- Inheritance bounds (document permissions bounded by collection), immediate revocation
- Permission downgrade propagation, link leak after revoke, access after document move
- Share-dialog focus and visible permission status

## Deliverable

- Findings on inheritance gaps, invariant violations, revocation failures, multi-view inconsistency
- Prioritized fixes; implement the highest-priority fixes that harden sharing invariants across the audit scope

## Context

## Business goals
Stop accidental data exposure from sharing/permission bugs while keeping collaboration usable.

## Users
- Authors sharing documents
- Viewers and workspace admins managing access

## Constraints
- Brownfield Outline collections, documents, and granular permissions
- Revoked access and expired/public links must not continue to work
- Audit inheritance conflicts between collection and document levels
