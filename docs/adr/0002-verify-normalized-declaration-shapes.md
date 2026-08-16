---
status: accepted
---

# Verify normalized declaration shapes

Declaration Verification compares canonical AST-derived structure rather than raw declaration text or TypeScript assignability. Formatting and approved trivia do not affect the verdict, while export identity, declaration kind, parameters, generics, modifiers, optionality, members, and type structure must match the approved Documented Declaration without unapproved aliases or other assignable substitutions.
