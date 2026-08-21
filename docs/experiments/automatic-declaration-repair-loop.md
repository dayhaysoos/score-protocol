# Automatic Declaration Repair Loop Experiment

Status: successful deterministic same-session adapter-harness experiment; not a
production Runner feature or live-model demonstration.

## Question

Can SCORE detect an invalid first candidate, send only deterministic typed
findings back to the same OpenCode Agent session, allow one repair turn, and
independently accept or reject the resulting final bytes without an unbounded
retry loop?

## Experimental seam

The opt-in `prototypeAutomaticRepair` configuration is bounded to one repair
continuation. Inside the existing OpenCode session lifecycle, the adapter:

1. sends the frozen Agent Input and waits for one completed turn;
2. safely reads only the assigned regular UTF-8 file without following symbolic
   links;
3. runs the pure assigned-file declaration checker;
4. returns immediately when the first candidate is valid;
5. when invalid, sends one deterministic JSON repair message containing the
   candidate digest, verdict digest, typed findings, and one bounded instruction;
6. waits for a new completed turn in the same session; and
7. independently checks the final candidate bytes before returning success.

Automatic repair implies the final-candidate check; it cannot be enabled without
final enforcement. The complete execution deadline still bounds both turns and
the existing cleanup removes the one session and disposable workspace.

## Result

The public `RuntimeAdapter.invoke` seam establishes three cases:

- an initially valid candidate uses one model turn and is accepted;
- an initially invalid candidate receives one typed repair continuation in the
  same session, changes to valid final bytes, and is accepted; and
- a candidate that remains invalid after the continuation is rejected as
  candidate integrity with no third prompt.

The repair message contains no candidate source, repository search result,
environment value, project command output, or newly discovered product fact.

## Cost boundary

The continuation reuses one Agent session, but it is another model turn and may
be another paid provider invocation. No extra model turn occurs when the first
candidate is valid. No paid Agent was invoked for this deterministic harness
experiment.

## Reproduction

```sh
npm run experiment:automatic-repair
npm run typecheck
```

## What this proves

The current OpenCode adapter lifecycle can remain open long enough for one
system-triggered repair continuation. SCORE, rather than the Agent, decides
whether feedback is needed, supplies only deterministic findings, bounds the
loop, and retains final-byte authority.

## What this does not prove

This is not production policy, durable repair evidence, manual retry behavior,
complete-set verification, universal model repair ability, or a claim that a
real paid model will always fix the reported issue. It does not run project
typecheck, builds, tests, or behavioral checks.

## Next experiment

This follow-up is complete in the
[approved-input binding experiment](approved-declaration-input-binding.md).
