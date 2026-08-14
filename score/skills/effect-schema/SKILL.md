---
name: effect-schema-for-score
description: Model and decode SCORE domain data with the Effect v4 APIs pinned by this repository.
license: MIT
compatibility: effect 4.0.0-beta.104
provenance: Adapted from Kit Langton's effect skill, kitlangton/skills at 0cace2ae0bd65e0cb03ab12860b62ae5e043f0df.
---

# Effect schemas for SCORE

Follow SCORE's existing encoded contracts first. This repository pins
`effect@4.0.0-beta.104`; use the APIs and conventions that exist at that pin.

## Records and types

- Define records with `Schema.Struct(...)` and keep the exported TypeScript type
  beside the schema as `export type Name = typeof Name.Type`.
- Define scalar identifiers with constrained branded schemas.
- Define closed variants as a union of structs with literal discriminators.
  Keep the discriminator authoritative rather than inferring it from another
  field.
- Preserve the existing encoded distinction between an absent key and an
  explicit `null`. Do not replace `Schema.NullOr(...)` with an optional field,
  or the reverse, when compatibility matters.

## Errors

- Model expected Effect failures with the beta.104 form
  `Schema.TaggedError<Name>()("Name", fields)`.
- Do not use `Schema.TaggedErrorClass`; it is not available at this pin.
- Give persistence, adapter, and compatibility errors enough stable fields to
  classify the failed operation without exposing provider payloads or secrets.

## Boundary decoding

- Decode unknown JSON, SDK data, and persisted rows at the boundary with
  `Schema.decodeUnknownEffect(...)`.
- Use synchronous decoding only where the established startup or test boundary
  intentionally throws.
- Do not use `as any`, non-null assertions, or unchecked casts to bypass
  validation.
- Fail closed on an unknown discriminator, missing frozen field, or malformed
  historical row.

## Compatibility gate

Before finishing, compare every changed schema to its stored representation.
Historical OpenCode values must decode to the same meaning, and new Pi values
must round-trip without reconstructing or dropping adapter identity.
