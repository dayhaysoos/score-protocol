# SCORE Protocol Glossary

This file defines SCORE's canonical domain language. It is a glossary, not an
implementation specification. Terms in the final section are deliberately
deferred beyond the first alpha.

## Product intent and compilation

**Outcome Request**:
A source expression of the result a requester wants. It may be informal and is
not itself portable SCORE data.
_Avoid_: Prompt, job, task

**Accepted Specification**:
An immutable, explicitly approved statement of product meaning produced by
human and LLM deliberation.
_Avoid_: Outcome Request, Plan Manifest, compiler interpretation

**Accepted Requirement**:
An immutable, stably identified obligation within an Accepted Specification
that compilation must preserve.
_Avoid_: Contract, acceptance criterion, instruction

**Plan Compiler**:
The broad-context component that transforms an Accepted Specification and
declared source state into a complete, closed Plan Manifest. It may inspect
declared source during preparation to derive immutable evidence.
_Avoid_: Context Compiler, Agent, Runner, prompt renderer

**Compilation Procedure**:
A versioned, attributable instruction artifact that teaches a Plan Compiler
how to produce valid objects for a declared Profile.
_Avoid_: Agent skill, hidden system prompt, Profile

**Compiled Plan**:
One complete structured submission containing a proposed compiled object graph.
A deterministic importer validates it as a unit.
_Avoid_: Compilation Bundle, partial table writes, Plan Manifest, approved definition

**Compilation Submission**:
An immutable record of one submitted Compiled Plan and its deterministic
import-validation result, whether valid or invalid.
_Avoid_: Draft definition, Attempt, compiler conversation

**Compilation Report**:
An immutable traceability record binding Accepted Requirements to compiled
objects and validation outcomes for one draft definition.
_Avoid_: Planner log, Plan Manifest, internal reasoning

**Compilation Source Citation**:
An immutable, purpose-labeled reference to source material that the compiler
declares materially supported a compiled decision, including source revision,
location, digest, and supported object.
_Avoid_: Context Item, exhaustive access log, proof of complete reasoning

**Validation Finding**:
A deterministic error or warning emitted by an identified validator against a
specific part of a Compiled Plan or draft definition.
_Avoid_: Compilation Gap, model opinion, log line

**Compilation Gap**:
A structured pre-approval finding that identifies a specific missing or
ambiguous fact whose absence prevents safe compilation, together with its basis,
provenance, affected obligation, and required resolution.
_Avoid_: Warning, Context Gap, completeness claim

**Plan Review**:
An immutable, human-inspectable presentation of one validated compiled
definition, its complete inputs, Allowed Changes, provenance, findings, gaps,
and exact identities and digests. A Profile may give this presentation a more
specific product-facing name without creating a different protocol object.
_Avoid_: Publication Review, approval, user interface technology, Compilation Report

**Plan Decision**:
An immutable approval or rejection that binds a deciding authority and
timestamp to the exact reviewed identities and digests.
_Avoid_: Publication Decision, Artifact Decision, review comment, deployment

**Plan Approval**:
A Plan Decision that authorizes the exact reviewed definition and Agent
Packages for execution by a Runner.
_Avoid_: Rejection, informal approval, deployment

**Plan Manifest**:
An immutable, portable compiled definition containing Briefs, Contracts,
Dependencies, closed Context Sets, and Allowed Changes.
_Avoid_: Run Manifest, execution log, mutable workflow, prompt

## Compiled work and context

**Brief**:
An immutable, bounded work definition with an objective, Contract,
Dependencies, closed Context Set, Capability requirements, and Allowed Changes.
_Avoid_: Capsule, Worker, task status, conversation

**Contract**:
A machine-readable declaration of required inputs, outputs, constraints, and
guarantees for a Brief or coordinated group of Briefs.
_Avoid_: Prompt, informal description, test result

**Contract Input**:
A stably identified required or optional input with an expected kind or schema,
accepted version rule, and cardinality.
_Avoid_: Context Item, payload field, informal prerequisite

