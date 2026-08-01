# Accessibility

Add accessibility detail only to surfaces and interactions in the current product slice. For each critical interactive workflow, specify:

- Semantic structure and accessible names.
- Keyboard reachability and logical order.
- Navigation and rerender focus.
- Invalid-field focus and error association.
- Busy/disabled state and duplicate-submit prevention.
- Live announcements for asynchronous outcomes.
- Status and progress that do not rely on color alone.
- Touch target requirements when touch input is in scope.

Encode these as surface behavior, operation outcomes, invariants, or scenarios—not a generic shared checklist. Verify them on the actual realizing surface.
