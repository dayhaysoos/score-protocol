import { Graph } from "effect";

import type { SliceDraft, SliceFinding } from "./slice-draft.js";

export interface SliceDraftSource {
  readonly path: string;
  readonly draft: SliceDraft;
}

export type SliceDraftGraphResult =
  | {
      readonly status: "invalid";
      readonly findings: ReadonlyArray<SliceFinding>;
    }
  | {
      readonly status: "ordered";
      readonly drafts: ReadonlyArray<SliceDraftSource>;
    };

function graphFinding(
  code: string,
  location: string,
  message: string,
  detail: Readonly<Record<string, unknown>>
): SliceFinding {
  return {
    code,
    location,
    message,
    detail,
    machineRepairable: true
  };
}

export function sliceDependencies(draft: SliceDraft): ReadonlyArray<string> {
  return draft.after ?? [];
}

export function orderSliceDrafts(
  sources: ReadonlyArray<SliceDraftSource>
): SliceDraftGraphResult {
  const orderedSources = [...sources].toSorted((left, right) =>
    left.draft.slice_id.localeCompare(right.draft.slice_id) ||
    left.path.localeCompare(right.path)
  );
  const findings: SliceFinding[] = [];
  const sourceById = new Map<string, SliceDraftSource>();

  for (const source of orderedSources) {
    const existing = sourceById.get(source.draft.slice_id);
    if (existing) {
      findings.push(
        graphFinding(
          "SLICE_ID_DUPLICATE",
          source.path,
          `Slice ID ${source.draft.slice_id} is declared by more than one draft`,
          { slice_id: source.draft.slice_id, first_path: existing.path, second_path: source.path }
        )
      );
      continue;
    }
    sourceById.set(source.draft.slice_id, source);
  }

  for (const source of orderedSources) {
    sliceDependencies(source.draft).forEach((dependencyId, dependencyIndex) => {
      if (dependencyId === source.draft.slice_id) {
        findings.push(
          graphFinding(
            "SLICE_DEPENDENCY_SELF",
            `${source.path}#/after/${dependencyIndex}`,
            `Slice ${source.draft.slice_id} cannot depend on itself`,
            { slice_id: source.draft.slice_id }
          )
        );
      } else if (!sourceById.has(dependencyId)) {
        findings.push(
          graphFinding(
            "SLICE_DEPENDENCY_MISSING",
            `${source.path}#/after/${dependencyIndex}`,
            `Slice ${source.draft.slice_id} depends on unknown slice ${dependencyId}`,
            { slice_id: source.draft.slice_id, dependency_slice_id: dependencyId }
          )
        );
      }
    });
  }

  if (findings.length > 0) return { status: "invalid", findings };

  const nodeById = new Map<string, Graph.NodeIndex>();
  const graph = Graph.directed<SliceDraftSource, string>((mutable) => {
    for (const source of orderedSources) {
      nodeById.set(source.draft.slice_id, Graph.addNode(mutable, source));
    }
    for (const source of orderedSources) {
      const dependentNode = nodeById.get(source.draft.slice_id);
      if (dependentNode === undefined) continue;
      for (const dependencyId of sliceDependencies(source.draft)) {
        const prerequisiteNode = nodeById.get(dependencyId);
        if (prerequisiteNode === undefined) continue;
        Graph.addEdge(mutable, prerequisiteNode, dependentNode, dependencyId);
      }
    }
  });

  if (!Graph.isAcyclic(graph)) {
    return {
      status: "invalid",
      findings: [
        graphFinding(
          "SLICE_DEPENDENCY_CYCLE",
          "/",
          "Slice dependencies must form an acyclic graph",
          { slice_ids: orderedSources.map((source) => source.draft.slice_id) }
        )
      ]
    };
  }

  const reachableBySliceId = new Map<string, ReadonlySet<Graph.NodeIndex>>();
  for (const [sliceId, node] of nodeById) {
    reachableBySliceId.set(
      sliceId,
      new Set(Graph.indices(Graph.dfs(graph, { start: [node], direction: "outgoing" })))
    );
  }
  const writersByPath = new Map<string, SliceDraftSource[]>();
  for (const source of orderedSources) {
    for (const file of source.draft.files) {
      const writers = writersByPath.get(file.path) ?? [];
      writers.push(source);
      writersByPath.set(file.path, writers);
    }
  }
  const targetFindings: SliceFinding[] = [];
  for (const [path, writers] of writersByPath) {
    for (let leftIndex = 0; leftIndex < writers.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < writers.length; rightIndex += 1) {
        const left = writers[leftIndex];
        const right = writers[rightIndex];
        if (left === undefined || right === undefined) continue;
        if (left.draft.slice_id === right.draft.slice_id) continue;
        const leftNode = nodeById.get(left.draft.slice_id);
        const rightNode = nodeById.get(right.draft.slice_id);
        if (leftNode === undefined || rightNode === undefined) continue;
        const leftBeforeRight = reachableBySliceId.get(left.draft.slice_id)?.has(rightNode) ?? false;
        const rightBeforeLeft = reachableBySliceId.get(right.draft.slice_id)?.has(leftNode) ?? false;
        if (!leftBeforeRight && !rightBeforeLeft) {
          targetFindings.push(
            graphFinding(
              "SLICE_TARGET_ORDER_AMBIGUOUS",
              path,
              `Slices ${left.draft.slice_id} and ${right.draft.slice_id} both update ${path} without a dependency order`,
              {
                path,
                slice_ids: [left.draft.slice_id, right.draft.slice_id]
              }
            )
          );
        }
      }
    }
  }
  if (targetFindings.length > 0) {
    return { status: "invalid", findings: targetFindings };
  }

  return {
    status: "ordered",
    drafts: Array.from(Graph.values(Graph.topo(graph)))
  };
}
