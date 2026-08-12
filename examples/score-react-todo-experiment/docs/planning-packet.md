# SCORE planning packet

This directory contains the accepted inputs for the to-do application planning
experiment. The repository now retains one generated implementation so the same
editable slice can be revised and rerun against real current target files.

## Read in this order

1. [`product-brief.md`](./product-brief.md) defines the product goal, required
   behavior, state lifetime, and non-goals.
2. [`acceptance.md`](./acceptance.md) defines the observable state and
   interaction requirements.
3. [`design.md`](./design.md) defines copy, semantic structure, accessibility,
   and responsive constraints.

All three documents are required. If they appear to conflict, stop and ask the
user rather than silently choosing one.

## Planning boundary

The planning agent must inspect the current project and decide the TypeScript
and TSX ownership boundaries. These documents intentionally do not prescribe
filenames, component boundaries, or state architecture.

Use SCORE to prepare one reviewable implementation slice from these accepted
inputs. Stop when the SCORE HTML Plan Review is ready. Do not implement the
to-do app directly, approve the plan, start the Runner, or apply candidate
changes before the user reviews the plan.
