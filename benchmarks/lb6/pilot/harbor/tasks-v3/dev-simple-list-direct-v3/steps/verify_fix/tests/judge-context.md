# A tiny household list

I want a pleasant little list for one person to capture a few things, mark them done, and clear completed items. Keep it simple and friendly. Please shape the product and build the next coherent version.

# Task brief

I want a pleasant little list for one person to capture a few things, mark them done, and clear completed items. Keep it simple and friendly. Please shape the product and build the next coherent version.

# Behavioral reference (concepts, not phrase hunt)

- Add items with stable ids and titles; new items start incomplete/open.
- Complete marks an item done while preserving title.
- Completing a missing id is a no-op (state unchanged).
- Completing an already-completed item is idempotent (no spurious churn).
- Multiple items stay isolated (completing one leaves others incomplete).
- Clear-completed removes completed items and retains open ones.
- Preferred product surface: a small reducer/state module (`createInitialState` / `reduce` / `project`) that can drive a simple UI.
