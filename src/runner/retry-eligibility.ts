import type { RunJobSummary, RunSnapshot } from "./domain.js";

export type RunRetryEligibility =
  | {
      readonly kind: "retryable";
      readonly failedJobs: ReadonlyArray<RunJobSummary>;
      readonly retainedSuccessCount: number;
    }
  | {
      readonly kind: "needs_attention";
      readonly retainedSuccessCount: number;
    }
  | {
      readonly kind: "unsupported_adapter";
      readonly adapterKind: string;
      readonly retainedSuccessCount: number;
    }
  | {
      readonly kind: "unavailable";
      readonly retainedSuccessCount: number;
    };

/**
 * Read-only projection for status and prompts. RunnerStore repeats these checks
 * transactionally because UI classification is never execution authority.
 */
export function classifyRunRetry(run: RunSnapshot): RunRetryEligibility {
  const retainedSuccessCount = run.jobs.filter(
    (job) => job.state === "succeeded"
  ).length;
  if (
    run.state !== "completed_with_failures" ||
    run.applicationState !== "not_applied"
  ) {
    return { kind: "unavailable", retainedSuccessCount };
  }
  if (run.adapter.kind !== "opencode") {
    return {
      kind: "unsupported_adapter",
      adapterKind: run.adapter.kind,
      retainedSuccessCount
    };
  }
  if (run.jobs.some((job) => job.state === "needs_attention")) {
    return { kind: "needs_attention", retainedSuccessCount };
  }
  const failedJobs = run.jobs.filter((job) => job.state === "failed");
  return failedJobs.length === 0
    ? { kind: "unavailable", retainedSuccessCount }
    : { kind: "retryable", failedJobs, retainedSuccessCount };
}
