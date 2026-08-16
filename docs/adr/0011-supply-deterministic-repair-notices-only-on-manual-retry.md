---
status: accepted
---

# Supply deterministic Repair Notices only on manual retry

When the Candidate Declaration Gate rejects a candidate, SCORE preserves successful candidates, presents the exact bounded mismatch, and asks whether to retry or stop. A manually authorized retry uses the same approved Agent Input and frozen runtime plus a Repair Notice derived only from the approved declaration, rejected candidate, and deterministic verdict; it adds no new project facts or intent, while a wrong approved contract requires a new prepared revision rather than another retry.
