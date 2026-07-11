# Travel Itinerary Planner

Design and implement a full collaborative trip planner for friend groups — not a packing-list stub. Cover shared itinerary, activity voting, expense split/settle, invites, and offline reconciliation as one product.

## Requirements

- Domain: trip, member, itinerary item, vote, expense, settlement, invite
- Invite-only trip access; organizer approval for material itinerary changes
- Primary flows: create trip, invite members, add activity, vote on options, split expense, settle up, leave trip
- Secondary surfaces: trip overview, member roster, conflict/vote resolution, offline sync status, expense export path
- Expense currency must stay consistent within a trip; handle member leaving mid-settlement
- Resolve conflicting votes; reconcile offline edits when connectivity returns
- Offline access during travel; maps need a non-visual alternative

## Deliverable

A coherent, buildable **full-product** implementation of the brief: domain model, all primary workflows end-to-end, edge/recovery paths, and a usable collaborative surface. Do not stop at a single-screen or thin demo stub.

## Context

## Business goals
Reach 100K trip plans in year one with 25% converting to premium (unlimited trips + expense export).

## Users
- Trip organizer (25–45) owning the plan
- Contributors adding ideas and expenses
- Passive members who mostly view

## Constraints
- iOS and Android native apps; Google Maps + calendar integration
- Premium unlocks unlimited trips and expense export
- Trade-offs: collaboration vs organizer control; offline access vs live sync
