# Virtual file workspaces for Runtime Adapters

Status: exploration note, not an accepted decision or implementation plan

Reviewed: 2026-08-10

## Summary

SCORE may eventually benefit from giving each File Job a virtual, memory-backed
file workspace instead of an operating-system temporary directory. The useful
abstraction is a file-shaped namespace, not access to the user's real
filesystem. An Agent can still read and edit its assigned target while the
Runtime Adapter chooses whether those operations use memory, local disk, or a
remote sandbox.

This should be explored later, behind the existing Runtime Adapter seam. It
should not add a VFS concept to SCORE Core, the Change Plan, Agent Package, Plan
Approval, or Runner database. Candidate delivery is already adapter-owned, so a
virtual workspace can remain a private implementation choice that returns the
same complete candidate bytes and runtime metadata.

Do not begin the migration while it requires private OpenCode internals. The
current physical-workspace adapter is working, and OpenCode V2 does not yet
publish a supported interface through which an external client can create,
seed, bind, inspect, and destroy an in-memory workspace.

## Why this is worth retaining

The current OpenCode Adapter creates one disposable OS workspace per File Job,
seeds the assigned target when the operation is `replace`, binds one V2 session
to that directory, scans the complete directory after execution, and removes
it. This is intentionally private Adapter implementation, not part of SCORE's
shared Runtime Adapter interface.

A virtual workspace could preserve those semantics while improving:

- **Containment:** the only representable files can be the assigned target and
  any explicitly mounted, immutable context artifacts.
- **Lifecycle:** there are no temporary directories, symbolic links, or
  partially removed workspaces to clean up.
- **Observability:** the Adapter can retain an exact mutation log and the final
  rejected bytes when a Job fails after generation.
- **Failure injection:** tests can deterministically simulate missing output,
  undeclared files, write failures, interruption, and cleanup failures.
- **Portability:** the same Adapter design can run in an embedded process,
  serverless host, browser-like runtime, or remote workspace provider without
  assuming host-disk access.
- **Skill packaging:** a future integration could mount an exact approved skill
  bundle with stable relative paths instead of discovering ambient user files.

A VFS does not inherently improve reasoning, instruction following, generated
code quality, or terminal-result reliability. The deterministic SCORE system
instruction, frozen Agent Input, runtime completion evidence, candidate checks,
and real post-application project verification remain necessary.

## What OpenCode V2 currently provides

The SCORE repository currently pins `@opencode-ai/cli` to
`0.0.0-next-17111`. That V2 implementation contains an internal environment
interface and a Map-backed memory file driver. The driver supports file
operations but deliberately cannot spawn processes. That limitation fits the
current SCORE worker policy, which disables shell access and leaves project
checks to the real project after application.

OpenCode is also separating core Agent and skill behavior from physical file
discovery. In particular, the skill service is becoming a registry of loaded
values while configuration plugins own directory scanning and watching. This
supports the architectural direction, but it is not a public VFS commitment.

The public integration surface is not sufficient for SCORE yet:

- V2 session creation still accepts a `location.directory` pointing at a real
  absolute path.
- The public filesystem HTTP group exposes read, list, and find operations, but
  no interface for mounting, seeding, writing, snapshotting, or destroying a
  virtual namespace.
- The in-process V2 SDK is documented as private to the OpenCode workspace and
  unavailable for external installation.
- The internal memory driver is therefore implementation evidence, not a
  supported dependency for SCORE.

SCORE should not import private OpenCode packages, reach through generated
source maps, patch the OpenCode binary, or treat an undocumented `workspaceID`
as an in-memory-workspace switch.

## Intended future execution shape

The smallest useful design is one virtual workspace per File Job:

```text
Frozen Agent Package + bound target state
                    |
                    v
             Runtime Adapter
                    |
                    v
       isolated virtual namespace
       - assigned target, or absent for create
       - no repository mount
       - no peer candidates
                    |
                    v
         one file-scoped Agent session
                    |
                    v
       enumerate namespace and read target
                    |
                    v
     existing candidate checks and storage
                    |
                    v
 existing complete-set atomic application
```

For the first experiment, the VFS should contain only the assigned target
state. The Adapter should continue delivering the exact frozen Agent Input as
the user message and the deterministic SCORE execution instruction as the
system message. This isolates the workspace-substrate change from context and
prompt changes.

Mounting skill files or other context documents should be a later, separately
reviewed experiment. Any such file must be part of the frozen, digest-bound
input. Ambient OpenCode skills, global instructions, repository files, and
provider source bytes must remain unavailable.

## Boundaries that remain unchanged

A virtual File Job workspace is candidate transport and containment. It is not
the synthetic TypeScript project rejected by D-088.

The VFS must not introduce:

- a combined multi-file or multi-slice project;
- peer candidates or another Agent's output;
- dependency installation or module loading;
- a TypeScript `Program` or fabricated declaration environment;
- project typechecking, tests, builds, linting, or generated-code execution;
- repository discovery or a read-only mount of the real repository;
- a new SCORE Core filesystem schema or user-facing workspace switch; or
- a claim that virtual containment proves the generated application is correct.

