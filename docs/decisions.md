# Accepted Decisions

This ledger records decisions already accepted for SCORE Protocol. Proposals
and unresolved choices belong in [open-questions.md](./open-questions.md), not
here.

## How to read this ledger

Later decisions narrow earlier ones. D-045 through D-068 establish the
definition-only first-alpha boundary; D-069 through D-085 record the current
Coding Profile preparation and user-owned Runner experiment. The LLM Plan
Compiler authors definitions; deterministic SCORE code materializes, validates,
and supports human approval; and the Runner launches file agents and writes
code without becoming SCORE Core.

Historical entries retain the terminology used when they were accepted. D-067
and [the terminology map](./terminology.md) define the canonical language for
current product documentation without silently renaming alpha wire identifiers.

Entries labeled **Deferred** remain accepted design direction for a possible
future extension but are not alpha requirements. Entries labeled **Reframed**
have had their original scope narrowed by a later decision. Historical decision
numbers remain stable so prior discussions and links do not break.

## D-001: Name and expansion

- **Decision:** The project is named **SCORE Protocol**.
- **Expansion:** **Structured Context Orchestration for Reliable Execution**.
- **Consequence:** Nearby uses of “Score” do not change the project identity;
  documentation must disambiguate the execution model clearly.

## D-002: Reliability is the goal

- **Decision:** SCORE exists to improve execution reliability through selected
  context, explicit contracts, bounded authority, and verifiable composition.
- **Consequence:** Parallelism is optional and must not be treated as the
  protocol's success criterion.

## D-003: Desired outcomes compile into capsules

- **Decision:** SCORE begins with a desired outcome, represents the relevant
  contracts and dependencies, and compiles the work into bounded capsules.
- **Consequence:** Narrow executors should receive sufficient capsule context
  rather than being required to rediscover the complete architecture.

## D-004: The protocol is implementation-agnostic

- **Decision:** SCORE specifies exchanged information, lifecycle semantics,
  invariants, and interoperability requirements.
- **Excluded choices:** Agent runtime, model provider, programming language,
  scheduler, transport, database, repository isolation, and deployment
  platform.

## D-005: Executors are broader than agents

- **Decision:** Agents, humans, scripts, compilers, test runners, local
  processes, cloud workers, and deterministic services may all be executors.
- **Consequence:** Core objects and lifecycle terms must not assume prompting,
  language models, or source-code modification.

## D-006: Concrete runtimes sit behind executor adapters

- **Status:** Reframed by D-045 and D-055.
- **Decision:** Concrete runtimes sit behind a user-owned integration seam. For
  the Coding Profile, an Agentic Harness obtains approved Harness Payloads and
  invokes its chosen SDK or runtime; SCORE does not dispatch or operate it.
- **Consequence:** No provider-, SDK-, pane-, command-, or runtime-specific field
  belongs in Core. Cursor SDK, Herdr, Codex, Claude Code, and similar systems are
  possible integrations, not product dependencies or SCORE-owned filesystems.

## D-007: Core Protocol and Coding Profile are separate layers

- **Decision:** The Core Protocol remains domain-neutral. A Coding Profile may
  standardize repository snapshots, paths, patches, tests, diagnostics, coding
  guidance, and integration checks.
- **Consequence:** The Coding Profile may depend on Core; Core must not depend on
  the Coding Profile.

## D-008: Interoperability requires schemas and conformance fixtures

- **Decision:** The mature project will publish versioned, language-neutral
  interchange schemas and conformance fixtures in addition to prose.
- **Consequence:** Independent implementations, rather than one reference
  implementation alone, define whether the protocol is actually portable.

## D-009: Comparative evaluation, if performed, needs a fair baseline

- **Status:** Reframed by D-026. Benchmarking is optional downstream work, not
  SCORE's organizing purpose or an alpha requirement.
- **Decision:** If a future evaluation compares SCORE with a single-executor
  workflow, both arms must use controlled tasks, repositories, models, tools,
  budgets, and accounted preparation cost.
- **Consequence:** The reusable product artifact remains the published Run
  Manifest and Coding Pass, not a benchmark fixture.

## D-010: Specification precedes substantial orchestration code

- **Decision:** The project begins with precise documents, concrete examples,
  state transitions, and protocol boundaries.
- **Consequence:** An orchestrator is not the first substantial deliverable.

## D-011: Capsule context is closed

- **Decision:** An Executor may observe only the run-specific inputs declared in
  its Capsule's immutable Context Set. It receives no ambient project or
  repository access.
- **Consequence:** Broad discovery belongs to planning and context compilation,
  not execution. Intrinsic Executor capabilities do not authorize fetching
  undeclared project state.

## D-012: Missing context produces a Context Gap

- **Scope:** Deferred beyond the first alpha because the alpha receives no
  Executor result or insufficiency report.
- **Decision:** An Executor that cannot satisfy its Contract from declared
  inputs reports a structured Context Gap rather than searching for more input.
- **Consequence:** Additional information requires an attributable Capsule or
  Context Set revision; coordinators may not inject hidden retry context.

## D-013: Coding Passes use single-file, single-writer execution

- **Decision:** Each File Capsule may create, replace, or delete exactly one
  declared target file, and each file has one authoritative writer within a
  Coding Pass.
- **Consequence:** Direct write conflicts are invalid compiled plans, not runtime
  conditions for file Executors to negotiate.

## D-014: A Coding Pass is a versioned repository transition

- **Decision:** A Coding Pass is compiled from one immutable Repository Revision
  and one versioned Contract Set. It defines the complete coordinated set of
  file operations intended to produce a possible next repository state.
- **Consequence:** Cross-file coupling is expressed through shared Contracts.
  Executors do not read one another's in-progress files. A user-owned harness
  performs the declared file operations; SCORE does not apply, assemble, test,
  or accept the result. Candidate assembly and whole-Pass verification are
  deferred by D-045.

## D-015: The first alpha is SQLite-backed and table-driven

- **Decision:** The first implementation experiment will persist capsule data in
  SQLite and prove that a user-owned agentic harness can construct an execution
  request using only the authorized rows for one Capsule.
- **Consequence:** SQLite is an alpha implementation choice, not a Core Protocol
  dependency. SCORE exports a closed payload assembled from table data; it does
  not give the agent a database connection or undeclared repository context.
  The user's harness, not SCORE, launches the agent and applies its file effect.

## D-016: Shared Contracts are fixed before dispatch

- **Decision:** Every shared cross-file Contract is fixed and versioned before
  a Coding Pass begins. Every File Capsule in the Pass implements or consumes
  that same declared Contract and may neither redefine it nor inspect another
  Executor's output.
- **Consequence:** A Contract Set that is not precise enough to compile closed
  File Capsules is not ready for a Coding Pass. Schema design and other shared
  interface decisions belong to planning and context compilation.

## D-017: A compiled-input change supersedes the entire Coding Pass

- **Decision:** In the alpha, any change to a published Pass's Repository
  Revision, Contract Set, File Capsules, or Context Sets supersedes the entire
  Coding Pass. The Context Compiler creates a new Pass and complete compiled
  input set from the declared base Repository Revision.
- **Consequence:** The alpha exports only the replacement Pass's complete
  Harness Payload set, even when one File Capsule appears content-equal to its
  predecessor. Dependency-scoped reuse and any treatment of future execution
  results are deferred.

## D-018: Historical identity is separate from content integrity

- **Decision:** Every published protocol record receives an opaque, immutable
  Protocol Identifier and a separate Content Digest. Changed content creates a
  new record with a new identifier and an explicit supersession link; records
  are not updated in place.
- **Consequence:** Equal content does not collapse separate historical records.
  A replacement Pass creates new Capsules whose Pass and Contract Set bindings
  are part of their history. Canonical digest rules can be designed separately
  from identifiers. Future retries, if recorded, create Attempts without
  changing the definition.

## D-019: The SQLite alpha uses a hybrid storage model

- **Decision:** SQLite stores identity, Definition Lineage, Pass membership,
  Context Set membership, target-file assignment, and publication state as
  relational rows and foreign keys. Complex Contract and Context Item contents
  are stored as immutable versioned JSON.
- **Consequence:** SQLite can enforce the Pass and single-writer invariants while
  protocol documents can evolve without fully normalizing every nested field.
  The exporter gives a user-owned harness narrow frozen payloads rather than the
  storage graph.

## D-020: Every Attempt receives a materialized immutable payload

- **Scope:** The first alpha exports immutable Harness Payloads before any
  Attempt exists. Attempt Payload materialization applies only if a harness
  later reports execution back to SCORE through an optional future extension.

- **Decision:** Creating an Attempt materializes the complete Attempt Payload as
  immutable JSON with a Content Digest before dispatch. The Executor receives
  that stored payload, not a live reconstruction from current tables or view
  logic.
- **Consequence:** SCORE can inspect and replay exactly what an Executor saw.
  Adapter or SQL-view changes cannot alter historical execution inputs, and a
  retry creates a new Attempt Payload even when its digest matches an earlier
  one.

## D-021: Final Artifact acceptance is whole-Pass and atomic

- **Scope:** Deferred beyond the first SQLite alpha by D-045. The alpha
  stops at Harness Payload export and creates no Artifact or Candidate.

- **Decision:** A File Capsule's output may become an Eligible Artifact after
  Capsule-level checks, but it is not finally accepted on its own. Selected
  Eligible Artifacts are assembled into a Candidate Revision, and the complete
  set becomes accepted only when whole-pass verification succeeds.
- **Consequence:** A failed Candidate Revision accepts no file Artifact and
  creates no accepted Repository Revision. Submitted Artifacts, eligibility
  checks, assembly membership, and verification Evidence remain available for
  diagnosis and measurement.

## D-022: A Pass may retry unchanged work and assemble multiple Candidates

- **Scope:** Deferred from the first alpha with execution reporting and
  Candidate assembly.

- **Decision:** A failed Candidate Revision does not necessarily end its Coding
  Pass. A File Capsule may receive a later, sequential Attempt using the same
  compiled inputs, and the Pass may assemble another immutable Candidate
  Revision from a newly selected Eligible Artifact set.
- **Consequence:** If execution reporting is later enabled, Attempts for one
  File Capsule are sequential under the current Coding Profile design and each
  Attempt stores its own payload snapshot. A same-input retry receives no
  verification diagnostics or other new context. Any input change supersedes
  the Pass under D-017.

## D-023: Attempt Results use a strict adapter-bound envelope

- **Scope:** Deferred from the first alpha. An optional future harness-reporting
  extension may adopt this envelope.

- **Decision:** Before a result enters SCORE, the Executor Adapter must produce
  and validate an Attempt Result that identifies the exact Attempt and Attempt
  Payload digest and declares exactly one outcome: an Artifact or a Context Gap.
  A concrete Executor may use any native response format; translating it into
  the required envelope is the Adapter's responsibility.
- **Consequence:** The coordinator rejects a result whose Attempt is unknown or
  no longer authoritative, whose payload digest does not match the dispatched
  snapshot, whose outcome shape is invalid, or whose Artifact exceeds the
  Capsule's allowed effect. Provider-specific output formats remain outside the
  protocol while result attribution, stale-output rejection, and replay remain
  portable.

## D-024: Acceptance uses a precommitted, executor-hidden oracle

- **Scope:** Deferred beyond the first SQLite alpha by D-045. The alpha has no
  Acceptance Oracle or SCORE-owned verification step.

- **Decision:** Every test, criterion, and expected result that may determine
  acceptance of a Coding Pass is fixed in an immutable Acceptance Oracle before
  File Executor dispatch and is not observable to those Executors. The verifier
  receives the assembled Candidate Revision and the precommitted oracle.
- **Consequence:** Candidate-aware checks may produce diagnostic Evidence, but
  they cannot change the acceptance decision for the current Pass. Adding or
  changing an acceptance-determining check changes the run-level verification
  contract and requires a superseding Pass under D-017. Same-input retries are
  judged against the same oracle, and oracle identity, digest, contents, and
  authorship provenance remain inspectable.

## D-025: The SQLite alpha defines one Harness Payload export boundary

- **Decision:** The first SQLite alpha defines one agent-facing Harness Payload
  export boundary to test table-driven payload construction and transfer to a
  user-owned harness. The alpha ends at export and records no harness execution.
  A separate later interoperability trial may pass the same conformance data
  through at least two genuinely different Adapters.
- **Consequence:** The alpha may support the table-driven Closed Context thesis,
  at the compiled-payload boundary, but it cannot establish that an Executor ran
  successfully, Executor interchangeability, provider neutrality, or a
  reliability advantage. Those claims require later harness integration and
  controlled evaluation stages.

## D-026: Published compiled work is reusable and executor-portable

- **Decision:** The reusable, shareable product artifact is the immutable
  published Run Manifest. In the Coding Profile, its Coding Pass fixes the base
  Repository Revision, Contract Set, File Capsules, Context Sets, dependencies,
  and allowed effects. A later verification feature may additionally bind an
  Acceptance Oracle. Compatible Executors may execute the same published
  definition without recompiling it.
- **Consequence:** The same published definition can supply separate external
  harness invocations without recompilation. Possible future execution records
  would receive separate identities while the published inputs remain
  unchanged. This portability supports provider fallback, remote execution,
  replay, and alternative code generation; model comparison is only an
  optional downstream use. Any compiled-input change creates a superseding Pass
  under D-017.

## D-027: Product deliberation and compilation precede publication

- **Decision:** Human and LLM product deliberation produces an Accepted
  Specification and Accepted Requirements. A Context Compiler with broad
  declared source access compiles that intent and one Repository Revision into
  a draft Run Manifest and Coding Pass. A user-owned harness may consume them
  only after the compiled objects are reviewed, validated, published, and
  frozen.
- **Consequence:** SCORE does not standardize how product deliberation occurs,
  but the accepted intent and source revision are attributable compiler inputs.
  Repository discovery and architectural reasoning end at the compilation
  boundary. Publication authority and additional compiler-quality policies
  remain explicit product-design questions.

## D-028: Publication requires complete requirement traceability

