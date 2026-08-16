import { userInfo } from "node:os";

import { checkbox, confirm, search, select } from "@inquirer/prompts";
import { Effect, type Layer } from "effect";

import { ScoreAlpha, type ReviewedChangePlan } from "../score-alpha.js";
import {
  runGuidedStart,
  type GuidedStartBackend,
  type GuidedStartPrompts,
  type GuidedStartResult
} from "./guided-start.js";
import type {
  RuntimeAdapterCatalog,
  RuntimeModel,
  RuntimeModelVariant
} from "./runtime-adapter-catalog.js";
import type { AdapterConfiguration, RunSnapshot } from "./domain.js";
import {
  formatApplicationSummary,
  formatRunApplicationSummary
} from "./application-summary.js";
import {
  enqueueApprovedPlan,
  inspectRun,
  prepareRepositoryForGuidedPlan,
  retryFailedJobsAndApply,
  runPendingJobsAndApply,
  type RunObservationObserver
} from "./runner.js";
import type { RepositoryDriftFinding } from "./repository-application.js";
import { RuntimeAdapter } from "./runtime-adapter.js";
import { listReviewedSlices, type SliceRunStatus } from "./slice-listing.js";
import {
  createRunProgressRenderer,
  createRunProgressTerminal,
  scheduleRunProgressRefresh,
  type RunProgressDisplayHeader,
  type RunProgressRenderer,
  type RunProgressSchedule,
  type RunProgressTerminal
} from "./run-progress-renderer.js";
import { terminalSafeLine } from "./terminal-safe-line.js";
import { formatFailedFile, formatRunStatus } from "./failure-presentation.js";
import { classifyRunRetry } from "./retry-eligibility.js";

export interface RunProgressDependencies {
  readonly now?: () => number;
  readonly schedule?: RunProgressSchedule;
  readonly terminal?: RunProgressTerminal;
}

export async function runWithRunProgress<A>(input: {
  readonly header: RunProgressDisplayHeader;
  readonly execute: (observer: RunObservationObserver) => Promise<A>;
  readonly progress?: RunProgressDependencies;
}): Promise<A> {
  let renderer: RunProgressRenderer | undefined;
  try {
    renderer = createRunProgressRenderer({
      header: input.header,
      now: input.progress?.now ?? Date.now,
      schedule: input.progress?.schedule ?? scheduleRunProgressRefresh,
      terminal: input.progress?.terminal ?? createRunProgressTerminal()
    });
  } catch {
    // Rendering is optional; construction failure must not prevent the Run.
  }
  const observer: RunObservationObserver = renderer ?? {
    update: () => undefined
  };
  try {
    return await input.execute(observer);
  } finally {
    try {
      renderer?.close();
    } catch {
      // Rendering is optional; cleanup failure must not replace the Run result.
    }
  }
}

function approvalLabel(status: ReviewedChangePlan["approvalStatus"]): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "needs_approval":
      return "Needs approval";
    case "review_required":
      return "Needs review";
    case "blocked":
      return "Blocked";
  }
}

function runStatus(plan: ReviewedChangePlan): SliceRunStatus | undefined {
  return "runStatus" in plan ? (plan.runStatus as SliceRunStatus) : undefined;
}

function terminalField(
  value: string,
  fallback: string,
  maximumLength?: number
): string {
  const projected = terminalSafeLine(value, maximumLength);
  return projected.length === 0 ? fallback : projected;
}

export function formatRuntimeSelection(
  adapterCatalog: RuntimeAdapterCatalog,
  model: RuntimeModel,
  variant: RuntimeModelVariant | null
): string {
  const modelSelection = [
    terminalField(model.label, "[unprintable model]", 24),
    model.sourceLabel === undefined
      ? undefined
      : terminalField(model.sourceLabel, "[unprintable provider]", 30)
  ]
    .filter((value): value is string => value !== undefined)
    .join(" · ");
  if (model.variants.length === 0) return terminalSafeLine(modelSelection, 78);
  return terminalSafeLine(
    `${modelSelection} · ${
      variant === null
        ? `${terminalField(adapterCatalog.label, "[unprintable adapter]", 10)} default`
        : terminalField(variant.summaryLabel, "[unprintable variant]", 18)
    }`,
    78
  );
}

