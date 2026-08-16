import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { Cause, Effect } from "effect";

import { canonicalJson, sha256Bytes, sha256Json } from "../canonical.js";
import { normalizeProjectRelativePath } from "../project-path.js";
import type { RepositorySourceSnapshot } from "../repository-source-state.js";
import { ScoreAlpha } from "../score-alpha.js";
import { safeFailureMessage } from "./diagnostic-sanitization.js";
import {
  type AdapterCompatibilityError,
  type ApprovedPackageIntegrityError,
  type CandidateFile,
  type ConfirmedTarget,
  type EnqueueApprovedPlanInput,
  type EnqueuedRun,
  type FailureCategory,
  type PlanNotApproved,
  type RunnerCounts,
  type RunRecoveryRequired,
  type RunId,
  type RunObservation,
  type RepositoryBinding,
  type RunSnapshot,
  RunnerStoreError
} from "./domain.js";
import { loadApprovedPlan } from "./approved-plan.js";
import { RuntimeAdapter } from "./runtime-adapter.js";
import { RunnerStore, RunnerStoreLive } from "./runner-store.js";
import type {
  RuntimeAttemptFact,
  RuntimeAttemptReporter
} from "./runtime-attempt-observation.js";
import {
  RepositoryApplicationConflictError,
  RepositoryApplicationError,
  RepositoryDriftError,
  RepositoryRootError,
  type RepositoryDriftFinding,
  applyCandidateSet,
  captureRepositoryTargets,
  findMissingRepositoryTargets,
  repositoryDifferencesFromSnapshot,
  resolveRepositoryRoot,
  verifyRepositoryTargetsMatch,
  verifyRepositoryMatchesSnapshot
} from "./repository-application.js";

function comparableDatabasePath(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return existsSync(parent)
    ? resolve(realpathSync(parent), basename(absolute))
    : absolute;
}

export function validateRunnerDatabaseBoundary(
  scoreDatabasePath: string,
  runnerDatabasePath: string
): Effect.Effect<void, RunnerStoreError> {
  return Effect.try({
    try: () => {
      const scorePath = comparableDatabasePath(scoreDatabasePath);
      const runnerPath = comparableDatabasePath(runnerDatabasePath);
      const scoreStat = existsSync(scorePath) ? statSync(scorePath) : undefined;
      const runnerStat = existsSync(runnerPath) ? statSync(runnerPath) : undefined;
      const sameExistingFile =
        scoreStat !== undefined &&
        runnerStat !== undefined &&
        scoreStat.dev === runnerStat.dev &&
        scoreStat.ino === runnerStat.ino;
      if (scorePath === runnerPath || sameExistingFile) {
        throw new Error("Runner database must be separate from the SCORE database");
      }
    },
    catch: (cause) =>
      new RunnerStoreError({
        operation: "databaseBoundary",
        message: cause instanceof Error ? cause.message : String(cause)
      })
  });
}

export interface PreparedRepository {
  readonly repositoryRoot: string;
  readonly missingReplacementPaths: ReadonlyArray<string>;
}

export interface PreparedGuidedRepository {
  readonly repositoryRoot: string;
  readonly confirmedTargets: ReadonlyArray<ConfirmedTarget>;
  readonly repositoryDifferences: ReadonlyArray<RepositoryDriftFinding>;
}

const resolveConfirmedRepositoryBinding = Effect.fn(
  "Runner.resolveConfirmedRepositoryBinding"
)(function*(input: {
  readonly scoreDatabasePath: string;
  readonly confirmedTargets: ReadonlyArray<ConfirmedTarget>;
  readonly invokingDirectory?: string;
  readonly repositoryOverride?: string;
}) {
  const store = yield* RunnerStore;
  const scoreDatabasePath = comparableDatabasePath(input.scoreDatabasePath);
  const savedRepositoryRoot = yield* store.readSavedRepositoryRoot(scoreDatabasePath);
  const candidate =
    input.repositoryOverride ??
    savedRepositoryRoot ??
    input.invokingDirectory ??
    process.cwd();
  const repositoryRoot = yield* Effect.try({
    try: () => {
      const root = resolveRepositoryRoot(candidate);
      verifyRepositoryTargetsMatch({
        repositoryRoot: root,
        confirmedTargets: input.confirmedTargets
      });
      return root;
    },
    catch: (cause) =>
      cause instanceof RepositoryDriftError || cause instanceof RepositoryRootError
        ? cause
        : new RepositoryRootError(
            cause instanceof Error ? cause.message : String(cause)
          )
  });
  yield* store.saveRepositoryRoot({ scoreDatabasePath, repositoryRoot });
  return repositoryRoot;
});