**Contract Input Binding**:
An explicit edge showing which identified Context Item or other declared input
supplies one Contract Input for one Brief.
_Avoid_: Context Set membership, Dependency, inferred relevance

**Dependency**:
A declared prerequisite relationship between Briefs or named obligations.
It records the dependency; it is not an informal ordering hint.
_Avoid_: Sequence number, shared session

**Context Item**:
An immutable, identified, fully resolved input included through a Context Set or
reusable Shared Contracts.
_Avoid_: File pointer, lookup instruction, ambient memory

**Context Set**:
The immutable, complete collection of Context Items a Worker may observe for
one Brief revision.
_Avoid_: Repository, workspace, session context

**Closed Context**:
The condition in which every project-specific input observable to a Worker is
declared by its Brief and no undeclared project state is accessible. Runtime
tools may only re-present already approved context, never discover new project
facts.
_Avoid_: Relevant context, sandbox alone, repository access

**Minimal Sufficient Context**:
A Closed Context intended to contain everything required by a Brief's
Contract and nothing unrelated. It is a design objective, not a provable claim
that no unknown fact is missing.
_Avoid_: Smallest prompt, perfect context, maximum context

**Shared Contracts**:
An immutable, versioned collection of Contracts used by multiple Briefs to
coordinate against the same intended behavior.
_Avoid_: Contract Set, shared conversation, documentation dump

**Capability**:
A declared property of a Worker, or a requirement of a Brief, used by an
external Runner to assess compatibility.
_Avoid_: Context Item, skill content, permission grant

**Allowed Change**:
An operation a Brief permits an external Worker or Runner to perform on an
identified target.
_Avoid_: Declared Effect, side effect discovered at runtime, Resource Claim, implementation log

## External delivery and execution seam

**Agent Package**:
The immutable serialized per-Brief definition exported for a user-owned
Runner. It contains Run Rules and Agent Input but makes no claim
that execution occurred.
_Avoid_: Harness Payload, Attempt Payload, repository checkout, agent result

**Run Rules**:
The Agent Package section used for routing, effect enforcement, identities,
and canonicalization metadata. It is not project context visible to the file
agent.
_Avoid_: Harness Control, Agent Input, hidden project instruction

**Agent Input**:
The complete and only project-specific instructions and resolved context that a
Brief authorizes an Agent to observe. It may contain a deterministically routed
subset of a Declaration Evidence Bundle bound by the approved prepared revision.
_Avoid_: Run Rules, audit history, ambient prompt

**Agent Package Render**:
A deterministic, versioned presentation of Agent Input, such as Markdown, with
recorded source and renderer digests. It adds no meaning.
_Avoid_: Harness Payload Render, authoritative package, LLM summary, editable protocol data

**Approval Package Binding**:
An immutable association from one Plan Approval to the exact Agent Package
identities and digests it authorizes. It remains separate from the package
bytes so approval does not participate in the digest it approves.
_Avoid_: Publication Payload Binding, Run Rules field, mutable approval status

**Runner**:
A user-controlled integration that enumerates an approved compiled definition,
obtains its Agent Packages, invokes Workers through a chosen SDK or runtime,
and owns their effects.
_Avoid_: Agentic Harness, SCORE runtime, Plan Compiler, Worker

**Worker**:
An identified actor or system capable of performing a Brief. A Worker may
be an agent, human, process, or deterministic tool.
_Avoid_: Executor, Plan Compiler, Runner, scheduler

**Runtime Adapter**:
A provider- or runtime-specific integration used by a Runner to deliver
approved Agent Packages to Workers and enforce Run Rules. It
does not compile work, add project context, inspect live repository declarations,
or make its runtime part of Core.
_Avoid_: Executor Adapter, Worker, Core Protocol, provider-specific field in Core

## Identity and interoperability

**Protocol Identifier**:
An opaque, immutable identity assigned to one historical protocol record. It is
not derived from content.
_Avoid_: Row number, digest, mutable logical name