export function formatGuidedConfirmation(input: {
  readonly adapterCatalog: RuntimeAdapterCatalog;
  readonly planLabel: string;
  readonly model: RuntimeModel;
  readonly variant: RuntimeModelVariant | null;
  readonly willApprove: boolean;
}): string {
  const action = input.willApprove ? "Approve, run, and apply" : "Run and apply";
  return terminalSafeLine(
    `${action} ${terminalField(input.planLabel, "[unprintable Change or Slice]", 50)} with ${formatRuntimeSelection(
      input.adapterCatalog,
      input.model,
      input.variant
    )}?`
  );
}

export function formatGuidedApplicationSummary(
  input: Parameters<typeof formatApplicationSummary>[0]
): string {
  return formatApplicationSummary({
    ...input,
    repositoryRoot:
      input.repositoryRoot === null
        ? null
        : terminalField(
            input.repositoryRoot,
            "[unprintable repository path]",
            120
          )
  });
}

export type ManualRetryDecision = "retry" | "stop";

export class ManualRetryCancelled extends Error {
  constructor(readonly retainedSuccessCount: number) {
    super("Manual retry was cancelled.");
    this.name = "ManualRetryCancelled";
  }
}

export interface ManualRetryPrompts {
  readonly selectDecision: (run: RunSnapshot) => Promise<ManualRetryDecision>;
  readonly selectTargets?: (run: RunSnapshot) => Promise<ReadonlyArray<string>>;
  readonly confirmRetry: (
    run: RunSnapshot,
    targetPaths: ReadonlyArray<string>
  ) => Promise<boolean>;
}

export function formatRetryDecisionSummary(run: RunSnapshot): string {
  const eligibility = classifyRunRetry(run);
  const failedJobs =
    eligibility.kind === "retryable" ? eligibility.failedJobs : [];
  const failures = failedJobs.map((job) => {
    const latestAttempt = [...(job.attempts ?? [])]
      .reverse()
      .find((attempt) => attempt.state === "failed");
    const target = terminalField(job.targetPath, "[unprintable target]", 156);
    const heading =
      latestAttempt === undefined
        ? `${target} failed`
        : `${target} — Attempt ${latestAttempt.attemptNumber} failed`;
    const file = run.observation.files.find(
      (candidate) => candidate.jobId === job.jobId
    );
    const detail =
      file === undefined
        ? `${heading}\nFailure details are unavailable for this historical Attempt.`
        : formatFailedFile(file, heading);
    const timing =
      latestAttempt === undefined
        ? []
        : [
            `Attempt started: ${terminalField(latestAttempt.claimedAt, "Unavailable", 80)}`,
            `Attempt completed: ${
              latestAttempt.completedAt === null
                ? "Unavailable"
                : terminalField(latestAttempt.completedAt, "Unavailable", 80)
            }`
          ];
    const runtimeSession =
      file?.runtimeSessionId === null || file?.runtimeSessionId === undefined
        ? []
        : [
            `Runtime session: ${terminalField(
              file.runtimeSessionId,
              "Unavailable",
              120
            )}`
          ];
    return [detail, ...timing, ...runtimeSession].join("\n");
  });
  const retained = eligibility.retainedSuccessCount;
  const savedVerb = retained === 1 ? "is" : "are";
  return (
    `\nLatest failed ${failures.length === 1 ? "Attempt" : "Attempts"}\n\n` +
    `${failures.join("\n\n") || "Failure details are unavailable."}\n\n` +
    `${retained} of ${run.jobs.length} candidates ${savedVerb} saved. Nothing was applied.\n`
  );
}

export function manualRetryDecisionChoices(run: RunSnapshot): ReadonlyArray<{
  readonly name: string;
  readonly value: ManualRetryDecision;
  readonly description?: string;
}> {
  const eligibility = classifyRunRetry(run);
  const retained = eligibility.retainedSuccessCount;
  const failedCount =
    eligibility.kind === "retryable" ? eligibility.failedJobs.length : 0;
  const retryChoice =
    eligibility.kind !== "retryable"
      ? []
      : [
          {
            name:
              failedCount === 1
                ? `Retry ${terminalField(
                    eligibility.failedJobs[0]!.targetPath,
                    "the failed Agent",
                    100
                  )} again`
                : `Retry ${failedCount} failed Agents again`,
            value: "retry" as const,
            description: `${failedCount} new paid Agent ${
              failedCount === 1 ? "invocation" : "invocations"
            }`
          }
        ];
  return [
    ...retryChoice,
    {
      name: `Stop and keep ${retained} saved ${
        retained === 1 ? "candidate" : "candidates"
      }`,
      value: "stop" as const
    }
  ];
}

