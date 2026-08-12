# SCORE Core Protocol: Exploratory Draft

**Status:** Non-normative design draft. This is not SCORE v1.

**Current boundary:** The first Coding Profile alpha implements compilation,
deterministic validation, human approval, immutable definition storage, and
per-Brief Agent Package export. It does not implement execution, result reporting,
artifact collection, repository assembly, testing, verification, or acceptance.

Future execution concepts remain at the end of this document so they can be
designed later without being mistaken for current alpha requirements.

## 1. Thesis

SCORE represents an approved outcome as immutable, contract-bound Briefs with
closed Context Sets. A compatible external system can consume those definitions
without asking its Workers to rediscover project-specific information.

SCORE separates three responsibilities:

1. **Compilation:** broad source discovery produces narrow, complete Briefs.
2. **Approval:** deterministic checks and authorized review freeze the exact
   definition that may be used.
3. **Execution:** a user-owned Runner invokes Workers and owns their
   Allowed Changes. This responsibility is outside SCORE's first alpha.

The protocol aims to make compiled intent portable and inspectable. It does not
claim that structural validation can prove the context is semantically perfect
or that an eventual implementation will be correct.

## 2. Inside and outside the current Core model

The current model describes:

- immutable protocol identifiers, content digests, and supersession;
- Accepted Specifications and Accepted Requirements;
- Plan Compiler submissions and deterministic validation findings;
- Compilation Reports, source citations, and Compilation Gaps;
- Plan Reviews and Plan Decisions;
- Plan Manifests, Briefs, Contracts, Dependencies, Context Sets, Context Items,
  Contract Inputs, and Contract Input Bindings;
- Capabilities and Allowed Changes;
- Profiles, extensions, and portable serialized definitions.

The current model does not prescribe:

- how human and LLM product deliberation is conducted;
- compiler prompts, search algorithms, or hidden model reasoning;
- a model provider, agent SDK, scheduler, or CLI;
- authentication, transport, or storage technology;
- repository paths, file operations, patches, or tests outside a Profile;
- how a Runner launches Workers or performs changes;
- benchmarking or product-evaluation policy.

SQLite and the one-file rule belong to the first Coding Profile alpha, not to
domain-neutral Core.

## 3. Current object relationships

```text
Accepted Specification
  `- one or more Accepted Requirements

Compilation Submission
  |- one complete Compiled Plan
  |- compiler and Compilation Procedure provenance
  `- deterministic import-validation findings

Valid imported definition
  |- one Plan Manifest
  |- one Compilation Report
  |    |- requirement traceability
  |    `- material Compilation Source Citations
  `- one or more Briefs
       |- one Contract
       |- zero or more Dependencies
       |- exactly one closed Context Set
       |    `- resolved Context Items
       |- explicit Contract Inputs and Input Bindings
       |- zero or more Capability Requirements
       `- declared allowed and prohibited changes

Plan Review
  `- exact validated definition, findings, gaps, and digests

Plan Decision
  `- authority and timestamp bound to the reviewed digests
```

A Plan Manifest is an approved definition. It is not a mutable execution record.

## 4. Current invariants

These invariants express the accepted direction but remain non-normative until
schemas and conformance fixtures are published.

1. **Separate identity and integrity.** Protocol identifiers are opaque and
   immutable. Content digests verify bytes or canonical structured content but
   do not replace historical identity.
2. **Immutable approved definitions.** Changing accepted intent or compiled
   input creates new records with explicit supersession links. Approved rows
   are never edited in place.
3. **Closed Context.** Every project-specific input observable to a Worker is
   declared in its Brief. The Worker receives no ambient repository, shared
   session, or fallback project search surface.
4. **Resolved content.** A required fact is supplied inline. A path, URL, symbol,
   source citation, or database identifier cannot stand in for content the
   Worker must discover.
5. **Explicit input bindings.** Every required Contract Input has a compatible
   supplier. Every supplied Context Item participates in at least one binding.
6. **Structural validation stays honest.** Deterministic checks validate the
   declared object graph. They do not claim that the compiler discovered every
   unknown requirement or interpreted product intent correctly.
7. **Attributable uncertainty.** A specific pre-approval fact that is missing
   or ambiguous is recorded as a Compilation Gap. An open Gap blocks
   approval; heuristic suspicion remains a warning.
8. **Authorized approval.** A definition becomes approved only through a Plan
   Approval bound to the exact reviewed identities and digests.
9. **External changes.** SCORE definitions may declare Allowed Changes, but
   SCORE does not perform them. A user-owned integration owns execution.
10. **Core/Profile separation.** A Profile may add stronger domain constraints
    but may not weaken Core invariants.

## 5. Compilation and deterministic import

An Outcome Request may begin as prose, a ticket, or another source expression.
Human and LLM deliberation produces an immutable Accepted Specification with
stably identified Accepted Requirements. The accepted form, rather than an
unreviewed conversation transcript, is the authoritative product meaning.

A Plan Compiler may inspect broad declared source state. It produces one
complete Compiled Plan containing the proposed object graph and a
Compilation Report. Its method is implementation-specific; its submitted output
is reviewable protocol data.

The compiler does not write the authoritative database directly. A
deterministic importer validates:

