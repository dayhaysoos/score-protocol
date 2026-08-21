# External declaration evidence

**Status:** Experimental production integration implemented in the current dirty
worktree. It is not yet an accepted release feature.

## Outcome

A reviewer can explicitly select the public members an Agent Brief needs from
an installed package. Trusted preparation freezes those contracts and only the
small direct supporting layer required to read them, so the Agent does not have
to guess a version-specific API or inspect the dependency itself.

## Current behavior

- Each reviewed request names one exact package specifier, a bounded list of
  public member names, and a purpose.
- Preparation binds the installed package to the root lockfile, resolves its
  public declaration route, and parses selected regular `.d.ts` files inside
  that package.
- The evidence includes selected declarations, at most one direct supporting
  layer, package identity, parser/resolver versions, provenance, and digests.
- Agent Brief context omits `node_modules` paths and package-internal module
  routes while preserving the readable TypeScript contracts.
- Missing, ambiguous, incomplete, unsupported, unsafe, or over-limit requests
  fail with typed findings before review.
- Identical frozen inputs produce byte-identical evidence and digests, and
  preparation does not modify project source files.

## Hard boundary

External packages remain closure boundaries. SCORE does not recursively follow
their type graphs, cross into another dependency, or provide a package
namespace dump. Preparation reads no `tsconfig.json`, creates no TypeScript
project, invokes no compiler or project command, loads no environment, and uses
no network or installer. File Agents and Runtime Adapters receive no dependency
filesystem access.

The evidence explains the selected installed API. It does not prove that a
candidate imports it correctly, typechecks, builds, behaves correctly, or uses
the API at all. Documented Declarations remain authoritative for product
meaning.

## Evidence

- [Effect public-declaration experiment](../experiments/effect-external-declaration-evidence.md)
- [Package-resolution matrix](../experiments/external-declaration-resolution-matrix.md)
- [Agent Brief binding experiment](../experiments/external-evidence-agent-brief-binding.md)
- [ADR 0014](../adr/0014-bind-selected-external-declarations-during-preparation.md)
- Production coverage in
  [`test/external-declaration-evidence.test.ts`](../../test/external-declaration-evidence.test.ts)
