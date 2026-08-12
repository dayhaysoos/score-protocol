# SQLite Alpha: Table-Driven Closed File Briefs

**Status:** Experimental design note. SQLite is an implementation choice for the
first alpha, not a SCORE Core requirement.

The implemented schema retains earlier identifiers such as `run_manifests`,
`coding_passes`, `capsules`, `harness_payloads`, and `publication_decisions`.
[Terminology](./terminology.md) maps those identifiers to the canonical product
language used in this document.

## Question the alpha should answer

Can an LLM Plan Compiler, guided by a versioned procedure and human-accepted
intent, produce complete File Briefs as inspectable SQLite data that can be
loaded by identifier and exported as complete per-file instructions for a
user-owned Runner, without requiring that Runner to discover more
project context or compose a new prompt?

The alpha is successful if the LLM produces a complete draft definition that
passes validation and human approval, after which the SCORE exporter can
materialize each File Brief as an immutable structured Agent Package using only its
authorized SQLite data.

The Core alpha stops at that export boundary. The user reviews the SCORE
definition and then deliberately triggers their own Runner. Core does not
launch agents, write or apply files, assemble a repository, run project tests,
judge whether the code works, or accept a result.

The next seam is a user-owned Runner using a Runtime Adapter. The first local
adapter experiment now uses the pinned OpenCode V2 server and HTTP API; Cursor is the second adapter and
comparison benchmark. The Runner enumerates the approved Change Plan, obtains one frozen
Agent Package per File Brief, starts one agent per file, supplies that agent
only its Agent Input, and owns the declared file operation. SCORE is the source
of the approved structure and context; the Runner and its agents are the
writers. The common adapter seam and isolation design are
documented in [Runtime Adapters](./runtime-adapters.md).

## Export seam

```text
LLM Plan Compiler
            |
            v
    Compiled Plan
            |
            v
 deterministic validation
   + transactional import
            |
            v
       SQLite tables
            |
        materialize
            |
   immutable Agent Package
            |
            v
  JSON or Markdown export
            |
            v
     user-owned Runner
      (outside SCORE)
```

The SCORE exporter owns the SQLite connection. The user-owned Runner receives
only the exported Agent Package. Giving the Runner or its file agent the database
would let it query undeclared rows and would violate Closed Context.

The LLM Plan Compiler does not receive the SQLite connection either. It
emits one complete Compiled Plan. A deterministic importer either rejects
the plan without changing draft-definition tables or persists its complete
object graph to SQLite in one transaction. SQLite is the alpha's authoritative
store after that boundary.

Every Compiled Plan is nevertheless retained in separate compiler-history tables as
an immutable Compilation Submission with its validation result. Invalid
submissions cannot be approved or exported; preserving them does not make them
part of the draft definition.

The current local authoring flow begins in the capable agent the user already
employs. After the person and that agent settle a small slice, the versioned
SCORE authoring skill maintains its editable JSON draft and invokes the coarse
preparation interface. Deterministic SCORE creates or opens SQLite, validates
and imports the complete compiled definition, materializes Agent Packages, and
prepares the HTML Plan Review. It does not introduce a separate specification
ceremony or invoke a hidden second compiler agent. Explicit delegation to a
fresh compiler may be tested later without changing the Compiled Plan or
importer seam.

This is not a required workflow CLI. Plan submission, human approval, and
approved-package reading are separate role-specific interfaces. A local
function, tool call, SDK, MCP server, CLI, or future UI may adapt them. The local
alpha may use a shell adapter for convenience, but neither the user nor the LLM
is required to coordinate a sequence of public SCORE commands. The LLM authors
the definition; deterministic SCORE code materializes it as trustworthy SQLite.

Each approved Brief produces one immutable Agent Package. Static integration
instructions may explain how a Runner reads the envelope, but the objective,
target content, Contracts, policies, Context Items, resolved skills,
Capabilities, and Allowed Changes all come from SQLite. The Runner should not need a
human or LLM to write another project-specific prompt.

## Smallest useful trial

The first trial needs only:

- one Accepted Specification produced through human and LLM deliberation;
- one base Source Snapshot;
- one LLM Plan Compiler following one versioned Compilation Procedure;
- one versioned collection of Shared Contracts;
- one Change Plan;
- exactly two File Briefs with different targets: one `replace` and one
  `create`, coordinated by one shared Contract but with different Agent Inputs;
