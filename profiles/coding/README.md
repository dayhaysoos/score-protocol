# SCORE Coding Profile

**Status:** Experimental boundary for the first SQLite alpha.

The Coding Profile applies SCORE's compiled-definition model to source files.
Broad repository reasoning happens during context compilation. Each external
file agent later receives one closed Agent Input and owns exactly one target
file through a user-controlled Runner.

SCORE defines the work. It does not launch the agents or write the files.

## Core shape

A Change Plan contains:

- one immutable base Source Snapshot;
- one immutable, versioned set of Shared Contracts;
- one or more immutable File Briefs.

Each File Brief declares:

- exactly one normalized target path;
- exactly one operation: `create`, `replace`, or `delete`;
- an objective and allowed effect for that target;
- Contracts it implements or consumes;
- one closed Context Set;
- explicit Contract Inputs and Input Bindings;
- required Capabilities, tools, versions, and permissions;
- prohibited changes.

A Change Plan is invalid if two File Briefs claim the same target path or if one
File Brief permits more than one source-file mutation.

## Compilation

The first alpha uses an LLM Plan Compiler. It receives:

- an Accepted Specification and its Accepted Requirements;
- the exact base Source Snapshot;
- a versioned Compilation Procedure for this Profile.

The local alpha's default entry point is the user's existing capable agent with
a versioned SCORE authoring skill. After explicit acceptance of product meaning,
that agent takes the Plan Compiler role and invokes one coarse submission
interface with its complete Compiled Plan. Deterministic SCORE code creates or
opens the SQLite store, validates and imports the definition, materializes Agent
Packages, and prepares review. The LLM does not design tables or issue SQL, and
SCORE does not silently launch another compiler. A future adapter may explicitly use a
fresh compiler agent with the same fixed inputs and recorded provenance.

The compiler may inspect the complete declared Source Snapshot. It produces one
complete Compiled Plan containing the proposed Plan Manifest, Shared Contracts,
Change Plan, File Briefs, Context Sets, Context Items, bindings, dependencies,
source citations, and Compilation Report.

The compiler does not write SQLite. A deterministic importer validates the
Compiled Plan and either:

- records the immutable submission and atomically imports one complete draft;
  or
- records the immutable submission and findings without creating any partial
  definition rows.

Purely mechanical validation findings may enter a bounded LLM repair loop. The
validator—not the LLM—decides whether a finding is mechanical. Anything
involving product meaning, repository interpretation, a Compilation Gap, a
warning waiver, or approval authority stops for human input.

The Compilation Procedure is versioned separately from the Coding Profile.
Different procedures may target the same Profile schemas and validators.

## Closed per-file context

Every required project-specific fact is included as resolved content in the
File Brief's Context Set and eventual Agent Input.

A file agent may receive:

- the target file's exact current content for `replace`;
- an explicit absent-target declaration for `create`;
- the file-specific objective;
- shared Contracts;
- complete type declarations and API shapes;
- relevant policies, conventions, and examples;
- a selected skill's full immutable content;
- required tools, versions, and permissions;
- allowed and prohibited changes.

A file agent may not receive:

- a repository checkout or SQLite connection;
- arbitrary file-reading, search, or directory-listing authority;
- another File Brief's target content or in-progress output;
- a path, URL, symbol, or identifier it must follow to learn a required fact;
- hidden project-specific instructions added by the Runner.

Repository locations and digests may remain attached to the compiled definition
as review provenance. They do not authorize the agent to retrieve anything.

## Contract Inputs and bindings

Every Contract Input has:

- a stable identifier;
- required or optional status;
- an expected kind or schema;
- an accepted version rule;
- minimum and maximum cardinality.

Each supplied Context Item must bind to at least one Contract Input. Context Set
membership alone does not explain why an item exists. Approval validation
rejects:

- a missing required binding;
- a dangling binding;
- a kind, version, or cardinality mismatch;
- a binding to an item outside the File Brief's Context Set;
- a Context Item with no binding;
- a materialized Agent Package whose membership and bindings disagree;
- a required input supplied only as a lookup instruction.

These checks establish structural coverage of declared inputs. They do not
prove that the compiler discovered every fact the agent will need.

## Cross-file coordination

Single-file ownership prevents direct write conflicts but does not eliminate
semantic coupling. The Plan Compiler resolves shared future behavior as
versioned Shared Contracts before the Change Plan is approved.

Every affected File Brief implements or consumes the same fixed Contract. An
agent may neither redefine it nor inspect another agent's output.

```text
account-contracts@1
        |
        +-- implemented by: src/schema.ts File Brief
        `-- consumed by:    src/account-label.ts File Brief
