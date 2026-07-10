## Business goals
Meet security compliance for idle timeout without destroying in-progress work or spiking support tickets.

## Users
- Active users in form-heavy workflows
- Idle users who stepped away

## Constraints
- 30-minute idle timeout; SSO via Okta
- Concurrent sessions may conflict — define product behavior
- Never silently discard unsaved form data on re-auth