const resolveVerifiedRepositoryBinding = Effect.fn(
  "Runner.resolveVerifiedRepositoryBinding"
)(function*(input: {
  readonly scoreDatabasePath: string;
  readonly sourceSnapshot: RepositorySourceSnapshot;
  readonly targetPaths: ReadonlyArray<string>;
  readonly absentPaths: ReadonlyArray<string>;
  readonly recoverableMissingPaths?: ReadonlyArray<string>;
  readonly acceptedMissingPaths?: ReadonlyArray<string>;
  readonly invokingDirectory?: string;
  readonly repositoryOverride?: string;
}) {
  const store = yield* RunnerStore;
  const scoreDatabasePath = comparableDatabasePath(input.scoreDatabasePath);
  const savedRepositoryRoot = yield* store.readSavedRepositoryRoot(scoreDatabasePath);
  const candidate =
    input.repositoryOverride ??
    savedRepositoryRoot ??
    input.invokingDirectory ??
    process.cwd();
  const repositoryRoot = yield* Effect.try({
    try: () => {
      const root = resolveRepositoryRoot(candidate);
      const missingReplacementPaths =
        input.acceptedMissingPaths ??
        (input.recoverableMissingPaths === undefined
          ? []
          : findMissingRepositoryTargets({
              repositoryRoot: root,
              snapshot: input.sourceSnapshot,
              targetPaths: input.recoverableMissingPaths
            }));
      verifyRepositoryMatchesSnapshot({
        repositoryRoot: root,
        snapshot: input.sourceSnapshot,
        targetPaths: input.targetPaths,
        absentPaths: input.absentPaths,
        acceptedMissingPaths: missingReplacementPaths
      });
      return { repositoryRoot: root, missingReplacementPaths };
    },
    catch: (cause) =>
      cause instanceof RepositoryDriftError || cause instanceof RepositoryRootError
        ? cause
        : new RepositoryRootError(
            cause instanceof Error ? cause.message : String(cause)
          )
  });
  yield* store.saveRepositoryRoot({
    scoreDatabasePath,
    repositoryRoot: repositoryRoot.repositoryRoot
  });
  return repositoryRoot;
});

export function prepareRepositoryForPlan(input: {
  readonly scoreDatabasePath: string;
  readonly runnerDatabasePath: string;
  readonly passId: string;
  readonly invokingDirectory?: string;
  readonly repositoryOverride?: string;
  readonly recoverMissingReplacements?: boolean;
}): Effect.Effect<
  PreparedRepository,
  RunnerStoreError | RepositoryDriftError | RepositoryRootError
> {
  return validateRunnerDatabaseBoundary(
    input.scoreDatabasePath,
    input.runnerDatabasePath
  ).pipe(
    Effect.andThen(
      Effect.scoped(
        Effect.gen(function*() {
          const store = yield* RunnerStore;
          yield* store.initialize;
          const reviewedPlan = yield* Effect.try({
            try: () =>
              ScoreAlpha.readReviewedPlanRepositoryState(
                input.scoreDatabasePath,
                input.passId
              ),
            catch: (cause) =>
              new RunnerStoreError({
                operation: "readReviewedPlan",
                message: cause instanceof Error ? cause.message : String(cause)
              })
          });
          const repository = yield* resolveVerifiedRepositoryBinding({
            scoreDatabasePath: input.scoreDatabasePath,
            sourceSnapshot: reviewedPlan.sourceSnapshot,
            targetPaths: reviewedPlan.allowedChanges.map((change) => change.targetPath),
            absentPaths: reviewedPlan.allowedChanges
              .filter((change) => change.operation === "create")
              .map((change) => change.targetPath),
            ...(input.recoverMissingReplacements === true
              ? {
                  recoverableMissingPaths: reviewedPlan.allowedChanges
                    .filter((change) => change.operation === "replace")
                    .map((change) => change.targetPath)
                }
              : {}),
            ...(input.invokingDirectory === undefined
              ? {}
              : { invokingDirectory: input.invokingDirectory }),
            ...(input.repositoryOverride === undefined
              ? {}
              : { repositoryOverride: input.repositoryOverride })
          });
          return {
            repositoryRoot: repository.repositoryRoot,
            missingReplacementPaths: repository.missingReplacementPaths
          } satisfies PreparedRepository;
        }).pipe(Effect.provide(RunnerStoreLive(input.runnerDatabasePath)))
      )
    )
  );
}

