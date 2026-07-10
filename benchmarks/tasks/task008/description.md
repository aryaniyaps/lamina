# Guest Document Sharing

Design and implement a **minimal vertical slice** of guest sharing for Outline documents: invite/link access, comment-or-view permissions, expiry, and revocation.

## Requirements

- Share via link or email invite; guest may view or comment (configurable); revoke immediately
- Expired links deny access; guest permissions are a subset of the document's member permissions
- Flows: share with guest, guest access, revoke, comment as guest
- Handle guest email mismatch, documents moved across collections, and collection vs document permission conflicts
- Clear guest-vs-member indicators; audit trail of share/revoke events
- Trade-off: link convenience vs security; comment access vs read-only
