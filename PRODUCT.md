# Product

## Register

product

## Users

The primary user is the human authority reviewing a prepared SCORE Change or
Slice before approval. They are working in a browser, want to understand the
decision quickly, and need machine evidence available without reading a raw
database or audit dump.

## Product Purpose

The Change Review or Slice Review helps a human decide whether one prepared
entity, its exact file boundary, shared Contracts, per-file instructions, and
unresolved findings are acceptable. These are the Coding Profile presentations
of the canonical Plan Review. Success means the reviewer can reach an informed
approve-or-reject decision while deterministic identities, digests, provenance,
and traceability remain inspectable on demand.

## Brand Personality

Calm, concise, trustworthy.

## Anti-references

- Raw JSON or database dumps presented as the primary review experience.
- Long pages that give UUIDs and digests the same prominence as human meaning.
- Decorative dashboard chrome, fake metrics, or visual effects that compete
  with the approval decision.
- Hidden semantic content that prevents the reviewer from knowing what an agent
  will be asked to do.

## Design Principles

- Lead with the Change or Slice, its files, and any unresolved risk.
- Show human meaning once; keep repeated machine structure in the audit layer.
- Let reviewers select each file and inspect its exact prompt, context, skills,
  and limits as one bounded instruction package.
- Present declaration text and its description exactly as authored; do not imply
  that SCORE parsed, type-checked, or behaviorally verified it.
- Keep exact Agent Package data accessible without making it the default reading path.
- Use deterministic rendering only; never rewrite review content with an LLM.

## Accessibility & Inclusion

Target WCAG 2.2 AA contrast, semantic landmarks and headings, full keyboard
access, visible focus states, readable line lengths, responsive layouts, and a
reduced-motion-safe interface.
