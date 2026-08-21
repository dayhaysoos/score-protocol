---
status: accepted
supersedes_in_part: D-088
---

# Bind reviewed local routes and retry only consumers

Every project-local consumed Documented Declaration includes an exact reviewed
`module_specifier` in addition to its declaration name and owning target. SCORE
does not infer this spelling from paths, `tsconfig.json`, package metadata, or a
project environment. Preparation freezes the authored value into the immutable
Agent Brief, renders it for human review, and preserves it through approval and
Runner enqueue.

After all File Candidates exist, SCORE parses only their final in-memory bytes
with the pinned OXC parser and checks each relevant named import against its
frozen route. Missing, ambiguous, wrong, unsupported, or syntactically invalid
relevant imports fail with typed bounded findings. Parser ASTs are ephemeral;
only approved facts, candidate and binding digests, verdict digests, and safe
findings may be retained.

A route failure blames only the consumer Job. SCORE discards that rejected
candidate's bytes, retains its rejected-output digest, preserves every unrelated
successful candidate, and applies nothing. A manually authorized retry invokes
only the failed consumer with the same frozen runtime and approved Agent Input.
The complete candidate set is checked again before one atomic application.

This check grants no access to the repository, `tsconfig.json`, `node_modules`,
package metadata, environment variables, network, installer, shell, compiler,
or project commands. It proves only the supported reviewed declaration route in
the exact candidate bytes; it does not prove TypeScript assignability,
compilation, tests, runtime behavior, or general module resolution.

Activation is forward-only. Coding Profile, compiler input, Compilation Bundle,
Plan Review, Agent Input, and Runner control advance to `0.1.0-alpha.6`;
Approved Pass Export advances to `0.1.0-alpha.7`. Historical artifacts remain
historical and are not silently reinterpreted.
