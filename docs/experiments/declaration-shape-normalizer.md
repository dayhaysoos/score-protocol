# Declaration Shape Normalizer Experiment

Status: two successful bounded increments after one reviewed corrective revision;
not production Declaration Evidence integration.

## Question

Can SCORE use one reviewed Agent Brief, one isolated Agent, one production file,
and an independent public-interface harness to implement a deterministic
OXC-backed declaration normalizer without manual production editing?

## Fixed seam

The experiment exercised one public function:

```ts
normalizeDeclarationShape(declaration: string)
```

The bounded supported input was one named exported ordinary function using
explicit `string`, `number`, `boolean`, or `void` annotations. The normalized
shape preserved the function name, parameter order, optional and rest flags,
and explicit parameter and return types while ignoring formatting and the
implementation body.

The Agent was allowed to create or modify only `src/declaration-shape.ts`. The
acceptance harness lived under `.score/experiments` and was outside the Agent's
context and Allowed Changes.

## Revision 1: delivery succeeded, acceptance failed

- Pass: `a92b1d68-e478-4b58-b3f6-4c5a62e1b7df`
- Run: `5a5f574a-f2a5-49d0-a654-618965ee3951`
- Runtime: `opencode/gpt-5.6-terra`, medium reasoning
- Attempts: 1
- Candidate digest:
  `sha256:8f97ad387560a0fef435ab8801d2554cb83301f84ee605011006ba8a56660791`

SCORE generated and atomically applied the one candidate. The initial harness,
`inspect-module --closure`, typecheck, build, and 316 existing tests passed.

A final requirement-level probe then showed that a rest parameter such as
`...values: string` incorrectly returned
`DECLARATION_CONTRACT_INCOMPLETE`. The reviewed brief had stated the wrong OXC
AST fact: it directed the Agent to read the annotation from the RestElement's
identifier argument. The initial harness also omitted the promised rest case.

OXC inspection showed the exact correction:

```text
parameter.type                       RestElement
parameter.typeAnnotation.typeAnnotation.type
                                     TSStringKeyword
parameter.argument.type              Identifier
```

Revision 1 therefore established candidate delivery, but not accepted behavior.
No manual production repair was made.

## Revision 2: corrective revision succeeded

Before revision 2, the harness gained the missing rest-parameter assertion and
was confirmed red against the revision 1 source.

Revision 2 changed the approved fact to read the annotation from
`RestElement.typeAnnotation` while still reading the parameter name from the
identifier argument.

- Pass: `27cc72ac-e763-4270-9682-6fdd40721c41`
- Run: `f6cc8d72-bd1e-4ad6-bd38-b7f815c5bfe0`
- Runtime: `opencode/gpt-5.6-terra`, medium reasoning
- Attempts: 1
- Candidate digest:
  `sha256:1d1d1561f8b989a4e5bf0fc4e1f1dc926ebefd70cee905178d16847a362ae400`

The one modify Agent corrected that exact defect. SCORE atomically applied the
candidate without manual production editing.

## Revision 2 verification result

Verification on 2026-08-16, immediately after revision 2 application:

```text
npx tsx .score/experiments/declaration-shape-harness.ts
  PASS declaration-shape acceptance harness

npx tsx src/cli.ts inspect-module src/declaration-shape.ts \
  --export normalizeDeclarationShape \
  --closure
  PASS status=ok; supportingDeclarations=0
  source digest=sha256:1d1d1561f8b989a4e5bf0fc4e1f1dc926ebefd70cee905178d16847a362ae400

npm run typecheck  PASS
npm run build      PASS
npm test           PASS (316/316)
git diff --check   PASS
```

Repository context at verification time:

```text
branch  plan/pi-adapter
HEAD    6aed0233ce6351de8ede893a95d69e3d626f86bb
```

The worktree also contained unrelated uncommitted work. The candidate digest,
Pass, and Run identify this experiment's exact production output; the HEAD alone
does not reproduce the complete worktree.

