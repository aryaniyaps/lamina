# Saved Searches

Design and implement a **minimal vertical slice** of saved catalog searches on Vercel Commerce: save filters, re-run, edit, and optional match notifications.

## Requirements

- Save named filter combinations (category, price, attributes); enforce a max number of saved searches
- Filter snapshot stays immutable until the user explicitly edits it
- Flows: save, run, edit, notification opt-in with frequency limits
- Prevent duplicate names; handle deprecated filters and "no new matches" notification states
- Entry points: account settings and search bar
- Announce search results and persist filter state accessibly
