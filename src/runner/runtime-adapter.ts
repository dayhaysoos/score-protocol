import { Context, Effect, Schema } from "effect";

import { JobId, TargetOutputState, type ClaimedJob } from "./domain.js";
import type { RuntimeAttemptReporter } from "./runtime-attempt-observation.js";

export const AdapterFailureCategory = Schema.Literals([
  "runtime_startup",
  "provider",
  "tool",
  "timeout",
  "interruption",
  "missing_output",
  "workspace_integrity",
  "runtime_protocol",
  "runtime_cleanup"
]);
export type AdapterFailureCategory = typeof AdapterFailureCategory.Type;

export const AdapterTerminalOutcome = Schema.Struct({
  kind: Schema.Literals(["provider", "tool", "assistant", "runtime", "transport"]),
  name: Schema.optional(Schema.String),
  status: Schema.optional(
    Schema.Literals(["completed", "error", "running", "streaming", "unknown", "aborted"])
  ),
  statusCode: Schema.optional(Schema.Number)
});
export type AdapterTerminalOutcome = typeof AdapterTerminalOutcome.Type;

export class AdapterInvocationError extends Schema.TaggedError<AdapterInvocationError>()(
  "AdapterInvocationError",
  {
    jobId: JobId,
    message: Schema.String,
    failureCategory: AdapterFailureCategory,
    runtimeSessionId: Schema.optional(Schema.String),
    terminalOutcome: Schema.optional(AdapterTerminalOutcome),
    targetOutputState: TargetOutputState,
    targetOutputDigest: Schema.optional(Schema.String),
    diagnosticContent: Schema.optional(Schema.String)
  }
) {}

export class AdapterBoundaryError extends Schema.TaggedError<AdapterBoundaryError>()(
  "AdapterBoundaryError",
  {
    jobId: JobId,
    message: Schema.String,
    failureCategory: AdapterFailureCategory,
    runtimeSessionId: Schema.optional(Schema.String),
    terminalOutcome: Schema.optional(AdapterTerminalOutcome),
    targetOutputState: TargetOutputState,
    targetOutputDigest: Schema.optional(Schema.String),
    diagnosticContent: Schema.optional(Schema.String)
  }
) {}

export type RuntimeAdapterError = AdapterInvocationError | AdapterBoundaryError;

export interface AdapterCandidate {
  readonly content: string;
  readonly runtimeSessionId: string;
  readonly targetOutputState?: TargetOutputState;
  readonly targetOutputDigest?: string;
}

export type RuntimeJobInvoke = (
  job: ClaimedJob,
  reporter?: RuntimeAttemptReporter
) => Effect.Effect<AdapterCandidate, RuntimeAdapterError>;

export class RuntimeAdapter extends Context.Service<RuntimeAdapter, {
  readonly invoke: RuntimeJobInvoke;
  readonly withRun: <A, E, R>(
    use: (invoke: RuntimeJobInvoke) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | RuntimeAdapterError, R>;
}>()("score/RuntimeAdapter") {}
