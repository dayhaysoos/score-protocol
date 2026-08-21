---
name: score-authoring
version: 0.9.2
description: Author and prepare small reviewed Changes or durable Slices when the person says "use SCORE". Inspect the exact project, declare complete File Brief scope, and stop before approval or execution.
---

# Use SCORE

When the person says **use SCORE**, treat that as authorization to prepare the
small implementation work already settled in the conversation. Do not add a
separate specification-approval ceremony.

## Choose a Change or Slice

A **Change** is the normal choice for concrete work managed by the current
authoring LLM. It contains one or more File Briefs and uses the same semantic
primitives as a Slice: objective, requirements, exact targets and operations,
documented declarations, explicit context with purposes, skills, and
constraints. The authoring LLM chooses the complete scope. SCORE enforces only
that declared scope; it does not discover extra targets, context, or tests.

Use a **Slice** when the work needs durable feature identity, editable authored
source under `score/slices/`, or applied dependencies on other Slices. A Change
does not acquire those lifecycle features merely because it contains several
files. Both forms prepare an immutable definition, produce an entity-specific
HTML Change Review or Slice Review, and later use the same explicit approval,
Runner, and atomic complete-set application path.

Revising the semantic input or frozen source of the same logical Change creates
an immutable superseding revision. It never rewrites a prior review, approval,
or execution history. Submitting the same complete document against the same
source reuses its existing revision and review artifacts.

## Write for the person reviewing

Before submitting a Change or Slice, run a plain-language pass over every title,
objective, requirement, Agent Brief purpose, declaration description, context
purpose, skill, and constraint. Write like one developer explaining the work to
another:

- Say what will change and why it matters.
- Use short, direct sentences and familiar words.
- Replace internal architecture jargon when ordinary words mean the same thing.
- Define a necessary technical term the first time it appears.
- Keep exact paths, code declarations, signatures, imports, field names, IDs,
  version values, and required error codes unchanged.
- Do not ask the HTML renderer to simplify or rewrite the text. SCORE must freeze
  the reviewed wording and render it exactly.

The pass is complete only when a reviewer can understand the Change or Slice
goal, every requirement, and every Agent Brief purpose without knowing SCORE's
internal implementation vocabulary.

## Discover existing declarations

Before drafting, determine whether each declaration the work depends on already
exists in the current source. If it exists at a TypeScript module seam, inspect
it. If it does not exist because its owner is a `create` target or the project is
new, do not run `inspect-module` against the missing path; author the declaration
from the accepted product meaning instead. For mixed work, inspect only the
existing declarations and author the new declarations.

Use `score inspect-module <path>` as a read-only authoring aid when a Change or
Slice crosses an existing TypeScript module seam. Discovery mode reports the
module's current imports and exports without returning implementation bodies.
When one export is relevant, run
`score inspect-module <path> --export <name>` to get its exact supported
declaration, the referenced names and their observed routing, and a
`sliceDraftContext` seed.

Treat this as evidence about current source, not product intent. The command
does not edit a Change or Slice, decide that a declaration should exist, or
write what it means. Copy the seed intentionally only after deciding the owner
and consumer. Supply the declaration description and consumer path yourself.
Every project-local `consumes` entry must include the declaration `name`, owner
path in `from`, and exact reviewed import spelling in `module_specifier`.

Inspect each referenced declaration the future File Agent needs. A local export
can be selected with another `--export` call; an imported reference names the
observed module specifier. Resolve that specifier to its actual project-relative
TypeScript file before the next `inspect-module` call. Do not paste a raw AST or
unrelated declarations into Agent Input. New declarations absent from source
must still be authored from the accepted product meaning.

For the complete existing contract, run
`score inspect-module <path> --export <name> --closure`. Closure mode recursively
follows local exports and relative TypeScript module references. It returns the
root declaration followed by the exact supporting declarations needed by that
signature. Cycles are included once in stable traversal order.