export function formatRetryPreview(
  run: RunSnapshot,
  targetPaths?: ReadonlyArray<string>
): string {
  const eligibility = classifyRunRetry(run);
  const retained = eligibility.retainedSuccessCount;
  const selected = new Set(
    targetPaths ??
      (eligibility.kind === "retryable" && eligibility.failedJobs.length === 1
        ? [eligibility.failedJobs[0]!.targetPath]
        : [])
  );
  const allFailedJobs =
    eligibility.kind === "retryable"
      ? eligibility.failedJobs
      : [];
  const failedJobs = allFailedJobs.filter((job) => selected.has(job.targetPath));
  const remainingFailedJobs = allFailedJobs.filter(
    (job) => !selected.has(job.targetPath)
  );
  const failedFiles = run.observation.files.filter((file) => file.stage === "failed");
  const candidateNoun = retained === 1 ? "candidate is" : "candidates are";
  const runtime = `${terminalField(run.adapter.providerId, "[unprintable provider]", 80)}/${terminalField(
    run.adapter.modelId,
    "[unprintable model]",
    80
  )}${
    run.adapter.variantId === null
      ? " · adapter default"
      : ` · ${terminalField(run.adapter.variantId, "[unprintable variant]", 80)}`
  }`;
  const targets =
    failedJobs.length === 0
      ? "  • None"
      : failedJobs
          .map(
            (job) =>
              `  • ${terminalField(job.targetPath, "[unprintable target]", 156)}`
          )
          .join("\n");
  const remainingTargets =
    remainingFailedJobs.length === 0
      ? "  • None"
      : remainingFailedJobs
          .map(
            (job) =>
              `  • ${terminalField(job.targetPath, "[unprintable target]", 156)}`
          )
          .join("\n");
  const evidence =
    failedFiles.length === 0
      ? "Failure details are unavailable for this historical Run."
      : failedFiles.map((file) => formatFailedFile(file)).join("\n\n");
  return (
    `\nRetry failed ${failedJobs.length === 1 ? "Agent" : "Agents"}\n\n` +
    `The other ${retained} ${candidateNoun} saved.\n` +
    `Frozen runtime: ${runtime}\n` +
    `New paid Agent invocations: ${failedJobs.length}\n\n` +
    `Selected retry targets\n${targets}\n\n` +
    `Other failed targets not retried now\n${remainingTargets}\n\n` +
    `${evidence}\n\n` +
    (remainingFailedJobs.length === 0
      ? `Nothing is applied unless all ${run.jobs.length} candidates are present and valid.\n`
      : `Even if this retry succeeds, nothing can be applied while ${remainingFailedJobs.length} other ${remainingFailedJobs.length === 1 ? "Job remains" : "Jobs remain"} failed.\n`)
  );
}

