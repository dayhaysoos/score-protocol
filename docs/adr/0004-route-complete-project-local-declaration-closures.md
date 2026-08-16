---
status: accepted
---

# Route complete project-local declaration closures

Each Agent receives the complete bounded transitive closure of project-local declarations reachable from every declaration it owns or consumes, rather than direct references alone. SCORE orders and deduplicates the closure deterministically, excludes unrelated declarations and implementation bodies, and blocks preparation instead of emitting partial context when a project-local reference is missing, ambiguous, unsupported, or beyond declared limits.
