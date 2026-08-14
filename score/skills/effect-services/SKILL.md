---
name: effect-services-for-score
description: Build SCORE runtime boundaries and scoped lifecycles with the Effect v4 APIs pinned by this repository.
license: MIT
compatibility: effect 4.0.0-beta.104
provenance: Adapted from Kit Langton's effect skill, kitlangton/skills at 0cace2ae0bd65e0cb03ab12860b62ae5e043f0df.
---

# Effect services and layers for SCORE

Follow the repository's named-export module style. This repository pins
`effect@4.0.0-beta.104`; do not substitute APIs from a newer Effect release.

## Service boundary

- Use `Context.Service` for an application service and keep its public surface
  smaller than its implementation.
- Use function-valued service members, including zero-argument operations.
- Name public and non-trivial internal operations with
  `Effect.fn("Domain.operation")`.
- Return typed errors at the boundary. Wrap SDKs, CLIs, filesystems, and SQL in
  named effects instead of leaking their raw failures.
- Keep the repository's named exports. Do not introduce the optional
  self-exporting module-namespace pattern from the upstream skill.

## Layers and dependencies

- Build effectful implementations with `Layer.effect(Service, makeEffect)` and
  return `Service.of({ ... })`.
- Use `Layer.succeed` only for an already-built implementation and
  `Layer.unwrap` only when an effect chooses the layer.
- Make authority and lifecycle dependencies explicit. Do not use
  `Layer.mergeAll(...)`, `provideMerge`, or default references merely to make
  the environment type compile.

## Scoped lifecycle

- Put acquisition, use, and cleanup for child processes, sessions, disposable
  workspaces, and external clients in one scope. Finalizers must run after
  success, typed failure, defect, timeout, or interruption.
- Fork owned background work with `Effect.forkScoped`; layer acquisition must
  not block on a forever loop.
- Preserve interruption when translating broad failures. A timeout belongs
  inside the adapter lifecycle when cleanup depends on aborting external work.
- Keep provider or network work outside authoritative SQLite transactions.
- Retry only an idempotent operation and only at a boundary with a truthful
  retry policy.

## Change gate

This Slice is a behavior-preserving seam extraction. Apply these practices to
the touched boundary without rewriting unrelated polling, HTTP, environment,
or scheduler machinery. The service is complete when its scope owns every
resource it acquires and its caller sees only the declared result and typed
failure surface.
