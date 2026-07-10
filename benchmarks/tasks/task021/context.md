## Business goals
Support low-connectivity users (field, travel, remote) without data loss or silent overwrite.

## Users
- Frequent editors working through flaky networks
- Occasional viewers who may open docs offline

## Constraints
- Assume a CRDT-based sync engine exists — design product behavior around it, do not reimplement CRDTs
- Mobile and desktop clients
- Auth can expire while offline; recovery must preserve queued work
