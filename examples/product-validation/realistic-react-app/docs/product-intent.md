# Focus Board product intent

Focus Board is a small, local-only task triage application. A person can add a
task to either Work or Personal, mark it complete, and filter the board by All,
Active, or Completed. The page session is the only state lifetime.

## Required product behavior

- The page title and primary heading are `Focus Board`.
- A semantic form has a text input labeled `Task`, a select labeled `Group`
  with Work and Personal options, and an `Add task` submit button.
- Titles are trimmed. Blank titles add nothing. New tasks append in creation
  order and begin active.
- Every task has a stable numeric ID, a visible group label, and one native
  checkbox associated with its title.
- Toggling changes only the matching task.
- `All`, `Active`, and `Completed` filters preserve creation order and do not
  mutate the collection. All is initially selected.
- A summary reports `{completed} of {total} complete` for the full collection.
- The selected view always has a semantic list. When no task is visible, concise
  filter-specific empty copy remains visible beside the empty list.

## Non-goals

No persistence, editing, deletion, routing, networking, accounts, backend,
drag-and-drop, dates, priorities, dependency changes, or automated test targets.
