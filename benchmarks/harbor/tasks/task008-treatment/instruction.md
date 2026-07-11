# Guest Document Sharing

Design and implement guest sharing for Outline documents: invite/link access, comment-or-view permissions, expiry, and revocation.

## Requirements

- Share via link or email invite; guest may view or comment (configurable); revoke immediately
- Expired links deny access; guest permissions are a subset of the document's member permissions
- Flows: share with guest, guest access, revoke, comment as guest
- Handle guest email mismatch, documents moved across collections, and collection vs document permission conflicts
- Clear guest-vs-member indicators; audit trail of share/revoke events
- Trade-off: link convenience vs security; comment access vs read-only

## Deliverable

A coherent, buildable **complete feature** implementation that fits the existing product: domain model, primary workflows end-to-end, edge/recovery paths, and UI that matches the host app patterns. Do not stop at a stub or single-path demo.

## Context

## Business goals
Enable external collaboration (clients, contractors) without forcing full workspace membership.

## Users
- Document authors sharing externally
- Team members co-owning docs
- External guests with limited access

## Constraints
- Brownfield Outline: collections, real-time editing, collection-level permissions, @mentions, inline comments
- Revocation must take effect immediately; expiry policy is mandatory for public links
- See product-context.md in the workspace if present
