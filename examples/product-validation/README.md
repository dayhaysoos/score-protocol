# SCORE product validation fixtures

These fixtures support SCORE's dated full-product and focused validation passes.
Each scenario owns its own `.score/score.db` and `.score/runner.db`; generated
reviews, Runner state, model sessions, dependency installs, and build output are
local evidence and are not intended for version control unless a dated fixture
explicitly preserves a sanitized artifact.

The fixtures deliberately do not reuse or mutate the two shipped examples.

| Directory | Purpose |
| --- | --- |
| `fresh-typescript/` | Fresh three-file preparation, review, execution, and project checks |
| `editable-revisions/` | Stable slice identity and immutable prepared revisions |
| `ordered-slices/` | Three sequential same-file slices with applied-revision dependencies |
| `graph-errors/` | Isolated malformed dependency graphs |
| `rerun-states/` | Guided reruns over unchanged, changed, missing, and occupied targets |
| `realistic-react-app/` | Eight-file React/TypeScript application delivered in three slices |
| `runner-observability-live-2026-08-11/` | Curated real-TTY evidence for Runner stages, retained status, and atomic application |
| `runner-observability-manual-live/` | Disposable manual check of the current responsive Runner table and liveness indicator |
| `change-authoring-dogfood/` | Packaged CLI, agent-authored Change, HTML review, guided Run, and project acceptance |

Normal fixture authoring files are hand-authored. A dated validation fixture may
preserve generated targets as explicitly labeled evidence. After a Runner
applies candidates, generated product targets are evaluated before any later
state change required by a rerun scenario.