export async function runManualRetryFlow(input: {
  readonly initialRun: RunSnapshot;
  readonly prompts: ManualRetryPrompts;
  readonly executeRetry: (
    run: RunSnapshot,
    targetPaths: ReadonlyArray<string>
  ) => Promise<RunSnapshot>;
  readonly write?: (value: string) => void;
  readonly initialDecision?: ManualRetryDecision;
}): Promise<RunSnapshot> {
  const write = input.write ?? ((value: string) => process.stdout.write(value));
  let current = input.initialRun;
  let initialDecision = input.initialDecision;
  const prompt = async <A>(operation: () => Promise<A>): Promise<A> => {
    try {
      return await operation();
    } catch (cause) {
      if (cause instanceof Error && cause.name === "ExitPromptError") {
        throw new ManualRetryCancelled(
          classifyRunRetry(current).retainedSuccessCount
        );
      }
      throw cause;
    }
  };
  while (current.state === "completed_with_failures") {
    let decision = initialDecision;
    if (decision === undefined) {
      write(formatRetryDecisionSummary(current));
      decision = await prompt(() => input.prompts.selectDecision(current));
    }
    initialDecision = undefined;
    if (decision === "stop") {
      const retained = classifyRunRetry(current).retainedSuccessCount;
      write(
        `\nStopped. ${retained} saved ${retained === 1 ? "candidate remains" : "candidates remain"} available; nothing was retried or applied.\n`
      );
      return current;
    }
    const eligibility = classifyRunRetry(current);
    if (eligibility.kind !== "retryable") return current;
    const targetPaths =
      eligibility.failedJobs.length === 1
        ? [eligibility.failedJobs[0]!.targetPath]
        : input.prompts.selectTargets === undefined
          ? []
          : await prompt(() => input.prompts.selectTargets!(current));
    if (targetPaths.length === 0) {
      write("\nNothing was selected. The saved candidates remain available.\n");
      return current;
    }
    write(formatRetryPreview(current, targetPaths));
    if (!(await prompt(() => input.prompts.confirmRetry(current, targetPaths)))) {
      const retained = classifyRunRetry(current).retainedSuccessCount;
      write(
        `\nNothing was retried. The saved ${retained === 1 ? "candidate remains" : "candidates remain"} available.\n`
      );
      return current;
    }
    current = await input.executeRetry(current, targetPaths);
    if (current.state !== "completed_with_failures") {
      write(formatRunApplicationSummary(current));
    }
  }
  return current;
}

export function createInquirerManualRetryPrompts(): ManualRetryPrompts {
  return {
    selectDecision: (run) =>
      select({
        message: "Retry again or stop?",
        choices: manualRetryDecisionChoices(run)
      }),
    selectTargets: (run) => {
      const eligibility = classifyRunRetry(run);
      if (eligibility.kind !== "retryable") return Promise.resolve([]);
      return checkbox({
        message: "Which failed Agents do you want to retry?",
        required: true,
        choices: eligibility.failedJobs.map((job) => ({
          name: terminalField(job.targetPath, "[unprintable target]", 156),
          value: job.targetPath
        }))
      });
    },
    confirmRetry: (_run, targetPaths) => {
      const failedCount = targetPaths.length;
      return confirm({
        message:
          `Retry ${failedCount === 1 ? "this failed Agent" : `${failedCount} failed Agents`} ` +
          `with the frozen runtime? This makes ${failedCount} new paid Agent ${failedCount === 1 ? "invocation" : "invocations"}.`,
        default: false
      });
    }
  };
}

function repositoryDifferenceLabel(finding: RepositoryDriftFinding): string {
  switch (finding.kind) {
    case "missing":
      return "missing; will be recreated";
    case "changed":
      return "changed since the plan";
    case "occupied":
      return "exists; will be replaced";
    case "reappeared":
      return "exists again; will be replaced";
    case "not_regular":
      return "not a regular file";
    case "unexpected":
      return "not in the original source snapshot";
    case "unsafe_snapshot_path":
      return "uses an unsafe path";
    case "duplicate_snapshot_paths":
      return "appears more than once";
  }
}

export function formatRepositoryDifferenceNotice(
  findings: ReadonlyArray<RepositoryDriftFinding>
): string {
  if (findings.length === 0) return "";
  return (
    "Repository warning\n" +
    "  These planned files differ from their original reviewed source state.\n" +
    findings
      .map((finding) =>
        "path" in finding
          ? `  • ${terminalField(finding.path, "[unprintable repository path]", 120)} · ${repositoryDifferenceLabel(finding)}`
          : `  • ${repositoryDifferenceLabel(finding)}`
      )
      .join("\n") +
    "\nContinuing lets SCORE replace or recreate these files if they remain unchanged while agents run.\n\n"
  );
}