Closure resolution does not read `tsconfig.json` or `package.json`, guess path
aliases, or resolve package dependencies. A missing module, ambiguous source
candidate, bare package specifier, unsupported declaration, or unprovable route
must fail without a context seed. The command is still read-only and does not
write a Change or Slice. The author must supply every declaration description,
consumer path, exact import and usage, and caller-observable behavior before
placing selected facts into reviewed input.

When an Agent Brief needs a public declaration from an installed package, do
not copy dependency declarations into authored context and do not ask
`inspect-module` to cross the package boundary. Add one reviewed
`external_declarations` request to that File Brief with the exact package
specifier in `from`, the selected public member names in `names`, and a short
`purpose`. Trusted preparation resolves those names from the root lockfile and
the selected installed package, freezes only their public declarations and one
bounded layer of directly required supporting types, and returns typed findings
when it cannot prove the route. The package remains a closure boundary: never
request a package namespace, unrelated members, or a recursive dependency type
graph.

Discovery is complete only when every declaration the work depends on is either
confirmed from existing source with closure inspection or explicitly authored
as a new declaration from the accepted product meaning. When inspection exposes
a wrong source assumption, correct the draft before preparation; ask the person
before changing product meaning or expanding scope.

## Author a Change

1. Inspect the exact current project directory and settle the complete set of
   File Briefs. A Change may own one file or several coordinated files; do not
   split or combine work merely to fit a CLI shape.
2. Author structured input against the authoritative SCORE Change schema. Use
   only `create` for an absent target or `modify` for a present target. The
   current Change flow does not support `delete` or `rename`. Apply the complete
   cross-file seam audit below before submission; for a Change, declaration
   owners and consumers must belong to that same Change. Read the authoritative
   machine schema with `score change --schema`; do not reproduce its fields in
   this skill.
3. Send the structured document on standard input with
   `score change --input -`. This is a non-interactive agent interface; do not
   simulate TTY selection or approval keystrokes. Omit `change_id` when creating
   a new Change. SCORE returns `changeId`; retain it with the conversation and
   send that exact value as `change_id` only when revising the same logical
   Change. A revision resubmits the complete document rather than a patch. If
   SCORE reports `CHANGE_REVIEW_PUBLICATION_INCOMPLETE`, it also returns the
   retained `changeId`; resolve the named artifact conflict and retry the same
   complete document with that identity.
4. If SCORE returns typed findings, repair only the declared semantic facts they
   identify. Ask the person before changing product meaning or expanding scope.
5. A successful result says `review_ready`, returns
   `humanApprovalRequired: true`, and names `score start` as the next action.
   Return the named HTML Change Review and a concise target summary. Treat the
   human-approval field as a hard gate: stop before approval, any Runner Run,
   candidate generation, or application unless the person explicitly asks to
   continue.

## Author durable Slices

1. Confirm from the conversation that the intended slice is small and concrete.
   If essential product meaning is still ambiguous, resolve it with the person
   before preparation.
2. Inspect the exact current project directory. Choose only the target files,
   requirements, public declarations, declaration consumers, context files,
   constraints, and reusable prompt text needed by this slice.
3. Build one compact `SliceDraft` per independently reviewable slice against
   the authoritative schema exposed by the SCORE preparation tool. The
   implementation source of that schema is `src/slice-draft.ts`; do not
   reproduce its field schema in this skill. Store each editable draft as
   `score/slices/<slice-id>.json`, with a stable `slice_id` that does not change
   when its title or requirements are edited.
