# Effect for the Runner queue

Status: research note, not normative protocol text

Reviewed: 2026-08-06

Historical note: D-086 supersedes this note's recommendation that the OpenCode
server itself be a per-Job resource. Per-Job workspaces, clients, sessions, and
cleanup remain current; one disposable server now belongs to the Run.

This note evaluates Effect as the concurrency and queue substrate for a local,
user-owned SCORE Runner. It uses official Effect documentation and source, plus
Kit Langton's explicitly opinionated Effect v4 skill where noted. The
recommended design below is an inference for SCORE, not a claim made by the
Effect project.

## Conclusion

Use **Effect v4's top-level core modules for structured, bounded concurrency**,
but keep the durable Run, Job, and Attempt state machine in the Runner's own
SQLite database. Do not use Effect's in-memory `Queue` as the source of truth,
and do not adopt Effect Persistence, Workflows, or Cluster for the first local
alpha. This is a deliberate beta dependency choice, not a production-stability
claim.

For 100 independent File Briefs, a concurrency setting of `5` should mean “at
most five jobs may be running,” not “split the files into fixed groups of five.”
As soon as one job finishes, another eligible job may be claimed. File order can
remain a stable display and tie-breaking property without becoming an execution
dependency.

## What Effect core provides

### `Queue`: useful coordination, not durability