- **Decision:** Every Accepted Requirement has a stable identifier. Before a
  draft Run Manifest may be published, the Context Compiler must produce an
  immutable Compilation Report that maps every Accepted Requirement to its
  Contracts, implementing or consuming Capsules, relevant dependencies and
  Context Items. If a later Profile version enables verification, the Report
  also maps requirements to its acceptance criteria. Publication validation for
  the alpha rejects missing implementation paths, dangling bindings, and
  unmapped required objects; it does not require verification coverage.
- **Consequence:** Traceability does not prove that the compiler interpreted a
  requirement correctly; it makes the interpretation explicit and reviewable.
  The report is bound to the accepted specification, Repository Revision, draft
  Run Manifest, and compiler provenance by identity and digest. Changing any
  mapping produces a new draft and requires validation again.

## D-029: The Coding Profile alpha requires explicit human publication

- **Decision:** After deterministic validation, an authorized human must issue
  a Publication Decision before any Harness Payload may be labeled published or
  exported by the Coding Profile alpha. The Publication Review is an interface
  boundary, not a graphical-UI requirement; a CLI, SQLite views, or a generated
  Markdown report may present it. Core represents publication authority
  generically so a future Profile or deployment policy may deliberately
  authorize an automated publisher.
- **Required review content:** Accepted Requirement traceability; Contracts;
  dependencies; File Capsules and target operations; every Context Item per
  Executor; material Compilation Source Citations; resolved, versioned skill
  Context Items with source, purpose, and digest; required Capabilities, tools,
  versions, and permissions; allowed and prohibited effects; deterministic
  validation errors, warnings, and Compilation Gaps; and the exact Run Manifest,
  Compilation Report, Harness Control, Agent Input, and complete payload
  identities and digests. A future verification extension may add an Acceptance
  Oracle, but the first alpha has none.
- **Consequence:** The Publication Decision records the approving authority,
  timestamp, and approved digests. Any subsequent compiled-input change
  invalidates that approval and requires a new draft, deterministic validation,
  Publication Review, and Publication Decision.

## D-030: Known compilation uncertainty is a Compilation Gap

- **Decision:** SCORE does not claim that compilation can prove no information
  is missing. A Compilation Gap records a specific missing or ambiguous fact
  discovered before publication that prevents safe compilation. It identifies
  the affected Accepted Requirement, Contract, Capsule, or verification
  criterion; explains the blocking basis; records detector provenance; and
  states what would resolve it. An LLM may propose a Gap, but its basis and
  provenance remain visible.
- **Resolution:** An open Compilation Gap blocks publication. An authorized
  human may resolve it by supplying the missing fact, clarifying the requirement,
  selecting the intended interpretation, or recording with rationale that the
  proposed Gap was mistaken. It may not be silently waived. The resolution and
  resulting compiled-input changes remain attributable and require a new draft
  validation cycle.
- **Consequence:** Deterministic validation errors always block. Heuristic
  suspicions that do not establish a specific missing or ambiguous fact are
  warnings, which require resolution or an explicit human waiver with rationale.
  Context Gap remains reserved for an Executor reporting insufficiency in a
  possible later execution-reporting extension; the alpha records none.

## D-031: Semantic Gap resolutions revise accepted intent

- **Decision:** If resolving a Compilation Gap changes or clarifies product
  meaning, the resolution creates a new immutable accepted specification and
  Accepted Requirement revision before recompilation. A repository fact that
  does not change product intent may remain a compiler-input revision, but it
  still produces a new draft Run Manifest and Compilation Report.
- **Consequence:** The Gap resolution links to the replacement specification,
  requirement, or compiler input that resolved it. A mistaken proposed Gap may
  be resolved with attributable rationale without changing product meaning, but
  the updated Compilation Report and Publication Review remain new immutable
  records. Product decisions cannot live only inside compiler-review metadata.

## D-032: Definition Lineage and Execution Lineage are separate

- **Definition Lineage:** A product-meaning change creates a new immutable
  Accepted Specification and affected Accepted Requirement revisions. Any
  compiled-input change creates a new Run Manifest, Coding Pass, and complete
  File Capsule set as applicable. Each replacement records explicit
  supersession links, timestamp, authority, rationale, and Content Digest.
  Existing records are never mutated. A superseding Pass contains new Capsule
  records even when some Capsule contents are equal; added, removed, changed,
  and content-equal rebound Capsules and target files remain visible in the
  revision diff.
- **Execution Lineage:** Executing an unchanged published definition creates a
  distinct Run and distinct Attempts without changing the Run Manifest, Coding
  Pass, Capsule, or Contract Set versions. Artifacts, Candidate Revisions,
  Verification Results, and Run Outcomes remain attributable to that execution.
- **Consequence:** Execution counts are derived by querying immutable Run and
  Attempt records; SCORE stores no mutable execution counter. Definition diffs
  and execution history can independently answer when and why intent changed,
  how the compiled file set changed, and how often each unchanged published
  definition was executed.
- **Alpha scope:** The first alpha implements Definition Lineage only. It stores
  no Run, Attempt, Artifact, Candidate, Verification Result, or execution count.

## D-033: The compiler preserves material source citations

- **Decision:** For every repository artifact or excerpt that the Context
  Compiler declares materially supported its choice of a Contract, dependency,
  Capsule, Context Item, or verification criterion, it records an immutable
  Compilation Source Citation. Each citation identifies the Repository
  Revision, source location, content digest, purpose, and compiled object or
  decision it supports.
- **Boundary:** These citations are reviewable compiler provenance, not an
  exhaustive log of every search, read, tool call, or internal reasoning step.
  They record the compiler's claimed material basis without asserting complete
  causal capture. They are distinct from the narrower Context Items and Context
  Sets delivered to Executors.
- **Consequence:** Publication Review exposes the citations beside the compiled
  decisions they support. A changed material citation creates a new Compilation
  Report and draft definition under D-031 and D-032, even when the resulting
  executable contents happen to be equal.

## D-034: The first alpha includes an LLM Context Compiler

- **Decision:** The SQLite alpha does not begin from manually authored Capsule
  rows. An LLM-based Context Compiler, working from human-accepted product input
  and broad access to one Repository Revision, must produce the draft Run
  Manifest, Contract Set, Coding Pass, File Capsules, Context Sets,
  dependencies, Compilation Source Citations, and Compilation Report that the
  alpha validates, reviews, publishes, and exports.
- **Guidance:** The Coding Profile documents the compiler's required outputs and
  invariants. A versioned Compilation Procedure, which may be packaged as an LLM
  skill, supplies the operational instructions for producing them. Its source,
  version, and Content Digest are recorded as compiler input and provenance; it
  is not an Executor skill or Context Item unless separately included in a File
  Capsule.
- **Consequence:** The alpha tests both LLM-guided context compilation and
  table-driven Closed Context payload export. Human input remains authoritative
  for the Accepted Specification, Compilation Gap resolutions, Publication
  Review, and Publication Decision. Deterministic validation remains a separate
  gate; the compiler cannot approve or publish its own output.

## D-035: LLM compilation enters SQLite through an atomic import boundary

- **Decision:** The LLM Context Compiler emits one complete Compilation Bundle;
  it does not write SQLite tables or execute SQL directly. A deterministic
  importer validates the Bundle's shape, references, digests, Profile rules,
  traceability, and compilation invariants before protocol rows are created.
- **Persistence:** SQLite is the authoritative alpha store. A valid Bundle is
  persisted there as one complete draft definition in a single transaction. An
  invalid Bundle cannot leave partial Contracts, Capsules, Context Sets, or
  other draft-definition rows behind; its validation findings are returned to
  the compiler for an attributable revision and resubmission.
- **Consequence:** Probabilistic compilation is separated from deterministic
  storage integrity while the resulting SCORE definition still lives directly
  in SQLite. The compiler interface is a structured Bundle contract rather than
  a database-specific sequence of mutations.

## D-036: Every Compilation Submission and validation result is retained

- **Decision:** SQLite stores an immutable Compilation Submission for every
  Bundle emitted by the LLM Context Compiler, including invalid Bundles. The
  submission records the compiler and model provenance, Compilation Procedure
  identity and digest, compiler-input revision, timestamp, Bundle digest,
  validation outcome, validator identity and version, and structured findings.
  A revision or retry creates another submission linked to the submission and
  findings it responds to.
- **Boundary:** Submission history is stored separately from publishable
  definition tables. An invalid submission creates no Run Manifest, Coding
  Pass, Capsule, Context Set, or other draft-definition record. A valid
  submission may be imported atomically as a draft definition and retains an
  explicit link back to its source submission.
- **Consequence:** SCORE can inspect how the Compilation Procedure failed and
  improved without confusing probabilistic compiler output with valid protocol
  state. Submission totals and validation-failure patterns are derived from
  immutable records rather than mutable counters.

## D-037: Compilation Procedures are versioned separately from Profiles

- **Decision:** Coding Profile semantics, object schemas, invariants, and
  deterministic validators define conformance. One or more independently
  versioned Compilation Procedures or skills may target the same Profile
  version. The alpha ships one reference Procedure, but that Procedure is not
  the only protocol-compatible way to compile a definition.
- **Consequence:** A Procedure improvement creates a new Procedure record and is
  captured in compiler input and Compilation Submission provenance. It does not
  require a new Profile version unless SCORE object semantics, schemas,
  invariants, or validators change. A procedure's output is compatible because
  it passes the declared Profile validation and publication workflow, not
  because it reproduces one mandated prompt or decomposition strategy.
- **Portability:** Other teams may publish alternative compiler skills for the
  same Profile. Their resulting definitions remain distinct and attributable;
  SCORE does not assume identical LLM output from identical product and
  repository inputs.

## D-038: Deterministic structural failures may enter a bounded repair loop

- **Decision:** A deterministic import validator may classify a finding as
  machine-repairable when its code and structured detail identify a purely
  structural correction that does not require new product meaning, repository
  interpretation, or human authority. The LLM Context Compiler may receive
  those findings and submit a corrected Compilation Bundle automatically.
- **Boundary:** Every repair produces a new immutable Compilation Submission
  linked to the findings and submission it addresses. The automatic loop ends
  when a Bundle validates, a configured retry limit is reached, or any finding
  requires product judgment, unresolved repository interpretation, a
  Compilation Gap resolution, or a warning waiver. The validator, not the LLM,
  assigns the machine-repairable classification.
- **Consequence:** Mechanical defects such as duplicate targets, dangling
  references, missing digests, invalid shapes, and incomplete traceability may
  be corrected without human mediation. Automatic repair cannot revise the
  Accepted Specification, resolve a Compilation Gap, waive a warning, publish a
  definition, or silently broaden compiler input. The retry bound is an alpha
  execution-policy setting rather than a Core protocol constant.

## D-039: A Context Gap is a claim with a later disposition

- **Scope:** Deferred beyond the first alpha because that alpha receives no
  Attempt or Context Gap report.
- **Decision:** A Context Gap is an Executor's attributable claim that it cannot
  satisfy a named Contract requirement from its Attempt Payload without
  inventing a project-specific fact that is absent or ambiguous. SCORE validates
  the report's structure and attribution, not the truth of the claim. The claim
  identifies the missing fact, affected Contract input or criterion, why it
  cannot be derived from the payload, and why materially different answers are
  plausible.
- **Disposition:** The Context Compiler may investigate the claim against the
  exact Repository Revision without granting the File Executor any additional
  access. An attributable Context Gap Disposition classifies it as a
  substantiated repository omission, product ambiguity, or not substantiated,
  with cited evidence and rationale. The Executor's requested remedy is not
  authoritative.
- **Consequence:** A substantiated omission may cause a new compiler-input
  revision and complete replacement Pass. Product ambiguity returns to human
  deliberation and may revise the Accepted Specification. A non-substantiated
  claim changes no definition and may be followed only by a same-input Attempt
  permitted by existing retry policy. No Context Gap injects context into an
  active or historical Attempt.

## D-040: Declared Contract inputs receive deterministic binding checks

- **Decision:** Every required Contract input in a compiled Capsule has a stable
  identity and an explicit binding to the Context Item or other declared input
  that supplies it. Before publication, deterministic validation checks required
  binding presence, referential integrity, declared kind and version
  compatibility, and cardinality under the Contract's binding rules. Missing or
  invalid required bindings block publication.
- **Boundary:** These checks prove structural completeness only relative to the
  inputs the Contract declares. They cannot prove that the compiler discovered
  every project-specific fact the task will actually require, that the bound
  content is semantically correct, or that no unknown omission exists.
- **Consequence:** Known dependencies become machine-checkable before execution.
  Undeclared needs may still surface through Publication Review or Compilation
  Gaps, and later through external execution feedback if reporting is added.
  SCORE must present binding coverage as deterministic structural evidence,
  never as proof of perfect context.

## D-041: Contract Input Bindings are explicit and typed per input

- **Decision:** Every Contract Input has a stable identifier, required or
  optional status, expected kind or schema, accepted version rule, and declared
  minimum and maximum cardinality. Each Capsule records explicit Contract Input
  Bindings to the identified Context Items or other declared inputs that supply
  it; Context Set membership alone is not a binding.
- **Multiplicity:** One Context Item may supply more than one Contract Input only
  through separate explicit bindings. More than one item may supply a single
  input only when that input's declared cardinality allows it. Required inputs
  must meet their minimum cardinality before publication; optional inputs may
  remain unbound.
- **Consequence:** SQLite and the Compilation Bundle expose Contract Inputs and
  bindings as addressable records. Deterministic validation checks the binding
  graph, and the Harness Payload preserves the resolved input-to-item mapping so
  the user-owned harness does not infer why an item was included.

## D-042: Every supplied Context Item must be bound

- **Decision:** Every Context Item in a Capsule's Context Set must supply at
  least one explicit required or optional Contract Input through a Contract
  Input Binding. There is no unbound “supporting material” category. Target
  content, policies, examples, type declarations, Contracts, and resolved skills
  are all modeled as declared inputs when supplied.
- **Validation:** Deterministic publication validation rejects a Context Set
  item with no binding, a binding whose supplier is absent from the Context Set,
  and a Harness Payload whose resolved membership and binding maps disagree.
  An optional input may remain unsupplied, but an included item may never be
  unexplained.
