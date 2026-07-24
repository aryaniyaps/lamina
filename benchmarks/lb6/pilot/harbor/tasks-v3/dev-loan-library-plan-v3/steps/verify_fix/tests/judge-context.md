# Borrowing things among neighbors

I want a friendly way for a small neighborhood group to lend useful things to one another. People should know who has what and whether it is safe to lend again, without making it feel like a logistics system. Please shape the product and build the next coherent version.

# Task brief

I want a friendly way for a small neighborhood group to lend useful things to one another. People should know who has what and whether it is safe to lend again, without making it feel like a logistics system. Please shape the product and build the next coherent version.

# Behavioral reference (concepts, not phrase hunt)

- Neighborhood loan requests are visible as first-class entities with a clear lifecycle (requested/pending → active after handoff).
- Handoff is mutual: borrower and owner each confirm; loan becomes active only after both confirmations.
- Damage reporting is meaningful after an active handoff: record damage and pause future lending for that item/loan.
- Premature damage (before active handoff) should be rejected or leave state unchanged — not silently mark damage.
- Multiple loans stay isolated (updating one must not collapse or alias another).
- Preferred product surface: a small reducer/state module (`createInitialState` / `reduce` / `project`) that can drive a simple UI.
