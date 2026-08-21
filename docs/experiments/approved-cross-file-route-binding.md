# Approved cross-file declaration route binding

**Status:** Successful deterministic binding-and-recovery experiment. Not a
production authoring schema, Agent Input, or Runner rule.

## Question

Can SCORE freeze an explicitly reviewed project-local import route into
immutable approval-bound input, reject a substituted route, and use only the
bound value to drive the already-proven targeted recovery behavior?

## Controlled input

```json
{
  "declaration": "Account",
  "ownerTarget": "src/account.ts",
  "consumerTarget": "src/format-account.ts",
  "moduleSpecifier": "./account.js"
}
```

The experiment treats this value as reviewed authoring input. It does not infer
the module specifier from the owner path, `tsconfig.json`, package metadata, or
the project environment.

## Observed result

1. Two identical preparations produced byte-identical deeply frozen content and
   the exact digest
   `sha256:30cabaf50dd2588a007b91dc6ac0d7900178873a701da2ceb9636bc13b21f2e2`.
2. Replacing `./account.js` with `./wrong.js` and recomputing the substituted
   content's own digest still returned the exact typed finding
   `APPROVED_ROUTE_INPUT_SUBSTITUTED`, because it no longer matched the digest
   bound by approval.
3. The valid binding supplied the route directly to the cross-file recovery
   experiment. No route literal was supplied at that recovery call site.
4. The wrong consumer candidate was the only retry target, the owner candidate
   remained retained, the consumer alone ran again, and the repaired two-file
   set applied atomically after a complete recheck.

| Observation | Result |
| --- | --- |
| Approved route input | Immutable and digest-bound |
| Identical preparation | Byte-identical content and digest |
| Substituted route | Rejected before candidate checking |
| Initial Agent invocations | 2 |
| Retry targets | `src/format-account.ts` only |
| Retained candidate | `src/account.ts` |
| Additional Agent invocations | 1 |
| Final application | Both files together |

## Reproduction

```sh
npm run experiment:approved-cross-file-route-binding
```

The executable binding is
[`src/prototypes/approved-cross-file-route-binding.ts`](../../src/prototypes/approved-cross-file-route-binding.ts),
the public-seam checks are
[`test/approved-cross-file-route-binding.test.ts`](../../test/approved-cross-file-route-binding.test.ts),
and the [interactive state prototype](approved-cross-file-route-binding-prototype.html)
shows the successful and substituted-input paths.

## Conclusion

The two required halves now connect deterministically. An exact reviewed route
can reach verification unchanged, and the resulting binding can drive precise
failure attribution and economical recovery without consulting the TypeScript
project environment.

## What this did not prove at the prototype checkpoint

- At this experiment's checkpoint, the Change and Slice schemas did not contain
  `module_specifier`, and the production preparation, Agent Input, approval
  export, Runner store, and candidate gate were unchanged.
- No protocol version advanced at that checkpoint, and this prototype did not
  supersede D-088. The later production follow-through is recorded by AC-026,
  AC-027, D-095, and ADR-0015.
- The experiment covers one named project-local import and does not establish
  aliases, namespace imports, re-exports, cycles, or general TypeScript
  correctness.
- It does not read `tsconfig.json`, package metadata, `node_modules`, environment
  variables, or network state, and it executes no target-project command.
