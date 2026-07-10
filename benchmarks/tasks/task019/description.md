# Enterprise RBAC Admin Console

Design and implement a complete multi-tenant RBAC admin product: custom roles, org/team/resource assignment, inheritance/overrides, and an audit log — without locking out the last super-admin.

## Requirements

- Create roles, assign permissions, assign users, review audit log
- Protect last super-admin; transitive inheritance; SSO group mapping stays consistent
- Resolve conflicting permissions; handle role deletion while users are assigned; tolerate SSO sync delay
- Destructive permission changes need confirmation; permission matrix must be keyboard-navigable
- Trade-off: granular permissions vs admin complexity; inheritance vs explicit override

## Deliverable

A coherent, buildable **full-product** implementation of the brief: domain model, all primary workflows end-to-end, edge/recovery paths, and a usable product surface. Do not stop at a single-screen or thin demo stub.
