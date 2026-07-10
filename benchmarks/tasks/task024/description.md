# Session Expiration UX

Build a **minimal vertical slice** of session timeout and re-authentication that preserves unsaved work and recovers mid-action failures — including SSO.

## Requirements

- Warn before idle expiry with an extend option; 30-minute idle timeout
- Preserve unsaved form work across re-auth; recover gracefully if session dies mid-submit
- Flows: idle warning, extend session, re-auth with work preservation, expired mid-submit
- Handle SSO (Okta) failure, concurrent session conflicts, and focus management on the warning modal
- Timeout warning must be announced to assistive tech
- Trade-off: security timeout vs workflow disruption; extend session vs force re-auth
