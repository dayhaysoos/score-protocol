# Ordered pipeline intent

The pipeline evolves in three deliberately separate reviewed capabilities:

1. produce a normalized base message;
2. add explicit emphasis while retaining the base behavior;
3. compose a final labeled summary while retaining both earlier exports.

All functions are pure and deterministic. Each later capability must be built
against the bytes that the immediately preceding SCORE Run actually applied.
