import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { prepareSliceSet } from "../src/plan-intake-set.js";

const EXAMPLE_ROOT = join(
  process.cwd(),
  "examples",
  "score-react-todo-experiment"
);

describe("React to-do SCORE example", () => {
  it("keeps one stable two-file slice and a short guided-start command", () => {
    const sliceId = "dependable-in-memory-to-do-app";
    const draftPath = join(
      EXAMPLE_ROOT,
      "score",
      "slices",
      `${sliceId}.json`
    );
    const draft = JSON.parse(readFileSync(draftPath, "utf8")) as {
      readonly slice_id?: unknown;
      readonly files?: ReadonlyArray<{ readonly path?: unknown }>;
    };
    const packageJson = JSON.parse(
      readFileSync(join(EXAMPLE_ROOT, "package.json"), "utf8")
    ) as {
      readonly scripts?: Readonly<Record<string, unknown>>;
    };

    assert.equal(draft.slice_id, sliceId);
    assert.deepEqual(
      draft.files?.map((file) => file.path),
      ["src/todo.ts", "src/App.tsx"]
    );
    assert.equal(
      packageJson.scripts?.["score:start"],
      "../../node_modules/.bin/tsx ../../src/runner/cli.ts start --score-db .score/score.db"
    );
  });

  it("prepares a review from the retained implementation without changing it", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "score-react-todo-example-"));
    try {
      for (const directory of ["docs", "score", "src"]) {
        cpSync(join(EXAMPLE_ROOT, directory), join(projectRoot, directory), {
          recursive: true
        });
      }
      for (const file of ["package.json", "tsconfig.json"]) {
        cpSync(join(EXAMPLE_ROOT, file), join(projectRoot, file));
      }
      const before = new Map(
        ["src/todo.ts", "src/App.tsx"].map((path) => [
          path,
          readFileSync(join(projectRoot, path), "utf8")
        ])
      );

      const result = prepareSliceSet({
        projectRoot,
        slicesDirectory: join(projectRoot, "score", "slices"),
        runnerDatabasePath: join(projectRoot, "runner.db")
      });

      assert.equal(result.status, "ready");
      if (result.status !== "ready") return;
      assert.deepEqual(
        result.slices.map((slice) => ({ id: slice.sliceId, state: slice.state })),
        [{ id: "dependable-in-memory-to-do-app", state: "review_ready" }]
      );
      for (const [path, content] of before) {
        assert.equal(readFileSync(join(projectRoot, path), "utf8"), content);
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