**Content Digest**:
An integrity value computed from immutable content under declared canonical
rules. Equal digests do not collapse distinct historical records.
_Avoid_: Protocol Identifier, version number, trust decision

**Definition Lineage**:
The immutable supersession history of accepted intent and compiled definitions,
including authority, timestamp, rationale, and content digests.
_Avoid_: Execution history, mutable changelog

**Core Protocol**:
The domain-neutral SCORE objects, invariants, and interchange semantics shared
across Profiles.
_Avoid_: Coding Profile, implementation, runtime

**Profile**:
A versioned specialization that adds domain vocabulary and stronger constraints
without weakening Core invariants.
_Avoid_: Implementation, adapter, plugin

**Extension**:
A namespaced addition whose interpretation is optional unless a definition or
Profile declares it required.
_Avoid_: Profile, custom fork, unversioned field

## Coding Profile

**Change**:
An agent-managed logical unit of coding work. Each prepared revision is
immutable, supersedes rather than mutates an earlier revision, and contains one
or more Agent Briefs compiled from one Source Snapshot and one set of Shared
Contracts. A Change is the atomic unit of definition, approval, Runner
execution, and application.
_Avoid_: Change Plan, patch, Agent run, batch, single-file task

**Slice**:
A durable, project-authored feature identity whose prepared revisions use the
same objective, requirements, Agent Briefs, documented declarations, explicit
context, skills, constraints, review, approval, Runner, and atomic-application
semantics as a Change. A Slice additionally has stable authored identity and
may declare dependencies on applied Slice revisions.
_Avoid_: Change, temporary batch, execution queue, combined workspace

**Change Review**:
The Coding Profile presentation of the canonical Plan Review for one prepared
Change revision. The name identifies what the human is reviewing; it does not
change the review snapshot, decision, approval, Agent Package, or digest rules.
_Avoid_: Publication Review, a separate review protocol, Change approval

**Slice Review**:
The Coding Profile presentation of the canonical Plan Review for one prepared
Slice revision. It uses the same human gate and protocol semantics as a Change
Review while naming the durable Slice being reviewed.
_Avoid_: Publication Review, a separate review protocol, Slice approval

**Source Snapshot**:
An immutable identity for the declared project state from which a Change or
Slice revision is prepared. The Coding Profile may freeze only selected targets
and context; it does not imply a snapshot of every repository file.
_Avoid_: Repository Revision, workspace, branch name, latest source

**Agent Brief**:
A Coding Profile Brief whose only permitted source mutation creates one absent
target file or replaces one present target file. Its reviewed context includes
one derived Approved Project File Set without separate per-file decisions.
_Avoid_: File Brief, File Capsule, patch job, multi-file task, Agent process

**Approved Project File Set**:
The complete set of project-local files to which one Agent Brief candidate may
couple its target. It combines frozen baseline imports, declaration owners and
support, and selected context under the Agent Brief's existing review approval.
_Avoid_: per-file approval, repository access, imports discovered during execution

**Documented Declarations**:
The immutable interface text planned for one Agent Brief. Each entry preserves
its authored name, exact declaration text, and concise usage description. It
remains the authority for intended interface behavior even when SCORE parses
project code to derive evidence about the current or candidate source.
_Avoid_: Inspected Declaration, Declaration Registry, inferred type model, runtime lock table

**Declaration Evidence Bundle**:
An immutable Context Item derived during preparation from identified files in
one frozen Source Snapshot. It contains Inspected Declarations, deterministic
routing, provenance, digests, and the exact parser and normalizer identities
without modifying the authored Slice.
_Avoid_: Documented Declarations, Slice mutation, live repository lookup

**Declaration Closure**:
The smallest deterministically ordered set containing one root declaration and
every transitively referenced project-local declaration needed to interpret its
type structure. It excludes unrelated declarations, implementation bodies, and
the internal declaration graphs of external packages.
_Avoid_: source file, repository context, direct references only

**Local Supporting Declaration**:
A non-exported project-local declaration transitively reachable from an
approved export. Its shape is contract-relevant read-only context, but it is not
a public declaration and consumers are never instructed to import it.
_Avoid_: private implementation detail, exported declaration, consumer import

