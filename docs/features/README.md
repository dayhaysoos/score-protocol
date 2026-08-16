# SCORE feature roadmap

This directory records durable product intent. Feature documents explain what
SCORE should eventually do and how a person can recognize success. They are not
executable Slices and are not accepted implementation specifications.

SCORE keeps exactly one current executable Slice in `score/slices`. That Slice
must be prepared from the repository as it exists at the time of execution.
Retired Slices remain in `score/retired-slices` as historical design evidence;
their file targets, declarations, dependencies, and digests may be stale.

## Working rule

For each feature:

1. select one small outcome from its feature document;
2. inspect the current repository and its real dependencies;
3. prepare and approve one fresh Slice;
4. execute it;
5. require typecheck, build, focused tests, and the full test suite to pass; and
6. resolve or revert that Slice before preparing another one.

A roadmap feature may require several sequential Slices. The feature document
survives those revisions; an executable Slice does not.

## Planned capabilities

| Feature | Product outcome | Retired Slice history |
| --- | --- | --- |
| [Declaration evidence](declaration-evidence.md) | Give Agents deterministic interface context derived from approved declarations and relevant source. | `declaration-evidence-preparation.json` |
| [Execution Flows](execution-flows.md) | Let authors communicate ordered or parallel behavioral steps to only the relevant Agents. | `execution-flow-contracts.json` |
| [Runtime Adapter foundation](runtime-adapter-foundation.md) | Keep the Runner independent of any one coding-agent runtime. | `runtime-adapter-foundation.json`, `runtime-adapter-foundation-repair.json` |
| [Runtime selection](runtime-selection.md) | Select and freeze a supported runtime without changing existing defaults. | `runtime-adapter-selection.json` |
| [Disposable Agent workspaces](disposable-agent-workspaces.md) | Give an Agent exact frozen source in an isolated workspace and extract only its assigned result. | `single-target-runtime-workspace.json` |
| [Pi runtime](pi-runtime.md) | Run Pi through SCORE's frozen package, isolation, and candidate boundaries. | `pi-runtime-primitives.json`, `pi-worker-lifecycle.json`, `pi-adapter.json` |
| [Runtime diagnostics and acceptance](runtime-diagnostics-and-acceptance.md) | Make runtime support understandable, diagnosable, and explicitly proven before release. | `pi-doctor-documentation.json` |

No feature listed here currently has an active Slice.
