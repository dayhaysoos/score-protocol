import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";

import { Effect, Layer } from "effect";
import Database from "better-sqlite3";

import { createAcceptedInputPacket } from "../src/fixture-inputs.js";
import {
  RunnerStoreError,
  type AdapterConfiguration
} from "../src/runner/domain.js";
import {
  enqueueApprovedPlan,
  inspectRun,
  retryFailedJobsAndApply,
  runPendingJobsAndApply
} from "../src/runner/runner.js";
import {
  AdapterInvocationError,
  RuntimeAdapter
} from "../src/runner/runtime-adapter.js";
import { formatRunStatus } from "../src/runner/failure-presentation.js";
import {
  formatRetryPreview,
  ManualRetryCancelled,
  manualRetryDecisionChoices,
  runGuidedOpenCodeStart,
  runManualRetryFlow
} from "../src/runner/guided-start-cli.js";
import type { GuidedStartPrompts } from "../src/runner/guided-start.js";
import type { RuntimeAdapterCatalog } from "../src/runner/runtime-adapter-catalog.js";
import { ScoreAlpha } from "../src/score-alpha.js";
import { createFixtureGitRepository } from "./helpers/git-repository.js";

function readBundle(): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), "fixtures", "account-status.bundle.json"), "utf8")
  );
}

function adapter(
  invoke: typeof RuntimeAdapter.Service["invoke"],
  onAdmission: () => void = () => undefined
): Layer.Layer<RuntimeAdapter> {
  return Layer.succeed(
    RuntimeAdapter,
    RuntimeAdapter.of({
      invoke,
      withRun: (use) =>
        Effect.sync(onAdmission).pipe(Effect.andThen(use(invoke)))
    })
  );
}

function preparedApprovedPlan(directory: string) {
  const scoreDatabasePath = join(directory, "score.db");
  const runnerDatabasePath = join(directory, "runner.db");
  const repositoryRoot = createFixtureGitRepository(directory);
  const score = ScoreAlpha.open(scoreDatabasePath);
  score.initializeAcceptedInputs(createAcceptedInputPacket());
  const submitted = score.submitCompilation(readBundle(), {
    compiler_name: "codex-existing-agent",
    model_id: "openai/gpt-5",
    received_at: "2026-08-14T12:00:00.000Z",
    label: "runner-manual-retry"
  });
  assert.ok(submitted.manifest_id);
  const review = score.prepareReview(
    submitted.manifest_id ?? "",
    "2026-08-14T12:01:00.000Z"
  );
  score.decidePublication({
    review_id: review.review_id,
    authority: "test-human-authority",
    decided_at: "2026-08-14T12:02:00.000Z",
    decision: "approve",
    expected_digest_set: review.digest_set,
    warning_waivers: [],
    rationale: "Synthetic approval in an isolated retry fixture."
  });
  score.close();
  return {
    scoreDatabasePath,
    runnerDatabasePath,
    repositoryRoot,
    passId: review.digest_set.pass.protocol_id
  };
}

async function preparedTwoJobRun(directory: string) {
  const approved = preparedApprovedPlan(directory);
  const enqueued = await Effect.runPromise(
    enqueueApprovedPlan({
      scoreDatabasePath: approved.scoreDatabasePath,
      runnerDatabasePath: approved.runnerDatabasePath,
      passId: approved.passId,
      repositoryRoot: approved.repositoryRoot,
      adapter: {
        kind: "opencode",
        providerId: "frozen-provider",
        modelId: "frozen-model",
        variantId: "frozen-variant",
        sdkVersion: "0.0.0-next-17111",
        cliVersion: "0.0.0-next-17111"
      },
      maxConcurrency: 2
    })
  );
  return {
    scoreDatabasePath: approved.scoreDatabasePath,
    runnerDatabasePath: approved.runnerDatabasePath,
    repositoryRoot: approved.repositoryRoot,
    runId: enqueued.runId
  };
}

const retainedCandidate =
  'import type { Account } from "./schema.js";\n\n' +
  "export function formatAccountLabel(account: Account): string {\n" +
  "  return `${account.name} [${account.status}]`;\n" +
  "}\n";
const retriedCandidate =
  "export interface Account {\n" +
  "  id: string;\n" +
  "  name: string;\n" +
  '  status: "active" | "suspended";\n' +
  "}\n";