4. Complete a cross-file seam audit while drafting. Do not prepare until every
   seam passes all of these checks:
   - Copy each file requirement exactly from one Slice-level requirement.
     Every Slice-level requirement must be allocated to at least one File Brief;
     do not paraphrase or introduce a file requirement that is absent from the
     Slice-level list.
   - Give every public declaration exactly one owning target and name each
     same-slice consumer's exact owner path. Treat each declaration as the
     documented interface between isolated File Agents. Supply its stable name,
     the exact TypeScript declaration text, and one concise description of what
     it means and how callers use it. Include every caller-visible property,
     parameter, callback, and return type in the authored text.
   - State the caller-observable behavior needed at each seam in the existing
     file task, requirements, or constraints. Include the meaning of inputs,
     normalization rules, returned result, failure or no-op behavior, and
     observable callbacks or state changes when they matter. Describe what a
     caller may rely on, not the owner's implementation algorithm.
   - Freeze each consumer connection literally in its file task, requirements,
     or constraints: the exact import statement, followed by the exact function
     arguments or JSX prop names used at the call site. For project-local
     declarations, SCORE plan preparation does not parse or infer module paths,
     binding forms, supporting types, or call-site behavior. If a declaration references
     another declaration owned in the same slice, list that supporting
     declaration as another explicit `consumes` entry even when the generated
     file will not import its name directly. Otherwise include the required
     project-local supporting declaration text in the file's prompt context
     explicitly. For installed-package contracts, use the reviewed
     `external_declarations` field described above. Do not leave an unresolved
     type name or shorthand like "use Foo" as the only guidance.
   - Give each user-visible empty, loading, error, or success state one
     rendering owner. When other files supply its data, name that boundary
     instead of asking multiple files to render the same state.
   - Use declaration consumers only for owners inside the same `SliceDraft`.
     Treat code from an applied predecessor slice as source context.
   - Match each operation to the current project state: `create` targets are
     absent and `modify` targets are present. SCORE authoring does not support
     `delete` or `rename`. When revising an applied slice, change an earlier
     `create` to `modify` if that revision created the file.
5. Keep every project file path relative to the current project directory. For
   each selected context file, state why the future File Agent needs it.
6. Select a skill by either its canonical project-relative prompt-file path or
   its complete inline text. A file-backed skill must be a regular file inside
   the current project and must not be a symlink or traverse one. Supply the
   full text the future File Agent needs. Do not put an external file path in a
   Change or Slice, or ask SCORE to crawl skill folders or discover referenced
   resources. External skill content would require a separate future trusted
   configuration boundary.
7. Add test files only when the person explicitly requested tests and accepted
   them as part of the slice's file structure. SCORE does not invent test
   targets or make them mandatory.
8. When one slice must be applied before another, list its `slice_id` in the
   dependent draft's `after` field. This is required when later slices build on
   code or files created by earlier slices; sequential slices may intentionally
   modify the same file.
9. Call `prepareSlices()`. The host supplies the exact current project
   directory, reads `score/slices/*.json`, and resolves applied predecessor
   revisions; do not ask the person for database paths, output paths,
   repository identifiers, protocol identifiers, digests, models, or providers.
10. If the result is `invalid`, repair only the facts identified by its typed
   structural findings and submit again. Authored Documented Declaration text
   remains opaque and authoritative. SCORE may reject an explicitly selected
   installed-package declaration when its locked public declaration route is
   missing, ambiguous, unsupported, incomplete, or over a fixed bound. Ask the
   person when a repair would change product meaning or expand the agreed slice.
11. For each result, distinguish `review_ready`, `implemented`, and `waiting`.
    A dependent slice remains `waiting` until every predecessor's exact revision
    was applied by a successful Runner Run. Give the person each named HTML
    Slice Review path, the `score start` next action for each ready Slice, and a
    short summary of the prepared files. Stop there unless the person explicitly
    asks to continue.

Do not approve the review, start a Runner, launch an executor, create candidates,
or edit source files during preparation. Do not author SCORE storage records or
internal protocol graphs. Deterministic SCORE derives and stores those behind
the preparation tool. Preparation does not parse or type-check authored
Documented Declarations or generated source, and it does not run project
checks. Its only dependency parsing is the explicitly reviewed, locked, bounded
external-declaration evidence described above. Typechecking, builds, tests, and
linting remain post-application work in the real project.

Completion means every currently unblocked draft passed the cross-file seam
audit and has a named review ready for the person's explicit decision, while
later drafts clearly name the applied predecessors they are waiting for. No
approval, execution, or source mutation is performed.