- exactly one small resolved skill, bound and embedded only in the Agent Input
  of the File Brief that needs it;
- one documented Agent Package export format;
- inline text and JSON content stored directly in SQLite;
- one authoritative JSON Agent Package and deterministic Markdown render for each
  approved File Brief.

Inline storage is deliberate for the alpha. Content-addressed blob storage and
remote Agent Package transport can wait until the table model is understandable.

The single export shape is an intentional experiment boundary. This alpha can
show that an LLM can produce a reviewable SCORE definition and that complete
closed per-file instructions can be derived from its tables. It does not prove
that an agent successfully executes them or that two Runners interpret them
identically. A later trial may pass the same approved definition through real
user-owned Runners.

The alpha ships one reference Compilation Procedure, but its version is not the
Coding Profile version. The Profile's schemas and deterministic validators are
the conformance target; later procedures may target the same Profile and remain
separately attributable.

The miniature workload remains in the repository as reproducible test and
conformance data. It is not a protocol object, portable product abstraction, or
SQLite table. The product artifact exercised by the test is the approved Plan
Manifest and Change Plan. The same approved definition can be exported again
without changing its compiled contents; execution reporting is deferred.

The workload uses a tiny repository created specifically for this alpha. Its
base revision has one existing file to replace, one absent path to create, one
shared Contract need, and no unrelated service or build dependencies. SQLite
stores that complete immutable revision as per-file paths, exact content bytes,
media or content types, and content digests. The revision digest is derived
deterministically from an ordered manifest of those records. This reduction
applies only to workload complexity: the LLM Plan Compiler must still
generate the complete Compiled Plan from the accepted inputs, and the
fixture's Brief, Context Set, and Agent Package rows are not manually
authored in SQLite.

The exact permanent first fixture is the Account Status scenario in
[coding-profile-run.md](../examples/coding-profile-run.md): replace
`src/schema.ts` to add the fixed status union, create
`src/account-label.ts` with the fixed formatter behavior, and supply the small
TypeScript Module Boundaries skill only to the creator Brief. The conformance data
includes valid and deliberately invalid Compiled Plan examples with expected
deterministic findings. Larger fixtures
are added only after this one succeeds and do not replace it.

## Identity and integrity

Every protocol record uses an opaque text primary key. Immutable content also
stores a separate digest, and replacement rows use explicit `supersedes_*`
foreign keys. SQLite row numbers and content hashes are not protocol identity.

Structured JSON uses RFC 8785 canonicalization, UTF-8, and SHA-256. Digest text
uses the form `sha256:` followed by 64 lowercase hexadecimal characters.
Canonicalization rejects duplicate object names, invalid Unicode, non-finite
numbers, and other input outside the RFC 8785 I-JSON boundary. Protocol integer
fields stay within the interoperable JSON safe-integer range; larger integers
and exact decimals use schema-defined strings. Repository files, deterministic
renders, and other byte content are hashed from their exact stored bytes.

Definition Lineage is stored in the alpha. A product-meaning change first creates
a superseding accepted specification and Accepted Requirement revisions. A
repository fact that leaves product intent unchanged may instead create a
superseding compiler-input revision. Both paths create a new draft Plan Manifest,
Compilation Report, Change Plan, and complete Brief set as applicable; no
existing definition row is mutated. Execution Lineage remains a protocol design
but its reporting tables are outside the first alpha.

A replacement Change Plan creates new Brief rows because its Change Plan and
Shared Contracts bindings changed, even when part of an instruction body remains unchanged. The
`payload_digest` covers the complete resolved Agent Package and remains
separate from `capsule_id`. Run, Attempt, and result identity are outside the
first alpha and may be introduced by a future reporting extension.

## Accepted storage approach

The alpha uses a hybrid model. Stable identities, Definition Lineage,
membership, target-file assignment, and approval lifecycle are relational.
Complex Contract and Context Item documents are immutable JSON validated by the
protocol layer.

### Editable slice sources and immutable revisions

The current authoring entry point keeps one editable JSON document per slice at
`score/slices/<slice-id>.json`. The required `slice_id` is its stable logical
identity; changing the human title or any implementation meaning does not turn
it into a different slice. Preparation records the source path and draft digest,
then creates a new immutable prepared revision when the draft or its resolved
predecessors change. Existing prepared revisions and reviews are never updated.