- **Consequence:** Closed Context cannot be padded with arbitrary repository
  material under a vague relevance claim. Publication Review can show why every
  observable item exists, while unused-item and payload-size measurements remain
  evidence about whether declared inputs are actually minimal.

## D-043: Verification feedback enters only through Corrective Compilation

- **Scope:** Deferred beyond the first SQLite alpha by D-045 because that alpha
  does not perform SCORE-owned verification.

- **Decision:** Verification Results and their identified Evidence from a failed
  Candidate may become attributable compiler input only in a new Corrective
  Compilation cycle. They are never inserted into an active Pass, same-input
  retry, historical Attempt Payload, or File Executor conversation.
- **Deterministic boundary:** SCORE deterministically preserves the source Run,
  Pass, Candidate, verification criterion, Verification Result, Evidence,
  digests, and inclusion authority for every failure input admitted to the new
  compilation. The Context Compiler's interpretation and proposed correction
  remain LLM work and are not represented as deterministic.
- **Consequence:** Corrective Compilation produces new Compilation Submissions
  and, if valid, a complete replacement Run Manifest, Coding Pass, Capsules,
  Context Sets, Contracts, bindings, and Acceptance Oracle through the existing
  validation and human-publication workflow. The prior definition and execution
  remain unchanged, and File Executors never receive the raw hidden Oracle.

## D-044: Corrective Compilation receives the complete required failure set

- **Scope:** Deferred beyond the first SQLite alpha by D-045 because that alpha
  does not produce Verification Results.

- **Decision:** A Corrective Compilation deterministically includes every
  failed required verification criterion for its source Candidate, together
  with the exact Verification Result and identified source Evidence. Neither a
  human nor an LLM selects a smaller required failure subset.
- **Additional input:** Attributable human explanations and non-required
  diagnostic findings may accompany the required failure set. Their source,
  authority, timestamp, and rationale are recorded. A summary may explain but
  never replace the original Verification Result or Evidence.
- **Consequence:** The input set is derived from the precommitted Acceptance
  Oracle and stored Verification Results rather than compiler judgment. SCORE
  can prove which recorded failures reached the compiler, while making no claim
  that the compiler's diagnosis or correction is deterministic.

## D-045: SCORE supplies execution definitions; the user's harness writes files

- **Status:** Narrowed by D-063 and D-064 to distinguish probabilistic LLM
  compilation from deterministic SCORE materialization.
- **Decision:** The Context Compiler authors a complete execution definition;
  deterministic SCORE code stores, validates, reviews, publishes, freezes, and
  exports it. For the Coding Profile, that definition contains each target file
  and operation, its objective, Contracts, exact closed Context Set, fully
  resolved Context Items and skills, Capabilities, and allowed and prohibited
  effects. Review provenance may retain source references, but they are not
  instructions the File Executor follows.
- **Execution boundary:** After human approval, the user deliberately invokes
  their own agentic harness. That harness creates one agent per File Capsule,
  supplies the exported closed payload, and performs the declared create,
  replace, or delete operation in the user's chosen environment. SCORE does not
  provision a checkout, launch or schedule agents, write files, apply patches,
  assemble a repository, merge code, or run tests.
- **Consequence:** The first SQLite alpha must prove that the complete approved
  per-file definition can be inspected and exported from stored data without
  handwritten execution prompts. Candidate assembly, filesystem integration,
  and testing are outside the alpha. D-021, D-024, D-043, and D-044 remain
  possible later Coding Profile design rather than alpha requirements. The
  alpha records no Run, Attempt, Event, Artifact, Context Gap, Candidate, output
  digest, or other report from the user-owned harness.

## D-046: The first alpha ends at Harness Payload export

- **Decision:** Before Publication Review, the first SQLite alpha materializes
  one complete immutable Harness Payload per File Capsule. After the human
  Publication Decision binds those exact payload digests, SCORE may export the
  frozen rows. That export is the alpha's terminal product boundary.
- **Excluded:** The alpha does not require or receive harness callbacks. It
  stores no Run, Attempt, Assignment, Event, Attempt Result, Artifact, Context
  Gap, Candidate, agent status, model-execution provenance, or resulting-file
  digest. Re-exporting a published definition is not recorded as an execution.
- **Consequence:** The alpha proves only that approved closed per-file
  instructions can be compiled, stored, inspected, and exported without another
  project-specific prompt. Execution Lineage and result reporting may be added
  later through a separate optional integration boundary.

## D-047: JSON is authoritative; Markdown is a deterministic render

- **Decision:** The authoritative Harness Payload is validated structured JSON.
  Its payload digest covers that JSON under the declared serialization rules.
  Markdown is an optional derived presentation and never defines independent
  protocol meaning.
- **Renderer boundary:** Ordinary deterministic code, not an LLM, renders
  Markdown through a fixed, versioned template with fixed field order, escaping,
  list ordering, and missing-value rules. The same Agent Input and renderer
  version produce byte-identical Markdown. Rendering performs no summarization,
  inference, rewriting, or field selection.
- **Provenance:** A retained Markdown render records the source payload identity
  and digest, renderer identity, version and digest, and its own content digest.
  Editing the Markdown cannot change the approved JSON; a changed template
  creates a new render version rather than a new Harness Payload.
- **Publication:** Deterministic code materializes every draft Harness Payload
  before Publication Review. The Review exposes the exact JSON and payload
  digests for every File Capsule, and the Publication Decision binds the complete
  Harness Control, Agent Input, and payload-digest sets along with the Manifest
  and Compilation Report digests.
  Export reads those frozen rows and never rebuilds approved JSON from a later
  database view.

## D-048: Harness Payloads contain resolved content, not lookup instructions

- **Decision:** Every fact a File Executor needs is present as resolved inline
  content in its authoritative Harness Payload. A target path, repository path,
  symbol name, URL, database identifier, or source citation cannot stand in for
  the required content and cannot instruct the Executor to fetch it.
- **Compilation boundary:** The Context Compiler may use broad repository access
  to discover a fact, but it must shape that fact into a complete purpose-
  specific Contract, declaration, policy, example, target snapshot, skill, or
  other Context Item before publication. If it cannot compile sufficient
  self-contained input, the Pass is not ready.
- **Provenance:** SCORE may retain where the compiler found a fact—such as path,
  Repository Revision, locator, and digest—for human review and lineage. That
  metadata is not an execution dependency and grants the File Executor no read
  authority.
- **Validation:** Publication validation rejects any required Contract Input
  whose supplier is only an unresolved pointer or lookup instruction. The
  Harness Payload may identify provenance, but its bound Context Item must carry
  the exact content the Executor is expected to use.

## D-049: Harness control and Agent Input are separate approved sections

- **Decision:** Every authoritative Harness Payload JSON object has an explicit
  `control` section and an explicit `agent_input` section. `control` contains
  routing and enforcement data for the user-owned harness, including protocol
  and Profile versions, Manifest, Pass, and Capsule identities, target path and
  operation, allowed effect, and canonicalization metadata. `agent_input`
  contains the complete and only project-specific instructions and context
  intended for the file agent.
- **Visibility:** Only `agent_input` may be delivered to or rendered for the
  file agent. Compiler source citations, requirement traceability, approval
  records, storage identifiers, and other review provenance remain linked SCORE
  records or harness control data and are not agent context.
- **Integrity:** SCORE records a digest for `control`, a digest for
  `agent_input`, and a digest for the complete Harness Payload. Publication
  Review exposes and approval binds all three. A harness may not silently add,
  remove, or move fields across the visibility boundary.
- **Rendering:** A Harness Payload Render deterministically renders only
  `agent_input`. Renderer identity and output digest remain outside the rendered
  agent-visible content as SCORE metadata.

## D-050: The first alpha fixture contains two coordinated File Capsules

- **Decision:** The reproducible SQLite-alpha fixture contains exactly two File
  Capsules in one Coding Pass: one `replace` operation for an existing file and
  one `create` operation for a new file. Both are compiled against the same base
  Repository Revision and versioned Contract Set.
- **Context boundary:** The two Capsules coordinate through one shared Contract
  but receive distinct, self-contained Agent Inputs appropriate to their
  different file objectives. Neither input refers the agent to the other target
  file or exposes the other Capsule's content.
- **Consequence:** The fixture exercises cross-file contract compilation,
  separate closed contexts, single-writer validation, and both update and create
  payload shapes without expanding to a third file. A `delete` fixture and
  larger Pass are deferred.

## D-051: The first fixture selectively injects one resolved skill

- **Decision:** Exactly one of the fixture's two File Capsules receives one
  small skill in its Agent Input. The other Capsule does not receive that skill.
- **Resolution:** SCORE stores the skill's complete immutable content, source,
  version, purpose, and digest as a Context Item. A Contract Input Binding
  explains exactly why that skill is included. A skill name, path, URL, or
  installer reference alone is invalid under D-048.
- **Consequence:** Publication Review shows the resolved skill and binding, the
  selected Capsule's Agent Input embeds its full content, and its Agent Input
  digest covers that content. The fixture therefore exercises selective context
  compilation instead of broadcasting the same guidance to every file agent.

## D-052: The first fixture uses a tiny purpose-built repository

- **Decision:** The reproducible SQLite-alpha fixture uses a tiny repository
  created specifically for SCORE rather than a revision from an existing
  product repository.
- **Shape:** Its immutable base revision contains one existing file that the
  `replace` Capsule targets, one absent path that the `create` Capsule targets,
  one shared Contract need, and one small skill required by only one Capsule.
  It has no external service dependency or unrelated build complexity.
- **Compiler constraint:** The fixture simplifies the workload, not the
  compilation path. Starting from the Accepted Specification, fixture
  Repository Revision, and Compilation Procedure, the LLM Context Compiler must
  still produce the complete Compilation Bundle. Humans do not hand-author the
  resulting Capsule, Context Set, or Harness Payload rows in SQLite.
- **Consequence:** Failures remain attributable to the compiler, schema,
  validation, review, or export boundary instead of being confounded by the
  size and drift of an existing application. A later experiment must use a real
  repository before SCORE claims usefulness on production-scale codebases.

## D-053: SQLite stores the complete alpha fixture Repository Revision

- **Decision:** The SQLite alpha stores the complete contents of the tiny
  fixture Repository Revision as immutable per-file rows. Each row includes at
  least the normalized repository-relative path, exact content bytes, media or
  content type, and content digest.
- **Revision integrity:** The Repository Revision has its own digest derived
  deterministically from an ordered manifest of its immutable file records.
  A display name, filesystem directory, or source-control reference may be
  retained as provenance but cannot substitute for the stored contents.
- **Compiler boundary:** The Context Compiler receives this exact revision as
  source input. File Executors still receive only their approved Agent Inputs;
  neither the user-owned harness nor its agents receive a SQLite connection or
  authority to inspect other revision rows.
- **Validation:** For the alpha fixture, deterministic validation can confirm
  that a `replace` target exists in the base revision and a `create` target does
  not. A content or manifest change creates a new Repository Revision rather
  than mutating the stored snapshot.
- **Consequence:** The first experiment is self-contained and can reproduce and
  inspect the exact repository state used for compilation. A later production
  storage design may replace inline revision contents with immutable external
  content-addressed storage without changing the closed Executor boundary.

## D-054: The first alpha does not standardize agent result transport

- **Decision:** A File Capsule declares one target path, its `create`, `replace`,
  or `delete` operation, the intended outcome, and the complete Agent Input.
  The first alpha does not require the external agent to return a full file, a
  patch, a tool call, or any other standardized result envelope.
- **Harness boundary:** A user-owned harness may let its agent write the one
  authorized file directly, capture complete file content, translate a patch,
  or use another native mechanism. SCORE neither chooses that mechanism nor
  receives its result in the alpha.
- **Consequence:** Harness-specific editing behavior cannot change the approved
  Agent Input, target, or allowed effect, but result transport remains outside
  SCORE. A future optional execution-reporting extension may define portable
  result semantics if interoperability or verification requires them.

## D-055: A published Pass drives a user-owned per-file agent harness

- **Status:** Extended by D-065, which makes the general Executor Adapter seam
  a first-class product integration while keeping concrete runtimes outside
  Core.
- **Decision:** The intended integration enumerates the File Capsules in one
  approved Coding Pass and obtains each Capsule's frozen Harness Payload from
  SCORE. Harness Control tells the integration which target and operation it may
  route; the corresponding Agent Input is the complete project-specific input
  supplied to that Capsule's file agent.
- **Execution boundary:** The user invokes an external Agentic Harness, which
  may be a CLI backed by Cursor SDK, another agent SDK, or a custom runtime. The
  harness programmatically creates one agent per File Capsule and owns every
  create, replace, or delete effect. The agent runtime writes the code; SCORE
  remains the source of the approved structure, instructions, and context.
- **No prompt reconstruction:** The harness may add static provider-level
  mechanics needed to invoke its SDK, but it does not discover repository facts
  or compose another project-specific prompt. Those inputs come from the frozen
  Harness Payload.
- **Scope:** Cursor SDK and a CLI are explanatory integration examples, not Core
  Protocol dependencies. D-065 selects Cursor SDK as the first experimental
  adapter without changing that boundary. The first SQLite alpha still ends at
  approved payload export; invoking a real harness is the next integration seam,
  not hidden SCORE behavior.

## D-056: Publication approval binds payloads without entering their digests

- **Decision:** A Publication Decision and its Publication Payload Bindings are
  separate immutable records from the Harness Payloads they approve. Each
  binding identifies the exact payload, Harness Control, Agent Input, and
  complete payload digests authorized by that Decision.
- **Reason:** Harness Payloads must be materialized and digested before human
  review. Putting the later Publication Decision inside Harness Control would
  change the Control and payload digests after approval and create a circular
  dependency.
- **Self-digest boundary:** `control_digest`, `agent_input_digest`, and
  `payload_digest` are stored as integrity metadata beside the exact bytes they
  cover; none is embedded inside the value whose digest it defines.
