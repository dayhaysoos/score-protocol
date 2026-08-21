---
status: accepted
supersedes_in_part: ADR-0005
---

# Bind selected external declarations during preparation

When a reviewed Agent Brief explicitly names installed-package members it needs,
trusted preparation resolves and freezes their public TypeScript declarations.
It may read only the root `package-lock.json`, the selected locked package's
`package.json`, and selected regular `.d.ts` files inside that same package.

External packages remain Declaration Closure boundaries. SCORE includes only
the selected public declarations and one fixed layer of directly required
supporting declarations. It never recursively copies a dependency type graph,
follows declarations into another package, or exposes package paths or internal
module routes to the File Agent.

The reviewed authoring field records the exact package specifier, public member
names, and purpose. Preparation fails with typed findings when the locked
identity or public declaration route is missing, ambiguous, unsupported,
incomplete, unsafe, or over a fixed bound. The resulting full evidence and the
sanitized Agent Brief projection are immutable and digest-bound.

Authored Documented Declarations remain authoritative. External Declaration
Evidence supplies dependency context only; it does not infer product intent or
prove TypeScript assignability, compilation, runtime behavior, or package API
usage in a candidate.

This decision grants no File Agent or Runtime Adapter access to the repository,
`node_modules`, package metadata, environment variables, network, installer,
shell, project compiler, or project commands. Preparation still does not read
`tsconfig.json`, construct a TypeScript project, resolve the general project
environment, or verify a complete candidate set. The Coding Profile, compiler
input, Compilation Bundle, Plan Review, Agent Input, and Runner control advance
forward-only to `0.1.0-alpha.5`; Approved Pass Export advances to
`0.1.0-alpha.6`.
