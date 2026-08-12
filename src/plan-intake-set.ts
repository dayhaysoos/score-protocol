import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { parseJsonNoDuplicateKeys, sha256Json } from "./canonical.js";
import {
  prepareSlice,
  SCORE_START_NEXT_ACTION,
  sliceDraftDigest,
  type PrepareSliceResult
} from "./plan-intake.js";
import { normalizeProjectRelativePath } from "./project-path.js";
import { installGitLocalExclude } from "./plan-intake-filesystem.js";
import { readLatestAppliedRuns } from "./runner/applied-run-history.js";
import { ScoreAlpha, type PreparedSliceHead } from "./score-alpha.js";
import { orderSliceDrafts, type SliceDraftSource } from "./slice-draft-graph.js";
import {
  validateSliceDraftShape,
  type ResolvedSliceDependency,
  type SliceDraft,
  type SliceFinding
} from "./slice-draft.js";
import {
  assertSecureDatabaseIdentity,
  prepareProjectScoreState,
  prepareRunnerDatabaseState,
  secureSqliteSidecars
} from "./private-state-filesystem.js";

export type SlicePreparationState =
  | {
      readonly state: "implemented";
      readonly sliceId: string;
      readonly title: string;
      readonly revision: number;
      readonly passId: string;
      readonly runId: string;
    }
  | {
      readonly state: "review_ready";
      readonly sliceId: string;
      readonly title: string;
      readonly revision: number;
      readonly passId: string;
      readonly reviewPath: string;
      readonly snapshotPath: string;
      readonly nextAction: typeof SCORE_START_NEXT_ACTION;
    }
  | {
      readonly state: "waiting";
      readonly sliceId: string;
      readonly title: string;
      readonly waitingFor: ReadonlyArray<string>;
    };

export type PrepareSliceSetResult =
  | {
      readonly status: "invalid";
      readonly findings: ReadonlyArray<SliceFinding>;
    }
  | {
      readonly status: "ready";
      readonly slices: ReadonlyArray<SlicePreparationState>;
    };

function finding(
  code: string,
  location: string,
  message: string,
  detail: Readonly<Record<string, unknown>> = {}
): SliceFinding {
  return { code, location, message, detail, machineRepairable: true };
}

function projectRelativePath(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath).split(sep).join("/");
}

function loadSliceDrafts(input: {
  readonly projectRoot: string;
  readonly slicesDirectory: string;
}):
  | { readonly status: "invalid"; readonly findings: ReadonlyArray<SliceFinding> }
  | { readonly status: "loaded"; readonly sources: ReadonlyArray<SliceDraftSource> } {
  let directory: string;
  try {
    directory = realpathSync(resolve(input.slicesDirectory));
    if (!statSync(directory).isDirectory()) throw new Error("path is not a directory");
  } catch (cause) {
    return {
      status: "invalid",
      findings: [
        finding(
          "SLICE_DIRECTORY_INVALID",
          input.slicesDirectory,
          "Slice drafts directory must exist",
          { cause: cause instanceof Error ? cause.message : String(cause) }
        )
      ]
    };
  }

  const relativeDirectory = projectRelativePath(input.projectRoot, directory);
  if (normalizeProjectRelativePath(relativeDirectory) === undefined) {
    return {
      status: "invalid",
      findings: [
        finding(
          "SLICE_DIRECTORY_OUTSIDE_PROJECT",
          input.slicesDirectory,
          "Slice drafts directory must be inside the project root"
        )
      ]
    };
  }

  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".json"))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  if (entries.length === 0) {
    return {
      status: "invalid",
      findings: [
        finding(
          "SLICE_DRAFTS_EMPTY",
          relativeDirectory,
          "Slice drafts directory must contain at least one JSON file"
        )
      ]
    };
  }

  const sources: SliceDraftSource[] = [];
  const findings: SliceFinding[] = [];
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const sourcePath = projectRelativePath(input.projectRoot, absolutePath);
    if (!entry.isFile() || lstatSync(absolutePath).isSymbolicLink()) {
      findings.push(
        finding(
          "SLICE_SOURCE_NOT_REGULAR_FILE",
          sourcePath,
          "Each slice draft must be a regular JSON file"
        )
      );
      continue;
    }
    let value: unknown;
    try {
      value = parseJsonNoDuplicateKeys(readFileSync(absolutePath, "utf8"));
    } catch (cause) {
      findings.push(
        finding(
          "SLICE_JSON_INVALID",
          sourcePath,
          "Slice draft must contain valid JSON without duplicate keys",
          { cause: cause instanceof Error ? cause.message : String(cause) }
        )
      );
      continue;
    }
    const shapeFindings = validateSliceDraftShape(value);
    if (shapeFindings.length > 0) {
      findings.push(
        ...shapeFindings.map((item) => ({
          ...item,
          location: `${sourcePath}#${item.location}`
        }))
      );
      continue;
    }
    sources.push({ path: sourcePath, draft: value as SliceDraft });
  }
  return findings.length > 0
    ? { status: "invalid", findings }
    : { status: "loaded", sources };
}

