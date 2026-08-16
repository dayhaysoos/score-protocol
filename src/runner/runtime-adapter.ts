import { Context, Effect, Schema } from "effect";

import {
  FailureEvidence,
  JobId,
  TargetOutputState,
  type ClaimedJob
} from "./domain.js";
import type { RuntimeAttemptReporter } from "./runtime-attempt-observation.js";

export class AdapterInvocationError extends Schema.TaggedError<AdapterInvocationError>()(
  "AdapterInvocationError",
  {
    jobId: JobId,
    message: Schema.String,
    failureEvidence: FailureEvidence,
    runtimeSessionId: Schema.optional(Schema.String),
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
    failureEvidence: FailureEvidence,
    runtimeSessionId: Schema.optional(Schema.String),
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
