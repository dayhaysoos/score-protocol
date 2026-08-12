import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SliceDraft } from "../src/slice-draft.js";
import { orderSliceDrafts } from "../src/slice-draft-graph.js";

function draft(sliceId: string, after: ReadonlyArray<string> = []): SliceDraft {
  return {
    slice_id: sliceId,
    after,
    title: sliceId,
    objective: `Prepare ${sliceId}.`,
    requirements: [`${sliceId} is prepared.`],
    files: [
      {
        path: `src/${sliceId}.ts`,
        operation: "create",
        task: `Create ${sliceId}.`,
        requirements: [`${sliceId} is prepared.`],
        owns: [],
        consumes: [],
        context: [],
        skills: [],
        constraints: []
      }
    ]
  };
}

describe("slice draft dependency graph", () => {
  it("uses Effect Graph to produce a deterministic prerequisite-first order", () => {
    const result = orderSliceDrafts([
      { path: "score/slices/persistence.json", draft: draft("persistence", ["filters"]) },
      { path: "score/slices/foundation.json", draft: draft("foundation") },
      { path: "score/slices/filters.json", draft: draft("filters", ["foundation"]) },
      { path: "score/slices/independent.json", draft: draft("independent") }
    ]);

    assert.equal(result.status, "ordered");
    if (result.status !== "ordered") return;
    const ids = result.drafts.map((source) => source.draft.slice_id);
    assert.ok(ids.indexOf("foundation") < ids.indexOf("filters"));
    assert.ok(ids.indexOf("filters") < ids.indexOf("persistence"));
    assert.deepEqual(ids, ["foundation", "independent", "filters", "persistence"]);
  });

  it("rejects duplicate, missing, self, and cyclic dependencies", () => {
    const duplicate = orderSliceDrafts([
      { path: "score/slices/one.json", draft: draft("same") },
      { path: "score/slices/two.json", draft: draft("same") }
    ]);
    assert.equal(duplicate.status, "invalid");
    if (duplicate.status === "invalid") {
      assert.ok(duplicate.findings.some((finding) => finding.code === "SLICE_ID_DUPLICATE"));
    }

    const missingAndSelf = orderSliceDrafts([
      {
        path: "score/slices/invalid.json",
        draft: draft("invalid", ["invalid", "missing"])
      }
    ]);
    assert.equal(missingAndSelf.status, "invalid");
    if (missingAndSelf.status === "invalid") {
      assert.deepEqual(
        missingAndSelf.findings.map((finding) => finding.code),
        ["SLICE_DEPENDENCY_SELF", "SLICE_DEPENDENCY_MISSING"]
      );
    }

    const cycle = orderSliceDrafts([
      { path: "score/slices/one.json", draft: draft("one", ["two"]) },
      { path: "score/slices/two.json", draft: draft("two", ["one"]) }
    ]);
    assert.equal(cycle.status, "invalid");
    if (cycle.status === "invalid") {
      assert.deepEqual(cycle.findings.map((finding) => finding.code), [
        "SLICE_DEPENDENCY_CYCLE"
      ]);
    }
  });

  it("requires slices that share a target to have a dependency order", () => {
    const first = draft("first");
    const second = draft("second");
    const firstFile = first.files[0];
    const secondFile = second.files[0];
    assert.ok(firstFile);
    assert.ok(secondFile);
    const unordered = orderSliceDrafts([
      {
        path: "score/slices/first.json",
        draft: {
          ...first,
          files: [{ ...firstFile, path: "src/shared.ts" }]
        }
      },
      {
        path: "score/slices/second.json",
        draft: {
          ...second,
          files: [{ ...secondFile, path: "src/shared.ts" }]
        }
      }
    ]);
    assert.equal(unordered.status, "invalid");
    if (unordered.status === "invalid") {
      assert.deepEqual(unordered.findings.map((finding) => finding.code), [
        "SLICE_TARGET_ORDER_AMBIGUOUS"
      ]);
    }

    const orderedSecond = draft("second", ["first"]);
    const orderedSecondFile = orderedSecond.files[0];
    assert.ok(orderedSecondFile);
    const ordered = orderSliceDrafts([
      {
        path: "score/slices/first.json",
        draft: {
          ...first,
          files: [{ ...firstFile, path: "src/shared.ts" }]
        }
      },
      {
        path: "score/slices/second.json",
        draft: {
          ...orderedSecond,
          files: [{ ...orderedSecondFile, path: "src/shared.ts" }]
        }
      }
    ]);
    assert.equal(ordered.status, "ordered");
  });
});