- **Export boundary:** The exporter returns or links the approving Decision and
  binding as publication metadata beside the unchanged payload. It never edits
  the approved Harness Control or includes the approval record in the digest it
  approves.
- **Consequence:** Published status is derived from an approving immutable
  Decision and matching bindings rather than stored as a mutable flag on the
  Run Manifest or Harness Payload.

## D-057: The alpha uses RFC 8785 canonical JSON and SHA-256 digests

- **Decision:** Structured JSON is canonicalized using the JSON
  Canonicalization Scheme in [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html),
  encoded as UTF-8, and digested with SHA-256. Stored digest text uses
  `sha256:` followed by 64 lowercase hexadecimal characters.
- **JSON boundary:** Input must satisfy the I-JSON constraints required by RFC
  8785. Duplicate object names, invalid Unicode data, `NaN`, and infinite
  numeric values are rejected. Object properties are sorted by the canonical
  algorithm, while array order remains unchanged and meaningful.
- **Number boundary:** Protocol integer fields must remain within the
  interoperable JSON safe-integer range. Larger integers and values requiring
  exact decimal semantics are represented as strings under their field schema.
- **Byte-content boundary:** Structured objects are digested from their
  canonical JSON bytes. Repository files, deterministic renders, and other
  stored byte content are digested from their exact stored bytes rather than
  parsed and reserialized.
- **Identity boundary:** Protocol Identifiers remain opaque identities and are
  never replaced by Content Digests. Equal digests do not collapse separate
  historical records.
- **Consequence:** Independent implementations can reproduce Bundle, Contract,
  Context Item, Manifest, Repository Revision, Harness Payload, and render
  digests without depending on input whitespace or object-property order.

## D-058: Deterministic validation and SQLite provide layered enforcement

- **Decision:** The deterministic importer validates the complete Compilation
  Bundle before persistence. SQLite independently enforces the structural
  invariants that it can express clearly and without reconstructing whole-graph
  meaning.
- **SQLite enforcement:** The alpha enables foreign-key enforcement and uses
  strict tables, required columns, enumerated-value checks, digest and
  identifier shape checks, unique constraints, and deferred foreign keys where
  complete-graph insertion requires them. Constraints prevent duplicate target
  writers, membership rows, binding positions, logical Contract versions, and
  Publication Payload Bindings.
- **Immutability:** Immutable protocol tables reject `UPDATE` and `DELETE`
  through append-only triggers. Correction, resolution, and supersession insert
  new attributable rows instead of rewriting or removing historical rows.
- **Whole-graph boundary:** Deterministic application validation owns rules
  requiring the complete definition, including requirement traceability,
  Context Input coverage, unexplained Context Items, target-operation agreement
  with the base Repository Revision, and exact Pass-to-payload coverage. These
  checks are rerun at the publication gate instead of being duplicated as
  insertion-order-sensitive per-row triggers.
- **Transactions:** An invalid Compilation Submission and all of its findings
  are recorded in one transaction without draft-definition rows. A valid
  Submission and complete draft graph are imported in one transaction. A
  Publication Review and its frozen payloads are materialized atomically, and
  an approving Publication Decision and all corresponding payload bindings are
  inserted atomically. Any failure rolls back its complete transaction.
- **Consequence:** The importer remains the understandable implementation of
  Profile-wide meaning, while SQLite protects referential integrity,
  uniqueness, allowed values, atomicity, and append-only history even when
  application code is defective.

## D-059: The alpha reviews a deterministic Markdown report organized by Pass

- **Status:** Narrowed by D-064. Markdown remains the alpha review presentation,
  but a CLI is only one possible adapter and is not the organizing product
  interface.
- **Decision:** A deterministic renderer produces one Markdown Publication
  Review report from an immutable Publication Review snapshot. Documented
  SQLite views remain available for direct inspection, but raw views are not
  the primary human approval surface.
- **Report hierarchy:** Always-visible material shows the definition identity,
  publication blockers, warnings, waivers, Compilation Gaps, and exact approval
  digests. Each Coding Pass is then presented as a collapsible HTML
  `<details>` section within the Markdown, with nested sections for its shared
  requirements, Contracts, dependencies, Context allocation, and File Capsules.
  Each File Capsule shows its target and operation, intended change, Contract
  role, resolved Context Items and skills, Capabilities, effects, Harness
  Control, Agent Input, and associated digests.
- **Terminology:** In the current Coding Profile, the Coding Pass is the
  coordinated vertical change the review groups together. “Slice” may be used
  as explanatory UX language, but the alpha does not introduce a separate
  Slice protocol object or grouping level.
- **Completeness:** Collapsing a section changes only presentation. The complete
  review content remains present in the Markdown bytes and readable as plain
  text even when a viewer does not provide interactive disclosure controls.
- **Determinism and provenance:** Ordinary versioned renderer code, never an
  LLM, produces the report. SCORE records the source Review identity and digest,
  renderer identity, version and digest, and rendered output digest. A separate
  human-authority interface records the authority, timestamp, Review identity,
  and exact approved definition and payload digests without modifying the
  Review or its render.
- **Evolution:** The Markdown layout and usability will be evaluated and
  iterated through new renderer versions. A future HTML or graphical review UI
  may present the same immutable Review snapshot without changing Core or the
  approved compiled definition.

## D-060: The Account Status example is the first frozen conformance fixture

- **Status:** Its formatter-skill selection is superseded by D-069; the fixture
  shape and selective one-skill allocation remain unchanged.
- **Decision:** The first reproducible alpha fixture freezes the Account Status
  scenario in [coding-profile-run.md](../examples/coding-profile-run.md). The
  base Repository Revision contains only `src/schema.ts`, whose exact content
  declares `Account` with `id` and `name`; `src/account-label.ts` is explicitly
  absent.
- **Accepted change:** The accepted specification requires the shared `Account`
  declaration to add required `status: "active" | "suspended"`, requires a new
  named `formatAccountLabel(account)` function that returns exactly
  `"<name> [<status>]"`, and prohibits every other file change.
- **Compiled shape:** One File Capsule replaces `src/schema.ts`; one creates
  `src/account-label.ts`. Both use the same fixed future Contract. The formatter
  Capsule receives the future `Account` declaration inline and is the only
  Capsule that receives the frozen Pure TypeScript Formatter skill.
- **Conformance data:** The fixture freezes the Accepted Specification and
  Requirements, exact repository bytes and absence declaration, target
  operations, shared Contract, skill content and purpose, and—after the Bundle
  schema is fixed—representative valid and deliberately invalid Compilation
  Bundles with expected deterministic findings.
- **Compiler boundary:** The frozen examples test the importer and validator.
  The live alpha trial still requires the LLM Context Compiler to produce a
  complete Compilation Bundle from the accepted inputs; humans do not author
  the resulting SQLite definition rows.
- **Growth rule:** The first fixture remains as a small permanent regression and
  conformance case. Richer repositories, frameworks, Contracts, and larger
  Passes are added only after this fixture succeeds and do not replace it.

## D-061: The compiler emits a strict versioned domain Bundle, not database rows

- **Decision:** The first compiler interface is a closed JSON Schema 2020-12
  document identified as `score.compilation-bundle` version
  `0.1.0-alpha.1`, targeting `score.coding` version `0.1.0-alpha.1`. It
  represents SCORE domain objects rather than SQLite tables, SQL statements, or
  pre-rendered prompts.
- **Source bindings:** The Bundle identifies the exact Accepted Specification,
  Repository Revision, Compilation Procedure, and compiler-input revision by
  Protocol Identifier and existing Content Digest.
- **Proposed definition:** The Bundle contains the proposed Run Manifest,
  Contract Set, Contracts, Contract Inputs, Coding Pass, File Capsules,
  dependencies, Context Items, Context Sets and memberships, Contract Input
  Bindings, Capability requirements, Accepted Requirement traceability,
  Compilation Source Citations and bindings, and Compilation Report.
- **Compiler findings:** The Bundle may report attributable heuristic warnings
  or proposed Compilation Gaps. They remain distinguishable from deterministic
  Validation Findings. A proposed Compilation Gap preserves the Submission but
  blocks draft import until authorized resolution leads to a new Bundle.
- **Local-reference boundary:** Proposed objects use unique readable
  Bundle-local handles to express internal references. After successful
  validation, the importer assigns opaque permanent Protocol Identifiers and
  records the mapping. The compiler does not mint database identities.
- **Deterministic ownership:** The LLM does not calculate Content Digests for
  proposed objects. The importer calculates them under D-057. Caller-controlled
  Submission metadata records compiler and model provenance, receipt time,
  prior Submission and finding lineage, and other facts the LLM must not assert
  about itself.
- **Strictness:** Required fields must be present; references must resolve;
  array-order semantics are declared; object schemas reject unknown fields.
  The importer never ignores, guesses, or translates unknown semantics. A shape
  change requires another Bundle schema version.
- **Excluded output:** Harness Payloads, Publication Reviews, Publication
  Decisions, Runs, Attempts, results, and SQLite row shapes are not compiler
  output. Deterministic software materializes the applicable post-compilation
  records from a valid imported definition.
- **Consequence:** Structured LLM output stays focused on the complete SCORE
  definition, while deterministic code owns validation, identity assignment,
  canonicalization, persistence, payload construction, and publication.

## D-062: The first implementation test is an unpublished local experiment

- **Decision:** The current `score-protocol` project remains the documentation
  source of truth while the first very small SQLite implementation test runs in
  a separate local workspace. The experiment is not pushed, published, or
  presented as a SCORE reference implementation.
- **Local boundary:** The experiment may create its own schema file, SQLite
  database, fixture data, importer, validators, review report, and exporter. It
  reads the accepted SCORE documents as design input but does not add prototype
  code to this documentation project or initialize this directory as a Git
  repository.
- **Authority:** Experimental code and output do not change protocol meaning.
  When the test is complete, a human reviews what worked, what failed, and which
  artifacts—if any—should be deliberately promoted into `score-protocol` or a
  future implementation repository.
- **Practical default:** A persistent sibling directory such as
  a disposable local worktree may hold the experiment;
  its exact local path is operational configuration, not a SCORE decision.
- **Scope:** The local experiment still ends at approved Harness Payload export.
  It does not gain agent execution, file mutation, testing, result reporting, or
  other deferred features merely because it lives outside the documentation
  project.
- **Consequence:** The thesis can be tested quickly without prematurely
  committing prototype structure to the open-source project. Promotion happens
  only after evidence from the small fixture supports it.

## D-063: The alpha enters through the user's existing agent and a SCORE skill

- **Scope:** This is the default entry-point hypothesis for the local alpha, not
  a Core requirement that every SCORE implementation use one conversational
  workflow.
- **Decision:** The user asks their existing capable agent to use SCORE for the
  requested work. A versioned SCORE authoring skill guides that agent through
  product deliberation, Accepted Specification approval, context compilation,
  Compilation Bundle submission, review, and the later explicit execution
  handoff. SCORE does not silently launch a second LLM compiler by default.
- **Compiler role:** After the user explicitly accepts the specification, the
  same agent acts as the Context Compiler. It receives the exact accepted input,
  declared Repository Revision, Compilation Procedure, and Bundle schema; uses
  broad declared source access; and submits one complete Bundle.
- **Tool seam:** Deterministic SCORE tools persist the accepted inputs and source
  revision, begin and record Compilation Submissions, validate and import a
  Bundle, return structured findings, materialize the Publication Review,
  record an authorized Publication Decision, and export the approved Pass. The
  tools do not perform the compiler's LLM reasoning.
- **Human gates:** The agent may not treat initial conversational intent as an
  accepted specification without explicit approval, and it must stop again at
  Publication Review. File-agent execution requires a later explicit user
  instruction after publication.
- **Execution handoff:** After approval, the user's existing agent may invoke a
  configured external Agentic Harness. That harness launches ordinary closed-
  context file agents from the approved Harness Payloads. File agents receive
  no SCORE database or compilation tools.
- **No hidden compiler:** A future integration may deliberately delegate
  compilation to a fresh agent using the same fixed compiler inputs and recorded
  provenance. Such delegation is an explicit harness choice, not hidden behavior
  inside a required `score compile` command.
- **Evaluation:** The local Account Status experiment will assess whether this
  entry point is understandable, whether the agent can switch cleanly from
  deliberation to compilation, and whether a later dedicated compiler adapter
  would materially improve context quality or usability.

## D-064: Conversation is the entry point; SCORE deterministically materializes storage

- **Decision:** The primary user experience is a conversation with the user's
  existing agent using the SCORE authoring skill. SCORE does not require the
  user or agent to orchestrate a public workflow command suite such as
  `score compile`, `score publish`, and `score export`.
- **LLM ownership:** The Context Compiler authors one complete Compilation
  Bundle. It may invoke one coarse compilation-submission interface with that
  Bundle and the exact accepted source bindings. It does not design the SQLite
  schema, generate SQL, mint storage identities, calculate new-object digests,
  or insert and update protocol rows directly.
- **Materialization:** The deterministic SCORE module creates or opens the local
  SQLite database, applies its fixed schema and migrations, validates and
  records the Submission, atomically imports a valid definition, materializes
  Harness Payloads, and generates the Publication Review. From the user's point
  of view the agent caused the SCORE database to be created; storage integrity
  remains deterministic.
- **Role-specific interfaces:** The alpha has three conceptual interfaces: a
  compiler-facing submission that returns structured findings or a reviewable
  draft; a human-authority publication decision over an exact Review and digest
  set; and a harness-facing read of approved frozen payloads. Illustrative names
  such as `submit_compilation`, `decide_publication`, and
  `get_approved_payloads` do not prescribe commands or transport.
- **Adapter neutrality:** A local function, tool call, MCP server, SDK, CLI, or
  future UI may adapt those interfaces. A shell command may be convenient in the
  unpublished alpha, but it does not define SCORE's product experience or Core
  Protocol.
- **Failure boundary:** Allowing the probabilistic compiler to create tables or
  issue direct SQL would permit schema drift, partial writes, rewritten history,
  and bypassed validation. Such a database is not a valid SCORE definition merely
  because an LLM created it.
