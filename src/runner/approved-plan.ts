import { Effect } from "effect";

import { ScoreAlpha } from "../score-alpha.js";
import { PlanNotApproved } from "./domain.js";

export const loadApprovedPlan = Effect.fn("ApprovedPlan.load")(function*(input: {
  readonly scoreDatabasePath: string;
  readonly passId: string;
}) {
  return yield* Effect.try({
    try: () => ScoreAlpha.readApprovedPass(input.scoreDatabasePath, input.passId),
    catch: (cause) =>
      new PlanNotApproved({
        passId: input.passId,
        message: cause instanceof Error ? cause.message : String(cause)
      })
  });
});
