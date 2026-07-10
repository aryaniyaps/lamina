# Enterprise RBAC Admin Console

Build a **minimal vertical slice** of multi-tenant RBAC: custom roles, org/team/resource assignment, inheritance/overrides, and an audit log — without locking out the last super-admin.

## Requirements

- Create roles, assign permissions, assign users, review audit log
- Protect last super-admin; transitive inheritance; SSO group mapping stays consistent
- Resolve conflicting permissions; handle role deletion while users are assigned; tolerate SSO sync delay
- Destructive permission changes need confirmation; permission matrix must be keyboard-navigable
- Trade-off: granular permissions vs admin complexity; inheritance vs explicit override
