import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const fixtureRoot = fileURLToPath(new URL("./", import.meta.url));
const scoreProtocolRoot = fileURLToPath(new URL("../../../", import.meta.url));
const { prepareSliceSet } = await import(
  pathToFileURL(join(scoreProtocolRoot, "src", "plan-intake-set.ts")).href
);
const cases = [
  "duplicate-id",
  "missing-predecessor",
  "self-dependency",
  "dependency-cycle",
  "unordered-shared-target"
];

let failed = false;
for (const caseName of cases) {
  const projectRoot = join(fixtureRoot, caseName);
  const result = prepareSliceSet({
    projectRoot,
    slicesDirectory: join(projectRoot, "score", "slices"),
    runnerDatabasePath: join(projectRoot, ".score", "runner.db")
  });
  const scoreDatabaseExists = existsSync(join(projectRoot, ".score", "score.db"));
  const reviewDirectory = join(projectRoot, ".score", "reviews");
  const reviewCount = existsSync(reviewDirectory) ? readdirSync(reviewDirectory).length : 0;
  process.stdout.write(`${JSON.stringify({
    case: caseName,
    result,
    scoreDatabaseExists,
    reviewCount
  }, null, 2)}\n`);
  if (result.status !== "invalid" || scoreDatabaseExists || reviewCount !== 0) failed = true;
}

if (failed) process.exitCode = 1;
