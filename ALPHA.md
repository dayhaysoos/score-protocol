# SCORE Core compiler/materializer alpha proof

This document describes the retained first local proof of SCORE's
compiler/materializer boundary. The repository now also contains slice
preparation and a user-owned Runner integration; those later surfaces do not
change what this definition-only reproduction proves.

The proof asks whether one LLM-authored complete Account Status Compiled Plan can
survive strict deterministic validation, atomic SQLite import, independent
persisted-state validation, reproducible payload/review rendering, and an exact
approval gate without manually authored protocol rows or prompts.
`npm run reproduce` wipes and recreates only the scratch output used to answer
that question.

The proof implements:

- one versioned local SCORE authoring skill;
- one strict `score.compilation-bundle@0.1.0-alpha.4` JSON Schema;
- deterministic validation, RFC 8785 canonicalization, SHA-256 digests, opaque
  stored identities, and atomic SQLite import;
- exact documented interface text routed to each owning and consuming File
  Brief without source parsing, module-path inference, or a synthetic project;
- an independent approval validator that re-checks the persisted graph and
  materialized payload bytes, retaining each gate result as immutable evidence;
- immutable compiler history, compiled-definition rows, Agent Packages,
  deterministic Agent Input Markdown, and a deterministic HTML Plan Review;
- an exact human Plan Decision gate and frozen-row export interface.

The reproduced Core proof does not run OpenCode or Cursor, launch an agent,
write application source files, assemble a Candidate, run tests on generated
code, or record execution results. It also does not parse or type-check authored
declarations or generated source. The separate Runner integration is described
in [Runtime Adapters](./docs/runtime-adapters.md).

## Reproduce the draft

```sh
npm ci
npm run reproduce
```

The second command recreates only the known files under `output/`, submits all
nine malformed conformance plans followed by the LLM-authored valid Compiled
Plan, creates `output/score.db`, materializes the two draft Agent Packages, and
writes the HTML Plan Review to the retained alpha path
`output/publication-review.html`. It deliberately records no Plan Decision.

Inspect the saved SQLite views with:

```sh
sqlite3 output/score.db < queries/inspect.sql
```

The `npm run approve` and `npm run export` commands are temporary developer
adapters for the proof's role-specific interfaces; they are not SCORE's public
product API. Do not run them until the human explicitly approves the exact
digest set in `output/digest-set.json`.

The implemented alpha retains earlier wire identifiers such as
`score.compilation-bundle`, `coding_passes`, `capsules`, `harness_payloads`, and
`publication_decisions`. [Terminology](./docs/terminology.md) maps those stable
alpha identifiers to the canonical product language without pretending a
schema migration has occurred.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

The Node/npm runtime range and all dependencies are pinned in `package.json`
and `package-lock.json`.
