# Saved Searches

Design and implement saved catalog searches on Vercel Commerce: save filters, re-run, edit, and optional match notifications.

## Requirements

- Save named filter combinations (category, price, attributes); enforce a max number of saved searches
- Filter snapshot stays immutable until the user explicitly edits it
- Flows: save, run, edit, notification opt-in with frequency limits
- Prevent duplicate names; handle deprecated filters and "no new matches" notification states
- Entry points: account settings and search bar
- Announce search results and persist filter state accessibly

## Deliverable

A coherent, buildable **complete feature** implementation that fits the existing product: domain model, primary workflows end-to-end, edge/recovery paths, and UI that matches the host app patterns. Do not stop at a stub or single-path demo.

## Context

## Business goals
Help frequent and B2B shoppers return to complex filter sets and discover new matching inventory without re-building searches.

## Users
- Frequent shoppers with repeat filter patterns
- B2B buyers monitoring catalog changes

## Constraints
- Brownfield Commerce catalog with existing search, filters, and collections
- Cap saved searches; throttle notification frequency vs relevance
- Notifications are optional and must degrade cleanly when filters become invalid
