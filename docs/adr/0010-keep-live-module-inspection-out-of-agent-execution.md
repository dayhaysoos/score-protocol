---
status: accepted
---

# Keep live module inspection out of Agent execution

The Plan Compiler may use `inspect-module` during preparation to derive reviewable Declaration Evidence Bundles, but executing Agents receive complete routed closures in their approved Agent Inputs and cannot inspect the live repository for more context. A future convenience tool may query only already approved bundle bytes; correctness must never depend on an Agent choosing to call it, and the Runtime Adapter cannot add newly discovered project facts.