**External Declaration Reference**:
A version-bound leaf in a Declaration Closure identifying an external package
specifier, imported symbol, import kind, and dependency-lock provenance. It
provides enough interface routing without copying the package's declaration graph.
_Avoid_: vendored package types, package documentation, project-local declaration

**External Declaration Evidence**:
An immutable, digest-bound projection prepared for explicitly reviewed public
members of one locked installed package. It contains only the selected public
declarations and one bounded layer of directly required supporting types. The
package remains a Declaration Closure boundary; this evidence is context for an
Agent Brief, not authority for product meaning and not a copy of the package's
recursive type graph.
_Avoid_: dependency environment, package dump, Documented Declaration

**Inspected Declaration**:
A deterministic, source-backed projection of one declaration parsed from an
identified frozen Source Snapshot or candidate, with its provenance and digest.
It is Evidence about code and never authority for intended interface behavior.
_Avoid_: Documented Declaration, inferred requirement, product intent

**Normalized Declaration Shape**:
The canonical structural representation of a declaration after removing
formatting, comments, and other approved trivia while preserving every authored
interface choice. It is stricter than TypeScript assignability and is not raw
source text.
_Avoid_: formatted declaration, assignable type, compiler output

**Approved Export Surface**:
The complete set of exports permitted for one Agent Brief candidate, formed
from unchanged exports in the frozen baseline plus additions, changes, and
removals explicitly authorized by approved Documented Declarations. Its
Declaration Closures include every reachable Local Supporting Declaration.
_Avoid_: required exports only, inferred public interface, private helpers

**Declaration Verification**:
A deterministic comparison of Inspected Declarations and their routing against
the Normalized Declaration Shapes of approved Documented Declarations. It may
accept or reject a candidate but never rewrite the approved declaration, infer
new product intent, or accept an unapproved assignable alternative. It applies
only to revisions prepared under a Profile version that requires it.
_Avoid_: TypeScript compilation, authored requirement, declaration generation

**Candidate Declaration Gate**:
The hard pre-application evaluation of the complete candidate set using
in-memory Declaration Verification. It requires every candidate to match its
Approved Export Surface, persists bounded findings and digests, discards parser
ASTs, and uses the exact parser and normalizer versions bound by the approved
revision. It makes no claim about compilation or runtime behavior. Relevant
unsupported syntax blocks the gate and cannot be waived.
_Avoid_: TypeScript project, test run, repository verification, acceptance oracle

**Declaration Ownership**:
The exclusive relation assigning one documented declaration to exactly one File
Brief that is instructed to provide it. Ownership is fixed before execution and
does not depend on scheduling, source inspection, or a Worker claiming a queue
item. Candidate inspection may verify conformance but cannot infer or change
ownership.
_Avoid_: resource lock, job claim, file order, inferred ownership

**Declaration Consumer**:
An Agent Brief explicitly named to use a documented declaration from its owning
file. The exact documented declaration is read-only context for that
Agent Brief together with its bounded Declaration Closure, owning target, and
exact reviewed `module_specifier`. SCORE freezes rather than infers that import
spelling. Caller behavior remains approved meaning; inspected source may
provide evidence but cannot define or alter it.
_Avoid_: co-owner, copied declaration, whole-Contract context

**Agent**:
A Coding Profile Worker that receives one Agent Brief's Agent Input and may make
only that brief's Allowed Change.
_Avoid_: Executor, Plan Compiler, Runner, Runtime Adapter

## Deferred execution reporting and evaluation

The terms below describe accepted or exploratory future protocol work. The first
SQLite alpha creates none of these records.

**Run**:
One reported use of an unchanged approved Plan Manifest.
_Avoid_: Plan Manifest, Change revision, export count

**Execution Strategy**:
A Runner's private choices about scheduling, matching, retries, and integration
within the constraints of an approved definition.
_Avoid_: Plan Manifest, protocol data