A draft may list predecessor slice IDs in `after`. SCORE uses Effect's directed
Graph to reject duplicate IDs, missing predecessors, self-dependencies, and
cycles and to obtain deterministic prerequisite-first order. A dependency is
satisfied only by a Runner Run whose complete candidate set reached
`completed` plus `applied`; tests, builds, linting, and other project checks are
not dependency state. The dependent revision records the exact predecessor
slice ID, prepared revision, Change Plan, and applied Run before it freezes the
current repository bytes.

This permits a sequence of slices to modify the same file deliberately. Only
the first unblocked slice is prepared against the current file. Later slices
remain visible as waiting drafts and are prepared after their predecessors are
applied, so each Source Snapshot reflects the actual preceding implementation.
Test files have no special SCORE status: they are included only when the human
accepted them as ordinary target files in that draft.

Source Snapshot identity covers the declared file manifest and target
absences. SCORE does not parse `tsconfig.json`, `package.json`, dependency
metadata, or source files to construct a project environment. Exact imports and
other language-specific facts are authored as ordinary immutable context.
Older alpha artifacts that contain normalized Project Settings remain
historical; they are not reinterpreted as current definitions.

The compiler-facing Compiled Plan is a complete structured value, not a
sequence of SQL statements. Its successful import creates the relational and
JSON rows below atomically.

The alpha Compiled Plan wire schema is the closed JSON Schema 2020-12 document
`score.compilation-bundle` version `0.1.0-alpha.4`, targeting
`score.coding` version `0.1.0-alpha.4`. It groups exact source bindings, the
complete proposed SCORE definition, and attributable compiler warnings or
proposed Compilation Gaps. Proposed objects refer to one another through unique
plan-local handles; the importer assigns permanent opaque Protocol
Identifiers only after validation. The LLM does not produce SQL, SQLite rows,
new-object digests, Agent Packages, review records, approvals, or execution
records. Unknown object fields and unresolved references are rejected.

The companion compiler-input packet, Agent Input, and Plan Review snapshot use
`0.1.0-alpha.4`. Approved Pass Export uses `0.1.0-alpha.5`; a Runner rejects an
older export before Run creation, so historical work must be prepared and
approved again for the documented-interface contract.

The alpha uses layered enforcement. Deterministic application code validates
whole-definition meaning before import and repeats approval-gating checks
before approval. SQLite enforces foreign keys, required values, enumerated
checks, digest and identifier shapes, uniqueness, and append-only history.
Immutable protocol tables reject `UPDATE` and `DELETE`; a change creates a new
linked record. Invalid-submission history, valid draft import, Plan Review
materialization, and approval with package bindings each use explicit
all-or-nothing transactions appropriate to that lifecycle step.

Change Plans and Context Sets are first-class records: a Change Plan identifies the complete
coordinated repository transition, while a Context Set identifies exactly what
one Brief revision made observable to its Worker.

## Provisional relational shape

This is a starting point for the schema discussion, not accepted DDL.

The tables fall into four readable groups:

| Group | What it answers |
| --- | --- |
| Intent and compiler history | What did the human approve, what did the LLM submit, and how did validation respond? |
| Compiled definition and approval | What exact Plan Manifest, Change Plan, Contracts, Briefs, context, findings, and approval exist? |
| Repository state and lineage | Which immutable source revision was compiled, and what supersedes what? |
| Agent Package export | What exact JSON may the Runner route to each file agent? |