```

Both agents receive the relevant Contract content directly. The consumer may
use a declared import path in its source code, but it does not read that file to
discover the interface.

If the Contract is too vague to compile complete closed Agent Inputs, the
Change Plan is not ready for approval.

## Compilation Gaps and warnings

A Compilation Gap is a concrete missing or ambiguous fact discovered before
approval that prevents safe compilation. It identifies the affected
requirement or compiled obligation, its basis and provenance, and what would
resolve it. It blocks approval until an authorized human resolves it or
records why the proposed Gap was mistaken.

A heuristic suspicion is a warning, not a Gap. Warnings require resolution or
an explicit human waiver with rationale. Neither the absence of Gaps nor the
presence of valid bindings proves perfect context.

If resolving a Gap changes product meaning, a new Accepted Specification and
affected requirements must be approved before recompilation. A repository-only
fact may revise compiler input without changing product intent, but it still
creates a new draft and review cycle.

## Review and approval

Before approval, deterministic code materializes one complete authoritative
Agent Package per File Brief. The Plan Review exposes:

- Accepted Requirement traceability;
- Contracts, dependencies, File Briefs, targets, and operations;
- every Context Item and binding per File Brief;
- source citations and compiler provenance;
- resolved skill contents, source, purpose, version, and digest;
- Capability, tool, version, and permission requirements;
- allowed and prohibited changes;
- validation errors, warnings, and Compilation Gaps;
- exact Plan Manifest, Compilation Report, Run Rules, Agent Input, and complete
  package identities and digests.

The first alpha requires explicit human approval. A deterministic renderer
generates the primary HTML Plan Review from an immutable review snapshot, while
documented SQLite views remain available for inspection. An interface adapter
may expose this through a tool, local function, SDK, CLI, MCP, or future UI;
none is required by the Profile.

The report groups each Change Plan as a Slice and nests its Shared Contracts,
Context and skill allocation, and files. The Plan Decision records the
authority, timestamp, decision, approved digests, and any warning waivers.

Any compiled-input or material-source change invalidates the approval and
requires a new draft, validation, review, and Plan Decision.

## Agent Package

The authoritative Agent Package is validated JSON:

```text
Agent Package
  |- control       Run Rules visible to the Runner only
  `- agent_input   complete project-specific input for the file agent
```

`control` contains routing and enforcement information such as the File Brief,
Change Plan, target, operation, Allowed Change, and the canonicalization or
version markers needed for integrity checks.

`agent_input` contains the exact objective, target state, Contracts, bindings,
resolved Context Items and skills, constraints, prohibited changes, and any
Profile-defined execution instructions visible to the agent.

SCORE records separate digests for `control`, `agent_input`, and the complete
package. A deterministic, versioned renderer may produce Markdown from
`agent_input` only. Rendering uses no LLM and adds no meaning.

The approving Plan Approval is not embedded in Run Rules because
that would make approval part of the digest it approves. A separate immutable
Approval Package Binding connects the approval to the exact Run Rules, Agent
Input, and complete package digests.

The three digest values are likewise stored beside the exact JSON values they
cover, not embedded inside those values as self-referential fields.

After approval, export reads the frozen Agent Package rows. It does not rebuild
them from a later database view.

## User-owned execution

The user deliberately invokes an external Runner through a Runtime Adapter. For
example, the OpenCode Adapter may:

1. select an approved Change Plan;
2. obtain every frozen Agent Package in the plan;
3. create one isolated OpenCode V2 session per File Brief;
4. route Run Rules without exposing them as project context;
5. supply each agent only its own Agent Input;
6. own the declared create, replace, or delete operations.

The Runner may use whatever Runtime Adapter-native edit mechanism it supports.
The first alpha does not standardize agent result transport and receives no
execution callback.

Runtime Adapters are a shared product integration seam, but concrete adapters
remain outside this Profile. They may not weaken Closed Context, add
project-specific prompt content, expose Run Rules to the file agent, or
grant changes beyond the single declared target. The current local integration
uses the OpenCode V2 server and HTTP API through SCORE's small typed V2 client;
Cursor is the planned second adapter and comparison benchmark. See
[Runtime Adapters](../../docs/runtime-adapters.md).

## Versioning and stale work

Any change to the base Source Snapshot, Shared Contracts, File Briefs, or
Context Sets supersedes the entire Change Plan. The Plan Compiler creates a
complete replacement definition; existing records are never rebound or edited.

The revision history exposes File Briefs and target files that were added,
removed, changed, or recreated with equal content under the new Change Plan.

If target files advance before external execution, the Runner must not silently
overwrite them. The current guided integration shows the exact target
differences and asks the human to confirm the current target state, then blocks
application if that state changes while agents work. Noninteractive execution
retains strict Source Snapshot matching. These are integration policies, not
SCORE Core filesystem actions.

## First-alpha conformance cases

1. Store the complete tiny Source Snapshot as immutable SQLite file rows and
   reproduce its ordered-manifest digest.
2. Reject a `replace` target absent from the base revision and a `create` target
   already present there.
3. Reject duplicate target writers and multi-file Brief changes.
4. Have an LLM compile exactly two coordinated File Briefs—one `replace` and
   one `create`—from the accepted inputs rather than handwritten SQLite rows.
5. Bind one small resolved skill only to the Agent Input that needs it.
6. Reject missing, dangling, incompatible, cardinality-invalid, or unexplained
   Context bindings.
7. Reject required facts represented only by pointers or lookup instructions.
8. Retain invalid and corrected Compilation Submissions while importing only a
   complete valid Compiled Plan as draft definition rows.
9. Materialize and display separate Run Rules, Agent Input, and complete
   package digests for both File Briefs.
10. Require human approval over those exact digests before export.
11. Reproduce Markdown byte-for-byte from the same Agent Input and renderer
    version without an LLM call.
12. Export the frozen packages without repository reads, SQLite access for the
    Runner, or handwritten project-specific prompts.
13. Supersede a changed definition without mutating any prior record.
14. Record no claim that agents ran, files changed, tests passed, or code was
    accepted.

## Explicitly deferred

The first alpha does not include:

- Runs, Assignments, Attempts, Events, or agent status;
- Agent-reported Context Gaps or result envelopes;
- Artifacts, Candidate Revisions, or repository assembly;
- retries, leases, cancellation, or overlapping Attempts;
- testing, Acceptance Oracles, Verification Results, or acceptance;
- failure-driven Corrective Compilation;
- benchmark or provider-comparison workflow.

These may become later protocol extensions only when a real integration makes
their semantics necessary.

## Outside the Profile

The Coding Profile does not require Git, a particular source host, SQLite, one
agent SDK, one model provider, one prompt format, one CLI, one sandbox, or one
deployment platform.