- **Consequence:** The user experiences “ask the agent to prepare this with
  SCORE, review it, then approve execution.” The agent owns compilation meaning;
  the SCORE module owns trustworthy materialization; the external harness owns
  file-agent execution.

## D-065: Executor Adapters are first-class integrations; Cursor is first

- **Status:** Terminology reframed by D-067; first-adapter order superseded by
  D-068.
- **Decision:** Executor Adapters are a first-class SCORE product integration
  surface. They let a user-owned Agentic Harness route approved Harness Payloads
  to a chosen runtime while keeping every concrete runtime outside SCORE Core.
- **Shared boundary:** An adapter reads approved frozen payloads through SCORE's
  harness-facing interface, verifies their publication bindings and supported
  requirements, keeps Harness Control away from the file agent, supplies the
  exact Agent Input without project-specific augmentation, and enforces the
  single-target Declared Effect. It does not query `score.db`, inspect the
  repository, recompile the work, or make its provider authoritative over SCORE
  records.
- **First experiment:** The first planned post-export adapter uses Cursor SDK to
  create one Cursor agent per File Capsule, initially using Cursor Composer.
  Each agent runs in a fresh workspace or process sandbox that contains only its
  assigned target state. Pointing Cursor at the real repository would violate
  Closed Context even if its prompt instructed it to edit one file.
- **Portability:** Pi is a candidate for a later adapter. Other runtimes may use
  their native invocation and editing mechanisms as long as they preserve the
  same approved Harness Payload boundary. Cursor concepts and model identifiers
  do not enter Core or the Coding Profile.
- **Scope:** This decision does not expand the first SQLite alpha, which still
  ends at approved Harness Payload export. Cursor execution is the immediately
  following integration experiment and remains owned by the external harness.
- **Detail:** [Executor Adapters](./runtime-adapters.md) records the common
  boundary and the initial Cursor isolation design.

## D-066: The proven alpha is promoted into the canonical repository

- **Decision:** The completed local alpha proof and its Git history are promoted
  into the root of the canonical `score-protocol` repository on `main`, beside
  the governing documentation, fixtures, schema, tests, and saved evidence.
- **Evidence:** The two-file fixture passed strict Bundle validation, atomic
  SQLite import, independent persisted-state validation, deterministic Harness
  Payload and HTML Publication Review rendering, pre-approval export rejection,
  synthetic frozen-row export after approval in an isolated database, and human
  review of the slice-first publication interface.
- **Supersession:** This decision supersedes only D-062's temporary storage and
  Git-isolation boundary. The proof remains an alpha rather than a reference
  implementation, and experimental evidence still does not change protocol
  meaning without an accepted decision.
- **Scope:** Promotion does not record a Publication Decision, launch an agent,
  invoke an Executor Adapter, mutate application files, or expand the alpha past
  approved Harness Payload export.
- **Consequence:** `score-protocol/main` is now the authoritative location for
  both the protocol documents and the implementation proof. A sibling copy has
  no authority after canonical verification succeeds.

## D-067: Canonical language favors human meaning over infrastructure jargon

- **Decision:** Current SCORE product language uses Plan Compiler, Compiled
  Plan, Plan Manifest, Change Plan, Brief, File Brief, Shared Contracts, Source
  Snapshot, Plan Review, Plan Decision, Plan Approval, Runner, Runtime Adapter,
  Worker, Agent, Agent Package, Run Rules, and Allowed Change.
- **Specialization:** Brief and Worker are the domain-neutral terms. The Coding
  Profile specializes them as File Brief and Agent. The Plan Review normally
  leads with Slice and filename and omits a separate object name when “file” is
  sufficient.
- **Superseded language:** Context Compiler, Compilation Bundle, Run Manifest,
  Coding Pass, Capsule, File Capsule, Contract Set, Repository Revision,
  Publication Review, Publication Decision, Agentic Harness, Executor Adapter,
  Executor, Harness Payload, Harness Control, and Declared Effect are no longer
  preferred product terms.
- **Compatibility:** The implemented alpha continues to use earlier JSON
  schema names, table names, TypeScript symbols, commands, generated artifact
  paths, and digest-bearing bytes. Those identifiers require one explicit,
  coordinated migration; documentation maps them rather than claiming they
  already changed.
- **Consequence:** Product copy and current design documents use the canonical
  language. Historical decisions retain their original wording, while
  [Terminology](./terminology.md) provides the exact compatibility map.

## D-068: OpenCode is the first Runtime Adapter; Cursor is the benchmark

- **Decision:** The first post-export Runtime Adapter experiment uses the
  OpenCode SDK. Cursor becomes the second adapter and comparison benchmark.
- **Reason:** OpenCode provides an inspectable, provider-flexible integration
  with explicit sessions, model configuration, permissions, events, and
  structured output. That makes it the better first test of SCORE's portable
  Agent Package seam. Cursor remains valuable as a more opinionated coding
  harness and independent comparison.
- **Shared enforcement:** The Runner, not either agent runtime, verifies Plan
  Approval and package digests, creates one disposable workspace per File
  Brief, withholds `score.db` and the real repository, sends only approved Agent
  Input, rejects undeclared file changes, and returns candidate files to the
  user outside the first-alpha database.
- **Scope:** This changes only experiment order. It does not make OpenCode or
  Cursor a SCORE dependency, record a Plan Decision, export approved packages,
  or authorize execution.

## D-069: The alpha fixture uses TypeScript Module Boundaries guidance

- **Decision:** Replace the fixture's Pure TypeScript Formatter skill with a
  TypeScript Module Boundaries skill, still supplied only to the
  `src/account-label.ts` File Brief.
- **Reason:** Formatting and basic style belong to deterministic linting. The
  former skill also repeated the prompt and Contract. The replacement adds
  distinct TypeScript behavior: type-only imports, domain-type ownership,
  side-effect-free module initialization, no barrel or runtime dependency, and
  an exact Contract-shaped public export surface.
- **Integrity:** The skill content, authoring procedure, source binding, and
  compiler-input revision receive new immutable bytes and identities. The
  Coding Profile and `score.compilation-bundle@0.1.0-alpha.1` wire schema do not
  change.
- **Scope:** This changes fixture guidance and resulting digests only. It does
  not approve the Plan, export an Agent Package, or execute an Agent.

## D-070: The local Runner uses approval-gated SQLite Jobs and Effect v4 workers

- **Status:** The explicit-export-only candidate handoff is superseded by D-075.
  D-086 supersedes the per-Job OpenCode server ownership. The queue, per-Job
  workspace and session isolation, compatibility, and recovery decisions remain
  in force.

- **Decision:** The first post-export Runner experiment stores operational Runs,
  Jobs, and Attempts in a separate `runner.db`. It uses exactly pinned Effect v4
  packages for typed services, scoped resources, and a rolling worker pool, while
  `runner.db` remains the durable queue source of truth.
- **Approval gate:** Enqueue first obtains SCORE's complete approved-pass export.
  An unapproved or incomplete Change Plan creates no Run or Job. Each accepted
  enqueue freezes the already approved Agent Package bytes and digests inside one
  Runner transaction.
- **Concurrency:** File order is display and tie-breaking data only. Jobs have no
  execution dependency unless a future plan explicitly introduces one. The
  configured concurrency is a ceiling: each free worker atomically claims the
  next pending Job without a fixed batch barrier. One ordinary Job failure does
  not cancel its siblings.
- **Crash rule:** A claimed external Attempt is never automatically redelivered.
  If the Runner stops before recording its result, later work requires an
  explicit recovery action that records the Attempt and Job as
  `needs_attention`; untouched pending Jobs may then continue.
- **OpenCode resources:** Every Job receives a disposable workspace, client, and
  session. D-086 makes the disposable server a Run resource. The real repository
  and `score.db` are absent. OpenCode receives only the approved Agent Input, and
  the Runner rejects any path effect outside the assigned target.
- **OpenCode compatibility:** The first adapter supports only `create` and
  `replace` packages using the exact alpha protocol, Coding Profile, single-file
  Capability, and Allowed Change shape. Incompatible approved packages fail
  before any Run or Job is written. SDK and CLI versions are pinned and recorded.
- **Disposable runtime state:** Workspaces use an OS-temporary root outside the
  repository. OpenCode config, data, cache, and state directories are isolated;
  the session is deleted, the server's exit is awaited, and then the temporary
  directory is removed.
- **Provider access:** Before selection, model discovery may copy OpenCode's
  credential index into disposable isolated state solely so OpenCode can report
  the models available to that account. It never displays credential content
  and deletes that state after discovery. Every Job copies only the selected
  provider's credential and explicitly supplied provider overlay. Neither phase
  inherits global instructions, plugins, MCP servers, or ambient project config.
- **Candidate retention:** Successful candidate bytes remain durable in
  `runner.db`. D-075 defines when a complete verified set is applied to the
  repository; explicit export remains available for diagnosis.
- **Scope:** `runner.db`, Effect, OpenCode sessions, candidates, provider/model
  choices, and recovery policy are integration mechanics, not SCORE Core data or
  claims that a candidate is correct or accepted.

## D-071: Guided start is the default and model catalogs are adapter-owned

- **Status:** The automatic-export clause is superseded by D-074. The guided
  selection, approval, concurrency, and adapter-owned model decisions remain in
  force. D-080 extends the model seam with adapter-owned optional variants.
- **Decision:** `npm run runner -- start` is the normal human entry point. It
  selects a reviewed Change Plan by title, shows its files, offers the selected
  Runtime Adapter's available models, asks one final confirmation, runs with a
  default concurrency ceiling of five, and originally exported candidates
  automatically.
- **Approval:** For a clean Plan, the final confirmation records the exact Plan
  Approval before enqueue. The user is not asked to enter an identifier,
  authority, or rationale. Internal identity, digest binding, timestamp, and
  local approval provenance remain recorded. Plans with warnings still require
  an explicit review and waiver rationale outside this fast path.
- **Model seam:** Each Runtime Adapter owns model discovery and maps one opaque
  selection key into its internal run configuration. The generic Runner sees
  only a readable normalized catalog and never constructs provider/model IDs.
  OpenCode uses its pinned native model listing; Cursor should later use
  Cursor's native listing or SDK.
- **Reason:** Available models depend on the runtime, account, credentials, and
  current provider configuration. A global SCORE catalog would be stale and
  would leak one Runtime Adapter's provider mechanics into every other adapter.
- **Automation:** Explicit pass, provider, model, and concurrency flags remain a
  low-level noninteractive interface. They are not the normal approval or model
  selection experience.

## D-072: Planned declarations have one owner and explicit consumers

- **Decision:** `score.compilation-bundle@0.1.0-alpha.2` adds a Declaration
  Registry. Every structured Planned Declaration has exactly one owning File
  Brief and may name zero or more different File Briefs as read-only consumers.
- **Projection:** An Agent Input receives the complete definitions it owns and
  only the declarations it explicitly consumes. A consumed declaration includes
  its owning target and deterministic import path. The whole multi-file Contract
  is not repeated as implementation context for every agent.
- **Execution:** After the Runtime Adapter returns a target, the Runner parses
  TypeScript deterministically and rejects syntax errors, missing or unexpected
  exports, name or kind mismatches, interface-shape mismatches, function-signature
  mismatches, locally redefined consumed declarations, wrong imports, and a
  planned exact return-expression mismatch. A rejected candidate is a failed Job
  and is never exported.
- **Concurrency:** Ownership is definition data established before enqueue. It
  is not a queue claim, execution lock, or ordering rule; independent File Briefs
  remain safe to run concurrently.
- **Scope:** This validates declared module boundaries and exact fixture
  structure. It does not claim general semantic correctness or accept/apply a
  candidate to the source repository.

## D-073: Project Settings resolve module paths before execution

- **Status:** Project Settings binding and deterministic import resolution remain
  in force. D-079 supersedes the complete-set TypeScript compiler gate.
- **Decision:** Each Source Snapshot owns one immutable Project Settings value.
  The first supported forms are TypeScript `NodeNext`/`NodeNext` and
  `ESNext`/`Bundler`, with compiler version, package type, target, strictness,
  library-check policy, and ambient type packages recorded explicitly.
- **Binding:** The Source Snapshot digest covers its ordered file manifest and
  Project Settings digest. Run Rules repeat that settings digest, while every
  self-contained Agent Input receives the same normalized settings value.
- **Resolution:** One deterministic module resolves a consumed declaration's
  owner path for the consuming file. NodeNext ESM maps TypeScript source
  extensions to emitted JavaScript extensions; Bundler resolution keeps the
  relative path extensionless. Unsupported or unknown settings fail instead of
  falling back to ambient configuration.
- **Seam:** The Plan Compiler and materializer own resolution. Runtime Adapters
  deliver the frozen result unchanged and neither inspect `tsconfig.json` nor
  invent provider-specific project context.
- **Verification (superseded by D-079):** After all Jobs succeed, the Runner type-checks the complete
  candidate set with the exact pinned TypeScript compiler and frozen settings
  before export. Partial Runs may export successful files for diagnosis without
  pretending that an incomplete set passed project verification.
- **Reason:** Shared project facts should be stored once, while each File Brief
  receives only their deterministic consequences. This keeps isolated agents
  consistent without copying repository discovery into every execution.

## D-074: Running and materializing candidates are separate actions

- **Status:** Superseded by D-075 for the normal `start` and `work` paths. The
  disposable per-Agent workspace and explicit diagnostic export remain in
  force.

- **Decision:** `npm run runner -- start` persists successful candidate bytes in
  `runner.db` but never exports or applies them. The guided flow reports that no
  candidate files were materialized and the source tree was not changed. By
  default, the durable Runner database lives in platform application storage,
  not beneath the invoking project's current working directory.
- **Explicit materialization:** `export-candidates` requires both a Run identity
  and an explicit destination. It has no destination derived from the CLI's
  current working directory. Applying candidates to a source tree remains a
  separate, future user-approved action.
- **Workspace boundary:** The CLI process stays in its invoking directory only
  to resolve the alpha's configured SCORE definition database. Every file Agent
  runs with an OS-temporary workspace as its own working directory; the adapter
  seeds only the assigned target, reads the candidate back, and removes that
  workspace.
