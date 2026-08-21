# Disposable Agent workspaces

**Status:** Planned shared extraction. No active Slice.

## Outcome

Each Agent receives exact frozen source through an isolated, disposable
workspace while its initial Agent Input stays focused. SCORE extracts only the
assigned target and leaves the real project untouched until complete-set
application.

## Expected behavior

- One Agent Package binds one target and explicitly approved context files by
  canonical path and content digest.
- Review remains complete, while the initial Agent Input may refer to large
  source bodies by path, purpose, and digest instead of duplicating them.
- A fresh workspace materializes only frozen package inputs.
- The Agent may work freely inside that workspace but cannot escape it through
  absolute paths, traversal, or symlinks.
- Only the assigned target is extracted; all auxiliary workspace changes are
  discarded.
- Missing, unchanged, invalid, oversized, or redirected target output fails
  closed with bounded evidence.
- Cleanup occurs on success, failure, cancellation, and timeout.

## Boundaries

A disposable workspace is a runtime delivery mechanism, not permission to copy
or typecheck the host project during preparation. It does not expand approved
context or make non-target edits eligible for application.

## Current implementation position

OpenCode already uses a disposable per-Job workspace and target-only candidate
extraction, but that machinery remains inside `open-code-adapter.ts`. Pi work
must first extract the reusable workspace, inspection, and cleanup behavior
behind an adapter-neutral invocation seam while proving OpenCode remains
unchanged. This extraction must not add repository, dependency, environment, or
project-command access to an Agent.

## Acceptance examples

- An Agent can read approved context and use scratch files without those files
  appearing in the candidate.
- The source repository has identical bytes before and after invocation until
  the Runner applies a complete valid candidate set.
- Two concurrent Jobs cannot observe or modify each other's workspaces.

## Historical evidence

- [Retired disposable-workspace Slice](../../score/retired-slices/single-target-runtime-workspace.json)
- [Virtual workspace research](../research/virtual-file-workspaces.md)
