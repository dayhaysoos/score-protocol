---
status: accepted
---

# Verify reachable local supporting declarations

Declaration Closure includes non-exported project-local declarations when an approved export transitively references them, because changing their shapes can change the export's meaningful interface. SCORE labels them as Local Supporting Declarations, gives consumers read-only shape context without import instructions, verifies them with the candidate, and continues to exclude unrelated private implementation declarations.