describe("manual failed-Job retry", () => {
  it("creates a new Attempt only for explicitly selected failed Jobs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-selected-retry-"));
    try {
      const fixture = await preparedTwoJobRun(directory);
      const bothFailed = await Effect.runPromise(
        runPendingJobsAndApply(fixture.runnerDatabasePath, fixture.runId).pipe(
          Effect.provide(
            adapter((job) =>
              Effect.fail(
                new AdapterInvocationError({
                  jobId: job.jobId,
                  message: `Synthetic failure for ${job.targetPath}`,
                  failureEvidence: {
                    category: "tool",
                    stage: null,
                    name: "fixture-tool",
                    status: "error",
                    statusCode: 422,
                    reason: "Synthetic selected-retry failure"
                  },
                  targetOutputState: "not observed"
                })
              )
            )
          )
        )
      );
      assert.deepEqual(bothFailed.jobs.map((job) => job.state), ["failed", "failed"]);
      const partialPreview = formatRetryPreview(bothFailed, ["src/account-label.ts"]);
      assert.match(
        partialPreview,
        /Selected retry targets\n  • src\/account-label\.ts/u
      );
      assert.match(
        partialPreview,
        /Other failed targets not retried now\n  • src\/schema\.ts/u
      );
      assert.match(
        partialPreview,
        /nothing can be applied while 1 other Job remains failed/u
      );

      const selectedInvocations: string[] = [];
      const oneRetained = await Effect.runPromise(
        retryFailedJobsAndApply(fixture.runnerDatabasePath, fixture.runId, {
          targetPaths: ["src/account-label.ts"]
        }).pipe(
          Effect.provide(
            adapter((job) => {
              selectedInvocations.push(job.targetPath);
              return Effect.succeed({
                content: retainedCandidate,
                runtimeSessionId: "selected-account-retry"
              });
            })
          )
        )
      );

      assert.deepEqual(selectedInvocations, ["src/account-label.ts"]);
      assert.equal(oneRetained.state, "completed_with_failures");
      assert.equal(oneRetained.applicationState, "not_applied");
      assert.equal(existsSync(join(fixture.repositoryRoot, "src/account-label.ts")), false);
      assert.deepEqual(
        oneRetained.jobs
          .find((job) => job.targetPath === "src/account-label.ts")
          ?.attempts?.map((attempt) => [attempt.attemptNumber, attempt.state]),
        [
          [1, "failed"],
          [2, "succeeded"]
        ]
      );
      assert.deepEqual(
        oneRetained.jobs
          .find((job) => job.targetPath === "src/schema.ts")
          ?.attempts?.map((attempt) => [attempt.attemptNumber, attempt.state]),
        [[1, "failed"]]
      );

      const complete = await Effect.runPromise(
        retryFailedJobsAndApply(fixture.runnerDatabasePath, fixture.runId, {
          targetPaths: ["src/schema.ts"]
        }).pipe(
          Effect.provide(
            adapter(() =>
              Effect.succeed({
                content: retriedCandidate,
                runtimeSessionId: "selected-schema-retry"
              })
            )
          )
        )
      );
      assert.equal(complete.applicationState, "applied");
      assert.equal(
        readFileSync(join(fixture.repositoryRoot, "src/account-label.ts"), "utf8"),
        retainedCandidate
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains a successful candidate and atomically applies it with one successful retry", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-manual-retry-"));
    try {
      const fixture = await preparedTwoJobRun(directory);
      const firstInvocations: string[] = [];
      const failed = await Effect.runPromise(
        runPendingJobsAndApply(fixture.runnerDatabasePath, fixture.runId).pipe(
          Effect.provide(
            adapter((job) => {
              firstInvocations.push(job.targetPath);
              if (job.targetPath === "src/schema.ts") {
                return Effect.fail(
                  new AdapterInvocationError({
                    jobId: job.jobId,
                    message: "Synthetic retryable failure",
                    failureEvidence: {
                      category: "tool",
                      stage: null,
                      name: "fixture-tool",
                      status: "error",
                      statusCode: 422,
                      reason: "Synthetic retryable failure"
                    },
                    targetOutputState: "different"
                  })
                );
              }
              return Effect.succeed({
                content: retainedCandidate,
                runtimeSessionId: "retained-attempt"
              });
            })
          )
        )
      );

      assert.equal(failed.state, "completed_with_failures");
      assert.equal(failed.applicationState, "not_applied");
      assert.deepEqual(firstInvocations.toSorted(), [
        "src/account-label.ts",
        "src/schema.ts"
      ]);
      assert.equal(existsSync(join(fixture.repositoryRoot, "src/account-label.ts")), false);
      const retainedBefore = failed.jobs.find(
        (job) => job.targetPath === "src/account-label.ts"
      )?.attempts?.[0];
      const failedPackageDigests = failed.jobs.map((job) => job.packageDigest);
      const originalFailedAttemptId = failed.jobs.find(
        (job) => job.targetPath === "src/schema.ts"
      )?.attempts?.[0]?.attemptId;
      assert.equal(retainedBefore?.state, "succeeded");
      assert.ok(retainedBefore?.candidateDigest);
      const failedStatus = formatRunStatus(failed);
      assert.match(failedStatus, /^Saved candidates: 1 of 2$/mu);
      assert.match(failedStatus, /^Failed targets: src\/schema\.ts$/mu);
      assert.match(failedStatus, /^src\/account-label\.ts · 1 Attempt$/mu);
      assert.match(failedStatus, /^  Attempt 1: succeeded · candidate sha256:/mu);
      assert.match(failedStatus, /^src\/schema\.ts · 1 Attempt$/mu);
      assert.match(failedStatus, /^  Attempt 1: failed · Tool failure$/mu);
      assert.match(
        failedStatus,
        new RegExp(`^Next: npm run runner -- retry --run ${fixture.runId}$`, "mu")
      );

      let adapterAdmissions = 0;
      const retriedTargets: string[] = [];
      const completed = await Effect.runPromise(
        retryFailedJobsAndApply(fixture.runnerDatabasePath, fixture.runId, {
          targetPaths: ["src/schema.ts"]
        }).pipe(
          Effect.provide(
            adapter(
              (job) => {
                retriedTargets.push(job.targetPath);
                assert.deepEqual(job.adapter, failed.adapter);
                return Effect.succeed({
                  content: retriedCandidate,
                  runtimeSessionId: "retry-attempt"
                });
              },
              () => {
                adapterAdmissions += 1;
              }
            )
          )
        )
      );

      assert.equal(adapterAdmissions, 1);
      assert.deepEqual(retriedTargets, ["src/schema.ts"]);
      assert.equal(completed.state, "completed");
      assert.equal(completed.applicationState, "applied");
      assert.deepEqual(completed.jobs.map((job) => job.packageDigest), failedPackageDigests);
      assert.equal(
        readFileSync(join(fixture.repositoryRoot, "src/account-label.ts"), "utf8"),
        retainedCandidate
      );
      assert.equal(
        readFileSync(join(fixture.repositoryRoot, "src/schema.ts"), "utf8"),
        retriedCandidate
      );
      const retainedAfter = completed.jobs.find(
        (job) => job.targetPath === "src/account-label.ts"
      )?.attempts?.[0];
      assert.equal(retainedAfter?.attemptId, retainedBefore?.attemptId);
      assert.equal(retainedAfter?.candidateDigest, retainedBefore?.candidateDigest);
      const retryHistory = completed.jobs.find(
        (job) => job.targetPath === "src/schema.ts"
      )?.attempts;
      assert.deepEqual(retryHistory?.map((attempt) => attempt.attemptNumber), [1, 2]);
      assert.deepEqual(retryHistory?.map((attempt) => attempt.state), ["failed", "succeeded"]);
      assert.equal(retryHistory?.[0]?.attemptId, originalFailedAttemptId);
      assert.notEqual(retryHistory?.[1]?.attemptId, originalFailedAttemptId);
      const completedStatus = formatRunStatus(completed);
      assert.match(completedStatus, /^Application state: applied$/mu);
      assert.match(completedStatus, /^  Attempt 1: failed · Tool failure$/mu);
      assert.match(completedStatus, /^  Attempt 2: succeeded · candidate sha256:/mu);
      assert.match(completedStatus, /^Next: None;/mu);
      assert.deepEqual(await Effect.runPromise(inspectRun(fixture.runnerDatabasePath, fixture.runId)), completed);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains both failed Attempts and applies nothing when the manual retry fails again", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-retry-fails-again-"));
    try {
      const fixture = await preparedTwoJobRun(directory);
      const failSchema = (job: Parameters<typeof RuntimeAdapter.Service["invoke"]>[0]) =>
        new AdapterInvocationError({
          jobId: job.jobId,
          message: "Synthetic repeated failure",
          failureEvidence: {
            category: "tool",
            stage: null,
            name: "fixture-tool",
            status: "error",
            statusCode: 422,
            reason: "Synthetic repeated failure"
          },
          targetOutputState: "not observed"
        });
      const first = await Effect.runPromise(
        runPendingJobsAndApply(fixture.runnerDatabasePath, fixture.runId).pipe(
          Effect.provide(
            adapter((job) =>
              job.targetPath === "src/schema.ts"
                ? Effect.fail(failSchema(job))
                : Effect.succeed({
                    content: retainedCandidate,
                    runtimeSessionId: "retained-attempt"
                  })
            )
          )
        )
      );
      const retainedBefore = first.jobs.find(
        (job) => job.targetPath === "src/account-label.ts"
      )?.attempts?.[0];
      let retryInvocations = 0;
      const second = await Effect.runPromise(
        retryFailedJobsAndApply(fixture.runnerDatabasePath, fixture.runId, {
          targetPaths: ["src/schema.ts"]
        }).pipe(
          Effect.provide(
            adapter((job) => {
              retryInvocations += 1;
              return Effect.fail(failSchema(job));
            })
          )
        )
      );

      assert.equal(retryInvocations, 1);
      assert.equal(second.state, "completed_with_failures");
      assert.equal(second.applicationState, "not_applied");
      assert.equal(existsSync(join(fixture.repositoryRoot, "src/account-label.ts")), false);
      assert.notEqual(
        readFileSync(join(fixture.repositoryRoot, "src/schema.ts"), "utf8"),
        retriedCandidate
      );
      const retainedAfter = second.jobs.find(
        (job) => job.targetPath === "src/account-label.ts"
      )?.attempts?.[0];
      assert.deepEqual(retainedAfter, retainedBefore);
      const retryHistory = second.jobs.find(
        (job) => job.targetPath === "src/schema.ts"
      )?.attempts;
      assert.deepEqual(retryHistory?.map((attempt) => attempt.attemptNumber), [1, 2]);
      assert.deepEqual(retryHistory?.map((attempt) => attempt.state), ["failed", "failed"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("blocks repository drift before adapter admission and preserves saved candidates", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-retry-drift-"));
    try {
      const fixture = await preparedTwoJobRun(directory);
      const first = await Effect.runPromise(
        runPendingJobsAndApply(fixture.runnerDatabasePath, fixture.runId).pipe(
          Effect.provide(
            adapter((job) =>
              job.targetPath === "src/schema.ts"
                ? Effect.fail(
                    new AdapterInvocationError({
                      jobId: job.jobId,
                      message: "Synthetic initial failure",
                      failureEvidence: {
                        category: "runtime",
                        stage: null,
                        name: null,
                        status: "error",
                        statusCode: null,
                        reason: "Synthetic initial failure"
                      },
                      targetOutputState: "not observed"
                    })
                  )
                : Effect.succeed({
                    content: retainedCandidate,
                    runtimeSessionId: "retained-attempt"
                  })
            )
          )
        )
      );
      const savedAttempt = first.jobs.find(
        (job) => job.targetPath === "src/account-label.ts"
      )?.attempts?.[0];
      const manualChange = "export const manualChange = true;\n";
      writeFileSync(join(fixture.repositoryRoot, "src/schema.ts"), manualChange);
      let adapterAdmissions = 0;
      let invocations = 0;
      const error = await Effect.runPromise(
        Effect.flip(
          retryFailedJobsAndApply(fixture.runnerDatabasePath, fixture.runId, {
            targetPaths: ["src/schema.ts"]
          }).pipe(
            Effect.provide(
              adapter(
                () =>
                  Effect.sync(() => {
                    invocations += 1;
                    return {
                      content: retriedCandidate,
                      runtimeSessionId: "must-not-run"
                    };
                  }),
                () => {
                  adapterAdmissions += 1;
                }
              )
            )
          )
        )
      );

      assert.equal(error.name, "RepositoryDriftError");
      assert.equal(adapterAdmissions, 0);
      assert.equal(invocations, 0);
      assert.equal(readFileSync(join(fixture.repositoryRoot, "src/schema.ts"), "utf8"), manualChange);
      const unchanged = await Effect.runPromise(
        inspectRun(fixture.runnerDatabasePath, fixture.runId)
      );
      assert.equal(unchanged.state, "completed_with_failures");
      assert.deepEqual(
        unchanged.jobs.find((job) => job.targetPath === "src/account-label.ts")
          ?.attempts?.[0],
        savedAttempt
      );
      assert.equal(
        unchanged.jobs.find((job) => job.targetPath === "src/schema.ts")?.attempts?.length,
        1
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reaches the guided retry decision and cancels without another invocation or mutation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-retry-cancel-"));
    try {
      const fixture = await preparedTwoJobRun(directory);
      const failed = await Effect.runPromise(
        runPendingJobsAndApply(fixture.runnerDatabasePath, fixture.runId).pipe(
          Effect.provide(
            adapter((job) =>
              job.targetPath === "src/schema.ts"
                ? Effect.fail(
                    new AdapterInvocationError({
                      jobId: job.jobId,
                      message: "Synthetic failure before cancellation",
                      failureEvidence: {
                        category: "tool",
                        stage: null,
                        name: "fixture-tool",
                        status: "error",
                        statusCode: 422,
                        reason: "Synthetic failure before cancellation"
                      },
                      targetOutputState: "not observed"
                    })
                  )
                : Effect.succeed({
                    content: retainedCandidate,
                    runtimeSessionId: "retained-attempt"
                  })
            )
          )
        )
      );
      const beforeSchema = readFileSync(join(fixture.repositoryRoot, "src/schema.ts"), "utf8");
      const output: string[] = [];
      let executions = 0;
      const result = await runManualRetryFlow({
        initialRun: failed,
        prompts: {
          selectDecision: async () => "retry",
          confirmRetry: async () => false
        },
        write: (value) => output.push(value),
        executeRetry: async () => {
          executions += 1;
          throw new Error("must not execute");
        }
      });

      assert.equal(executions, 0);
      assert.deepEqual(result, failed);
      assert.match(output.join(""), /The other 1 candidate is saved\./u);
      assert.match(output.join(""), /New paid Agent invocations: 1/u);
      assert.match(output.join(""), /Frozen runtime: frozen-provider\/frozen-model · frozen-variant/u);
      assert.match(output.join(""), /Nothing was retried\. The saved candidate remains available\./u);
      assert.equal(readFileSync(join(fixture.repositoryRoot, "src/schema.ts"), "utf8"), beforeSchema);
      assert.equal(existsSync(join(fixture.repositoryRoot, "src/account-label.ts")), false);
      assert.match(formatRetryPreview(failed), /Selected retry targets\n  • src\/schema\.ts/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("shows the latest exact safe failure before asking whether to retry or stop", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-retry-decision-details-"));
    try {
      const fixture = await preparedTwoJobRun(directory);
      const failed = await Effect.runPromise(
        runPendingJobsAndApply(fixture.runnerDatabasePath, fixture.runId).pipe(
          Effect.provide(
            adapter((job) =>
              job.targetPath === "src/schema.ts"
                ? Effect.fail(
                    new AdapterInvocationError({
                      jobId: job.jobId,
                      message: "Patch verification rejected the malformed terminator",
                      failureEvidence: {
                        category: "tool",
                        stage: "checking output",
                        name: "patch",
                        status: "error",
                        statusCode: null,
                        reason: "The last line of the patch must be '*** End Patch'"
                      },
                      targetOutputState: "different",
                      diagnosticContent: "sensitive candidate bytes must not be printed"
                    })
                  )
                : Effect.succeed({
                    content: retainedCandidate,
                    runtimeSessionId: "decision-details-retained"
                  })
            )
          )
        )
      );
      const output: string[] = [];
      let executions = 0;
      const result = await runManualRetryFlow({
        initialRun: failed,
        prompts: {
          selectDecision: async () => "stop",
          confirmRetry: async () => {
            throw new Error("Stop must not reach retry confirmation");
          }
        },
        write: (value) => output.push(value),
        executeRetry: async () => {
          executions += 1;
          throw new Error("must not execute");
        }
      });

      const visible = output.join("");
      assert.equal(executions, 0);
      assert.deepEqual(result, failed);
      assert.match(visible, /src\/schema\.ts — Attempt 1 failed/u);
      assert.match(visible, /Tool: patch/u);
      assert.match(visible, /Reason: The last line of the patch must be '\*\*\* End Patch'/u);
      assert.match(visible, /Stage: Starting/u);
      assert.match(visible, /Candidate output: Changed, but rejected/u);
      assert.match(visible, /Attempt started:/u);
      assert.match(visible, /Attempt completed:/u);
      assert.match(visible, /1 of 2 candidates is saved\. Nothing was applied\./u);
      assert.doesNotMatch(visible, /sensitive candidate bytes/u);
      assert.deepEqual(
        manualRetryDecisionChoices(failed).map(({ name, value }) => ({ name, value })),
        [
          { name: "Retry src/schema.ts again", value: "retry" },
          { name: "Stop and keep 1 saved candidate", value: "stop" }
        ]
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("treats prompt cancellation after failure as a retry cancellation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-retry-prompt-cancel-"));
    try {
      const fixture = await preparedTwoJobRun(directory);
      const failed = await Effect.runPromise(
        runPendingJobsAndApply(fixture.runnerDatabasePath, fixture.runId).pipe(
          Effect.provide(
            adapter((job) =>
              job.targetPath === "src/schema.ts"
                ? Effect.fail(
                    new AdapterInvocationError({
                      jobId: job.jobId,
                      message: "Synthetic failure before prompt cancellation",
                      failureEvidence: {
                        category: "runtime",
                        stage: null,
                        name: null,
                        status: "error",
                        statusCode: null,
                        reason: "Synthetic failure before prompt cancellation"
                      },
                      targetOutputState: "not observed"
                    })
                  )
                : Effect.succeed({
                    content: retainedCandidate,
                    runtimeSessionId: "prompt-cancel-retained"
                  })
            )
          )
        )
      );
      let executions = 0;
      const exitPromptError = new Error("User force closed the prompt");
      exitPromptError.name = "ExitPromptError";

      await assert.rejects(
        runManualRetryFlow({
          initialRun: failed,
          prompts: {
            selectDecision: async () => {
              throw exitPromptError;
            },
            confirmRetry: async () => true
          },
          executeRetry: async () => {
            executions += 1;
            throw new Error("must not execute");
          }
        }),
        (error: unknown) =>
          error instanceof ManualRetryCancelled && error.retainedSuccessCount === 1
      );
      assert.equal(executions, 0);
      const unchanged = await Effect.runPromise(
        inspectRun(fixture.runnerDatabasePath, fixture.runId)
      );
      assert.deepEqual(unchanged, failed);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reaches Stop from the normal guided start after the initial Run fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-guided-retry-stop-"));
    try {
      const fixture = preparedApprovedPlan(directory);
      const model = {
        key: "frozen-provider/frozen-model",
        label: "Frozen model",
        sourceLabel: "Frozen provider",
        variants: []
      } as const;
      const adapterCatalog: RuntimeAdapterCatalog<AdapterConfiguration> = {
        id: "opencode",
        label: "OpenCode",
        discoverModels: Effect.succeed([model]),
        configurationFor: () => ({
          kind: "opencode",
          providerId: "frozen-provider",
          modelId: "frozen-model",
          variantId: null,
          sdkVersion: "0.0.0-next-17111",
          cliVersion: "0.0.0-next-17111"
        })
      };
      const prompts: GuidedStartPrompts = {
        selectPlan: async (plans) => plans[0]!,
        showPlan: () => undefined,
        selectModel: async (_catalog, models) => models[0]!,
        confirmStart: async () => true
      };
      const invokedTargets: string[] = [];
      let retryDecisionReached = 0;
      const result = await runGuidedOpenCodeStart({
        scoreDatabasePath: fixture.scoreDatabasePath,
        runnerDatabasePath: fixture.runnerDatabasePath,
        invokingDirectory: fixture.repositoryRoot,
        adapterCatalog,
        runtimeLayer: adapter((job) => {
          invokedTargets.push(job.targetPath);
          return job.targetPath === "src/schema.ts"
            ? Effect.fail(
                new AdapterInvocationError({
                  jobId: job.jobId,
                  message: "Synthetic guided-start failure",
                  failureEvidence: {
                    category: "tool",
                    stage: null,
                    name: "fixture-tool",
                    status: "error",
                    statusCode: 422,
                    reason: "Synthetic guided-start failure"
                  },
                  targetOutputState: "not observed"
                })
              )
            : Effect.succeed({
                content: retainedCandidate,
                runtimeSessionId: "guided-start-retained"
              });
        }),
        prompts,
        retryPrompts: {
          selectDecision: async () => {
            retryDecisionReached += 1;
            return "stop";
          },
          confirmRetry: async () => {
            throw new Error("Stop must not reach retry confirmation");
          }
        },
        progress: {
          schedule: () => ({ clear: () => undefined }),
          terminal: { mode: "append", write: () => undefined }
        },
        concurrency: 2
      });

      assert.equal(result.state, "completed_with_failures");
      assert.equal(retryDecisionReached, 1);
      assert.deepEqual(invokedTargets.toSorted(), [
        "src/account-label.ts",
        "src/schema.ts"
      ]);
      const run = await Effect.runPromise(
        inspectRun(fixture.runnerDatabasePath, result.runId)
      );
      assert.equal(
        run.jobs.reduce((count, job) => count + (job.attempts?.length ?? 0), 0),
        2
      );
      assert.equal(run.applicationState, "not_applied");
      assert.equal(existsSync(join(fixture.repositoryRoot, "src/account-label.ts")), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("cancels the real interactive retry CLI without adapter admission or target mutation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-retry-cli-cancel-"));
    try {
      const fixture = await preparedTwoJobRun(directory);
      const failed = await Effect.runPromise(
        runPendingJobsAndApply(fixture.runnerDatabasePath, fixture.runId).pipe(
          Effect.provide(
            adapter((job) =>
              job.targetPath === "src/schema.ts"
                ? Effect.fail(
                    new AdapterInvocationError({
                      jobId: job.jobId,
                      message: "Synthetic CLI cancellation failure",
                      failureEvidence: {
                        category: "tool",
                        stage: null,
                        name: "fixture-tool",
                        status: "error",
                        statusCode: 422,
                        reason: "Synthetic CLI cancellation failure"
                      },
                      targetOutputState: "not observed"
                    })
                  )
                : Effect.succeed({
                    content: retainedCandidate,
                    runtimeSessionId: "cli-cancel-retained"
                  })
            )
          )
        )
      );
      const attemptsBefore = failed.jobs.reduce(
        (count, job) => count + (job.attempts?.length ?? 0),
        0
      );
      const schemaBefore = readFileSync(join(fixture.repositoryRoot, "src/schema.ts"), "utf8");
      assert.equal(existsSync("/usr/bin/expect"), true);
      const result = spawnSync(
        "/usr/bin/expect",
        [
          "-c",
          "set timeout 10\n" +
            "spawn $env(SCORE_RETRY_TSX) $env(SCORE_RETRY_CLI) retry --score-db $env(SCORE_RETRY_SCORE_DB) --runner-db $env(SCORE_RETRY_RUNNER_DB) --run $env(SCORE_RETRY_RUN_ID)\n" +
            "expect {\n" +
            "  -re {\\(y/N\\)} { send \"\\r\" }\n" +
            "  timeout { exit 124 }\n" +
            "}\n" +
            "expect eof\n" +
            "set result [wait]\n" +
            "exit [lindex $result 3]\n"
        ],
        {
          cwd: fixture.repositoryRoot,
          input: "\n",
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            CI: "",
            SCORE_RETRY_TSX: join(process.cwd(), "node_modules", ".bin", "tsx"),
            SCORE_RETRY_CLI: join(process.cwd(), "src", "runner", "cli.ts"),
            SCORE_RETRY_SCORE_DB: fixture.scoreDatabasePath,
            SCORE_RETRY_RUNNER_DB: fixture.runnerDatabasePath,
            SCORE_RETRY_RUN_ID: fixture.runId
          }
        }
      );
      const output = stripVTControlCharacters(`${result.stdout}${result.stderr}`);
      assert.equal(result.status, 0, output);
      assert.match(output, /New paid Agent invocations: 1/u);
      assert.match(output, /Nothing was retried\. The saved candidate remains available\./u);
      const after = await Effect.runPromise(
        inspectRun(fixture.runnerDatabasePath, fixture.runId)
      );
      assert.equal(
        after.jobs.reduce((count, job) => count + (job.attempts?.length ?? 0), 0),
        attemptsBefore
      );
      assert.equal(readFileSync(join(fixture.repositoryRoot, "src/schema.ts"), "utf8"), schemaBefore);
      assert.equal(existsSync(join(fixture.repositoryRoot, "src/account-label.ts")), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("blocks whole-set application when a retained candidate digest no longer reproduces", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-retry-digest-"));
    try {
      const fixture = await preparedTwoJobRun(directory);
      await Effect.runPromise(
        runPendingJobsAndApply(fixture.runnerDatabasePath, fixture.runId).pipe(
          Effect.provide(
            adapter((job) =>
              job.targetPath === "src/schema.ts"
                ? Effect.fail(
                    new AdapterInvocationError({
                      jobId: job.jobId,
                      message: "Synthetic initial failure",
                      failureEvidence: {
                        category: "runtime",
                        stage: null,
                        name: null,
                        status: "error",
                        statusCode: null,
                        reason: "Synthetic initial failure"
                      },
                      targetOutputState: "not observed"
                    })
                  )
                : Effect.succeed({
                    content: retainedCandidate,
                    runtimeSessionId: "retained-attempt"
                  })
            )
          )
        )
      );
      const originalSchema = readFileSync(join(fixture.repositoryRoot, "src/schema.ts"), "utf8");
      const error = await Effect.runPromise(
        Effect.flip(
          retryFailedJobsAndApply(fixture.runnerDatabasePath, fixture.runId, {
            targetPaths: ["src/schema.ts"]
          }).pipe(
            Effect.provide(
              adapter(() =>
                Effect.sync(() => {
                  const database = new Database(fixture.runnerDatabasePath);
                  database
                    .prepare(
                      `UPDATE runner_attempts SET candidate_content = candidate_content || ?
                       WHERE state = 'succeeded'`
                    )
                    .run("// tampered\n");
                  database.close();
                  return {
                    content: retriedCandidate,
                    runtimeSessionId: "retry-before-integrity-check"
                  };
                })
              )
            )
          )
        )
      );

      assert.ok(error instanceof RunnerStoreError);
      assert.equal(error.operation, "verifyCandidateIntegrity");
      assert.equal(existsSync(join(fixture.repositoryRoot, "src/account-label.ts")), false);
      assert.equal(readFileSync(join(fixture.repositoryRoot, "src/schema.ts"), "utf8"), originalSchema);
      const blocked = await Effect.runPromise(
        inspectRun(fixture.runnerDatabasePath, fixture.runId)
      );
      assert.equal(blocked.applicationState, "not_applied");
      assert.equal(blocked.observation.failureCategory, "candidate integrity");
      const status = formatRunStatus(blocked);
      assert.match(status, /Candidate integrity failure/u);
      assert.match(status, /Application state: not_applied/u);
      assert.doesNotMatch(status, /runner -- retry --run/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps needs_attention on the explicit recovery path without adapter admission", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-retry-attention-"));
    try {
      const fixture = await preparedTwoJobRun(directory);
      await Effect.runPromise(
        runPendingJobsAndApply(fixture.runnerDatabasePath, fixture.runId).pipe(
          Effect.provide(
            adapter((job) =>
              job.targetPath === "src/schema.ts"
                ? Effect.fail(
                    new AdapterInvocationError({
                      jobId: job.jobId,
                      message: "Synthetic ambiguous precursor",
                      failureEvidence: {
                        category: "runtime",
                        stage: null,
                        name: null,
                        status: "unknown",
                        statusCode: null,
                        reason: "Synthetic ambiguous precursor"
                      },
                      targetOutputState: "not observed"
                    })
                  )
                : Effect.succeed({
                    content: retainedCandidate,
                    runtimeSessionId: "retained-attempt"
                  })
            )
          )
        )
      );
      const database = new Database(fixture.runnerDatabasePath);
      database.exec(
        `UPDATE runner_attempts SET state = 'needs_attention', observed_stage = 'needs attention'
         WHERE state = 'failed';
         UPDATE runner_jobs SET state = 'needs_attention' WHERE state = 'failed'`
      );
      database.close();
      let admissions = 0;
      const error = await Effect.runPromise(
        Effect.flip(
          retryFailedJobsAndApply(fixture.runnerDatabasePath, fixture.runId, {
            targetPaths: ["src/schema.ts"]
          }).pipe(
            Effect.provide(
              adapter(
                () => Effect.die("must not invoke"),
                () => {
                  admissions += 1;
                }
              )
            )
          )
        )
      );

      assert.ok(error instanceof RunnerStoreError);
      assert.equal(error.operation, "prepareRetry");
      assert.match(error.message, /needs_attention/u);
      assert.equal(admissions, 0);
      const unchanged = await Effect.runPromise(
        inspectRun(fixture.runnerDatabasePath, fixture.runId)
      );
      assert.equal(
        unchanged.jobs.find((job) => job.targetPath === "src/schema.ts")?.state,
        "needs_attention"
      );
      assert.equal(unchanged.applicationState, "not_applied");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reopens a historical completed_with_failures Run with legacy null failure evidence", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-retry-historical-"));
    try {
      const fixture = await preparedTwoJobRun(directory);
      await Effect.runPromise(
        runPendingJobsAndApply(fixture.runnerDatabasePath, fixture.runId).pipe(
          Effect.provide(
            adapter((job) =>
              job.targetPath === "src/schema.ts"
                ? Effect.fail(
                    new AdapterInvocationError({
                      jobId: job.jobId,
                      message: "Historical failure",
                      failureEvidence: {
                        category: "unknown",
                        stage: null,
                        name: null,
                        status: null,
                        statusCode: null,
                        reason: null
                      },
                      targetOutputState: "not observed"
                    })
                  )
                : Effect.succeed({
                    content: retainedCandidate,
                    runtimeSessionId: "historical-retained-attempt"
                  })
            )
          )
        )
      );
      const database = new Database(fixture.runnerDatabasePath);
      database.exec(
        `UPDATE runner_attempts
         SET failure_evidence_json = NULL, failure_tag = NULL,
             failure_message = NULL, failure_stage = NULL,
             terminal_outcome_json = NULL
         WHERE state = 'failed'`
      );
      database.close();

      const reopened = await Effect.runPromise(
        retryFailedJobsAndApply(fixture.runnerDatabasePath, fixture.runId, {
          targetPaths: ["src/schema.ts"]
        }).pipe(
          Effect.provide(
            adapter(() =>
              Effect.succeed({
                content: retriedCandidate,
                runtimeSessionId: "historical-retry-attempt"
              })
            )
          )
        )
      );
      assert.equal(reopened.applicationState, "applied");
      assert.deepEqual(
        reopened.jobs
          .find((job) => job.targetPath === "src/schema.ts")
          ?.attempts?.map((attempt) => [attempt.attemptNumber, attempt.state]),
        [
          [1, "failed"],
          [2, "succeeded"]
        ]
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