- **Reason:** Agent execution, durable candidate retention, review export, and
  source-tree mutation are different authorities. Finishing a Run must not
  create an unexpected candidate or Runner-state directory in the invoking
  project.

## D-075: A complete verified Run applies through one guarded repository binding

- **Status:** Project discovery and guided approval ordering are refined by
  D-076 and D-077. D-079 supersedes synthetic complete-set TypeScript
  verification. D-085 supersedes original Source Snapshot equality for guided
  execution. Per-Run freezing, integrity checks, target race detection, and
  guarded application remain in force.

- **Decision:** The normal guided and noninteractive `start` paths execute all
  Jobs, verify the complete candidate set, and apply every declared `create` or
  `replace` target to the real project directory. In a Git-backed project, a
  successful Run leaves ordinary uncommitted changes for human review. It does
  not stage, commit, format, lint, or run user project commands.
- **Repository binding:** Before enqueue, the Runner resolves the project root
  from `--repo` or the invoking directory. The Run freezes that absolute root, the
  approved Source Snapshot ID and digest, and the complete Source Snapshot
  manifest in `runner.db`. These values are runtime data; SCORE and the Plan
  Compiler continue to own only repository-relative target paths.
- **Human confirmation:** Guided start displays the resolved repository root and
  exact target files before its one confirmation. That confirmation authorizes
  Plan Approval when needed, agent execution, complete-set verification, and
  application to those targets.
- **Drift gate:** The visible repository file set and every file digest must
  equal the approved Source Snapshot before enqueue and again immediately before
  application. A dirty repository is allowed only when that exact state was
  captured in the Source Snapshot. Any later addition, deletion, or content
  change blocks application and creates no partial candidate update.
- **Verification (synthetic compiler portion superseded by D-079):** Every Job must succeed. The Runner rechecks stored candidate
  and package digests, overlays candidates on the verified Source Snapshot, and
  type-checks the complete TypeScript file set with the frozen Project Settings.
  A partial or invalid Run applies nothing.
- **Application:** Candidate files are staged on the repository filesystem, then
  all approved targets are installed as one application operation. A
  synchronous write failure attempts to restore replaced files and remove
  created files before recording `apply_failed`. If restoration is obstructed,
  the Runner preserves the staging directory and original backups, reports their
  recovery path, and fails closed for manual recovery. An interrupted `applying`
  state is likewise ambiguous and is never silently retried.
- **Workspace boundary:** Each File Agent still runs in its own OS-temporary,
  single-target workspace. The real repository is read only by deterministic
  preflight and verification code until the complete set is ready; agents never
  receive or navigate the repository.
- **Diagnostic export:** `export-candidates` remains an explicit low-level tool
  for inspecting stored candidates in a fresh destination. It is not part of
  the normal successful flow and never applies to a repository.
- **Scope:** `delete` remains unsupported in the first application version.

## D-076: Repository binding is remembered locally and validated before approval

- **Status:** Root discovery is generalized beyond Git by D-077. The remembered
  local binding remains in force. D-085 changes guided validation to explicit
  confirmation of current target state and saves the reusable binding only
  after that confirmation.
- **Decision:** The normal human command is `npm run runner -- start` with no
  repository argument. The local Runner database remembers one canonical project
  root for each canonical SCORE database path. A first start verifies the
  resolved project root before saving it. A successful `--repo` override replaces
  that saved binding; a failed override leaves the prior binding untouched.
- **Boundary:** The reusable absolute path is machine-local Runner configuration
  and never enters portable `score.db` data or Agent Input. Every Run still
  copies its resolved root, Source Snapshot identity, digest, and manifest into
  immutable Run state.
- **Ordering:** Guided start resolves and validates the repository immediately
  after Plan selection, before model discovery. After the human confirms, it
  validates the same binding again before recording Plan Approval. Enqueue and
  final application retain their independent drift gates.
- **Failure:** A failed preflight creates no Plan Approval, Run, Job, Attempt, or
  source-file change. Normal CLI output summarizes missing, changed, occupied,
  and unexpected paths; `--verbose` exposes the complete deterministic finding
  list.
- **Reason:** Repository location is local runtime configuration that should be
  remembered, not repetitive human input or LLM-authored portable protocol data.
  Validation remains exact and deterministic while the common path stays one
  command.

## D-077: A target project does not require Git initialization

- **Status:** D-078 narrows normal preparation and execution checks to declared
  targets. D-085 makes their current confirmed state, rather than whole-project
  or original-snapshot equality, the guided execution boundary.
- **Decision:** SCORE binds and applies to an absolute project directory. Git is
  optional. When the selected path is inside a Git worktree, the containing Git
  root remains the project root. Otherwise the selected directory itself is the
  root. Explicit `--repo` paths and saved bindings follow the same rule.
- **Visibility:** Git-backed roots retain the tracked plus non-ignored untracked
  file view. A root without Git is enumerated recursively and deterministically
  in lexical order; `.git` metadata is excluded. Every other filesystem entry is
  part of drift detection, and expected targets must still be regular files with
  exact digests.
- **Safety:** The canonical real path is frozen in the Run and re-resolved at
  every existing gate. Supporting an unmanaged directory does not weaken Source
  Snapshot equality, target absence checks, candidate verification, or atomic
  application.
- **Reason:** Git provides useful discovery and review ergonomics but is not part
  of the SCORE execution contract. New projects must be runnable before their
  first `git init`.

## D-078: “Use SCORE” prepares one narrow reviewed slice

- **Status:** Supersedes D-063 and D-064 where they require a separate first
  specification approval, and supersedes the whole-project visibility and drift
  rules in D-075 through D-077. Their later human approval, isolated execution,
  remembered binding, and atomic application rules remain in force. D-079
  supersedes combined project verification after per-file execution. D-084
  supersedes title-based single-slice identity, and D-085 supersedes the guided
  requirement that targets still match their prepared state before a Run.
- **Entry point:** After the person and their existing capable LLM settle a small
  implementation slice, “use SCORE” authorizes preparation. The LLM submits one
  semantic Slice Draft through `prepareSlice`; it does not author protocol
  graphs, storage identifiers, digests, SQL, or execution configuration.
- **Preparation:** The host supplies the exact canonical current project
  directory. SCORE never widens a nested project to a Git root. It freezes only
  declared modify-target bytes, create-target absences, explicitly selected
  context, declarations, requirements, selected skill prompt text, and relevant
  immutable project settings.
- **Review:** A valid preparation creates or opens `.score/score.db` and writes a
  named immutable HTML/snapshot pair under `.score/reviews/`. Slice title is the
  human logical identity. Unchanged input reuses its revision; changed input
  under the same title creates `v2`, `v3`, and so on. Preparation stops at
  `review_ready` with no approval, Run, Job, Attempt, executor, candidate, or
  source-file change. SQLite remains authoritative if projection fails, but a
  prepared revision is not selectable until both named artifacts are published;
  rerunning the same input republishes the pair and records readiness.
- **Execution projection:** The CLI lists only the latest revision for each human
  title. Ready, active, failed, and implemented markers are derived from immutable
  Run and application history; an older implemented revision remains visible in
  the latest revision's status.
- **Conflict gate:** Before execution and immediately before atomic application,
  every declared `modify` target must still match its frozen bytes and every
  declared `create` target must still be absent. One target conflict blocks the
  complete set. SCORE does not enumerate, snapshot, retain, monitor, or reject
  changes to unrelated project files.
- **Git boundary:** Git is optional and used only for ordinary change visibility
  and an idempotent local `.score/` exclusion. It does not discover the project
  root or define conflict scope.

## D-079: SCORE stops after integrity-checked atomic candidate delivery

- **Supersedes:** The complete-set TypeScript compiler requirements in D-073,
  D-075, and D-078. Their Project Settings, per-file verification, repository
  binding, drift protection, and atomic application rules remain in force.
- **Decision:** SCORE coordinates independent per-file generation, retains the
  resulting candidate bytes, enforces SCORE-owned integrity and ownership
  checks, requires every planned Job to succeed, rechecks declared targets for
  drift, and atomically applies the complete candidate set as ordinary
  uncommitted changes. Normal application and diagnostic export do not create a
  synthetic combined TypeScript project.
- **Retained checks:** The Runtime Adapter must return the assigned target and
  must reject undeclared workspace changes. The Runner verifies candidate and
  package bytes and digests plus planned declaration ownership, exports,
  imports, signatures, and resolved module paths. Missing or failed Jobs,
  integrity failures, target drift, or application failures still apply
  nothing.
- **Project boundary:** SCORE does not type-check, test, build, lint, or otherwise
  verify the resulting project. Project Settings remain frozen inputs for
  authoring and deterministic per-file contract checks; they are not a promise
  that SCORE can reproduce the project's dependency or toolchain environment.
  The user, planning workflow, or a later agent runs project-owned checks in the
  real project after candidate delivery.
- **Workspace boundary:** Disposable single-target workspaces remain private
  Runtime Adapter containment. They are not assembled into a combined project,
  and this decision adds no optional project-verification mode.
- **User-facing claim:** A successful Runner reports that all candidates were
  generated and applied and explicitly states that project verification was not
  run. It never implies that compilation, tests, builds, or linting passed.
- **Reason:** The synthetic `/score-candidate` filesystem could reproduce
  selected compiler options but not real dependency resolution. It falsely
  rejected valid React candidates because their installed React, Vitest, and
  Testing Library dependencies were absent from the fabricated environment.
  Deterministic delivery is valuable; a partial reimplementation of the target
  project's toolchain is not.

## D-080: Runtime Adapters own optional model variants

- **Decision:** A Runtime Adapter's normalized model catalog may expose an
  ordered set of opaque variant identifiers with readable labels. One optional
  variant is selected as execution configuration for a Run and forwarded to
  every Job. SCORE does not define a closed reasoning-level enum, infer variant
  membership from model names, or expose provider-specific reasoning settings.
  Adapter-owned presentation labels may humanize an advertised ID without
  changing or interpreting the persisted value.
- **OpenCode discovery:** The pinned OpenCode Adapter reads each model's current
  variants from the typed SDK `provider.list()` response inside the existing
  isolated discovery environment. Built-in and user-defined IDs receive the
  same treatment.
- **Selection:** An explicit `--variant` wins. Otherwise guided mode asks only
  when the chosen model advertises at least one variant and offers the runtime
  default first. Omission stores no explicit variant and causes the adapter to
  omit the field from runtime requests. An explicit ID absent from the selected
  model's catalog fails before confirmation, Plan Approval, Run creation, or
  agent execution.
- **OpenCode forwarding:** A selected ID is included in both OpenCode session
  creation and the prompt request because those are the variant-bearing seams
  in the pinned SDK. The same ID is used for every per-file session in the Run.
- **Storage:** `runner_runs.variant_id` is nullable. Existing Runner databases
  gain the column through an additive migration, and historical Runs therefore
  read as having no explicit variant.
- **Protocol boundary:** Variant selection does not modify the Change Plan,
  Agent Package, Plan Approval, or package digest. Future Runtime Adapters may
  expose different IDs or no variants without changing SCORE Core.

## D-081: Guided Runs may recreate explicitly confirmed missing replacements

- **Status:** Superseded by D-085 for guided execution. Historical strict and
  noninteractive behavior remains as described by the later decision.
- **Supersedes:** D-075 through D-078 only where they require every planned
  replacement to remain present after review. Their protection against changed
  replacements, occupied creation targets, repository rebinding, undeclared
  paths, partial application, and unrelated-file monitoring remains unchanged.
- **Decision:** Guided start may classify a planned `replace` target as
  recoverable when its frozen Source Snapshot file is absent. The existing final
  confirmation displays every such path as a file SCORE will recreate. No
  additional waiver prompt is introduced.
- **Run binding:** Confirmation authorizes only the exact missing-path set shown.
  The Runner stores it as local per-Run execution configuration. It does not
  modify the Change Plan, Agent Package, Plan Approval, frozen source bytes, or
  any digest. Existing Runner databases receive an additive table, and
  historical Runs read as accepting no missing replacements.
- **Race boundary:** The guided flow redetects the missing-path set before Plan
  Approval and Run creation. Enqueue and final application independently require
  every accepted path to remain absent. A path that reappears is a repository
  conflict and causes the complete candidate set to apply nothing.
- **Atomicity:** A successful candidate for an accepted missing replacement is
  installed with the complete set. If a later installation fails, rollback
  removes the recreated path. SCORE never needs the deleted base file in the
  real repository because the approved package still owns its frozen input.
- **Strict cases:** Missing replacements remain errors in noninteractive and
  low-level flows unless a future explicit interface defines equivalent human
  authorization. Changed or non-regular replacements and occupied `create`
  targets are never inferred as recoverable.
- **Reason:** Deleting generated or replaceable files outside SCORE is ordinary
  project activity, not evidence that SCORE should overwrite whatever may later
  appear at that path. Binding the visible absence to one confirmed Run preserves
  the human workflow while retaining deterministic overwrite protection.

## D-082: OpenCode discovery offers only connected providers

- **Refines:** D-071 and D-080. Model and variant discovery remain adapter-owned,
  but OpenCode catalog membership now distinguishes known providers from
  providers available to the current isolated runtime configuration.
- **Decision:** The OpenCode Adapter reads both `all` and `connected` from the
  pinned SDK's typed `provider.list()` response. It contributes models only from
  provider records whose IDs occur in `connected`. It does not treat appearance
  in OpenCode's broader known-model catalog as evidence that credentials or
  provider configuration are available.
- **Failure boundary:** If connected providers contribute no models, discovery
  fails before confirmation, Plan Approval, Run creation, or agent invocation.
  SCORE does not offer a model and wait for every per-file Job to discover that
  its provider is unavailable.
- **Presentation:** Guided model choices retain the adapter-provided provider
  label, and confirmation plus execution output display it with the model name.
  This disambiguates identical model names exposed by multiple connected
  providers without interpreting provider-specific configuration in SCORE.
- **Isolation:** Discovery continues to use disposable OpenCode config, data,
  cache, and state directories with the configured credential index and provider
  definitions. OpenCode therefore owns the meaning of `connected`; SCORE only
  filters by the opaque provider IDs returned in the same response.