| Table | Purpose | Important identity or constraint |
| --- | --- | --- |
| `accepted_specifications` | Immutable accepted product meaning from deliberation | Specification identifier, optional superseded specification, authority, timestamp, rationale, and content digest |
| `accepted_requirements` | Stable obligations from an accepted specification | Immutable requirement identifier, specification identifier, optional superseded requirement, authority, timestamp, rationale, and content digest |
| `compilation_procedures` | Versioned instructions used by an LLM Plan Compiler | Procedure identifier, Profile, source, version, purpose, content digest, and optional superseded procedure |
| `compilation_submissions` | Every immutable Compiled Plan submitted for deterministic import validation | Submission identifier, plan JSON and digest, compiler and model provenance, Procedure identity and digest, compiler-input revision, timestamp, outcome, optional prior submission, and optional imported Plan Manifest |
| `compilation_submission_findings` | Deterministic import-validation results for one submission | Submission, validator identity and version, finding code, severity, affected bundle location, structured detail, repair classification, and human-input requirement |
| `compiler_input_revisions` | Immutable repository facts and other compilation inputs that do not themselves define product meaning | Input revision identifier, optional superseded input revision, source identity, authority, timestamp, rationale, and content digest |
| `run_manifests` | Immutable compiled definitions eligible for review and approval | Manifest identifier, specification and compiler-input revisions, optional superseded manifest, authority, timestamp, rationale, and content digest; approval is derived from Plan Decisions, not a mutable status |
| `compilation_reports` | Traceability and validation summary for one draft Plan Manifest and Change Plan | Bound to specification, Source Snapshot, draft manifest, and compiler provenance by identifier and digest |
| `requirement_bindings` | Typed traceability edges from requirements to compiled objects | Requirement-to-Contract, Brief, dependency, and Context Item bindings; no dangling targets |
| `compilation_source_citations` | Material repository artifacts or excerpts the compiler declares supported compiled decisions | Source Snapshot, source location, source digest, purpose, compiler provenance, and immutable citation digest |
| `compilation_source_bindings` | Typed edges from source citations to the compiled objects or decisions they support | Citation-to-Contract, dependency, Brief, or Context Item binding; no dangling targets |
| `validation_findings` | Immutable deterministic validation errors and heuristic warnings for a draft | Stable finding identifier, severity, affected object, validator provenance, and structured detail |
| `validation_finding_dispositions` | Immutable resolutions or human warning waivers | Finding, authority, timestamp, disposition, rationale, and any replacement input or definition |
| `compilation_gaps` | Immutable specific missing or ambiguous facts that prevent safe compilation | Affected requirement or compiled obligation, basis, detector provenance, required resolution, and gap digest |
| `compilation_gap_resolutions` | Immutable resolutions of proposed Compilation Gaps | Gap, resolver, timestamp, resolution kind, rationale, and any replacement specification or compiler input |
| `publication_reviews` | Immutable inspectable snapshot prepared for human approval | Exact Plan Manifest and Compilation Report identities and digests plus complete compiled definition and findings |
| `publication_decisions` | Authorization or rejection of one Plan Review | Authority, timestamp, decision, approved Plan Manifest and report digests, and any warning waivers |
| `publication_decision_payloads` | Exact Agent Package digest set authorized by one approving Plan Approval | Approval, Agent Package, Run Rules digest, Agent Input digest, and complete package digest; immutable unique binding |
| `repository_revisions` | Immutable accepted repository states | `revision_id`; optional `parent_revision_id`; digest binding the ordered declared-file manifest |
| `repository_revision_files` | Exact immutable files belonging to the alpha's stored base revisions | Unique `(revision_id, normalized_path)`; exact content BLOB, media or content type, and content digest |
| `contract_sets` | Versioned future behavior shared by a Change Plan | `contract_set_id`; immutable after approval |
| `contracts` | Individual typed contracts with immutable JSON documents | Unique logical name and version within Shared Contracts |
| `contract_inputs` | Addressable required or optional inputs declared by Contracts | Stable input identifier, Contract, expected kind or schema, accepted version rule, minimum cardinality, and maximum cardinality |
| `coding_passes` | Immutable transition definition from one Source Snapshot using Shared Contracts | `pass_id`, `manifest_id`, `base_revision_id`, `contract_set_id`, optional `supersedes_pass_id`, authority, timestamp, rationale, and digest |
| `context_items` | Immutable fully resolved target content, Contracts, policies, declarations, repository facts, examples, or skills, with content in JSON | `context_item_id`, kind, inline content, source provenance, version, digest, and purpose; no required input may be pointer-only |
| `context_sets` | Closed input collection for one Brief revision | `context_set_id`, optional `supersedes_context_set_id`, and digest; never updated in place |
| `context_set_items` | Ordered membership of Context Items | Unique `(context_set_id, context_item_id)`; every membership must be referenced by at least one binding before approval |
| `contract_input_bindings` | Explicit suppliers for Contract Inputs in one Brief | Contract Input, Brief, supplying Context Item or declared input, actual kind/version, and binding position; unique supplier position within the input |
| `capsules` | One immutable file transformation and its Contract | `capsule_id`, `pass_id`, optional `supersedes_capsule_id`, digest; unique `(pass_id, target_path)` and exactly one target operation |
| `planned_declarations` | Legacy structured-declaration storage retained for historical inspection | Current alpha.4 plans write no rows; documented declaration triples live in ordinary immutable Context Items |
| `declaration_ownership` | Legacy ownership storage retained for historical inspection | Current ownership is validated while routing Slice Draft `owns` entries into per-file Context Items |
| `declaration_consumers` | Legacy consumer storage retained for historical inspection | Current consumers receive exact documented text through per-file Context Items; no source relationship is inferred |
| `capability_requirements` | Capabilities, tools, versions, and permissions required by a Brief | Namespaced identifier plus provisional typed requirement JSON; matching language remains open |
| `harness_payloads` | Exact immutable authoritative JSON Agent Package materialized for one File Brief | Separate `control` and `agent_input` JSON, their individual digests, complete package digest, Brief, Plan Manifest, and Change Plan; approval is a separate binding and no execution status exists |
| `harness_payload_renders` | Deterministic Markdown or other presentation derived from an Agent Package | Source package and digest, renderer identity, version and digest, media type, rendered content, and render content digest |

