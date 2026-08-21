---
name: score-authoring
version: 0.1.0-alpha.5
description: Author one complete SCORE Compilation Bundle for the canonical Account Status alpha proof.
---

# SCORE authoring procedure

Use this procedure only for the current local alpha proof targeting
`score.compilation-bundle@0.1.0-alpha.5` and `score.coding@0.1.0-alpha.5`.

The governing meaning and alpha implementation live in this repository. Read
and follow:

- `README.md`
- `docs/sqlite-alpha.md`
- `examples/coding-profile-run.md`
- `profiles/coding/README.md`
- `CONTEXT.md`
- `docs/decisions.md`, especially D-045 through D-066

## Procedure

1. Consume the exact accepted compiler-input packet. Do not reinterpret the
   accepted Account Status specification or add another target.
2. Act as the Context Compiler and author one complete Compilation Bundle—not
   SQL, database rows, persistent identifiers, digests for proposed objects,
   Harness Payloads, Markdown prompts, approval records, or execution records.
3. Use readable Bundle-local handles for every proposed object and resolve every
   internal reference. Deterministic software assigns opaque stored identities.
4. Compile the full domain graph: Manifest, Compilation Report, Contract Set,
   Contract and Contract Inputs, Coding Pass, both File Capsules, documented
   interface Context Items for owners and consumers, Context Sets, typed
   bindings, capabilities/effects, requirement traceability, and source
   citations/bindings.
5. Put every required file-agent fact inline. A path, URL, symbol, source
   citation, or lookup instruction cannot stand in for required content.
6. Treat declaration text and descriptions as opaque authored context. Preserve
   them exactly; do not parse source, infer imports, or derive type semantics.
7. Give each File Capsule a distinct self-contained Agent Input source graph.
   Give an owning Capsule its exact documented interface and give a consuming
   Capsule the same exact documented interface as read-only context. Put any
   required import statement and supporting type text directly in the authored
   file instructions or documented interface.
   Bind every supplied Context Item to at least one Contract Input. Embed the
   complete TypeScript Module Boundaries skill only for the creator Capsule.
8. Preserve traceability from all three Accepted Requirements and from each
   material source citation to the compiled objects it supports.
9. Put only attributable heuristic warnings in `compiler_findings.warnings`.
   Put a concrete missing or ambiguous blocking fact in
   `compiler_findings.compilation_gaps`. Do not label LLM judgment as a
   deterministic Validation Finding or claim that the context is complete.
10. Submit the whole Bundle through the compiler-facing interface. React only to
   its structured deterministic findings; every repair is a linked new
   submission. Stop if meaning, repository interpretation, a warning waiver, or
   a Compilation Gap requires human judgment.
11. After a valid import, request deterministic Publication Review and stop for
    explicit human approval of the exact identities and digests. Do not record
    approval, export payloads, or invoke an Executor Adapter yourself.

Completion criterion: one schema-valid complete Bundle has imported without
manual protocol-row or prompt authoring; every Accepted Requirement, Contract
Input, Context Item, Capsule, skill, and source citation has an explicit path in
the review; and work is stopped before Publication Decision.

The strict schema is
`schema/compilation-bundle.schema.json`.