function sameDependencies(
  left: ReadonlyArray<ResolvedSliceDependency>,
  right: ReadonlyArray<ResolvedSliceDependency>
): boolean {
  const orderedLeft = [...left].toSorted((a, b) => a.slice_id.localeCompare(b.slice_id));
  const orderedRight = [...right].toSorted((a, b) => a.slice_id.localeCompare(b.slice_id));
  return orderedLeft.length === orderedRight.length && orderedLeft.every((item, index) => {
    const other = orderedRight[index];
    return other !== undefined &&
      item.slice_id === other.slice_id &&
      item.revision === other.revision &&
      item.pass_id === other.pass_id &&
      item.run_id === other.run_id;
  });
}

function legacySpecificationDraft(specification: unknown): unknown {
  if (typeof specification !== "object" || specification === null) return undefined;
  const record = specification as Record<string, unknown>;
  if (!Array.isArray(record.requirements)) return undefined;
  const requirements = record.requirements.map((requirement) => {
    if (typeof requirement !== "object" || requirement === null) return undefined;
    const statement = (requirement as Record<string, unknown>).statement;
    return typeof statement === "string" ? statement : undefined;
  });
  if (requirements.some((requirement) => requirement === undefined)) return undefined;
  return {
    title: record.title,
    objective: record.objective,
    requirements,
    files: record.files
  };
}

function headMatchesDraft(head: PreparedSliceHead, draft: SliceDraft): boolean {
  if (head.draftDigest !== null) return head.draftDigest === sliceDraftDigest(draft);
  if ((draft.after ?? []).length > 0) return false;
  const legacyDraft = legacySpecificationDraft(head.acceptedSpecification);
  return legacyDraft !== undefined && sha256Json(legacyDraft) === sha256Json({
    title: draft.title,
    objective: draft.objective,
    requirements: draft.requirements,
    files: draft.files
  });
}

function reviewPaths(
  projectRoot: string,
  artifactStem: string
): { readonly reviewPath: string; readonly snapshotPath: string } {
  const reviewsDirectory = join(projectRoot, ".score", "reviews");
  return {
    reviewPath: join(reviewsDirectory, `${artifactStem}.html`),
    snapshotPath: join(reviewsDirectory, `${artifactStem}.snapshot.json`)
  };
}

function reviewReadyFromHead(
  projectRoot: string,
  head: PreparedSliceHead
): SlicePreparationState {
  return {
    state: "review_ready",
    sliceId: head.sliceId,
    title: head.title,
    revision: head.revision,
    passId: head.passId,
    nextAction: SCORE_START_NEXT_ACTION,
    ...reviewPaths(projectRoot, head.artifactStem)
  };
}

function reviewReadyFromPreparation(result: Extract<PrepareSliceResult, { status: "review_ready" }>): SlicePreparationState {
  return {
    state: "review_ready",
    sliceId: result.sliceId,
    title: result.title,
    revision: result.revision,
    passId: result.passId,
    reviewPath: result.reviewPath,
    snapshotPath: result.snapshotPath,
    nextAction: result.nextAction
  };
}