- **Reason:** OpenCode's `all` catalog can include providers such as AnyAPI even
  when the user has no connection for them. Offering those entries creates Runs
  whose Jobs all fail before producing candidates and makes a provider failure
  look like a per-file implementation failure.

## D-083: OpenCode prompts use asynchronous admission and terminal monitoring

- **Refines:** D-068, D-070, and D-080. Their isolated per-Job workspace,
  session, provider/model/variant forwarding, and awaited cleanup boundaries
  remain in force. D-086 later moves only server ownership to the Run. This
  decision replaces only the blocking prompt transport used by the first
  implementation.
- **Admission:** The adapter assigns the prompt an OpenCode-compatible message
  ID and submits the unchanged Agent Input through the pinned SDK's
  `promptAsync` API. The request returns immediately. Until that exact user
  message appears, an empty message list or absent status means only that
  admission is not yet visible.
- **Terminal result:** The adapter polls the typed session-status and
  session-message APIs for the fresh session. Success requires a completed,
  terminal assistant response whose parent is the assigned prompt message. A
  tool-call turn is not terminal. A typed assistant error for that prompt fails
  immediately, including while status is busy. A terminal response wins over a
  stale busy status. After admission is visible, confirmed idle without a
  terminal response, an unknown state, or an incomplete response fails closed
  as malformed. One idle observation is allowed to settle because OpenCode
  persists the user message immediately before marking the session busy.
- **Deadlines and cancellation:** Server startup retains its independent
  10-second default. Model execution has an adapter-owned 30-minute default
  deadline that tests can shorten without changing approved protocol data.
  Deadline expiry is a specific adapter failure. Runner/Effect interruption is
  cancellation. During active worker execution the CLI translates `SIGINT` and
  `SIGTERM` into that interruption. Both abort active sessions before session
  deletion, awaited Run-server shutdown, and workspace removal; an interrupted
  Attempt retains the existing explicit-recovery rule.
- **Errors:** Provider authentication and API/rate-limit errors retain their
  safe typed category, message, status, and retryability. Response headers,
  bodies, metadata, credentials, and request secrets are not rendered. Local
  SDK and server-process failures retain nested transport causes rather than
  collapsing to `fetch failed`. Terminal state is never inferred from elapsed
  time or scraped logs.
- **Persistence and protocol boundary:** Monitoring remains inside one adapter
  invocation. It adds no Runner database migration and does not modify the
  Change Plan, Agent Package, Plan Approval, package digest, per-file isolation,
  atomic application rule, or project-verification boundary.
- **Reason:** The synchronous SDK prompt held one response open until model
  completion and therefore inherited Node/Undici's roughly five-minute response
  header ceiling. Concurrent slow or queued Jobs could produce valid work yet
  fail near that accidental transport limit with only `fetch failed`.

## D-084: Editable slice drafts form an applied-revision dependency graph

- **Supersedes:** D-078 where it treats one submitted draft and its title as the
  logical slice identity. It also supersedes only D-079's requirement to print
  an unsolicited project-verification disclaimer after delivery. D-079's
  project boundary and prohibition on claiming verification remain unchanged.
- **Authoring source:** A project may contain several editable Slice Draft JSON
  files under `score/slices/`. Every draft has a stable, human-authored
  `slice_id`; its title, objective, requirements, files, and ordering may be
  revised indefinitely. The JSON is authoring input, not mutable protocol data.
  Tests have no special status and are target files only when the human accepted
  them as part of that slice's file structure.
- **Immutable preparation:** Each distinct draft or resolved predecessor set
  creates a new prepared revision for the same `slice_id`. Prepared definitions,
  reviews, approvals, and prior execution history remain append-only. A title
  edit changes display copy, not identity. Historical prepared rows migrate
  with their existing slug as a stable legacy slice ID and no dependencies.
- **Ordering:** A draft's optional `after` field names prerequisite slice IDs.
  Deterministic Plan Intake uses Effect's directed Graph to reject duplicate
  IDs, missing nodes, self-edges, and cycles and to obtain prerequisite-first
  order. The graph coordinates preparation; it does not become one combined
  Change Plan or one combined execution workspace.
- **Applied boundary:** A prerequisite is complete only when the Runner records
  a successful Run whose complete candidate set was atomically applied. It is
  not complete because a review exists, agents generated candidates, or project
  tests passed. A dependent prepared revision records the exact prerequisite
  slice ID, revision, Change Plan, and applied Run and freezes the repository
  only after that state exists.
- **Shared files:** Ordered slices may intentionally update the same path. A
  later slice remains an editable waiting draft until its predecessors apply,
  then prepares against the actual current bytes. This avoids treating planned
  sequential work as a conflict or compiling future slices against imagined
  outputs.
- **Experience:** `prepareSlices()` reads the authored directory and reports
  each slice as review ready, implemented, or waiting for named predecessors.
  The normal Runner success output states only that all candidates were
  generated and applied. It neither promises project verification nor adds a
  disclaimer for work SCORE never claimed to perform.

## D-085: Guided confirmation binds current target state instead of requiring the original repository state

- **Supersedes:** D-075, D-076, D-078, and D-081 only where they make equality
  with the approved Source Snapshot an eligibility gate for normal guided
  execution or save a reusable guided repository binding before human
  confirmation.
  Their frozen package context, canonical root, per-file isolation, integrity
  checks, target-only race detection, and atomic application boundaries remain
  in force. Noninteractive and low-level starts remain strict.
- **Decision:** Guided start safely inspects the canonical repository root and
  every planned target immediately after Plan selection. A target may be a
  regular file or absent. Differences from the Plan's original Source Snapshot
  are displayed as warnings in the existing confirmation instead of blocking
  model discovery or execution.
- **Human authority:** The confirmation displays the exact root and target list.
  Continuing authorizes SCORE to replace or recreate those target files from the
  complete generated candidate set. Changed replacements, missing replacements,
  and occupied creation targets therefore share one rule instead of separate
  recovery cases. Symbolic links, non-regular targets, unsafe paths, and an
  unavailable root remain hard failures.
- **Run binding:** The Runner stores each confirmed target as either absent or a
  regular-file content digest in nullable per-Run execution state. Historical
  Runs have no confirmed target snapshot and retain their prior strict behavior.
  The reusable local repository binding is updated only after confirmation.
  The Source Snapshot, Change Plan, Agent Packages, Plan Approval, and package
  digests are not modified; agents still receive the approved frozen context.
- **Race and atomicity:** Guided start recaptures target state after confirmation
  and before approval. Enqueue and complete-set application independently
  require the same target snapshot. If any target changes while agents run,
  nothing is applied. Once application begins, present files are backed up,
  absent files are created, and any synchronous failure restores the complete
  confirmed state or reports explicit recovery needs. Unrelated files are not
  monitored.
- **Reason:** The Source Snapshot explains and reproduces what agents were told;
  it does not need to veto an intentional rerun after the user has reviewed the
  current destination. One visible confirmation plus target-only compare-and-
  swap protection preserves the human safety boundary without requiring
  previous-Run recognition or exact-output matching.

## D-086: One disposable OpenCode server owns all isolated sessions in a Run

- **Supersedes:** D-070 and D-083 only where they assign one OpenCode server to
  every Job. Their per-Job workspace, client, session, Agent Input, target-only
  permission, cleanup, recovery, integrity, and atomic-application rules remain
  unchanged.
- **Run resource:** The live Runtime Adapter opens one `withRun` scope around the
  Runner worker pool. The first claimed Job lazily starts one pinned `opencode
  serve --pure` process with isolated config, data, cache, state, the selected
  provider credential, and the selected provider overlay. The server process
  works from its own disposable control directory, not from any Job workspace.
- **Per-Job routing:** Every Job still receives a distinct disposable workspace
  containing only its assigned target state. It creates a distinct SDK client
  with that workspace as the client's `directory`, so the pinned SDK sends the
  encoded `x-opencode-directory` value on every request. OpenCode 1.18.14 loads
  and caches the corresponding instance by that exact directory. Every Job then
  creates, monitors, aborts when necessary, and deletes its own session.
- **Permissions:** The shared process configuration denies every capability by
  default. Each session appends only read and edit permission for its assigned
  relative target. Web access, shell access, subagents, external directories,
  ambient instructions, plugins, MCP servers, formatting, and LSP remain
  disabled. The Runner's independent workspace-diff and symbolic-link checks
  remain authoritative.
- **Concurrency and identity:** Up to the Run's configured worker ceiling may
  use the shared server concurrently. Sessions, Attempts, Agent Inputs, target
  files, and workspaces remain independent. Sharing the process does not create
  a combined project, combined context, shared conversation, or cross-file agent
  workspace. All Jobs retain the Run's one provider, model, variant, and pinned
  CLI version; a provider or CLI mismatch fails closed.
- **Lifetime:** The adapter awaits all session cleanup, then shuts down the
  shared server and removes its isolated state before the Runner finalizes the
  Run or considers complete-set application. Startup failure is retained for
  every waiting Job rather than starting competing replacement servers. Effect
  interruption still aborts active sessions and awaits the shared shutdown.
- **Reason:** OpenCode's server and pinned SDK natively support multiple clients
  routed by directory. A process per Job duplicated startup, configuration,
  credentials, caches, and local runtime pressure without strengthening SCORE's
  actual isolation contract. The Run-scoped module preserves the closed per-file
  execution model behind a smaller lifecycle interface.

## D-087: The experimental OpenCode adapter uses the V2 execution contract

- **Supersedes:** D-080's OpenCode-specific SDK discovery and dual-request
  variant-forwarding mechanics, D-082's V1 catalog response mechanics, D-083's
  `promptAsync`/status/message terminal monitoring and V1 error projection, and
  D-086's V1 directory-header, `--pure`, per-session permission, and SDK
  mechanics. D-080's adapter-owned opaque variant model and D-083's deadlines,
  cancellation, cleanup, secret-redaction, persistence, and protocol boundaries
  remain unchanged, as do the one-server-per-Run resource, independent per-Job
  workspaces and sessions, frozen Agent Input, integrity checks, and atomic
  application rules.
- **Pinned runtime:** The adapter pins `@opencode-ai/cli` and the V2 HTTP
  contract to `0.0.0-next-17111`. It starts the project-local `opencode2 serve`
  directly on loopback with an ephemeral port, authenticates with the generated
  server password, and owns shutdown. The published beta client package at this
  pin has unresolved extensionless ESM imports under Node, so SCORE uses a small
  typed HTTP boundary for the same V2 endpoints instead of adding another
  execution harness. The beta pin must move only with matching contract tests.
- **Isolation:** The shared server retains disposable config, data, cache,
  state, database, and home paths. Project config discovery is disabled, global
  `.claude/skills` and `.agents/skills` are outside the private home, and
  inherited V2 server-password controls are removed. Each Job creates a fresh
  V2 session whose `location.directory` is its one-file
  disposable workspace. V2 has no per-session permission override, so the
  SCORE-only agent denies all actions and then permits read/edit within that
  Location; external directories, shell, subagents, skills, web access,
  questions, plugins, MCP, formatting, and LSP remain denied. The existing
  complete workspace scan rejects every undeclared entry and symbolic link, so
  the effective output boundary remains exactly the assigned target. That agent
  also receives one deterministic SCORE system instruction: treat the unchanged
  Agent Input as implementation work for the assigned target, make the target
  file the deliverable rather than returning prose or a code block, and do not
  run project checks. This is static execution framing, not project-specific
  prompt reconstruction or additional product context.
- **Execution result:** The adapter submits the unchanged Agent Input with a
  fresh V2 message ID, requires the matching admission receipt, calls
  `session.wait`, and then reads every page of projected messages. The pinned preview starts
  its event bus without durable-event persistence, so its experimental session
  log exposes a watermark but no replayable execution events and cannot be an
  honest success gate. Success instead requires native wait completion, no
  assistant/provider error or explicit error finish, no failed or unsettled
  tool, a completed assistant turn, and the unchanged candidate-integrity
  checks. Other assistant `finish` values are not independently authoritative:
  `finish: "unknown"` is acceptable behind those observable facts.
- **Catalog and credentials:** Discovery joins V2 provider and model endpoint
  results for the disposable Location, offers only enabled models
  from active providers, and preserves advertised opaque variant IDs. The
  pinned preview marks its legacy credential migration complete without
  importing API-key entries, so SCORE connects `type: "api"` entries through
  V2's private `connect/key` endpoint and waits for the asynchronous catalog
  refresh. Execution copies and connects only the selected entry. Other legacy
  credential types are not claimed supported by this bridge. No global V2
  daemon or credential database is shared.
- **Error projection:** Projected assistant errors preserve the safe type,
  message, and status when V2 supplies them. This preview does not expose a
  reliable retryability field, so the adapter does not invent one. Response
  headers, raw bodies, metadata, credentials, and request secrets remain
  excluded from diagnostics.
- **Bounds:** Server startup, post-start model readiness, per-session
  health/creation, prompt execution, paginated message reads, interrupt/delete
  cleanup, and owned process shutdown are all abortable and bounded. A stalled
  V2 endpoint therefore becomes a classified adapter failure instead of an
  indefinitely active Job.
- **Compatibility:** Adapter version fields remain opaque strings, so no Runner
  database or protocol migration is required. Historical Runs pinned to V1
  remain historical; attempting to execute one with the V2 binary fails the
  existing version check. A fresh Run records the V2 pin.
- **Reason:** The V1 runtime could successfully edit a target and become idle
  after persisting a completed assistant turn with `finish: "unknown"`, while
  SCORE correctly rejected that ambiguous finish and atomically applied
  nothing. V2's native admission and wait APIs remove the V1 status-polling
  race. Combined with projected message/tool failures and SCORE's unchanged
  candidate boundary, they permit the completed-unknown case without treating
  the preview's non-persisted event log as stronger evidence than it is.

## D-088: Declarations are immutable documented text, not parsed source contracts

