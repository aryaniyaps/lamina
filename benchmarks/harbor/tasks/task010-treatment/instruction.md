# Session Expiration UX

Design and implement complete session timeout and re-authentication that preserves unsaved work and recovers mid-action failures — including SSO.

## Requirements

- Warn before idle expiry with an extend option; 30-minute idle timeout
- Preserve unsaved form work across re-auth; recover gracefully if session dies mid-submit
- Flows: idle warning, extend session, re-auth with work preservation, expired mid-submit
- Handle SSO (Okta) failure, concurrent session conflicts, and focus management on the warning modal
- Timeout warning must be announced to assistive tech
- Trade-off: security timeout vs workflow disruption; extend session vs force re-auth

## Deliverable

A coherent, **buildable application codebase** that implements the product behaviors in this brief: domain model, primary workflows end-to-end, edge/recovery paths, and a usable product surface in source.

Prefer one pragmatic stack you can finish (TypeScript/Node + simple web UI is fine for mobile-first briefs — keep the UI mobile-friendly). Scoring judges **application source**, not CI/CD, app-store packaging, push infrastructure, or production ops — those are out of scope.

Do not stop at a single-screen or thin demo stub. Do not refuse for scope or only write plans.

## Context

## Business goals
Meet security compliance for idle timeout without destroying in-progress work or spiking support tickets.

## Users
- Active users in form-heavy workflows
- Idle users who stepped away

## Constraints
- 30-minute idle timeout; SSO via Okta
- Concurrent sessions may conflict — define product behavior
- Never silently discard unsaved form data on re-auth
