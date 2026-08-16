import type { RunSnapshot } from "./domain.js";
import { formatRunFailureSummary } from "./failure-presentation.js";
import { terminalSafeLine } from "./terminal-safe-line.js";

export function formatApplicationSummary(input: {
  readonly applicationState: RunSnapshot["applicationState"];
  readonly candidateCount: number;
  readonly repositoryRoot: RunSnapshot["repositoryRoot"];
}): string {
  if (input.applicationState !== "applied") {
    return "\nNo files were applied because the Run did not complete successfully.\n";
  }
  if (input.repositoryRoot === null) {
    throw new Error("An applied Run must retain its repository root");
  }
  const delivery = input.candidateCount === 1
    ? "The candidate was"
    : `All ${input.candidateCount} candidates were`;
  const repositoryRoot =
    terminalSafeLine(input.repositoryRoot, 240) || "[unprintable repository path]";
  return `\n${delivery} generated and applied to ${repositoryRoot}.\n`;
}

export function formatRunApplicationSummary(run: RunSnapshot): string {
  if (run.state === "completed_with_failures" || run.applicationState === "apply_failed") {
    return formatRunFailureSummary(run);
  }
  return formatApplicationSummary({
    applicationState: run.applicationState,
    candidateCount: run.jobs.length,
    repositoryRoot: run.repositoryRoot
  });
}