The Runner still binds the exact repository root and target state, requires
every Job to succeed, checks target drift, and atomically applies the complete
candidate set as unstaged changes. Real project verification still happens
afterward under the project's own configuration and dependencies.

## Adoption gates

Do not start a production migration until the selected runtime offers a
supported, versioned interface that can prove all of the following:

1. Create one isolated namespace for one session or Job.
2. Seed exact bytes at an assigned relative path and represent an absent create
   target without fabricating a placeholder.
3. Read, write, list, stat, and remove entries without falling back to the host
   filesystem.
4. Enumerate the complete namespace after execution so undeclared entries fail
   closed.
5. Prevent path traversal, external-directory access, ambient skill discovery,
   and access to other Jobs.
6. Bind the exact namespace to the Agent session through a public client or
   published SDK interface.
7. Preserve bounded cancellation, terminal-result diagnostics, and deterministic
   cleanup.
8. Return exact candidate bytes without Markdown extraction or model-authored
   destination paths.
9. Pin the runtime and interface versions together and support deterministic
   contract tests.

If OpenCode exposes only its private memory driver but not these lifecycle and
inspection operations, the gate is not met.

## First bounded experiment

When the adoption gates are met, add an alternate OpenCode Adapter
implementation behind the existing Runtime Adapter seam. Do not replace the
physical-workspace path before comparison evidence exists.

Use a disposable fixture with exactly two independent Jobs:

- one `create` target; and
- one `replace` target with frozen source bytes.

Run the physical and virtual implementations with the same approved Agent
Packages, system instruction, provider, model, variant, concurrency, and no
automatic retries. Compare:

- first-attempt Job success and failure classification;
- exact candidate bytes and deterministic verifier results;
- target-only namespace enforcement;
- missing and undeclared output handling;
- interruption and cleanup behavior;
- retained failure evidence and mutation history;
- elapsed duration and resource use; and
- complete-set atomic application with unrelated repository changes present.

Success means the virtual implementation satisfies the existing Runtime
Adapter interface and safety rules with less host-filesystem authority or
lifecycle complexity. A speed improvement is useful but not required. Generated
code quality must still be evaluated independently in the real project.

## Reconsideration triggers

Revisit this exploration when one of the following occurs:

- OpenCode publishes a supported environment or workspace-driver interface.
- The public V2 client gains virtual workspace create, seed, inspect, and
  destroy operations.
- The in-process SDK becomes installable and documents filesystem injection.
- Physical temporary workspaces cause a demonstrated security, portability,
  cleanup, or reliability problem.
- SCORE needs an embedded or serverless Runtime Adapter where host-disk access
  is unavailable.
- Failure observability requires an authoritative write history that the
  physical workspace cannot provide cleanly.

Until then, continue using the current disposable single-target workspace and
improve observability at the existing Adapter and Runner seams.

## Adjacent idea: direct candidate submission

A runtime plugin could expose a structured `submit_candidate(content)` tool and
return candidate bytes without treating a file as output. That would be a
`content-return` Adapter, not a virtual filesystem. It may be valuable on its
own, but it should not be used as evidence that VFS containment, skill mounting,
or namespace inspection works.

## Open questions for a future review

- Does the runtime own VFS lifetime per session, per Job, or per shared Run?
- Can the Adapter inspect every path and mutation after an interrupted session?
- Can immutable skill assets and the writable target occupy distinct mounts?
- How are rejected candidate bytes and mutation logs retained without storing
  provider secrets or private response metadata?
- Does an in-memory workspace remain isolated when multiple sessions share one
  OpenCode server?
- Can the runtime guarantee that file tools never fall back to local paths?
- Is the public interface stable enough to pin without continuously following
  OpenCode private implementation changes?

## References

- [SCORE Runtime Adapters](../runtime-adapters.md)
- [D-079: SCORE stops after integrity-checked atomic candidate delivery](../decisions.md#d-079-score-stops-after-integrity-checked-atomic-candidate-delivery)
- [D-086: one disposable OpenCode server owns all isolated sessions in a Run](../decisions.md#d-086-one-disposable-opencode-server-owns-all-isolated-sessions-in-a-run)
- [D-087: the experimental OpenCode adapter uses the V2 execution contract](../decisions.md#d-087-the-experimental-opencode-adapter-uses-the-v2-execution-contract)
- [OpenCode V2 client](https://opencode.ai/v2/docs/build/client)
- [OpenCode V2 API](https://opencode.ai/v2/docs/api)
- [OpenCode V2 SDK](https://opencode.ai/v2/docs/build/sdk)
- [OpenCode V2 skills](https://opencode.ai/v2/docs/skills)
- [OpenCode memory driver source](https://github.com/anomalyco/opencode/blob/2580f880a8f99a33ef6b614cf0509e3d77a85b0a/packages/core/src/environment/memory.ts)
- [OpenCode skill/filesystem separation](https://github.com/anomalyco/opencode/pull/41622)