## Revision 3: bounded type aliases succeeded

Revision 3 deepened the same public function without adding another production
target or public seam. Before approval, OXC 0.144.0 was used to confirm the
relevant `TSTypeAliasDeclaration`, primitive keyword, `TSTypeReference`, and
`TSUnionType` node shapes. The private harness was extended and confirmed red
against revision 2 before Agent execution.

The accepted input added exactly one named exported nongeneric type alias whose
annotation is either a supported primitive, an unqualified named reference
without type arguments, or a flat ordered union of those leaves. Generic aliases,
qualified or parameterized references, intersections, literals, parenthesized
forms, and nested unsupported union members remain outside the supported shape.

- Pass: `5d54659b-995b-41ab-9059-574b0548a8b3`
- Approval decision: `ffe7d086-3ae8-4d5d-ab86-d06df74557d1`
- Run: `eff11baa-476b-488d-98aa-d4c97323c3e3`
- Runtime: `opencode/gpt-5.6-terra`, medium reasoning
- Attempts: 1
- Candidate digest:
  `sha256:217c6e301757a55e96ef885df27f2f07ee7551649be75be02c2a17b33a0b3673`

SCORE generated and atomically applied the one candidate in about 25 seconds.
No manual production repair was made.

Verification on 2026-08-16, immediately after revision 3 application:

```text
npx tsx .score/experiments/declaration-shape-harness.ts
  PASS declaration-shape acceptance harness

bounded rejection probes
  PASS qualified references, type arguments, intersections, literals,
       parenthesized and nested forms, generic aliases, and multiple exports

union-order probe
  PASS boolean | First | void | Second preserved in source order

npx tsx src/cli.ts inspect-module src/declaration-shape.ts \
  --export normalizeDeclarationShape \
  --closure
  PASS status=ok; supportingDeclarations=0
  source digest=sha256:217c6e301757a55e96ef885df27f2f07ee7551649be75be02c2a17b33a0b3673

npm run typecheck  PASS
npm run build      PASS
npm test           PASS (316/316)
git diff --check   PASS
```

The worktree remained dirty with unrelated work. The Run status reported
`Applied`, one successful Attempt, and no pending manual action.

## What the experiment establishes

- One isolated Agent can implement and correct this exact bounded AST-backed
  seam from reviewed Agent Briefs.
- The same reviewed seam can be deepened by one parser-derived declaration
  dimension while preserving its previously accepted function behavior.
- The bounded primitive, named-reference, and flat-union type-alias shapes are
  deterministic across the compact and reformatted fixtures exercised here.
- A private acceptance harness can independently reject an applied candidate
  even when SCORE delivery, typecheck, build, and the existing suite succeed.
- A failed requirement can become one red public-interface assertion and one
  reviewed corrective revision without manual production repair.
- `inspect-module --closure` can reproduce the final complete public contract
  without exposing implementation bodies or unresolved private declarations.

## What the experiment does not establish

- The first reviewed plan was correct. It was not.
- The first harness covered every reviewed requirement. It did not.
- Agent execution is generally reliable across models or workloads.
- Multi-file independently generated changes integrate correctly.
- The complete Declaration Evidence Bundle, preparation routing, or candidate
  declaration gate works.
- TypeScript assignability, arbitrary declaration syntax, project runtime
  behavior, release readiness, deployment, or user acceptance.
- Declaration closure, preparation evidence, Agent Brief routing, candidate
  conformance, or multi-file integration.

## Lesson for the next experiment

Every promised AST case must have both:

1. a parser-derived fixture confirming the actual OXC node shape; and
2. an independent public-interface assertion that is red before Agent work.

Revision 3 followed this rule successfully. The next experiment should still
increase only one dimension, retain parser-derived fixtures and independent red
assertions, and keep the same post-application project verification boundary.