The `capsules` row should hold the one target path and operation directly. This
makes the one-file invariant visible and allows SQLite to reject duplicate
writers with a unique constraint on `(pass_id, target_path)`.

One initial derived view makes Definition Lineage inspectable without
duplicating mutable state:

- `definition_revision_diff` compares a superseding definition with its prior
  definition and lists added, removed, changed, and content-equal rebound target
  files and Briefs.

Run, Attempt, Event, Artifact, Context Gap, and Candidate tables are deferred
beyond the first alpha. A future extension may define how a user-owned Runner
reports execution back to SCORE.

## Agent Package interface

SQLite may use a `harness_payloads_view` to assemble data from the storage
graph. Before Plan Review, that result is materialized as one immutable
draft `harness_payloads` row per File Brief. Approval freezes those exact
rows, after which the exporter reads only the stored snapshots. Normalization
and view logic may change without changing a historical approved Agent Package.

Approval does not mutate an Agent Package or enter its digest. An approving
Plan Approval creates immutable `publication_decision_payloads` bindings
to the exact precomputed digest set. Export joins that approval metadata to the
unchanged package.

| Column | Meaning |
| --- | --- |
| `control_json` | Runner-only identities, protocol and Profile versions, Source Snapshot digest, Shared Contracts, target path and operation, Allowed Change, and canonicalization metadata |
| `agent_input_json` | Exact agent-visible objective, target state, documented owned declarations, only the documented consumed declarations needed from other files, input bindings, fully resolved Context Items and skills, constraints, prohibited changes, and intended outcome |
| `control_digest` | Integrity identity for the exact Run Rules section |
| `agent_input_digest` | Integrity identity for the exact Agent Input section |
| `payload_digest` | Integrity identity for the complete authoritative JSON object containing both sections |

The alpha Markdown renderer is ordinary template code. It reads only
`agent_input_json`, emits fixed headings and fields in a fixed order, preserves
declared array order, and applies explicit escaping and missing-value rules. It
does not call an LLM. The render record—not the agent-visible Markdown—stores the
source package and Agent Input digests, renderer identity and version, and its
own output digest.

The separate Plan Review renderer also uses deterministic template code. It
renders the complete immutable review snapshot as self-contained HTML for a
human reviewer, with no JavaScript or external assets. The default view leads
with each Change Plan as a Slice and lists its files. Selecting a file reveals
its Prompt, Context, Skills, Limits, and Raw Agent Input. Machine identities,
digests, and verification evidence remain available in the audit layer. Slice
is a presentation label for the Change Plan, not a separate protocol object.
SQLite views remain available for raw inspection.

There is no alpha Attempt Result interface. A future reporting extension may
bind Runner reports to the exact exported `payload_digest` through a separate
narrow envelope; that would not make SCORE the Worker or file writer.
Accordingly, the alpha does not standardize whether the Runner uses a
direct file write, complete returned content, a patch, or another native edit
mechanism.

An inspectable alpha row might look like:

| capsule_id | base_revision_id | contract_set_id | target_path | operation | context items |
| --- | --- | --- | --- | --- | ---: |
| `F1` | `R1` | `account-contracts@1` | `src/schema.ts` | `replace` | 3 |
| `F2` | `R1` | `account-contracts@1` | `src/account-label.ts` | `create` | 4 |

