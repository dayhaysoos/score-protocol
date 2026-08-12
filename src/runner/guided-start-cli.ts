import { userInfo } from "node:os";

import { confirm, search, select } from "@inquirer/prompts";
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
import type { AdapterConfiguration } from "./domain.js";
import { formatApplicationSummary } from "./application-summary.js";
import {
  enqueueApprovedPlan,
  prepareRepositoryForGuidedPlan,
  runPendingJobsAndApply,
  type RunObservationObserver
} from "./runner.js";
import type { RepositoryDriftFinding } from "./repository-application.js";
import { OpenCodeAdapter } from "./open-code-adapter.js";
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
  readonly runtimeLayer: Layer.Layer<OpenCodeAdapter>;
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
      process.stdout.write(
        formatGuidedApplicationSummary({
          applicationState: completed.applicationState,
          candidateCount: completed.jobs.length,
          repositoryRoot: completed.repositoryRoot
        })
      );
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
  readonly runtimeLayer: Layer.Layer<OpenCodeAdapter>;
  readonly runEffect?: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
  readonly progress?: RunProgressDependencies;
  readonly concurrency: number;
  readonly variantOverride?: string;
}): Promise<GuidedStartResult> {
  return runGuidedStart({
    backend: makeGuidedStartBackend(input),
    prompts: createInquirerGuidedPrompts(),
    adapterCatalog: input.adapterCatalog,
    concurrency: input.concurrency,
    ...(input.variantOverride === undefined ? {} : { variantOverride: input.variantOverride })
  });
}