Effect documents `Queue` as a lightweight **in-memory** queue. A bounded queue
provides backpressure by suspending `offer` while full; dropping and sliding
queues discard new or old values; an unbounded queue has no capacity limit.
`take` is FIFO and suspends while empty. [`shutdown` interrupts suspended offers
and takes, empties the queue, and makes later queue operations terminate](https://www.effect.website/docs/v3/concurrency/queue#shutting-down-a-queue).

That makes `Queue` suitable as an optional wake-up channel inside one live
Runner process. It cannot provide restart recovery: process exit loses its
contents, and orderly shutdown explicitly clears them. SQLite must remain the
source from which pending jobs are rediscovered.

### Numeric concurrency is the direct fit

Effect's concurrency option accepts a number, `"unbounded"`, or `"inherit"`.
The official docs state that a number such as `2` limits execution to two
effects at once, while omitting the option is sequential
([concurrency options](https://www.effect.website/docs/v3/concurrency/basic-concurrency#concurrency-options)).
The same option is available on collection operations such as `Effect.forEach`;
streams also expose bounded effectful mapping through
[`Stream.mapEffect(..., { concurrency: N })`](https://www.effect.website/docs/v3/stream/operations#effectful-mapping).

For a finite, already-selected set of jobs, the simplest shape is conceptually:

```ts
Effect.forEach(jobs, runOneJob, { concurrency: maxConcurrency })
```

There is one important policy detail: Effect's structured concurrency normally
propagates interruption across sibling concurrent effects when one is
interrupted. Each job should therefore capture its own `Exit` and persist its
own terminal state instead of allowing one ordinary job failure to escape and
cancel unrelated siblings
([interruption of concurrent effects](https://www.effect.website/docs/v3/concurrency/basic-concurrency#interruption-of-concurrent-effects)).

Once jobs are claimed dynamically from SQLite, a clearer long-running design is
`N` identical worker fibers. Each fiber repeatedly claims one eligible row in a
transaction, runs one isolated OpenCode session, and records the outcome. This
is a worker pool in the ordinary architectural sense; it does not require
Effect's `Pool` data type.

### `Semaphore`, `Pool`, and `Stream`

- A `Semaphore` is useful when several Runs or code paths must share one global
  capacity limit, or when work has different weights. `withPermits` releases
  permits even when the wrapped effect fails or is interrupted
  ([Semaphore docs](https://www.effect.website/docs/v3/concurrency/semaphore#withpermits)).
  It is unnecessary when one `Effect.forEach` call already owns the only limit.
- Effect's `Pool` manages reusable, scoped resources that fibers borrow and
  return; it supports fixed or elastic sizes and per-resource concurrency. It
  is not a job queue
  ([official source](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/Pool.ts#L1-L50)).
  It would fit reusable provider clients or transports, but not isolated,
  one-shot OpenCode sessions.
- Effect v4's `Stream.mapEffect` supports both numeric concurrency and
  `unordered: true`, which matches independent files when there is a genuine
  stream. A small set of database-claim workers is still the more direct model
  for a durable SQLite queue
  ([v4 source](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/Stream.ts#L1790-L1850)).

## Durable queue and workflow packages

The Effect ecosystem does contain persistent queue machinery:

- Effect v3 publishes `@effect/workflow` `0.19.1`; its `DurableQueue` wraps a
  `PersistedQueue`, waits for completion using a durable deferred, derives an
  idempotency key, and accepts a worker `concurrency` number
  ([API reference](https://www.effect.website/docs/v3/api/workflow/DurableQueue)).
- The v3 SQL persisted-queue implementation has an official SQLite integration
  test using `@effect/sql-sqlite-node`
  ([source](https://github.com/Effect-TS/effect/blob/bd20125fb9b8ce42f814ba738513daaf83ce723d/packages/sql-sqlite-node/test/SqlPersistedQueue.test.ts)).
- In Effect v4, persistence, workflows, and clustering have moved into
  `effect/unstable/*`. The current reviewed package manifest is
  `4.0.0-beta.104` and exports `unstable/persistence`, `unstable/workflow`, and
  `unstable/cluster`
  ([manifest](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/package.json#L1-L50)).
  Its `PersistedQueue` supports de-duplicated IDs, SQL-backed storage including
  SQLite, worker locks, and retry accounting
  ([source](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/unstable/persistence/PersistedQueue.ts#L1-L95),
  [SQL store](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/unstable/persistence/PersistedQueue.ts#L740-L795)).

These packages are real capabilities, but they are not a good alpha boundary
for SCORE:

1. **Their recovery policy is different.** `PersistedQueue.take` retries failed
   work and defaults to ten maximum attempts. Its SQL store uses renewable
   worker locks with a two-minute default expiration, after which abandoned work
   becomes claimable again
   ([queue contract](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/unstable/persistence/PersistedQueue.ts#L50-L95),
   [lock configuration](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/unstable/persistence/PersistedQueue.ts#L740-L795)).
   That is reasonable at-least-once queue behavior, but an OpenCode call can
   complete externally just before the Runner crashes. Automatic redelivery
   would then risk launching the agent twice. SCORE's proposed
   `needs_attention` state requires a deliberate, domain-specific recovery
   rule.
2. **A queue row is not the Runner's audit model.** SCORE still needs explicit
   Run, Job, and Attempt identities; the approved package digest; adapter,
   provider, model, SDK, and CLI versions; candidate artifact and digest; claim
   and heartbeat data; failure classification; and the human retry decision. A
   generic persisted payload plus attempt counter does not replace that state
   machine.
3. **`DurableQueue` is workflow-coupled.** It is designed for a workflow to
   enqueue work, suspend on a durable deferred, and resume when a worker records
   the result. Its worker depends on the workflow engine as well as the
   persisted-queue factory
   ([official source](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/unstable/workflow/DurableQueue.ts#L1-L9),
   [worker contract](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/unstable/workflow/DurableQueue.ts#L249-L333)).
   The durable workflow implementation is built on Effect Cluster's sharding
   and message storage, which is much broader than a single-user local Runner
   ([Cluster workflow engine](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/unstable/cluster/ClusterWorkflowEngine.ts#L1-L45)).
4. **Stability is not aligned with the alpha.** Effect's official site labels
   Clustering and Workflows **Alpha**
   ([Effect home page](https://www.effect.website/)). Effect v4 is still beta;
   the release post says `effect/unstable/*` modules may break in minor releases
   and recommends v3 for production
   ([v4 beta announcement](https://www.effect.website/blog/releases/effect/40-beta#unstable-modules)).

Using a generic persisted queue underneath a separate Runner state machine
would also create two competing sources of truth. For the alpha, it is simpler
and safer to claim work directly from the Runner's domain tables.

## Recommended alpha boundary

1. Keep `score.db` unchanged as SCORE's approved-definition store.
2. Put operational `runs`, `jobs`, `attempts`, and events in a Runner-owned
   SQLite database.
3. On enqueue, freeze the selected approved Agent Packages into Job records.
   Preserve a stable ordinal for display and reproducibility, but do not gate
   Job N on Job N-1.
4. Start `N` Effect worker fibers, with a conservative default such as `5` and
   an explicit configurable ceiling. Each worker atomically claims any eligible
   Job; there are no fixed batches.
5. Persist each Job's success or failure independently. Do not let an ordinary
   Job failure interrupt unrelated running Jobs.
6. On clean interruption, stop claiming new Jobs and allow bounded graceful
   shutdown. On an ambiguous process crash, do not automatically rerun an
   external agent call; expose the affected Attempt as `needs_attention`.

Effect would solve typed errors, structured resource lifetimes, cancellation,
bounded concurrency, and observability around this loop. It would **not** decide
SCORE's claim protocol, crash ambiguity, idempotency boundary, retry authority,
or audit schema. Those remain Runner domain decisions encoded in SQLite.

For this experimental Runner, use Effect v4 with exact beta pins and adopt only
the top-level core abstractions plus a narrowly contained SQLite driver. Revisit
v4 persisted queues and workflows after SCORE has proved its own
Run/Job/Attempt semantics; their instability is not the main objection, but it
makes the semantic mismatch more expensive to absorb.

## Effect v4 and Kit Langton's skill

Kit's repository contains one Effect skill. It targets v4 and describes an
opinionated application style; it is not official Effect documentation. The
relevant reviewed files were
[`skills/effect/SKILL.md`](https://github.com/kitlangton/skills/blob/0cace2ae0bd65e0cb03ab12860b62ae5e043f0df/skills/effect/SKILL.md),
[`SCHEMA.md`](https://github.com/kitlangton/skills/blob/0cace2ae0bd65e0cb03ab12860b62ae5e043f0df/skills/effect/references/SCHEMA.md),
[`SERVICES_LAYERS.md`](https://github.com/kitlangton/skills/blob/0cace2ae0bd65e0cb03ab12860b62ae5e043f0df/skills/effect/references/SERVICES_LAYERS.md),
[`CONFIG.md`](https://github.com/kitlangton/skills/blob/0cace2ae0bd65e0cb03ab12860b62ae5e043f0df/skills/effect/references/CONFIG.md),
[`SCHEDULING.md`](https://github.com/kitlangton/skills/blob/0cace2ae0bd65e0cb03ab12860b62ae5e043f0df/skills/effect/references/SCHEDULING.md),
[`STREAMS.md`](https://github.com/kitlangton/skills/blob/0cace2ae0bd65e0cb03ab12860b62ae5e043f0df/skills/effect/references/STREAMS.md),
[`TESTING.md`](https://github.com/kitlangton/skills/blob/0cace2ae0bd65e0cb03ab12860b62ae5e043f0df/skills/effect/references/TESTING.md),
and
[`HTTP_CLIENTS.md`](https://github.com/kitlangton/skills/blob/0cace2ae0bd65e0cb03ab12860b62ae5e043f0df/skills/effect/references/HTTP_CLIENTS.md).

### What changes in the implementation

The queue contract does not change: SQLite remains authoritative, jobs remain
independent, concurrency is a ceiling rather than a batch barrier, and an
ambiguous external attempt is never automatically redelivered. The code should
be organized around these v4 services instead:

- `RunnerStore`: owns atomic claim, Attempt creation, terminal writes, and row
  decoding.
- `OpenCodeAdapter`: owns exactly one isolated SDK invocation and maps SDK or
  provider failures into typed adapter errors.
- `RunWorker`: claims one Job, invokes the adapter outside the database
  transaction, validates the candidate, and persists the outcome.
- `WorkerPool`: starts `max_concurrency` scoped workers and owns their lifetime.
- `RunnerConfiguration`: reads database path, concurrency, model, and provider
  settings through `Config`.

Define those boundaries with `Context.Service`, construct real implementations
with explicit `Layer.effect` layers, and name public operations with
`Effect.fn("Domain.operation")`. Model Run, Job, Attempt, Candidate, and event
rows with `Schema.Struct`; use branded schemas for their IDs;
`Schema.TaggedUnion` for persisted variants; and `Schema.TaggedError` for
expected persistence, adapter, validation, and ambiguity failures. Decode every
SQLite row and SDK response with `Schema.decodeUnknownEffect` rather than casts.
These conventions come from Kit's skill and are supported by the current v4
[`Context.Service`](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/Context.ts#L98-L245),
[`Layer`](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/Layer.ts),
and
[`Schema`](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/Schema.ts)
APIs.

### Concurrency and resource ownership

For the finite set frozen at enqueue time, start `N` identical workers. Each
worker atomically claims any pending Job, runs it, records its outcome, and
claims again until no work remains. `N` is the concurrency ceiling; job and
completion order have no correctness meaning. A finite in-memory traversal may
use `Effect.forEach(..., { concurrency: N })`, while a real stream may use
`Stream.mapEffect(..., { concurrency: N, unordered: true })`
([`Effect.forEach` source](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/Effect.ts#L708-L797)).
The database-claim loop remains preferable because it preserves restart and
claim semantics without first loading the queue into memory.

The `WorkerPool` layer should fork workers with `Effect.forkScoped` or manage
them with `FiberSet`; layer acquisition must not block on a forever loop. Catch
and persist expected failures around one Job so they do not cancel independent
siblings, while preserving interruption and allowing defects to reach the
supervision boundary. An Effect `Queue` may wake idle workers, but is optional
for the finite CLI-run alpha and never owns a Job.

Treat each OpenCode workspace, server, client, and session as one scoped Job
resource, not a reusable Effect `Pool` entry. Use
`Effect.acquireUseRelease`, pass the Effect-provided `AbortSignal` into server
startup, and always close the server in the finalizer. Effect's scoped
finalizers run on success, typed failure, defect, or interruption
([OpenCode SDK](https://opencode.ai/docs/sdk/#create-client),
[`acquireRelease` source](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/Effect.ts#L6475-L6685)).

Implementation inspection found one important SDK-helper limitation: the
`createOpencode` / `createOpencodeServer` helper in `@opencode-ai/sdk@1.18.14`
does not expose a child-process working directory or the CLI's `--pure` flag.
The adapter therefore launches `opencode serve --pure` in the disposable
workspace and uses the official `createOpencodeClient` SDK API against that
server. This preserves the SDK session seam while making workspace and plugin
isolation explicit. The implementation pins the matching `opencode-ai` CLI,
verifies its version before startup, and isolates its config, data, cache, and
state paths inside the disposable Job directory.

### SQLite boundary

For the new `runner.db`, the Effect-native option is the exact-matching
`@effect/sql-sqlite-node` beta. Its v4 implementation uses Node's built-in
`node:sqlite`, enables WAL by default, serializes one connection with a
semaphore, closes it through the owning Scope, and exposes transaction support
([official driver source](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/sql/sqlite-node/src/SqliteClient.ts),
[`SqlClient.withTransaction`](https://github.com/Effect-TS/effect/blob/b938c8ad2823bd88493187922f7d9090eff037b6/packages/effect/src/unstable/sql/SqlClient.ts#L38-L68)).
The repository's Node 26 runtime already satisfies `node:sqlite`.

Keep that unstable SQL API entirely behind `RunnerStore`. Claim one Job and
create its Attempt in one short transaction, ideally with a conditional
`UPDATE ... RETURNING` claim. Commit before starting OpenCode; later write the
terminal result in a separate short transaction. Do not migrate or otherwise
change `score.db` merely to adopt the Runner driver.

Do **not** use `effect/unstable/persistence`,
`effect/unstable/workflow/DurableQueue`, or Cluster underneath `RunnerStore`.
Their automatic retry, expiring-lock, and at-least-once recovery model still
conflicts with the Runner's `needs_attention` boundary, and it would duplicate
the domain tables. Kit's skill also treats `Queue` as in-memory coordination,
not as durable state.

### Version and test consequences

The reviewed release is `4.0.0-beta.104`. Effect's official beta announcement
says beta releases may break, recommends v3 for production, and allows
`effect/unstable/*` modules to break in minor releases. It also says all v4
ecosystem packages share one version
([Effect v4 beta announcement](https://www.effect.website/blog/releases/effect/40-beta)).
Therefore pin, rather than range, the matching versions:

- `effect@4.0.0-beta.104`;
- `@effect/sql-sqlite-node@4.0.0-beta.104`;
- optionally `@effect/vitest@4.0.0-beta.104` with compatible Vitest 4.1 for the
  new Runner tests.

Do not install from the moving `beta` tag in a reproducible branch. Upgrade all
Effect packages together behind typecheck, queue-state, crash-recovery, and
resource-finalization tests. If the Runner adopts Kit's testing conventions,
use `it.effect`, test layers, `TestClock`, `Deferred`, `Queue`, `Latch`, and
`Ref`; do not use real sleeps. The existing non-Effect tests need not be
rewritten merely to add this subsystem.
