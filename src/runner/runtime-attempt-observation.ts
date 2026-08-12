import type { Effect } from "effect";

export type RuntimeAttemptFact =
  | {
      readonly kind: "runtime_session_created";
      readonly runtimeSessionId: string;
    }
  | {
      readonly kind: "agent_input_admitted";
      readonly runtimeSessionId: string;
    }
  | {
      readonly kind: "workspace_inspection_started";
      readonly runtimeSessionId?: string;
    };

export interface RuntimeAttemptReporter {
  readonly report: (fact: RuntimeAttemptFact) => Effect.Effect<void, unknown>;
}
