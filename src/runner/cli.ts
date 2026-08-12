import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";

import { ScoreAlpha } from "../score-alpha.js";
import {
  OpenCodeRuntimeLive
} from "./open-code-adapter.js";
import {
  runGuidedOpenCodeStart,
  runWithRunProgress
} from "./guided-start-cli.js";
import { GuidedStartCancelled } from "./guided-start.js";
import { makeOpenCodeModelCatalog } from "./open-code-catalog.js";
import {
  enqueueApprovedPlan,
  exportRunCandidates,
  inspectLatestProjectRun,
  inspectRun,
  inspectRunner,
  prepareRepositoryForPlan,
  recoverRun,
  runPendingJobsAndApply,
  validateRunnerDatabaseBoundary
} from "./runner.js";
import {
  RepositoryDriftError,
  RepositoryRootError,
  formatRepositoryDriftFindingForTerminal,
  formatRepositoryDriftForHuman
} from "./repository-application.js";
import { MAX_RUNNER_CONCURRENCY, RunId } from "./domain.js";
import { defaultRunnerDatabasePath } from "./runner-paths.js";
import { formatReviewedSlice, listReviewedSlices } from "./slice-listing.js";
import { formatRunApplicationSummary } from "./application-summary.js";
import { resolveNonInteractiveOpenCodeConfiguration } from "./open-code-selection.js";
import { optionValue } from "./cli-options.js";
import {
  isRunnerCliCommand,
  RUNNER_CLI_HELP,
  RUNNER_CLI_USAGE
} from "./cli-commands.js";
import { safeRunnerCliErrorMessage } from "./diagnostic-sanitization.js";
import { prepareRunnerDatabaseState } from "../private-state-filesystem.js";
import { installRunnerDatabaseGitExclude } from "../plan-intake-filesystem.js";
import { terminalSafeJson } from "./terminal-safe-json.js";

class RunnerInterruptedError extends Error {
  constructor(readonly signalName: "SIGINT" | "SIGTERM", cause: unknown) {
    super(`Runner was interrupted by ${signalName}`, { cause });
    this.name = "RunnerInterruptedError";
  }
}

