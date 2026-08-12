# SCORE terminology

[CONTEXT.md](../CONTEXT.md) defines the canonical product language. This file
maps that language to identifiers retained by the implemented alpha and explains
how to write about SCORE without exposing storage vocabulary to users.

## Canonical language

| Canonical term | Retained alpha term or identifier |
| --- | --- |
| Plan Compiler | Context Compiler |
| Change | Change Plan, Coding Pass, `coding_passes` |
| Change revision | Slice Revision, `PreparedSliceRevision`, `prepared_slice_revisions` |
| Slice | Slice Draft, `SliceDraft`, `prepared_slices`, editable `score/slices/<slice-id>.json` input |
| Compiled Plan | Compilation Bundle, `score.compilation-bundle` |
| Plan Manifest | Run Manifest, `run_manifests` |
| Brief | Capsule, `capsules` |
| File Brief | File Capsule |
| Documented Declarations | `documented_declarations` Context Item |
| Declaration Ownership | Slice Draft `owns` routing |
| Declaration Consumer | Slice Draft `consumes` routing |
| Shared Contracts | Contract Set, `contract_sets` |
| Source Snapshot | Repository Revision, `repository_revisions` |
| Plan Review | Publication Review, `publication_reviews` |
| Plan Decision | Publication Decision, `publication_decisions` |
| Plan Approval | An approving Plan Decision |
| Runner | Agentic Harness |
| Runtime Adapter | Executor Adapter |
| Worker | Executor |
| Agent | File Executor |
| Agent Package | Harness Payload, `harness_payloads` |
| Run Rules | Harness Control, `control_json` |
| Approval Package Binding | Publication Payload Binding |
| Allowed Change | Declared Effect |

The right column is compatibility vocabulary, not preferred product copy.
Historical migrations and inspection views still expose older identifiers such
as `planned_declarations` and `repository_project_settings`, but current plans
leave those tables empty. Documentation must not present those legacy storage
names as active product concepts.

When the Coding Profile entity is known, **Change Review** and **Slice Review**
are the preferred product presentation names for the canonical Plan Review.
They are not compatibility vocabulary or separate protocol objects.

## Writing rules

- Use **Change** for agent-managed logical work and its atomic reviewed scope.
  Do not imply that a Change has only one file: every prepared revision contains
  one or more File Briefs.
- Use **Slice** only when durable project-authored feature identity or
  dependencies on applied Slices matter. Its editable JSON and prepared
  revisions retain the same semantic fields and execution gates as a Change.
- Say **prepared Change revision** for immutable reviewed output. Retained
  `SliceDraft`, `PreparedSliceRevision`, Change Plan, Coding Pass, and `passId`
  names are compatibility identifiers, not additional product entities.
- Use **Change Review** and **Slice Review** in Coding Profile product surfaces
  when the reviewed entity is known. Use the canonical **Plan Review** umbrella
  in Core Protocol discussion and for legacy or generic review paths. These are
  presentation names for the same review object and human gate.
- In a Change Review or Slice Review, lead with the **Change** or **Slice** and
  filenames. Do not introduce a separate noun when “file” is sufficient.
- Use **File Brief** when the bounded, immutable per-file definition matters.
- Use **Agent Package** for the exact exported bytes delivered through the
  Runner. Keep **Run Rules** separate from agent-visible **Agent Input**.
- Say **Agent** for a coding worker. Use the generic **Worker** only when a
  statement deliberately includes humans, processes, or deterministic tools.
- Name concrete integrations directly: **OpenCode Adapter**, **Cursor Adapter**.
  Use **Runtime Adapter** only when discussing the shared seam.
- Say **review**, **approve**, and **approved for execution**. Do not describe
  the approval gate as publication in product copy.
- Keep precise integrity language such as **Protocol Identifier**, **Content
  Digest**, **Context Set**, **Context Item**, and **Contract Input Binding** in
  technical and audit views where those distinctions matter.

Historical decision entries retain the vocabulary used when they were accepted.
Later decisions and current documents use this mapping rather than rewriting
the history.