export function prepareSliceSet(input: {
  readonly projectRoot: string;
  readonly slicesDirectory: string;
  readonly runnerDatabasePath: string;
  readonly tightenRunnerDatabaseParent?: boolean;
}): PrepareSliceSetResult {
  let projectRoot: string;
  try {
    projectRoot = realpathSync(resolve(input.projectRoot));
    if (!statSync(projectRoot).isDirectory()) throw new Error("path is not a directory");
  } catch (cause) {
    return {
      status: "invalid",
      findings: [
        finding(
          "PROJECT_ROOT_INVALID",
          "/projectRoot",
          "Project root must be an existing canonical directory",
          { cause: cause instanceof Error ? cause.message : String(cause) }
        )
      ]
    };
  }

  const loaded = loadSliceDrafts({
    projectRoot,
    slicesDirectory: input.slicesDirectory
  });
  if (loaded.status === "invalid") return loaded;
  const graph = orderSliceDrafts(loaded.sources);
  if (graph.status === "invalid") return graph;

  const gitExcludeFailure = installGitLocalExclude(projectRoot);
  if (gitExcludeFailure !== undefined) {
    return { status: "invalid", findings: [gitExcludeFailure] };
  }

  const projectState = prepareProjectScoreState(projectRoot);
  const scoreDatabasePath = projectState.database.path;
  const score = ScoreAlpha.open(scoreDatabasePath);
  try {
    // Opening SCORE applies any pending schema migrations. Sidecars are secured
    // only after close so concurrent SQLite users never have a live mapped WAL
    // file touched by the filesystem hardening boundary.
  } finally {
    score.close();
    secureSqliteSidecars(projectState.database, "SCORE database");
  }

  const headsBySliceId = new Map(
    ScoreAlpha.listPreparedSliceHeads(scoreDatabasePath).map((head) => [head.sliceId, head])
  );
  let runnerPathExists = true;
  try {
    lstatSync(input.runnerDatabasePath);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") runnerPathExists = false;
    else throw cause;
  }
  let appliedRuns: ReturnType<typeof readLatestAppliedRuns>;
  if (!runnerPathExists) {
    appliedRuns = new Map();
  } else {
    const runnerState = prepareRunnerDatabaseState({
      databasePath: input.runnerDatabasePath,
      tightenExistingParent: input.tightenRunnerDatabaseParent ?? false,
      createDatabase: false
    });
    try {
      appliedRuns = readLatestAppliedRuns(runnerState.databasePath);
    } finally {
      if (runnerState.database !== undefined) {
        assertSecureDatabaseIdentity(runnerState.database, "Runner database");
      }
    }
  }
  const appliedDependencies = new Map<string, ResolvedSliceDependency>();
  const slices: SlicePreparationState[] = [];

  for (const source of graph.drafts) {
    const waitingFor = (source.draft.after ?? []).filter(
      (dependencyId) => !appliedDependencies.has(dependencyId)
    );
    if (waitingFor.length > 0) {
      slices.push({
        state: "waiting",
        sliceId: source.draft.slice_id,
        title: source.draft.title,
        waitingFor: waitingFor.toSorted()
      });
      continue;
    }

    const resolvedDependencies = (source.draft.after ?? []).map((dependencyId) => {
      const dependency = appliedDependencies.get(dependencyId);
      if (dependency === undefined) {
        throw new Error(`Resolved dependency ${dependencyId} disappeared during preparation`);
      }
      return dependency;
    });
    const head = headsBySliceId.get(source.draft.slice_id);
    const current = head !== undefined &&
      headMatchesDraft(head, source.draft) &&
      sameDependencies(head.resolvedDependencies, resolvedDependencies);
    if (current && head.published) {
      const applied = appliedRuns.get(head.passId);
      if (applied) {
        slices.push({
          state: "implemented",
          sliceId: head.sliceId,
          title: head.title,
          revision: head.revision,
          passId: head.passId,
          runId: applied.runId
        });
        appliedDependencies.set(head.sliceId, {
          slice_id: head.sliceId,
          revision: head.revision,
          pass_id: head.passId,
          run_id: applied.runId
        });
      } else {
        slices.push(reviewReadyFromHead(projectRoot, head));
      }
      continue;
    }

    const prepared = prepareSlice({
      projectRoot,
      sliceDraft: source.draft,
      resolvedDependencies,
      sourcePath: source.path
    });
    if (prepared.status === "invalid") {
      return {
        status: "invalid",
        findings: prepared.findings.map((item) => ({
          ...item,
          location: `${source.path}#${item.location}`
        }))
      };
    }
    slices.push(reviewReadyFromPreparation(prepared));
  }

  return { status: "ready", slices };
}
