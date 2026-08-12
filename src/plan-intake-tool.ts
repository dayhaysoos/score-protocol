import { join } from "node:path";

import {
  prepareSlice as prepareSliceAtProjectRoot,
  type PrepareSliceResult
} from "./plan-intake.js";
import {
  prepareSliceSet,
  type PrepareSliceSetResult
} from "./plan-intake-set.js";
import { defaultRunnerDatabasePath } from "./runner/runner-paths.js";
import {
  prepareChange as prepareChangeAtProjectRoot,
  type PrepareChangeResult
} from "./change-authoring.js";

export type { PrepareSliceResult, SliceDraft, SliceFinding } from "./plan-intake.js";
export type { PrepareSliceSetResult, SlicePreparationState } from "./plan-intake-set.js";
export type { ChangeDraft, PrepareChangeResult } from "./change-authoring.js";
export { SLICE_DRAFT_SCHEMA } from "./plan-intake.js";
export { CHANGE_DRAFT_SCHEMA } from "./change-authoring.js";

/** Agent-facing Change entry point. The host binds SCORE to its exact cwd. */
export function prepareChange(input: {
  readonly changeDraft: unknown;
}): PrepareChangeResult {
  return prepareChangeAtProjectRoot({
    projectRoot: process.cwd(),
    changeDraft: input.changeDraft
  });
}

/** Agent-facing Plan Intake entry point. The host binds SCORE to its exact cwd. */
export function prepareSlice(input: { readonly sliceDraft: unknown }): PrepareSliceResult {
  return prepareSliceAtProjectRoot({
    projectRoot: process.cwd(),
    sliceDraft: input.sliceDraft
  });
}

/** Prepare every authored slice in dependency order from the host project's score/slices directory. */
export function prepareSlices(input: {
  readonly slicesDirectory?: string;
  readonly runnerDatabasePath?: string;
} = {}): PrepareSliceSetResult {
  const projectRoot = process.cwd();
  const usesDefaultRunnerDatabase = input.runnerDatabasePath === undefined;
  return prepareSliceSet({
    projectRoot,
    slicesDirectory: input.slicesDirectory ?? join(projectRoot, "score", "slices"),
    runnerDatabasePath: input.runnerDatabasePath ?? defaultRunnerDatabasePath(),
    tightenRunnerDatabaseParent: usesDefaultRunnerDatabase
  });
}
