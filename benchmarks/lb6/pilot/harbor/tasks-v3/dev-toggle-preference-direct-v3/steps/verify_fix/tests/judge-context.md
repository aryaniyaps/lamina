# Focus mode

I want a minimal personal settings panel where I can turn focus mode on when I need fewer distractions, see that the app reflects that choice, and turn it off again when I'm done. One person, one simple preference — keep the implementation small.

# Task brief

I want a minimal personal settings panel where I can turn focus mode on when I need fewer distractions, see that the app reflects that choice, and turn it off again when I'm done. One person, one simple preference — keep the implementation small.

# Behavioral reference (concepts, not phrase hunt)

- Focus preference is a first-class entity with a clear enabled/disabled state.
- Enable and disable (or toggle) visibly flip focus mode on and off.
- Round-trip toggle returns to the prior off/disabled state.
- Unknown / unsupported actions must be ignored without mutating state or leaking opaque probe payloads into the UI/projection.
- Keep the surface small: one person, one preference — avoid unrelated settings sprawl.
- Preferred product surface: a small reducer/state module (`createInitialState` / `reduce` / `project`) that can drive a simple UI.
