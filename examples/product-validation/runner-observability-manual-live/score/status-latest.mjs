import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import Database from "better-sqlite3";

const scoreDatabasePath = resolve(".score/score.db");
const runnerDatabasePath = resolve(".score/runner.db");
if (!existsSync(runnerDatabasePath)) {
  process.stderr.write("No manual Run exists yet. Run `npm run start` first.\n");
  process.exit(1);
}

const database = new Database(runnerDatabasePath, { readonly: true });
const latest = database
  .prepare("SELECT run_id AS runId FROM runner_runs ORDER BY created_at DESC LIMIT 1")
  .get();
database.close();

if (latest === undefined) {
  process.stderr.write("No manual Run exists yet. Run `npm run start` first.\n");
  process.exit(1);
}

const repositoryRoot = resolve("../../..");
const result = spawnSync(
  resolve(repositoryRoot, "node_modules/.bin/tsx"),
  [
    resolve(repositoryRoot, "src/runner/cli.ts"),
    "status",
    "--score-db",
    scoreDatabasePath,
    "--runner-db",
    runnerDatabasePath,
    "--run",
    latest.runId
  ],
  { stdio: "inherit" }
);
if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
