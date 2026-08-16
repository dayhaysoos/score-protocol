---
status: accepted
---

# Keep derived declaration evidence out of Slices

OXC-derived declaration evidence is stored as an immutable, digest-bound Context Item in the prepared revision rather than copied into the authored Slice. Reviews and Agent Inputs may present deterministically routed subsets, but changing source evidence requires a new prepared revision and cannot silently rewrite approved product intent.