- **Supersedes:** D-072's structured declaration kinds and generated-source
  verification; D-073's normalized Project Settings, inferred module paths, and
  per-file compiler checks; D-078's preparation of relevant Project Settings;
  and D-079's retained export, import, signature, and resolved-module-path
  checks. The one-owner and explicit-consumer relationships, frozen Agent
  Inputs, Runtime Adapter containment, package and candidate integrity, target
  drift protection, complete-Run requirement, and atomic application remain in
  force.
- **Documented declaration:** Each authored declaration contains exactly a
  stable `name`, exact `declaration` text, and concise `description`. The text is
  ordinary immutable agent context. SCORE validates only the surrounding data
  shape and ownership graph, then stores, reviews, digests, and routes those
  exact strings without parsing, normalizing, classifying, or reserializing
  them.
- **Routing:** Every declaration still has one owning File Brief and zero or
  more explicit same-slice consumers. Owners receive their documented
  declarations. Consumers receive only the documented declarations they name.
  Supporting declarations, exact import statements, binding forms, prop names,
  call arguments, and caller-observable behavior must be written explicitly in
  the Slice Draft's declaration text, description, task, requirements, or
  constraints. SCORE does not infer a declaration closure or import path.
- **No project environment:** Preparation does not parse `tsconfig.json`,
  `package.json`, provider source, candidate source, or dependency metadata to
  reproduce a TypeScript environment. Project Settings are no longer Source
  Snapshot identity or Agent Input. SCORE creates no TypeScript `Program`,
  synthetic project, declaration file, peer-candidate workspace, or dependency
  installation.
- **Opaque candidates:** Candidate source is an opaque single-target artifact.
  SCORE does not use Babel, an AST, TypeScript source parsing, typechecking,
  export or signature matching, import inspection, local-redefinition rules,
  call-site analysis, linting, tests, builds, or generated-code execution as a
  gate. It continues to require the assigned target, reject undeclared workspace
  changes, preserve exact bytes and digests, require every Job, recheck confirmed
  target state, and apply the complete set atomically as unstaged changes.
- **Truthful result:** Successful delivery means only that every candidate was
  generated, integrity-checked, and applied. The natural-language description
  and generated behavior are not deterministically verified. Typechecking,
  builds, tests, linting, browser review, and other acceptance work happen after
  application in the real project.
- **Compatibility:** This is a breaking alpha protocol boundary. Previously
  prepared definitions and Runs remain historical evidence; they are not
  silently reinterpreted under the text-only contract. Work intended for the
  new Runner semantics must be prepared and approved again. Compilation Bundle,
  Coding Profile, compiler-input packet, Agent Input, and Plan Review advance to
  `0.1.0-alpha.4`; Approved Pass Export advances to `0.1.0-alpha.5`. Older
  exports are rejected before Run creation. No legacy Babel or TypeScript
  verifier is retained as a compatibility path.
- **Reason:** The parser rejected useful TypeScript surface forms, duplicated
  responsibilities already owned by the real project, and could imply stronger
  correctness than SCORE established. SCORE's useful deterministic boundary is
  context preparation and exact delivery, while the isolated agent needs rich,
  explicit text more than a partial source-language model.

## D-089: Runner observability is a dashboard and flight recorder, never a pilot

- **Preserves:** D-070's durable queue and explicit recovery, D-075's guarded
  complete-set application, D-079 and D-088's project-verification boundary,
  D-083 and D-087's terminal execution rules, and D-086's Run-scoped server with
  isolated per-Job sessions and workspaces.
- **Authoritative lifecycle:** The Runner owns the fixed per-file stages
  `waiting`, `starting`, `candidate ready`, `succeeded`, `failed`, and
  `needs attention`, plus the whole-Run integrity and application phases.
  `starting` follows the committed Attempt claim; terminal stages follow their
  existing required transactions. These writes retain their fail-closed role.
- **Adapter observations:** A Runtime Adapter may optionally report only the
  session identity, matching Agent Input admission, and the actual start of
  assigned-output inspection. The Runner normalizes admitted work as
  `Agent working` and real inspection as `checking output`. The observer is
  adapter-neutral and best-effort; missing reports remain missing, and its
  failure cannot change execution.
- **One read model:** `runner.db` stores the current sanitized Run and latest
  Attempt observation with identities, fixed stages, source, timestamps,
  monotonic revision, stable failure category and category-derived message, safe
  allowlisted terminal outcome, the last nonterminal stage before failure, and
  an honest assigned-target state. `status` preserves its existing JSON fields
  and adds this same read model for historical inspection. No generic event table
  or second operational database is introduced.
- **Failure evidence:** Known failed-session identities and safely readable
  rejected target digests survive disposable-runtime cleanup. Raw rejected bytes
  are not copied automatically because a finite secret denylist cannot establish
  that arbitrary source text is credential-free. Raw diagnostic content never
  enters successful candidate columns, cannot satisfy a Job, and is never
  eligible for application. Whole-Run integrity and
  application failures stay on the Run rather than being copied to every file.
  The read model reports files as applied only after the full transaction
  succeeds, reports false only before application begins, and uses unknown while
  application is active or failed because rollback may require manual recovery.
- **Rendering:** A replaceable renderer consumes only the sanitized read model.
  Interactive terminals repaint observations immediately and animate one
  Run-level liveness marker at 100 ms while the Run is active. The animation
  proves only that the local Runner process is alive; File markers and persisted
  stage text stay exact and static. Non-interactive output is append-only and
  retains a five-second factual heartbeat without animation frames. `TERM=dumb`,
  CI, and `SCORE_REDUCED_MOTION=1` disable animation. Untrusted labels and paths
  are projected into bounded single-line terminal-safe text without changing
  durable JSON. Renderer errors cannot fail a Job or prevent application.
- **Privacy:** SCORE omits credentials, authorization headers, raw response
  bodies, private provider metadata, hidden reasoning, unrestricted transcripts,
  and ambient OpenCode data. It references the existing frozen Agent Input
  digest instead of retaining another prompt copy. Serialized additive schema
  migration replaces legacy free-form failure text, removes unsafe terminal
  names and runtime-session IDs, and clears legacy rejected-output paths before
  recording its privacy-version marker.
- **Non-goals:** This decision adds no retry, semantic source verification,
  synthetic project, project check, provider event log, event-sourcing system,
  OpenTelemetry deployment, third-party task runner, or model-prose stream.
- **Reason:** A slow healthy Agent previously looked abandoned, while failed
  sessions and workspaces could disappear before SCORE retained enough bounded
  evidence to explain the outcome. Current-state observations and sanitized
  diagnostic evidence make the existing execution contract reviewable without
  granting observability any operational authority.

## D-090: Agent-managed Changes and durable Slices share one preparation contract

- **Supersedes:** D-067 only where Change Plan is preferred product language,
  D-078 where “use SCORE” necessarily authors a Slice, and D-084 only where all
  reviewed work requires durable Slice identity. Their immutable preparation,
  explicit context, Slice revision and dependency graph, human gate, isolated
  File Agents, and complete-set application rules remain unchanged. Historical
  decisions retain their accepted wording.
- **Change:** A Change is agent-managed logical coding work. One revision may
  contain one File Brief or several coordinated File Briefs. Changing its
  objective, requirements, files, documented declarations, context, skills, or
  constraints creates an immutable superseding revision rather than mutating a
  prior review, decision, Agent Package, or execution record.
- **Slice:** A Slice uses the same exact semantic primitives and downstream
  lifecycle as a Change. It additionally provides durable project-authored
  feature identity through editable `score/slices/<slice-id>.json` source and
  may declare applied-revision dependencies through `after`. File count does
  not distinguish a Change from a Slice; durable identity and dependencies do.
- **Scope authority:** The authoring LLM chooses the complete reviewed scope:
  target files, operations, requirements, declaration owners and consumers,
  explicit context and purposes, skills, and constraints. SCORE validates,
  freezes, stores, renders, and later enforces that declared scope. It does not
  discover additional files or context, split or combine the work, or invent
  tests on the author's behalf.
- **Operations:** Current authored Changes and Slices support only `create` for
  an absent target and `modify` for a present target. `modify` compiles to the
  existing replace operation. Delete and rename remain unsupported and are not
  approximated through hidden multi-step work.
- **Agent interface:** The canonical non-interactive Change preparation command
  is `score change --input -`. The authoring LLM sends one structured document
  on standard input from the exact project directory. It does not simulate TTY
  file selection, approval, or execution, and it does not supply database
  paths, protocol identifiers, digests, models, providers, or Runner settings.
  A new Change omits `change_id`; SCORE returns its opaque `changeId`. A later
  revision resubmits the complete document with that exact value as
  `change_id`. An unknown supplied identity is rejected rather than silently
  creating a second Change. The retained Change namespace is disjoint from
  valid authored `slice_id` values, so one entity cannot impersonate the other.
- **Preparation boundary:** A valid Change or currently unblocked Slice writes
  its immutable records and named HTML Plan Review, then stops. Preparation
  records no Plan Approval, creates no Run, invokes no Runtime Adapter, produces
  no candidate, and applies no source change. Typed structural findings return
  to the authoring LLM; changing product meaning still returns to the person.
- **Shared lifecycle:** After explicit human review, the exact Change or Slice
  revision follows the existing Plan Decision, Plan Approval, Agent Package,
  Runner, target-drift, integrity, and complete-set application gates. All File
  Briefs in one revision form one atomic application unit: any failed Job or
  invalid candidate applies none of them.
- **Compatibility:** `SliceDraft`, `prepareSlice`, `prepareSlices`, Change Plan,
  Coding Pass, `passId`, existing schema identifiers, SQLite tables and columns,
  artifact paths, and digest-bearing bytes remain implementation compatibility
  names. New product copy and the Change command adapt to those seams rather
  than broadly renaming storage or silently reinterpreting historical records.
- **Non-goals:** This decision adds no multi-Change approval group, automatic
  dependency inference, multi-Slice Runner orchestration, delete or rename
  semantics, ambient repository access for File Agents, candidate reuse, or
  hidden preparation-to-execution shortcut.
- **Reason:** One-off work should not require permanent feature bookkeeping,
  while durable feature work still needs stable authored identity and applied
  dependencies. Sharing one semantic and safety contract avoids a second kind
  of File Brief, review, approval, or Runner path.

## D-091: Entity-aware review names specialize one canonical human gate

- **Preserves:** D-067's canonical Plan Review, Plan Decision, and Plan Approval
  language and D-090's shared Change and Slice preparation lifecycle.
- **Product names:** A prepared Change renders a **Change Review** and a prepared
  Slice renders a **Slice Review**. These labels identify the reviewed Coding
  Profile entity. They do not create new protocol objects, storage records,
  snapshot fields, Agent Input, or digest semantics.
- **Canonical gate:** Both presentations remain one canonical Plan Review and
  bind the same later Plan Decision and Plan Approval. The entity label cannot
  authorize execution, and preparation still records no decision or approval.
- **Generic compatibility:** Core Protocol discussion and render paths that do
  not know the Coding Profile entity continue to say **Plan Review**. Retained
  `publication_reviews` storage and historical artifact names remain
  compatibility identifiers rather than product-facing terminology.
- **Agent signal:** A successful `score change --input -` result remains
  `review_ready` and now includes `humanApprovalRequired: true`. Its `score
  start` next action begins the existing guided flow, where the human reviews
  the exact revision and gives final approval before SCORE creates a Run.
- **Reason:** Reviewers should see the concrete entity they are approving while
  integrations retain one stable human gate and one canonical protocol model.

## D-092: File-backed skills remain inside the project trust boundary

- **Decision:** A Change or Slice may select inline skill text or a canonical
  project-relative skill path. A file-backed skill must resolve to a regular,
  non-symlink file inside the canonical project root; absolute paths, traversal,
  symlinks, and non-regular files are rejected before SCORE writes state.
- **Privacy:** SCORE stores only the project-relative skill locator. It never
  persists the absolute project root in the review, snapshot, database, or
  Agent Input provenance.
- **External content:** Change and Slice JSON cannot import external skill
  files. Supporting them later requires a separate trusted configuration
  boundary rather than broadening the untrusted authoring document.
- **Reason:** A reviewed Change must not become a path-based file-exfiltration
  primitive or leak a user's local filesystem layout into durable artifacts.

## D-093: CLI output projects untrusted values through terminal-safe boundaries

- **Preserves:** D-089's sanitized Runner read model and replaceable progress
  renderer, D-071's guided human confirmation, and every immutable Plan Review,
  Plan Approval, Agent Package, Source Snapshot, adapter configuration, and
  repository binding.
- **Human-output boundary:** Every untrusted value displayed during guided
  approval or other human-facing Runner output uses one shared bounded,
  single-line terminal projection. This includes Change and Slice labels,
  objectives, File paths, runtime adapter, provider, model and variant labels
  and descriptions, repository roots, repository-drift and recovery values,
  list rows, completion summaries, verbose findings, generic errors, selection
  choices, completed prompt text, and the final confirmation.
- **Control handling:** The projection removes C0 and C1 controls, ESC control
  sequences and strings including CSI and OSC forms, Unicode format controls
  including bidirectional overrides and isolates, and injected line breaks. It
  collapses remaining whitespace and truncates overlong fields with a visible
  ellipsis so one value cannot create a forged terminal record or completed
  prompt.
- **Raw authority:** Projection never rewrites the selected plan, catalog model,
  variant, repository binding, drift finding, stored row, digest-bearing bytes,
  or value passed into Runner decisions. Durable and operational data remains
  exact; only terminal-facing copies are sanitized.
- **JSON output:** JSON stdout preserves the exact data model and remains
  parseable while escaping C1 controls, Unicode format controls, and Unicode
  line and paragraph separators as JSON Unicode escapes. Parsing recovers the
  original strings; this is a serialization projection, not data mutation.
- **Failure boundary:** An empty projected value receives an explicit
  unprintable-value placeholder. Terminal presentation still has no authority
  to approve, enqueue, alter, or apply work.
- **Reason:** CLI surfaces previously rendered reviewed, provider-supplied, and
  filesystem text directly, allowing control bytes or line breaks to imitate
  trusted UI state even though the durable data remained valid.