Each row can describe work against the same future schema without exposing any
other row's target content.

## Alpha compilation and export flow

1. The Accepted Specification and Accepted Requirements are persisted before
   compilation. The LLM Plan Compiler receives them, the Source Snapshot, and a
   resolved Compilation Procedure, then produces its compiler-input
   revision, draft Plan Manifest, Source Snapshot binding, Shared Contracts,
   Change Plan, File Briefs, documented declaration Context Items with one owner
   per name and explicit consumers, Context Sets, Context Items, dependencies, Compilation
   Source Citations, and Compilation Report as one complete
   Compiled Plan.
2. A deterministic importer records the immutable Compilation Submission and
   validates its complete Compiled Plan, references, and requirement traceability. Its
   validation outcome and findings are stored in compiler-history tables. A
   valid Compiled Plan is written to SQLite as one draft definition in a single
   transaction and linked to its submission; an invalid Compiled Plan creates no
   partial definition rows. If every blocking finding is classified by the
   validator as machine-repairable, the findings return to the LLM for a linked
   resubmission within the configured retry bound. Otherwise compilation pauses
   for human input.
3. Deterministic approval validation inspects the persisted definition and
   records every validation error and warning.
   Compiler or reviewer discoveries may add attributable Compilation Gaps. The
   exporter also materializes one immutable draft `harness_payloads` row for
   every File Brief using only the validated SQLite graph. The system then
   produces an immutable Plan Review exposing every finding and
   open or resolved Gap, the exact Plan Manifest and Compilation Report digests, all
   File Brief inputs and Allowed Changes, material Compilation Source Citations, resolved
   skill Context Items, Capability and tool requirements, and the exact
   `control`, `agent_input`, and complete-package JSON and digests for every draft
   Agent Package.
4. An authorized human issues a Plan Approval over those exact digests.
   Approval freezes the Plan Manifest, all Change Plan inputs, and the complete
   Run Rules, Agent Input, and package digest sets. No Agent Package may be
   labeled approved or exportable before approval.
5. The exporter selects the frozen approved `harness_payloads` rows; it does not
   reconstruct them from current views.
6. The user can export the authoritative JSON or a deterministically generated
   Markdown render by File Brief identifier. The render record identifies the
   source digests and renderer version and has its own output digest; the
   agent-visible Markdown contains only rendered Agent Input.
7. The user deliberately invokes their own Runner. It enumerates the approved
   Change Plan and uses the frozen Agent Packages to create one agent per File
   Brief through its chosen SDK or runtime. That trigger and everything
   afterward are outside the SCORE alpha. The local OpenCode Runner experiment
   now exercises this seam with its own `runner.db`.

## Alpha success criteria

The alpha succeeds only if all of the following groups pass.

### Fixture and repository state

- SQLite displays every file in the exact fixture Source Snapshot and
  reproduces its per-file digest and the Source Snapshot digest that binds the
  ordered declared-file manifest.
- The fixture contains exactly one valid `replace` target and one absent
  `create` target using one shared Contract.
- Every documented declaration name has exactly one owning File Brief. Agent Input
  includes the exact authored name, declaration, and description only for owned
  declarations and explicitly declared read-only consumers.
- The formatter's exact import statement is authored in its frozen instruction;
  SCORE does not derive it from project configuration.
- Exactly one of the two Agent Inputs contains the complete resolved fixture
  skill and its binding.

### LLM compilation and atomic import

- Starting only from the Accepted Specification, Source Snapshot, and
  Compilation Procedure, the LLM produces every Brief and Context Set; humans
  do not author those rows directly.
- The LLM submits one complete Compiled Plan and has no SQL authority.
- Every valid or invalid Submission retains its Compiled Plan digest, model and
  Procedure provenance, input revision, timestamp, validator version, outcome,
  findings, and links to any correction.
- Invalid Compiled Plans create no partial definition rows. A valid Compiled Plan imports one
  complete draft in one transaction and links back to its Submission.
- Only deterministic structural findings may enter the bounded automatic repair
  loop; human judgment stops it.

### Traceability and closed context

- SQLite traces every Accepted Requirement through its Contracts, Briefs,
  Dependencies, Context Items, and bindings.
- Validation rejects missing, dangling, incompatible, cardinality-invalid, or
  unexplained bindings and any mismatch between stored and materialized maps.