export function prepareRepositoryForGuidedPlan(input: {
  readonly scoreDatabasePath: string;
  readonly runnerDatabasePath: string;
  readonly passId: string;
  readonly invokingDirectory?: string;
  readonly repositoryOverride?: string;
}): Effect.Effect<
  PreparedGuidedRepository,
  RunnerStoreError | RepositoryDriftError | RepositoryRootError | RepositoryApplicationError
> {
  return validateRunnerDatabaseBoundary(
    input.scoreDatabasePath,
    input.runnerDatabasePath
  ).pipe(
    Effect.andThen(
      Effect.scoped(
        Effect.gen(function*() {
          const store = yield* RunnerStore;
          yield* store.initialize;
          const reviewedPlan = yield* Effect.try({
            try: () =>
              ScoreAlpha.readReviewedPlanRepositoryState(
                input.scoreDatabasePath,
                input.passId
              ),
            catch: (cause) =>
              new RunnerStoreError({
                operation: "readReviewedPlan",
                message: cause instanceof Error ? cause.message : String(cause)
              })
          });
          const scoreDatabasePath = comparableDatabasePath(input.scoreDatabasePath);
          const savedRepositoryRoot = yield* store.readSavedRepositoryRoot(scoreDatabasePath);
          const candidate =
            input.repositoryOverride ??
            savedRepositoryRoot ??
            input.invokingDirectory ??
            process.cwd();
          const repositoryRoot = yield* Effect.try({
            try: () => resolveRepositoryRoot(candidate),
            catch: (cause) =>
              cause instanceof RepositoryRootError
                ? cause
                : new RepositoryRootError(
                    cause instanceof Error ? cause.message : String(cause)
                  )
          });
          const approvedTargets = reviewedPlan.allowedChanges.map((change) => ({
            targetPath: change.targetPath,
            operation: supportedApplicationOperation(change.operation)
          }));
          const confirmedTargets = yield* Effect.try({
            try: () =>
              captureRepositoryTargets({
                repositoryRoot,
                targetPaths: approvedTargets.map((target) => target.targetPath)
              }),
            catch: (cause) =>
              cause instanceof RepositoryDriftError ||
              cause instanceof RepositoryRootError ||
              cause instanceof RepositoryApplicationError
                ? cause
                : new RepositoryRootError(
                    cause instanceof Error ? cause.message : String(cause)
                  )
          });
          const repositoryDifferences = repositoryDifferencesFromSnapshot({
            snapshot: reviewedPlan.sourceSnapshot,
            approvedTargets,
            confirmedTargets
          });
          return {
            repositoryRoot,
            confirmedTargets,
            repositoryDifferences
          } satisfies PreparedGuidedRepository;
        }).pipe(Effect.provide(RunnerStoreLive(input.runnerDatabasePath)))
      )
    )
  );
}

const enqueueApprovedPlanEffect = Effect.fn("Runner.enqueueApprovedPlan")(
  function*(input: EnqueueApprovedPlanInput) {
    const store = yield* RunnerStore;
    yield* store.initialize;
    const approvedPlan = yield* loadApprovedPlan({
      scoreDatabasePath: input.scoreDatabasePath,
      passId: input.passId
    });
    const repositoryRoot =
      input.confirmedTargets === undefined
        ? (
            yield* resolveVerifiedRepositoryBinding({
              scoreDatabasePath: input.scoreDatabasePath,
              sourceSnapshot: approvedPlan.source_snapshot,
              targetPaths: approvedPlan.payloads.map((payload) => payload.target_path),
              absentPaths: approvedPlan.payloads
                .filter((payload) => payload.operation === "create")
                .map((payload) => payload.target_path),
              acceptedMissingPaths: input.acceptedMissingReplacementPaths ?? [],
              ...(input.repositoryRoot === undefined
                ? {}
                : { repositoryOverride: input.repositoryRoot })
            })
          ).repositoryRoot
        : yield* resolveConfirmedRepositoryBinding({
            scoreDatabasePath: input.scoreDatabasePath,
            confirmedTargets: input.confirmedTargets,
            ...(input.repositoryRoot === undefined
              ? {}
              : { repositoryOverride: input.repositoryRoot })
          });
    return yield* store.enqueue({
      approvedPlan,
      repositoryRoot,
      acceptedMissingReplacementPaths: input.acceptedMissingReplacementPaths ?? [],
      ...(input.confirmedTargets === undefined
        ? {}
        : { confirmedTargets: input.confirmedTargets }),
      adapter: input.adapter,
      maxConcurrency: input.maxConcurrency
    });
  }
);

