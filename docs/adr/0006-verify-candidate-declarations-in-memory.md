---
status: accepted
---

# Verify candidate declarations in memory

Before atomic application, SCORE parses the complete candidate set in memory and enforces approved declaration shapes and routing without constructing a TypeScript project, copying the repository, loading environment variables, installing packages, or running project commands. The Declaration Evidence Bundle, content digests, verdict, and bounded findings are durable; parser ASTs are ephemeral, and a passing gate claims declaration conformance only—not compilation, tests, or behavioral correctness.