- Validation rejects a required fact represented only by a path, URL, symbol,
  identifier, or lookup instruction.
- Binding coverage is reported as structural completeness of the declared graph,
  never as proof that no unknown fact is missing.
- Material Compilation Source Citations remain inspectable as provenance without
  becoming agent lookup instructions.

### Review and approval

- The Plan Review displays the complete definition, findings, Gaps,
  citations, skill provenance, Capabilities, Allowed Changes, and exact Plan
  Manifest, Compilation Report, Run Rules, Agent Input, and package digests.
- Every deterministic error and open Compilation Gap blocks approval.
  Warnings require resolution or an explicit human waiver with rationale.
- A Gap resolution records its provenance and produces a new draft; changing
  product meaning first revises the Accepted Specification.
- Human approval records the authority, timestamp, approved digests, and any
  warning waivers. Any compiled-input or material-citation change invalidates it.

### Agent Package materialization and export

- SQLite displays the Change Plan, File Briefs, Context membership, bindings,
  and exact materialized Agent Packages as ordinary tables.
- Every approved File Brief has separate Run Rules, Agent Input, and complete
  package digests. Any declared Contract or Context change changes the relevant
  digest.
- Export selects frozen approved Agent Package rows without rematerializing them or
  reading the repository.
- The same Agent Input and renderer version produce byte-identical Markdown
  without an LLM call; only Agent Input appears in that Markdown.
- The Runner receives neither SQLite access nor a need to compose
  another project-specific prompt.
- Candidate source remains opaque. The Runner does not parse exports, signatures,
  imports, local declarations, call sites, or function bodies and does not claim
  that generated code implements the documented declaration or description.
- Before applying a fully successful guided Run, the Runner rechecks stored
  candidate and package integrity and verifies that every declared target still
  matches the exact regular-file digest or absence shown at confirmation. A
  target conflict applies nothing; unrelated file changes are outside this
  gate. The approved Source Snapshot remains immutable package context and
  provenance, not guided execution eligibility. The Runner does not parse,
  type-check, test, build, or lint the resulting project; those checks run after
  application in the real project.
- Runner application state, its frozen per-Run absolute repository binding, and
  its adapter-owned provider, model, and optional opaque variant selection live
  only in `runner.db`; SCORE storage continues to contain portable relative
  paths and no execution state. Historical Runner rows migrated from before
  variant support retain no explicit variant. A guided Run may also own a sorted
  snapshot of every confirmed target as either absent or a regular-file content
  digest. Historical Runs read as having no such target snapshot and preserve
  their strict Source Snapshot behavior. This execution-only state does not
  alter SCORE plans, packages, approvals, or digests. The same local database
  keeps one reusable `runner_repository_bindings` row per resolved `score.db`
  path. That mutable convenience binding is validated before every use, while
  each Run copies and freezes the exact root and declared inputs it actually
  used. Explicit candidate export remains diagnostic.

### Lineage and scope honesty

- Changing any compiled input creates a complete superseding definition with
  new immutable records, links, authority, timestamp, rationale, and digests.
- A revision diff shows added, removed, changed, and content-equal rebound
  Briefs and target files. Prior records remain unchanged.
- Re-exporting an unchanged definition changes none of its identities or
  digests and does not count as execution.
- The Core database records no claim that an agent ran, a file changed, a test
  passed, or the requested code is correct or accepted.
- The Core proof launches no agent and performs no source-file, assembly,
  testing, merge, or verification operation.

## Local implementation boundary

The proven implementation now lives beside these documents in the canonical
repository. `npm run reproduce` creates only the known scratch artifacts under
`output/`; it does not approve a Change Plan, start a Runner, or write
application source files. The separate `npm run runner -- start` flow is an
explicit post-export experiment with its own database and lifecycle. It does
not change this Core alpha boundary. [open-questions.md](./open-questions.md)
contains only work deferred beyond the first alpha.

## Explicitly outside the alpha

- Runs, Attempts, Events, results, Context Gaps, and file-effect digests;
- Artifacts, Candidate assembly, testing, Acceptance Oracles, Verification
  Results, acceptance, and Corrective Compilation;
- production-scale content-addressed storage;
- non-SQLite mappings;
- real Runtime Adapter execution as a SCORE Core responsibility, and provider
  comparison claims.