export function enqueueApprovedPlan(
  input: EnqueueApprovedPlanInput
): Effect.Effect<
  EnqueuedRun,
  | PlanNotApproved
  | ApprovedPackageIntegrityError
  | AdapterCompatibilityError
  | RepositoryDriftError
  | RepositoryRootError
  | RunnerStoreError
> {
  return validateRunnerDatabaseBoundary(
    input.scoreDatabasePath,
    input.runnerDatabasePath
  ).pipe(
    Effect.andThen(
      Effect.scoped(
        enqueueApprovedPlanEffect(input).pipe(
          Effect.provide(RunnerStoreLive(input.runnerDatabasePath))
        )
      )
    )
  );
}

export function inspectRunner(
  runnerDatabasePath: string
): Effect.Effect<RunnerCounts, RunnerStoreError> {
  return Effect.scoped(
    Effect.gen(function*() {
      const store = yield* RunnerStore;
      yield* store.initialize;
      return yield* store.inspect;
    }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
  );
}

export function inspectRun(
  runnerDatabasePath: string,
  runId: RunId
): Effect.Effect<RunSnapshot, RunnerStoreError> {
  return Effect.scoped(
    Effect.gen(function*() {
      const store = yield* RunnerStore;
      yield* store.initialize;
      return yield* store.inspectRun(runId);
    }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
  );
}

export function inspectLatestProjectRun(input: {
  readonly scoreDatabasePath: string;
  readonly runnerDatabasePath: string;
}): Effect.Effect<RunSnapshot, RunnerStoreError> {
  return validateRunnerDatabaseBoundary(
    input.scoreDatabasePath,
    input.runnerDatabasePath
  ).pipe(
    Effect.andThen(
      Effect.scoped(
        Effect.gen(function*() {
          const store = yield* RunnerStore;
          yield* store.initialize;
          const repositoryRoot = yield* store.readSavedRepositoryRoot(
            comparableDatabasePath(input.scoreDatabasePath)
          );
          if (repositoryRoot === null) {
            return yield* new RunnerStoreError({
              operation: "inspectLatestProjectRun",
              message:
                "No Run is available for the current project. Start one with score start or use score status --run <id>."
            });
          }
          return yield* store.inspectLatestRun(repositoryRoot);
        }).pipe(Effect.provide(RunnerStoreLive(input.runnerDatabasePath)))
      )
    )
  );
}

export interface RunObservationObserver {
  readonly update: (observation: RunObservation) => void;
}

export interface RunExecutionOptions {
  readonly observer?: RunObservationObserver;
}

interface RunObservationDelivery {
  readonly offer: (observation: RunObservation) => void;
}

const runObservationDelivery = Symbol("score/RunObservationDelivery");

type InternalRunExecutionOptions = RunExecutionOptions & {
  readonly [runObservationDelivery]?: RunObservationDelivery;
};

function makeRunObservationDelivery(
  observer: RunObservationObserver | undefined
): RunObservationDelivery | undefined {
  if (observer === undefined) return undefined;
  const pending = new Map<string, Array<RunObservation>>();
  const latestAcceptedSequence = new Map<string, number>();
  let scheduled = false;

  const deliverySignature = (observation: RunObservation) =>
    JSON.stringify({
      phase: observation.phase,
      failureCategory: observation.failureCategory,
      failureMessage: observation.failureMessage,
      terminalAt: observation.terminalAt,
      application: observation.application,
      files: observation.files.map((file) => ({
        jobId: file.jobId,
        attemptId: file.attemptId,
        stage: file.stage,
        source: file.source,
        claimedAt: file.claimedAt,
        terminalAt: file.terminalAt,
        runtimeSessionId: file.runtimeSessionId,
        failureCategory: file.failureCategory,
        failureMessage: file.failureMessage,
        failureStage: file.failureStage,
        terminalOutcome: file.terminalOutcome,
        failureEvidence: file.failureEvidence,
        targetOutputState: file.targetOutputState,
        rejectedOutputDigest: file.rejectedOutputDigest,
        rejectedOutputPath: file.rejectedOutputPath
      }))
    });

  const deliver = (observation: RunObservation) => {
    try {
      const result = observer.update(observation) as unknown;
      if (result instanceof Promise) void result.catch(() => undefined);
    } catch {
      // Observer delivery is optional and cannot participate in Runner outcomes.
    }
  };
  const flush = () => {
    scheduled = false;
    const batch = [...pending.values()].flat();
    pending.clear();
    for (const observation of batch) deliver(observation);
    if (pending.size > 0 && !scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  };

  return {
    offer: (observation) => {
      const key = String(observation.runId);
      if (observation.sequence <= (latestAcceptedSequence.get(key) ?? -1)) return;
      latestAcceptedSequence.set(key, observation.sequence);
      const queued = pending.get(key);
      const latest = queued?.at(-1);
      if (latest === undefined) {
        pending.set(key, [observation]);
      } else if (observation.sequence > latest.sequence) {
        if (deliverySignature(observation) === deliverySignature(latest)) {
          queued![queued!.length - 1] = observation;
        } else {
          queued!.push(observation);
        }
      }
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    }
  };
}

function withRunObservationDelivery(
  options: InternalRunExecutionOptions
): InternalRunExecutionOptions {
  if (options[runObservationDelivery] !== undefined) return options;
  const delivery = makeRunObservationDelivery(options.observer);
  return delivery === undefined
    ? options
    : { ...options, [runObservationDelivery]: delivery };
}

function bestEffortObservation<R>(
  effect: Effect.Effect<unknown, unknown, R>
): Effect.Effect<void, never, R> {
  return effect.pipe(
    Effect.asVoid,
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.void
    )
  );
}

function notifyObservation(
  delivery: RunObservationDelivery | undefined,
  observation: RunObservation
): Effect.Effect<void> {
  if (delivery === undefined) return Effect.void;
  return Effect.sync(() => delivery.offer(observation)).pipe(
    Effect.catchCause(() => Effect.void)
  );
}

const runPendingJobsEffect = Effect.fn("Runner.runPendingJobs")(
  function*(runId: RunId, options: InternalRunExecutionOptions) {
    const store = yield* RunnerStore;
    const adapter = yield* RuntimeAdapter;
    const delivery = options[runObservationDelivery];
    const publish = () =>
      delivery === undefined
        ? Effect.void
        : bestEffortObservation(
            store.inspectRun(runId).pipe(
              Effect.flatMap((snapshot) =>
                notifyObservation(delivery, snapshot.observation)
              )
            )
          );
    const recordIntermediate = (
      job: Parameters<typeof store.recordAttemptObservation>[0]["job"],
      fact: RuntimeAttemptFact
    ) => {
      const stage =
        fact.kind === "runtime_session_created"
          ? "starting"
          : fact.kind === "agent_input_admitted"
            ? "Agent working"
            : "checking output";
      return bestEffortObservation(
        store.recordAttemptObservation({
          job,
          stage,
          source: "runtime adapter",
          ...(fact.runtimeSessionId === undefined
            ? {}
            : { runtimeSessionId: fact.runtimeSessionId })
        })
      ).pipe(Effect.andThen(publish()));
    };
    yield* store.initialize;
    yield* store.requireNoRunningAttempts(runId);
    const waiting = yield* store.inspectRun(runId);
    yield* notifyObservation(delivery, waiting.observation);
    yield* store.beginWork(runId);
    const run = yield* store.inspectRun(runId);

    const executeWorkers = (invoke: typeof adapter.invoke) => {
      const worker: Effect.Effect<void, RunnerStoreError> = Effect.suspend(():
        Effect.Effect<void, RunnerStoreError> =>
        store.claimNext(runId).pipe(
          Effect.flatMap((job) => {
            if (job === null) return Effect.void;
            const reporter: RuntimeAttemptReporter = {
              report: (fact) => recordIntermediate(job, fact)
            };
            return publish().pipe(
              Effect.andThen(invoke(job, reporter)),
              Effect.matchEffect({
                onFailure: (error) => {
                  return store.completeFailure({
                    job,
                    failureEvidence: error.failureEvidence,
                    ...(error.runtimeSessionId === undefined
                      ? {}
                      : { runtimeSessionId: error.runtimeSessionId }),
                    ...(error.targetOutputState === undefined
                      ? {}
                      : { targetOutputState: error.targetOutputState }),
                    ...(error.targetOutputDigest === undefined
                      ? {}
                      : { targetOutputDigest: error.targetOutputDigest }),
                    ...(error.diagnosticContent === undefined
                      ? {}
                      : { diagnosticContent: error.diagnosticContent })
                  }).pipe(Effect.andThen(publish()));
                },
                onSuccess: (candidate) =>
                  bestEffortObservation(
                    store.recordAttemptObservation({
                      job,
                      stage: "candidate ready",
                      source: "runner",
                      runtimeSessionId: candidate.runtimeSessionId,
                      ...(candidate.targetOutputState === undefined
                        ? {}
                        : { targetOutputState: candidate.targetOutputState }),
                      ...(candidate.targetOutputDigest === undefined
                        ? {}
                        : { targetOutputDigest: candidate.targetOutputDigest })
                    })
                  ).pipe(
                    Effect.andThen(publish()),
                    Effect.andThen(
                      store.completeSuccess({
                        job,
                        content: candidate.content,
                        runtimeSessionId: candidate.runtimeSessionId,
                        ...(candidate.targetOutputState === undefined
                          ? {}
                          : { targetOutputState: candidate.targetOutputState }),
                        ...(candidate.targetOutputDigest === undefined
                          ? {}
                          : { targetOutputDigest: candidate.targetOutputDigest })
                      })
                    ),
                    Effect.andThen(publish())
                  )
              }),
              Effect.andThen(worker)
            );
          })
        )
      );

      return Effect.all(
        Array.from({ length: run.maxConcurrency }, () => worker),
        { concurrency: "unbounded", discard: true }
      );
    };

    yield* adapter.withRun(executeWorkers).pipe(
      Effect.tapError((error) =>
        error._tag === "RunnerStoreError"
          ? Effect.void
          : store.recordRunFailure({
              runId,
              phase: "not applied",
              failureCategory: error.failureEvidence.category
            }).pipe(Effect.andThen(publish()))
      ),
      Effect.mapError((error) => {
        if (error._tag === "RunnerStoreError") return error;
        const category = error.failureEvidence.category;
        return new RunnerStoreError({
          operation: "runAdapter",
          message: `${safeFailureMessage(category)} Inspect Runner status for retained evidence.`
        });
      })
    );
    yield* store.finalizeRun(runId);
    yield* publish();
    return yield* store.inspectRun(runId);
  }
);

export function runPendingJobs(
  runnerDatabasePath: string,
  runId: RunId,
  options: RunExecutionOptions = {}
): Effect.Effect<RunSnapshot, RunRecoveryRequired | RunnerStoreError, RuntimeAdapter> {
  const executionOptions = withRunObservationDelivery(options);
  return Effect.scoped(
    runPendingJobsEffect(runId, executionOptions).pipe(
      Effect.provide(RunnerStoreLive(runnerDatabasePath))
    )
  );
}

export function recoverRun(
  runnerDatabasePath: string,
  runId: RunId
): Effect.Effect<number, RunnerStoreError> {
  return Effect.scoped(
    Effect.gen(function*() {
      const store = yield* RunnerStore;
      yield* store.initialize;
      return yield* store.recoverRun(runId);
    }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
  );
}

function verifyRunRepositoryState(input: {
  readonly run: RunSnapshot;
  readonly binding: RepositoryBinding;
}): void {
  if (input.binding.confirmedTargets.length === 0) {
    verifyRepositoryMatchesSnapshot({
      repositoryRoot: input.binding.repositoryRoot,
      snapshot: input.binding.sourceSnapshot,
      targetPaths: input.run.jobs.map((job) => job.targetPath),
      acceptedMissingPaths: input.run.acceptedMissingReplacementPaths,
      absentPaths: input.run.jobs
        .filter((job) => job.operation === "create")
        .map((job) => job.targetPath)
    });
    return;
  }
  verifyRepositoryTargetsMatch({
    repositoryRoot: input.binding.repositoryRoot,
    confirmedTargets: input.binding.confirmedTargets
  });
}

export function retryFailedJobsAndApply(
  runnerDatabasePath: string,
  runId: RunId,
  options: RunExecutionOptions & { readonly targetPaths: ReadonlyArray<string> }
): Effect.Effect<
  RunSnapshot,
  RunRecoveryRequired | RunnerStoreError | RepositoryDriftError,
  RuntimeAdapter
> {
  return Effect.scoped(
    Effect.gen(function*() {
      const store = yield* RunnerStore;
      yield* store.initialize;
      const run = yield* store.inspectRun(runId);
      const binding = yield* store.readRepositoryBinding(runId);
      yield* Effect.try({
        try: () => verifyRunRepositoryState({ run, binding }),
        catch: (cause) =>
          cause instanceof RepositoryDriftError
            ? cause
            : new RunnerStoreError({
                operation: "verifyRetryRepositoryState",
                message: cause instanceof Error ? cause.message : String(cause)
              })
      });
      yield* store.prepareRetry({ runId, targetPaths: options.targetPaths });
    }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
  ).pipe(
    Effect.andThen(runPendingJobsAndApply(runnerDatabasePath, runId, options))
  );
}

function safeCandidatePath(path: string): string {
  const normalized = normalizeProjectRelativePath(path);
  if (normalized === undefined) {
    throw new Error(`Unsafe candidate target path: ${path}`);
  }
  return normalized;
}

function verifyCandidatePackageIntegrity(candidate: {
  readonly agentInputJson: string;
  readonly agentInputDigest: string;
  readonly packageJson: string;
  readonly packageDigest: string;
}): void {
  const agentInput: unknown = JSON.parse(candidate.agentInputJson);
  if (typeof agentInput !== "object" || agentInput === null) {
    throw new Error("Agent Input must be a JSON object");
  }
  if (sha256Json(agentInput) !== candidate.agentInputDigest) {
    throw new Error("Frozen Agent Input digest does not reproduce");
  }
  const packageEnvelope: unknown = JSON.parse(candidate.packageJson);
  if (typeof packageEnvelope !== "object" || packageEnvelope === null) {
    throw new Error("Agent Package must be a JSON object");
  }
  if (sha256Json(packageEnvelope) !== candidate.packageDigest) {
    throw new Error("Frozen Agent Package digest does not reproduce");
  }
  const envelope = packageEnvelope as {
    readonly control?: unknown;
    readonly agent_input?: unknown;
  };
  if (canonicalJson(envelope.agent_input) !== canonicalJson(agentInput)) {
    throw new Error("Frozen Agent Package does not contain the stored Agent Input");
  }
}

function verifyCompleteCandidateIntegrity(input: {
  readonly run: RunSnapshot;
  readonly candidates: ReadonlyArray<CandidateFile>;
}): void {
  for (const candidate of input.candidates) {
    if (sha256Bytes(candidate.content) !== candidate.candidateDigest) {
      throw new Error(`Candidate digest mismatch for ${candidate.targetPath}`);
    }
  }
  input.candidates.forEach(verifyCandidatePackageIntegrity);
  if (input.run.state !== "completed") return;
  if (input.candidates.length !== input.run.jobs.length) {
    throw new Error(
      `Completed Run has ${input.run.jobs.length} Jobs but ${input.candidates.length} Candidates`
    );
  }
}

function supportedApplicationOperation(operation: "create" | "replace" | "delete") {
  if (operation === "delete") {
    throw new Error("Repository application does not support delete operations");
  }
  return operation;
}

export function applyRunCandidates(
  runnerDatabasePath: string,
  runId: RunId,
  options: RunExecutionOptions = {}
): Effect.Effect<RunSnapshot, RunnerStoreError | RepositoryDriftError> {
  const executionOptions = withRunObservationDelivery(options);
  return Effect.scoped(
    Effect.gen(function*() {
      const store = yield* RunnerStore;
      const delivery = executionOptions[runObservationDelivery];
      const publish = () =>
        delivery === undefined
          ? Effect.void
          : bestEffortObservation(
              store.inspectRun(runId).pipe(
                Effect.flatMap((snapshot) =>
                  notifyObservation(delivery, snapshot.observation)
                )
              )
            );
      const retainRunFailure = (failureCategory: FailureCategory) =>
        store.recordRunFailure({
          runId,
          phase: "not applied",
          failureCategory
        }).pipe(Effect.andThen(publish()));
      yield* store.initialize;
      const run = yield* store.inspectRun(runId);
      yield* notifyObservation(delivery, run.observation);
      if (run.state !== "completed") {
        return yield* new RunnerStoreError({
          operation: "applyCandidates",
          message: `Run ${runId} is ${run.state}; every Job must succeed before application`
        });
      }
      if (run.applicationState === "applied") return run;
      if (run.applicationState === "applying") {
        return yield* new RunnerStoreError({
          operation: "applyCandidates",
          message: `Run ${runId} has an ambiguous interrupted repository application`
        });
      }
      const candidates = yield* store.readCandidates(runId);
      const binding = yield* store.readRepositoryBinding(runId);
      yield* bestEffortObservation(
        store.recordRunPhase({ runId, phase: "checking current target state" })
      );
      yield* publish();
      const verifyTargetState = Effect.try({
        try: () => {
          verifyRunRepositoryState({ run, binding });
        },
        catch: (cause) =>
          cause instanceof RepositoryDriftError
            ? new RepositoryApplicationConflictError(cause, "not_written")
            : new RunnerStoreError({
                operation: "verifyTargetState",
                message: cause instanceof Error ? cause.message : String(cause)
              })
      });
      yield* verifyTargetState.pipe(
        Effect.tapError(() => retainRunFailure("target drift"))
      );
      yield* bestEffortObservation(
        store.recordRunPhase({ runId, phase: "checking the complete set" })
      );
      yield* publish();
      yield* Effect.try({
        try: () => verifyCompleteCandidateIntegrity({ run, candidates }),
        catch: (cause) =>
          new RunnerStoreError({
            operation: "verifyCandidateIntegrity",
            message: cause instanceof Error ? cause.message : String(cause)
          })
      }).pipe(
        Effect.tapError(() => retainRunFailure("candidate integrity"))
      );
      yield* store.beginApplication(runId);
      yield* publish();
      const apply = Effect.try({
        try: () =>
          applyCandidateSet({
            repositoryRoot: binding.repositoryRoot,
            snapshot: binding.sourceSnapshot,
            acceptedMissingReplacementPaths: run.acceptedMissingReplacementPaths,
            ...(binding.confirmedTargets.length === 0
              ? {}
              : { confirmedTargets: binding.confirmedTargets }),
            approvedTargets: run.jobs.map((job) => ({
              targetPath: job.targetPath,
              operation: supportedApplicationOperation(job.operation)
            })),
            candidates: candidates.map((candidate) => ({
              targetPath: candidate.targetPath,
              operation: supportedApplicationOperation(candidate.operation),
              content: candidate.content,
              candidateDigest: candidate.candidateDigest
            }))
          }),
        catch: (cause) =>
          cause instanceof RepositoryDriftError
            ? cause
            : new RunnerStoreError({
                operation: "applyCandidates",
                message: cause instanceof Error ? cause.message : String(cause)
              })
      });
      const application = yield* apply.pipe(
        Effect.tapError((error) =>
          store.failApplication({
            runId,
            failureCategory: "application"
          }).pipe(Effect.andThen(publish()))
        )
      );
      yield* store.completeApplication(runId);
      yield* publish();
      if (application.cleanupWarning !== undefined) {
        const cleanupWarning = application.cleanupWarning;
        yield* Effect.sync(() => process.emitWarning(cleanupWarning));
      }
      return yield* store.inspectRun(runId);
    }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
  );
}

export function runPendingJobsAndApply(
  runnerDatabasePath: string,
  runId: RunId,
  options: RunExecutionOptions = {}
): Effect.Effect<
  RunSnapshot,
  RunRecoveryRequired | RunnerStoreError | RepositoryDriftError,
  RuntimeAdapter
> {
  const executionOptions = withRunObservationDelivery(options);
  return inspectRun(runnerDatabasePath, runId).pipe(
    Effect.tap((existing) =>
      notifyObservation(executionOptions[runObservationDelivery], existing.observation)
    ),
    Effect.flatMap((existing) =>
      existing.state === "pending"
        ? runPendingJobs(runnerDatabasePath, runId, executionOptions)
        : existing.state === "completed"
          ? Effect.succeed(existing)
          : Effect.fail(
              new RunnerStoreError({
                operation: "runAndApply",
                message: `Run ${runId} is ${existing.state} and cannot be started`
              })
            )
    ),
    Effect.flatMap((run) =>
      run.state === "completed"
        ? applyRunCandidates(runnerDatabasePath, runId, executionOptions)
        : Effect.succeed(run)
    )
  );
}

export function exportRunCandidates(
  runnerDatabasePath: string,
  runId: RunId,
  destinationPath: string
): Effect.Effect<
  { readonly destinationPath: string; readonly fileCount: number },
  RunnerStoreError
> {
  return Effect.scoped(
    Effect.gen(function*() {
      const store = yield* RunnerStore;
      yield* store.initialize;
      const run = yield* store.inspectRun(runId);
      const candidates = yield* store.readCandidates(runId);
      return yield* Effect.try({
        try: () => {
          verifyCompleteCandidateIntegrity({ run, candidates });
          const destination = resolve(destinationPath);
          mkdirSync(dirname(destination), { recursive: true });
          mkdirSync(destination);
          try {
            for (const candidate of candidates) {
              const target = join(destination, safeCandidatePath(candidate.targetPath));
              mkdirSync(dirname(target), { recursive: true });
              writeFileSync(target, candidate.content, { encoding: "utf8", flag: "wx" });
            }
          } catch (cause) {
            rmSync(destination, { recursive: true, force: true });
            throw cause;
          }
          return { destinationPath: destination, fileCount: candidates.length };
        },
        catch: (cause) =>
          new RunnerStoreError({
            operation: "exportCandidates",
            message: cause instanceof Error ? cause.message : String(cause)
          })
      });
    }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
  );
}
