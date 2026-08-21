# Open Questions

This file contains only unresolved choices. Accepted answers belong in
[decisions.md](./decisions.md).

There are no remaining product-grill or implementation-choice blockers for the
first SQLite alpha. The questions below preserve intentionally deferred
protocol work without making it part of the current local experiment.

## Deferred execution and runtime questions

These questions do not affect the first alpha because SCORE exports definitions
but does not run agents or receive execution records. The separate local Runner
experiment deliberately keeps its operational choices non-normative.

### Q-001: What is the eventual minimum normative Core?

- **Question:** If execution reporting is standardized later, which current and
  future objects must every compatible implementation understand?
- **Deferred tension:** A small definition-only Core is easier to implement; a
  lifecycle-rich Core could support stronger interoperability but risks turning
  SCORE into a workflow runtime.

### Q-003: When is an execution dependency satisfied?

- **Question:** In a future reported Run, is upstream completion sufficient, or
  must named outputs and verification outcomes be accepted first?
- **Pressure test:** An upstream agent finishes, but its result is rejected.

### Q-004: How are Attempts controlled?

- **Question:** What portable meaning should assignment, acceptance, leases,
  heartbeats, expiry, abandonment, cancellation, and retries have?

### Q-021: May Attempts for one File Brief overlap?

- **Question:** Can a future integration run speculative or redundant Attempts
  concurrently, and how would it fence late competing results?
- **Current lean:** If execution reporting is introduced, begin with sequential
  Attempts per File Brief.

### Q-005: Does Core need a generic resource object?

- **Question:** Are declared inputs and Allowed Changes sufficient, or will a
  non-coding Profile need a portable resource-ownership concept?
- **Coding Profile answer:** Duplicate file writers are invalid compiled plans;
  file agents do not negotiate locks.

### Q-006: What capability-matching language is portable?

- **Question:** How could a future runner match required tools, versions, and
  permissions without adopting one scheduler's query language?
- **Alpha boundary:** Plan Review displays the requirements but SCORE
  performs no runtime matching.

### Q-045: What portable file-result format would later reporting use?

- **Question:** Would a future result envelope normalize complete file content,
  patches, and tool-native edits into one form or represent several forms?
- **Alpha boundary:** The Runner owns SDK mechanics and SCORE receives
  no result.

## Deferred results, testing, and verification

These questions resume only if SCORE later receives execution history or owns a
verification extension.

### Q-007: How are Artifacts addressed and transported?

- **Question:** Which identifiers, digests, media types, sizes, and retrieval
  metadata would be required?

### Q-008: Who may accept or reject Artifacts?

- **Question:** How would acceptance authority and competing results be recorded
  without making an agent authoritative over its own output?

### Q-009: What constitutes Verification?

- **Question:** Which criteria are machine-evaluable, which outcomes exist, and
  how is evaluator trust represented?
- **Alpha boundary:** The user's normal testing practices remain outside SCORE.

### Q-046: How can SCORE verify candidates in the real project environment?

- **Question:** After declaration verification is established, should named
  project-owned checks run before application, after guarded application, or
  through a user-controlled external integration, and how should their results
  bind to the exact candidate and project state?
- **Current boundary:** D-079 excludes project verification from the Runner and
  the rejected synthetic-project approach must not return implicitly.
- **Research record:** See [Real-project verification](./features/real-project-verification.md).

### Q-037: May separate Verification Rounds be combined?

- **Question:** Must one unchanged Candidate pass all required checks in one
  round, or may results from different rounds be combined?
- **Current lean:** Do not combine them; this accepted direction remains
  irrelevant until verification enters scope.

### Q-010: When is a future Run terminal?

- **Question:** How would cancellation, supersession, optional Briefs, partial
  completion, and failed criteria determine the Run outcome?

### Q-020: How should context quality be evaluated?

- **Question:** Which later evidence can distinguish minimal sufficient context
  from a lucky agent success?
- **Possible observations:** Context Gaps, unused items, Agent Package size, corrective
  revisions, external code review, and repeatability. None is proof by itself.

## Deferred format, trust, and evaluation

### Q-012: How will full protocol and extension versioning work?

- **Question:** How should protocol versions, Profile versions, optional
  extensions, and required extensions interact beyond the first schema?

### Q-013: What belongs in the trust and security envelope?

- **Question:** Which identity, provenance, integrity, and authorization facts
  are portable protocol data, and which authentication mechanisms remain
  transport-specific?

### Q-016: How should optional comparative evaluation be controlled?

- **Question:** If SCORE is later compared with another workflow or model, how
  should task, repository, model, tools, budget, preparation cost, retries, and
  human intervention be controlled?
- **Scope:** Benchmarking is an optional downstream experiment, not a SCORE
  product abstraction or central workflow.

## Terminology still worth revisiting

### Q-018: Contract

- **Question:** Is “Contract” sufficiently precise once inputs, outputs,
  constraints, and guarantees receive explicit schema types?

### Q-019: Resource Claim

- **Status:** Do not use this as an active Core term unless Q-005 establishes a
  real generic resource object.
- **Alternatives:** Allowed Change or Resource Access Declaration.
