# To-do app product brief

## Product goal

Maintain a small, dependable in-memory to-do app. The slice is intentionally
large enough to require meaningful planning across state and UI files while
remaining easy for a person to review and rerun through SCORE.

## Required behavior

- The page is titled `Tasks`.
- A user can add a task from a text input labeled `New task` and a button labeled
  `Add task`.
- Leading and trailing whitespace is removed before a task is added.
- An empty or whitespace-only task is not added.
- A user can mark any task complete or active using a checkbox associated with
  that task's title.
- The app provides `All`, `Active`, and `Completed` filters. `All` is selected
  initially, and changing filters does not change or reorder the underlying
  tasks.
- The task list preserves creation order.
- The interface provides a clear empty state when the selected filter contains
  no tasks.

## State lifetime

State lives in memory for the current page session. Reloading the page may reset
the task list.

## Non-goals

- Editing or deleting tasks.
- Persistence, accounts, a backend, routing, synchronization, or networking.
- New dependencies or changes to package, TypeScript, or Vite configuration.
- Automated test files. They may be authored separately when the user asks for
  them, but they are not targets in this slice.
- CSS changes or visual redesign. This slice is about behavior, semantics, and
  planning boundaries.

## Planning constraint

These documents intentionally do not prescribe filenames, component boundaries,
or state architecture. The planning agent must inspect the current project and
propose the TypeScript and TSX ownership boundaries needed to preserve or revise
the accepted behavior.