**Assignment**:
A reported selection of a Worker for one Attempt.
_Avoid_: Brief, dispatch command, ownership lock

**Attempt**:
One Worker's reported execution history for one Brief. A retry creates a
new Attempt and does not mutate the Brief.
_Avoid_: Brief revision, prompt, result

**Attempt Payload**:
The immutable serialized input reported as delivered for one Attempt.
_Avoid_: Agent Package, live database query

**Repair Notice**:
A bounded structured explanation of one candidate's deterministic mismatch with
its approved contract, supplied only to a manually authorized retry. It is
derived execution evidence, not new project context or product intent.
_Avoid_: Agent Input mutation, corrective requirement, raw candidate output

**Attempt Result**:
A structured submission binding one Artifact or Context Gap to the Attempt and
Attempt Payload that produced it.
_Avoid_: Raw agent response, status message

**Context Gap**:
An attributable Worker claim that it cannot satisfy a named Contract
requirement from its approved input without inventing an absent or ambiguous
project-specific fact. The claim is not presumed true.
_Avoid_: Compilation Gap, question, permission to search

**Context Gap Disposition**:
An attributable determination that a Context Gap reflects a repository omission,
product ambiguity, or an unsubstantiated claim.
_Avoid_: Automatic context grant, Worker verdict

**Event**:
An immutable, ordered observation about a reported execution object from which
lifecycle state may be derived.
_Avoid_: Mutable status, log line

**Artifact**:
An immutable, identified output produced or referenced during a reported Run.
_Avoid_: Result envelope, accepted output, mutable file

**Eligible Artifact**:
An Artifact that passed preliminary checks and may be selected for assembly but
is not finally accepted.
_Avoid_: Accepted Artifact, completed file

**Artifact Decision**:
An attributable acceptance, rejection, or supersession of an Artifact for a
declared output.
_Avoid_: Plan Decision, merge status

**Candidate Revision**:
An immutable assembly of a base Source Snapshot and one selected Artifact
for each required Agent Brief.
_Avoid_: Workspace, Plan Manifest, accepted revision

**Evidence**:
An immutable, attributable observation used to evaluate a declared criterion.
_Avoid_: Proof, test declaration, opinion

**Verification Result**:
A recorded evaluation of one declared criterion against identified Evidence.
_Avoid_: Evidence, Artifact Decision, test command

**Acceptance Oracle**:
An immutable set of acceptance-determining criteria and expected outcomes used
to evaluate a Candidate Revision.
_Avoid_: Post-hoc diagnostic, Agent Input

**Run Outcome**:
A terminal conclusion derived from the Run's declared obligations, accepted
outputs, and Verification Results.
_Avoid_: Attempt status, completion count

**Corrective Compilation**:
A new Plan Compiler cycle that uses attributable failure Evidence from a
previous execution as declared input and proposes a replacement definition.
_Avoid_: Same-input retry, Repair Notice, hidden diagnostic injection

**Corrective Compilation Input**:
An immutable binding from failed criteria, Verification Results, and Evidence
into Corrective Compilation.
_Avoid_: Selected summary, active Change revision context

**Execution Lineage**:
The immutable history of reported Runs, Attempts, outputs, and verification
governed by an unchanged approved definition.
_Avoid_: Definition revision, mutable execution counter

## Assurance

**Assurance Case**:
A maintained account of bounded Assurance Claims, their supporting Evidence,
their Verification Results, and the limits on what SCORE may conclude.
_Avoid_: Proof list, feature list, release checklist

**Assurance Claim**:
One falsifiable statement about SCORE, scoped to identified versions, inputs,
environments, and Evidence.
_Avoid_: Requirement, capability, universal guarantee

**Assurance Envelope**:
The complete set of Assurance Claims currently supported by identified Evidence
without extrapolating beyond each claim's stated scope.
_Avoid_: Roadmap, intended capability, product promise

**Non-Claim**:
An explicit boundary stating what identified Evidence or a Verification Result
does not establish.
_Avoid_: Disclaimer, hidden limitation, failed requirement