export function createInquirerGuidedPrompts(): GuidedStartPrompts {
  return {
    selectPlan: (plans) =>
      select({
        message: "Which Change or Slice do you want to run?",
        choices: plans.map((plan) => {
          const status = runStatus(plan);
          return {
            name: terminalSafeLine(
              `${status?.marker ?? "○"} ${terminalField(plan.label, "[unprintable Change or Slice]")} · ${plan.files.length} ${plan.files.length === 1 ? "file" : "files"} · ${approvalLabel(plan.approvalStatus)}`
            ),
            value: plan,
            description: terminalField(
              status?.detail ?? plan.objective,
              "[unprintable description]"
            ),
            ...(plan.approvalStatus === "blocked"
              ? { disabled: "Blocked" }
              : plan.approvalStatus === "review_required"
                ? { disabled: "Review warnings first" }
                : {})
          };
        })
      }),
    showPlan: (plan) => {
      process.stdout.write(
        `\n${terminalField(plan.label, "[unprintable Change or Slice]")}\n\n${terminalField(plan.objective, "[unprintable objective]")}\n\nFiles\n`
      );
      for (const file of plan.files) {
        process.stdout.write(
          `  • ${terminalField(file, "[unprintable file path]", 156)}\n`
        );
      }
      process.stdout.write("\n");
    },
    selectModel: async (adapterCatalog, models) => {
      let latestResults: ReadonlyArray<RuntimeModel> = models;
      let latestGeneration = 0;
      while (true) {
        const selection = await search({
          message: terminalSafeLine(
            `Which ${terminalField(adapterCatalog.label, "[unprintable adapter]")} model should run it?`
          ),
          source: (term) => {
            latestGeneration += 1;
            const generation = latestGeneration;
            const query = term?.trim().toLowerCase() ?? "";
            latestResults = models.filter((model) =>
              query.length === 0
                ? true
                : `${model.label} ${model.sourceLabel ?? ""}`.toLowerCase().includes(query)
            );
            return latestResults.map((model) => ({
              name: terminalField(model.label, "[unprintable model]"),
              value: { model, generation },
              ...(model.sourceLabel === undefined
                ? {}
                : {
                    description: terminalField(
                      model.sourceLabel,
                      "[unprintable provider]"
                    )
                  })
            }));
          }
        });
        if (selection.generation === latestGeneration) return selection.model;
        if (latestResults.length === 1) return latestResults[0]!;
        process.stdout.write(
          "Search results changed before selection completed. Choose the model again.\n"
        );
      }
    },
    selectVariant: (adapterCatalog, model) =>
      select({
        message: terminalSafeLine(
          `Which ${terminalField(model.label, "[unprintable model]")} reasoning variant should run it?`
        ),
        choices: [
          {
            name: terminalSafeLine(
              `${terminalField(adapterCatalog.label, "[unprintable adapter]")} default`
            ),
            value: null
          },
          ...model.variants.map((variant) => ({
            name: terminalField(variant.label, "[unprintable variant]"),
            value: variant
          }))
        ]
      }),
    confirmStart: ({
      adapterCatalog,
      plan,
      model,
      variant,
      willApprove,
      repositoryRoot,
      repositoryDifferences
    }) => {
      process.stdout.write(
        `Repository\n  ${terminalField(repositoryRoot, "[unprintable repository path]", 158)}\n\nFiles to update\n`
      );
      for (const file of plan.files) {
        process.stdout.write(
          `  • ${terminalField(file, "[unprintable file path]", 156)}\n`
        );
      }
      process.stdout.write("\n");
      process.stdout.write(formatRepositoryDifferenceNotice(repositoryDifferences));
      return confirm({
        message: formatGuidedConfirmation({
          adapterCatalog,
          planLabel: plan.label,
          model,
          variant,
          willApprove
        }),
        default: true
      });
    }
  };
}