async function runRunnerEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  const controller = new AbortController();
  let signalName: "SIGINT" | "SIGTERM" | undefined;
  const onSigint = () => {
    signalName = "SIGINT";
    controller.abort();
  };
  const onSigterm = () => {
    signalName = "SIGTERM";
    controller.abort();
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    return await Effect.runPromise(effect, { signal: controller.signal });
  } catch (cause) {
    if (signalName !== undefined) throw new RunnerInterruptedError(signalName, cause);
    throw cause;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

const require = createRequire(import.meta.url);
const openCodePackagePath = require.resolve("@opencode-ai/cli/package.json");
const openCodePackage = JSON.parse(
  readFileSync(openCodePackagePath, "utf8")
) as { readonly bin?: string | Readonly<Record<string, string>> };
const openCodeBin =
  typeof openCodePackage.bin === "string"
    ? openCodePackage.bin
    : openCodePackage.bin?.opencode2;
if (openCodeBin === undefined) {
  throw new Error("Pinned @opencode-ai/cli package does not expose the opencode2 binary");
}
const PINNED_OPENCODE_COMMAND = resolve(dirname(openCodePackagePath), openCodeBin);
const DEFAULT_OPENCODE_AUTH_PATH = join(
  homedir(),
  ".local",
  "share",
  "opencode",
  "auth.json"
);

function option(name: string): string | undefined {
  return optionValue(process.argv, name);
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing required --${name} option`);
  return value;
}

function positiveIntegerOption(name: string, fallback: number): number {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  if (name === "concurrency" && value > MAX_RUNNER_CONCURRENCY) {
    throw new Error(`--concurrency must not exceed ${MAX_RUNNER_CONCURRENCY}`);
  }
  return value;
}

function print(value: unknown): void {
  process.stdout.write(`${terminalSafeJson(value, 2)}\n`);
}

function openCodeRuntimeOptions() {
  const command = option("opencode-command") ?? PINNED_OPENCODE_COMMAND;
  const configuredAuthPath = option("opencode-auth");
  const authPath =
    configuredAuthPath ??
    (existsSync(DEFAULT_OPENCODE_AUTH_PATH) ? DEFAULT_OPENCODE_AUTH_PATH : undefined);
  const providerConfigPath = option("opencode-provider-config");
  return {
    command,
    startTimeoutMs: positiveIntegerOption("start-timeout-ms", 10_000),
    ...(authPath === undefined ? {} : { authPath }),
    ...(providerConfigPath === undefined ? {} : { providerConfigPath })
  };
}

function runtimeLayer() {
  return OpenCodeRuntimeLive(openCodeRuntimeOptions());
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== undefined && isRunnerCliCommand(command) && process.argv.includes("--help")) {
    process.stdout.write(RUNNER_CLI_HELP[command]);
    return;
  }
  const scoreDatabasePath = option("score-db") ?? join(process.cwd(), ".score", "score.db");

  if (command === "approve") {
    const passId = requiredOption("pass");
    const plan = ScoreAlpha.listReviewedChangePlans(scoreDatabasePath).find(
      (candidate) => candidate.passId === passId
    );
    if (plan === undefined) throw new Error(`Reviewed work ${passId} is not ready for approval`);
    print(
      ScoreAlpha.approveReviewedChangePlan(scoreDatabasePath, {
        plan,
        authority: `local-cli:${userInfo().username}`,
        decidedAt: new Date().toISOString()
      })
    );
    return;
  }
  const requestedRunnerDatabasePath = option("runner-db");
  const runnerState = prepareRunnerDatabaseState({
    databasePath: requestedRunnerDatabasePath ?? defaultRunnerDatabasePath(),
    tightenExistingParent: requestedRunnerDatabasePath === undefined,
    createDatabase: false
  });
  const runnerDatabasePath = runnerState.databasePath;
  installRunnerDatabaseGitExclude(process.cwd(), runnerDatabasePath);
  await Effect.runPromise(
    validateRunnerDatabaseBoundary(scoreDatabasePath, runnerDatabasePath)
  );

  if (command === "counts") {
    print(await Effect.runPromise(inspectRunner(runnerDatabasePath)));
    return;
  }

  if (command === "list") {
    for (const slice of listReviewedSlices({ scoreDatabasePath, runnerDatabasePath })) {
      process.stdout.write(`${formatReviewedSlice(slice)}\n`);
    }
    return;
  }

  if (command === "status") {
    const hasRequestedRunId = process.argv.includes("--run");
    print(
      await Effect.runPromise(
        hasRequestedRunId
          ? inspectRun(runnerDatabasePath, RunId.make(requiredOption("run")))
          : inspectLatestProjectRun({ scoreDatabasePath, runnerDatabasePath })
      )
    );
    return;
  }

  if (command === "recover") {
    const runId = RunId.make(requiredOption("run"));
    print({
      runId,
      recoveredAttempts: await Effect.runPromise(
        recoverRun(runnerDatabasePath, runId)
      )
    });
    return;
  }

  if (command === "export-candidates") {
    const runId = RunId.make(requiredOption("run"));
    const destination = requiredOption("destination");
    print(await Effect.runPromise(exportRunCandidates(runnerDatabasePath, runId, destination)));
    return;
  }

  if (
    command === "start" &&
    option("pass") === undefined &&
    option("provider") === undefined &&
    option("model") === undefined
  ) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(
        "Guided start requires an interactive terminal. For automation, provide --pass, --provider, and --model."
      );
    }
    const runtimeOptions = openCodeRuntimeOptions();
    const requestedVariantId = option("variant");
    const repositoryOverride = option("repo");
    const result = await runGuidedOpenCodeStart({
      scoreDatabasePath,
      runnerDatabasePath,
      invokingDirectory: process.cwd(),
      ...(repositoryOverride === undefined ? {} : { repositoryOverride }),
      adapterCatalog: makeOpenCodeModelCatalog(runtimeOptions),
      runtimeLayer: OpenCodeRuntimeLive(runtimeOptions),
      runEffect: runRunnerEffect,
      concurrency: positiveIntegerOption("concurrency", 5),
      ...(requestedVariantId === undefined ? {} : { variantOverride: requestedVariantId })
    });
    process.stdout.write(`\nRun ID: ${result.runId}\n`);
    if (result.state === "completed_with_failures") process.exitCode = 2;
    return;
  }

  if (command === "enqueue" || command === "start") {
    const passId = requiredOption("pass");
    const providerId = requiredOption("provider");
    const modelId = requiredOption("model");
    const runtimeOptions = openCodeRuntimeOptions();
    const requestedVariantId = option("variant");
    const adapterCatalog = makeOpenCodeModelCatalog(runtimeOptions);
    const runtimeSelection = await resolveNonInteractiveOpenCodeConfiguration({
      adapterCatalog,
      providerId,
      modelId,
      ...(requestedVariantId === undefined ? {} : { variantId: requestedVariantId })
    });
    const repositoryOverride = option("repo");
    const preparedRepository = await Effect.runPromise(
      prepareRepositoryForPlan({
        scoreDatabasePath,
        runnerDatabasePath,
        passId,
        invokingDirectory: process.cwd(),
        ...(repositoryOverride === undefined ? {} : { repositoryOverride })
      })
    );
    const enqueued = await Effect.runPromise(
      enqueueApprovedPlan({
        scoreDatabasePath,
        runnerDatabasePath,
        passId,
        repositoryRoot: preparedRepository.repositoryRoot,
        adapter: runtimeSelection.configuration,
        maxConcurrency: positiveIntegerOption("concurrency", 5)
      })
    );
    if (command === "enqueue") {
      print(enqueued);
      return;
    }
    const adapterLayer = runtimeLayer();
    const completed = await runWithRunProgress({
      header: {
        modelLabel: runtimeSelection.model?.label ?? runtimeSelection.configuration.modelId,
        providerLabel:
          runtimeSelection.model?.sourceLabel ?? runtimeSelection.configuration.providerId,
        ...(runtimeSelection.variant === null
          ? {}
          : { variantLabel: runtimeSelection.variant.summaryLabel })
      },
      execute: (observer) =>
        runRunnerEffect(
          runPendingJobsAndApply(runnerDatabasePath, enqueued.runId, {
            observer
          }).pipe(Effect.provide(adapterLayer))
        )
    });
    process.stdout.write(formatRunApplicationSummary(completed));
    if (completed.state === "completed_with_failures") process.exitCode = 2;
    return;
  }

  if (command === "work") {
    const runId = RunId.make(requiredOption("run"));
    const existing = await Effect.runPromise(inspectRun(runnerDatabasePath, runId));
    const adapterLayer = runtimeLayer();
    const completed = await runWithRunProgress({
      header: {
        modelLabel: existing.adapter.modelId,
        providerLabel: existing.adapter.providerId,
        ...(existing.adapter.variantId === null
          ? {}
          : { variantLabel: existing.adapter.variantId })
      },
      execute: (observer) =>
        runRunnerEffect(
          runPendingJobsAndApply(runnerDatabasePath, runId, { observer }).pipe(
            Effect.provide(adapterLayer)
          )
        )
    });
    process.stdout.write(formatRunApplicationSummary(completed));
    if (completed.state === "completed_with_failures") process.exitCode = 2;
    return;
  }

  throw new Error(
    RUNNER_CLI_USAGE.trimEnd()
  );
}

function reportRunnerCliFailure(cause: unknown): void {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  if (error instanceof GuidedStartCancelled || error.name === "ExitPromptError") {
    process.stdout.write("Nothing was approved or started.\n");
    return;
  }
  if (error instanceof RunnerInterruptedError) {
    process.stderr.write(
      `${error.message}. Active OpenCode sessions were asked to abort and the Runner waited for cleanup.\n` +
        "Inspect the Run before recovery; no interrupted Attempt is automatically redelivered.\n"
    );
    process.exitCode = error.signalName === "SIGINT" ? 130 : 143;
    return;
  }
  if (error instanceof RepositoryDriftError) {
    process.stderr.write(`${formatRepositoryDriftForHuman(error)}\n`);
    if (process.argv.includes("--verbose")) {
      process.stderr.write(
        `\nMismatches\n${error.findings.map((finding) => `  • ${formatRepositoryDriftFindingForTerminal(finding)}`).join("\n")}\n`
      );
    }
    process.exitCode = 1;
    return;
  }
  if (error instanceof RepositoryRootError) {
    process.stderr.write(
      "Repository is unavailable.\n" +
        "No work was started. Use --repo <path> once to establish a valid binding.\n"
    );
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`${safeRunnerCliErrorMessage(error.message)}\n`);
  process.exitCode = 1;
}

/** Run the Runner command currently present in process.argv. */
export async function runRunnerCli(): Promise<void> {
  try {
    await main();
  } catch (cause) {
    reportRunnerCliFailure(cause);
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runRunnerCli();
}
