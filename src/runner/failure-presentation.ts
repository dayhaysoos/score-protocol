import type {
  FailureCategory,
  FailureEvidence,
  RunFileObservation,
  RunSnapshot
} from "./domain.js";
import { safeFailureMessage } from "./diagnostic-sanitization.js";
import { terminalSafeLine } from "./terminal-safe-line.js";
import { classifyRunRetry } from "./retry-eligibility.js";

function titleCaseStage(stage: FailureEvidence["stage"]): string {
  if (stage === null) return "Unavailable (not retained for this Run)";
  return stage === "Agent working"
    ? stage
    : `${stage[0]?.toUpperCase() ?? ""}${stage.slice(1)}`;
}

function failureLabel(category: FailureCategory): string {
  switch (category) {
    case "provider":
      return "Provider failure";
    case "tool":
      return "Tool failure";
    case "timeout":
      return "Runtime timeout";
    case "workspace integrity":
      return "Workspace integrity failure";
    case "missing output":
      return "Missing candidate output";
    case "interruption":
      return "Interrupted execution";
    case "ambiguous recovery":
      return "Ambiguous prior execution";
    case "candidate integrity":
      return "Candidate integrity failure";
    case "target drift":
      return "Target changed during the Run";
    case "application":
      return "Application failure";
    case "persistence":
      return "Runner persistence failure";
    case "runtime":
      return "Runtime failure";
    case "unknown":
      return "Unknown Runner failure";
  }
}

function candidateOutputLabel(file: RunFileObservation): string {
  switch (file.targetOutputState) {
    case "different":
    case "present":
      return "Changed, but rejected";
    case "unchanged":
      return "Unchanged and rejected";
    case "missing":
      return "Missing";
    case "not observed":
      return "Unavailable (not observed)";
  }
}

function legacyEvidence(file: RunFileObservation): FailureEvidence | null {
  if (file.failureCategory === null) return null;
  return {
    category: file.failureCategory,
    stage: file.failureStage,
    name: file.terminalOutcome?.name ?? null,
    status: file.terminalOutcome?.status ?? null,
    statusCode: file.terminalOutcome?.statusCode ?? null,
    reason:
      file.failureMessage === null ||
      file.failureMessage === safeFailureMessage(file.failureCategory)
        ? null
        : file.failureMessage
  };
}

function available(value: string | null, maximumLength = 320): string {
  if (value === null) return "Unavailable (not retained for this Run)";
  return terminalSafeLine(value, maximumLength) || "Unavailable (not printable)";
}