export function makeGuidedStartBackend(input: {
  readonly scoreDatabasePath: string;
  readonly runnerDatabasePath: string;
  readonly invokingDirectory: string;
  readonly repositoryOverride?: string;
  readonly adapterCatalog: RuntimeAdapterCatalog<AdapterConfiguration>;
  readonly runtimeLayer: Layer.Layer<RuntimeAdapter>;
  readonly runEffect?: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly progress?: RunProgressDependencies;
}): GuidedStartBackend {
  return {
    listPlans: async () =>
      listReviewedSlices({
        scoreDatabasePath: input.scoreDatabasePath,
        runnerDatabasePath: input.runnerDatabasePath
      }),
    prepareRepository: (plan) =>
      Effect.runPromise(
        prepareRepositoryForGuidedPlan({
          scoreDatabasePath: input.scoreDatabasePath,
          runnerDatabasePath: input.runnerDatabasePath,
          passId: plan.passId,
          invokingDirectory: input.invokingDirectory,
          ...(input.repositoryOverride === undefined
            ? {}
            : { repositoryOverride: input.repositoryOverride })
        })
      ),
    approve: async (plan) => {
      ScoreAlpha.approveReviewedChangePlan(input.scoreDatabasePath, {
        plan,
        authority: `local-cli:${userInfo().username}`,
        decidedAt: new Date().toISOString()
      });
    },
    start: async ({
      plan,
      model,
      variant,
      concurrency,
      repositoryRoot,
      confirmedTargets
    }) => {
      const configuration = input.adapterCatalog.configurationFor(model, variant?.id);
      const enqueued = await Effect.runPromise(
        enqueueApprovedPlan({
          scoreDatabasePath: input.scoreDatabasePath,
          runnerDatabasePath: input.runnerDatabasePath,
          passId: plan.passId,
          repositoryRoot,
          confirmedTargets,
          adapter: configuration,
          maxConcurrency: concurrency
        })
      );
      const completed = await runWithRunProgress({
        header: {
          planLabel: plan.label,
          modelLabel: model.label,
          providerLabel: model.sourceLabel ?? input.adapterCatalog.label,
          ...(model.variants.length === 0
            ? {}
            : {
                variantLabel:
                  variant?.summaryLabel ?? `${input.adapterCatalog.label} default`
              })
        },
        ...(input.progress === undefined ? {} : { progress: input.progress }),
        execute: (observer) =>
          (input.runEffect ?? Effect.runPromise)(
            runPendingJobsAndApply(input.runnerDatabasePath, enqueued.runId, {
              observer
            }).pipe(Effect.provide(input.runtimeLayer))
          )
      });
      if (completed.state !== "completed_with_failures") {
        process.stdout.write(formatRunApplicationSummary(completed));
      }
      return {
        runId: enqueued.runId,
        state: completed.state
      } satisfies GuidedStartResult;
    }
  };
}

export async function runGuidedOpenCodeStart(input: {
  readonly scoreDatabasePath: string;
  readonly runnerDatabasePath: string;
  readonly invokingDirectory: string;
  readonly repositoryOverride?: string;
  readonly adapterCatalog: RuntimeAdapterCatalog<AdapterConfiguration>;
  readonly runtimeLayer: Layer.Layer<RuntimeAdapter>;
  readonly runEffect?: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly progress?: RunProgressDependencies;
  readonly concurrency: number;
  readonly variantOverride?: string;
  readonly prompts?: GuidedStartPrompts;
  readonly retryPrompts?: ManualRetryPrompts;
}): Promise<GuidedStartResult> {
  const result = await runGuidedStart({
    backend: makeGuidedStartBackend(input),
    prompts: input.prompts ?? createInquirerGuidedPrompts(),
    adapterCatalog: input.adapterCatalog,
    concurrency: input.concurrency,
    ...(input.variantOverride === undefined ? {} : { variantOverride: input.variantOverride })
  });
  if (result.state !== "completed_with_failures") return result;
  const initialRun = await Effect.runPromise(
    inspectRun(input.runnerDatabasePath, result.runId)
  );
  const finalRun = await runManualRetryFlow({
    initialRun,
    prompts: input.retryPrompts ?? createInquirerManualRetryPrompts(),
    executeRetry: (run, targetPaths) =>
      runWithRunProgress({
        header: {
          modelLabel: run.adapter.modelId,
          providerLabel: run.adapter.providerId,
          ...(run.adapter.variantId === null
            ? {}
            : { variantLabel: run.adapter.variantId })
        },
        ...(input.progress === undefined ? {} : { progress: input.progress }),
        execute: (observer) =>
          (input.runEffect ?? Effect.runPromise)(
            retryFailedJobsAndApply(input.runnerDatabasePath, run.runId, {
              targetPaths,
              observer
            }).pipe(Effect.provide(input.runtimeLayer))
          )
      })
  });
  return { runId: finalRun.runId, state: finalRun.state };
}