- schema shape and required fields;
- referential integrity and identifier uniqueness;
- digests and version declarations;
- requirement traceability;
- Contract Input kinds, versions, cardinality, and bindings;
- Profile invariants and Allowed Changes;
- agreement between stored objects and materialized Agent Packages.

An invalid Compiled Plan creates no partial definition. Its immutable Compilation
Submission and findings may still be retained as compiler history. A valid
Compiled Plan may be imported atomically as one draft definition.

A validator may classify a purely mechanical defect as machine-repairable. An
LLM compiler may resubmit within a bounded loop, but it cannot use that loop to
change product meaning, interpret unresolved source ambiguity, resolve a Gap,
waive a warning, or approve its own work.

## 6. Review, gaps, and approval

The Compilation Report traces every Accepted Requirement to the Contracts,
Briefs, Dependencies, and Context Items that are intended to satisfy it. This
makes the compiler's interpretation inspectable; it does not prove the
interpretation correct.

A Compilation Source Citation records a repository artifact or excerpt that
the compiler says materially supported a compiled decision. Citations preserve
review provenance. They are not Worker inputs unless their resolved content is
separately included as a Context Item.

A Compilation Gap identifies one concrete missing or ambiguous fact that makes
safe compilation impossible. It records the affected requirement or compiled
obligation, the basis, detector provenance, and the information needed to
resolve it. A human may supply the fact, clarify intent, select an
interpretation, or record why the proposed Gap was mistaken. It may not be
silently waived.

If a resolution changes product meaning, a new Accepted Specification and
affected requirements precede recompilation. If it supplies only a repository
fact, it creates a new compiler-input revision. Both paths create a new draft
and review cycle.

A Plan Review exposes the complete compiled definition, validation
errors, warnings, resolved and open Gaps, source citations, Capabilities,
Allowed Changes, and exact identities and digests. A Plan Decision records the
authority, timestamp, decision, approved digests, and any warning waivers.

Any compiled-input or material-source change invalidates the prior approval.

## 7. Definition lineage

Definition Lineage answers when and why product intent or compiled inputs
changed. A superseding definition records:

- the prior object it replaces;
- the new immutable identity and content digest;
- timestamp and authority;
- rationale;
- added, removed, changed, and content-equal rebound members.

Equal content does not collapse two historical records. A Brief compiled into
a replacement Plan Manifest receives a new identity even when part of its instruction
body is unchanged, because its definition context changed.

Using an unchanged approved definition more than once does not mutate it.
Possible future execution records belong to separate Execution Lineage.

## 8. Coding Profile specialization

The Coding Profile adds repository-specific concepts:

- Source Snapshot;
- Change Plan;
- Shared Contracts used across the Change Plan;
- File Brief;
- one target path and one `create`, `replace`, or `delete` Allowed Change;
- one authoritative writer for each target in the Change Plan;
- a closed per-file Agent Package for a user-owned Runner.

The first alpha stores the complete tiny fixture revision and compiled
definition in SQLite. It exports validated JSON with separate Run Rules and
Agent Input. Run Rules support routing and effect enforcement; only
Agent Input is visible to the file agent.

See [the Coding Profile](../profiles/coding/README.md),
[the SQLite alpha](../docs/sqlite-alpha.md), and
[Runtime Adapters](../docs/runtime-adapters.md) for the current definition
and external execution seams.

## 9. Deferred execution and evaluation model

The following concepts are not part of the first alpha:

- Run, Assignment, Attempt, Attempt Payload, and Event;
- Attempt Result and Worker-reported Context Gap;
- Artifact, Artifact Decision, and Candidate Revision;
- Acceptance Oracle, Evidence, and Verification Result;
- retries, leases, heartbeats, cancellation, stale-result fencing, and terminal
  Run outcomes;
- Corrective Compilation driven by failed verification;
- SCORE-owned testing, assembly, acceptance, or execution reporting.

Earlier drafts proposed detailed lifecycles for these objects. Those proposals
were removed from the current Core narrative because no running integration yet
requires them and they repeatedly obscured SCORE's compiler/export boundary.
Their remaining design questions are preserved in
[open-questions.md](../docs/open-questions.md) and accepted-but-deferred
decisions remain in [decisions.md](../docs/decisions.md).

An optional future extension may standardize these records without turning
SCORE into the runtime. A user-owned Runner would still launch Workers and
perform changes; it could merely report attributable history back to a SCORE
implementation.

## 10. Current conformance direction

The first conformance work should test the compiled-definition boundary:

1. reject duplicate file writers and invalid target operations;
2. reject missing, dangling, incompatible, or unbound Context Items;
3. reject required facts represented only as lookup instructions;
4. import a valid Compiled Plan atomically and retain invalid submissions
   only as compiler history;
5. produce one immutable, complete Agent Package per File Brief;
6. prove that JSON package materialization and Markdown rendering are
   deterministic;
7. bind Plan Approval to the exact definition and package digests;
8. supersede changed definitions without mutating prior records;
9. export closed Agent Packages without giving the Runner or file agents repository
   or database access.

Execution success and code quality require a later integration experiment and
must not be inferred from passing these conformance cases.