export function formatFailedFile(
  file: RunFileObservation,
  heading?: string
): string {
  const evidence = file.failureEvidence ?? legacyEvidence(file);
  const target =
    terminalSafeLine(file.targetPath, 240) || `[unprintable target; Job ${file.jobId}]`;
  if (evidence === null) {
    return [
      heading ?? `${target} failed`,
      "What failed: Unavailable (not retained for this Run)",
      "Reason: Unavailable (not retained for this Run)",
      "Stage: Unavailable (not retained for this Run)",
      `Candidate output: ${candidateOutputLabel(file)}`
    ].join("\n");
  }

  const identityLabel =
    evidence.category === "tool"
      ? "Tool"
      : evidence.category === "provider"
        ? "Provider"
        : "Name";
  const status = [
    evidence.status,
    evidence.statusCode === null ? null : `code ${evidence.statusCode}`
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");
  const lines = [
    heading ?? `${target} failed`,
    `What failed: ${failureLabel(evidence.category)}`,
    `${identityLabel}: ${available(evidence.name, 120)}`,
    `Reason: ${available(evidence.reason)}`,
    `Stage: ${titleCaseStage(evidence.stage)}`,
    `Status: ${status || "Unavailable (not retained for this Run)"}`,
    `Candidate output: ${candidateOutputLabel(file)}`
  ];
  if (file.rejectedOutputDigest !== null) {
    lines.push(`Rejected-output digest: ${terminalSafeLine(file.rejectedOutputDigest, 96)}`);
  }
  return lines.join("\n");
}

function formatAttemptHistory(run: RunSnapshot): string {
  return run.jobs
    .map((job) => {
      const target = terminalSafeLine(job.targetPath, 240) || "[unprintable target]";
      const attempts = job.attempts ?? [];
      const countLabel = attempts.length === 1 ? "1 Attempt" : `${attempts.length} Attempts`;
      const lines = [`${target} · ${countLabel}`];
      for (const attempt of attempts) {
        const evidenceLabel =
          attempt.state === "failed" && attempt.failureEvidence !== null
            ? ` · ${failureLabel(attempt.failureEvidence.category)}`
            : "";
        const candidateLabel =
          attempt.state === "succeeded" && attempt.candidateDigest !== null
            ? ` · candidate ${terminalSafeLine(attempt.candidateDigest, 96)}`
            : "";
        lines.push(
          `  Attempt ${attempt.attemptNumber}: ${attempt.state.replace("_", " ")}${evidenceLabel}${candidateLabel}`
        );
      }
      return lines.join("\n");
    })
    .join("\n");
}

export function formatRunFailureSummary(run: RunSnapshot): string {
  const retry = classifyRunRetry(run);
  const failures = run.observation.files.filter(
    (file) => file.stage === "failed" || file.stage === "needs attention"
  );
  const succeeded = run.jobs.filter((job) => job.state === "succeeded").length;
  const failedTargets = run.jobs
    .filter((job) => job.state === "failed")
    .map((job) => terminalSafeLine(job.targetPath, 240) || "[unprintable target]");
  const details =
    failures.length === 0
      ? run.observation.failureCategory === null
        ? "Failure details are unavailable for this Run."
        : `Run failure: ${failureLabel(run.observation.failureCategory)}\nReason: ${available(run.observation.failureMessage)}`
      : failures.map((file) => formatFailedFile(file)).join("\n\n");
  const applicationResult =
    run.applicationState === "apply_failed"
      ? "Application failed; repository recovery may be required."
      : "No files were applied.";
  const attemptHistory = formatAttemptHistory(run);
  const next =
    run.applicationState === "apply_failed"
      ? "Next: Inspect the application recovery evidence before changing the repository or starting another Run."
      : failures.some((file) => file.stage === "needs attention")
        ? "Next: No retry command is available. Resolve the ambiguous Attempt through the explicit recovery process before continuing."
        : retry.kind === "retryable"
          ? `Next: npm run runner -- retry --run ${run.runId}`
          : "Next: Address the cause recorded for this Run; no failed Job is eligible for retry.";
  return (
    `\n${details}\n\n` +
    `Run result: ${succeeded}/${run.jobs.length} candidates succeeded. ${applicationResult}\n` +
    `Saved candidates: ${succeeded} of ${run.jobs.length}\n` +
    `Failed targets: ${failedTargets.length === 0 ? "Unavailable" : failedTargets.join(", ")}\n` +
    `Application state: ${run.applicationState}; successful subsets are never applied.\n\n` +
    `Attempt history\n${attemptHistory || "Unavailable for this historical Run"}\n\n` +
    `${next}\n`
  );
}

export function formatRunStatus(run: RunSnapshot): string {
  const hasFileFailure = run.observation.files.some(
    (file) => file.stage === "failed" || file.stage === "needs attention"
  );
  if (
    hasFileFailure ||
    run.state === "completed_with_failures" ||
    run.applicationState === "apply_failed" ||
    run.observation.failureCategory !== null
  ) {
    return `Run ${run.runId} needs attention\n${formatRunFailureSummary(run).trimStart()}`;
  }
  const succeeded = run.jobs.filter((job) => job.state === "succeeded").length;
  const state = run.applicationState === "applied" ? "Applied" : run.state;
  return (
    `Run ${run.runId}\n` +
    `State: ${state}\n` +
    `Files: ${succeeded}/${run.jobs.length} candidates succeeded\n` +
    `Application state: ${run.applicationState}\n\n` +
    `Attempt history\n${formatAttemptHistory(run) || "Unavailable for this historical Run"}\n\n` +
    "Next: None; this Run has no pending manual action.\n"
  );
}
