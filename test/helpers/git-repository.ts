import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BASE_SCHEMA_CONTENT } from "../../src/fixture-inputs.js";

function writeFixtureProject(repositoryRoot: string): void {
  mkdirSync(join(repositoryRoot, "src"), { recursive: true });
  writeFileSync(join(repositoryRoot, "src", "schema.ts"), BASE_SCHEMA_CONTENT, "utf8");
}

export function createFixtureProjectDirectory(parent: string): string {
  const repositoryRoot = join(parent, "project");
  writeFixtureProject(repositoryRoot);
  return repositoryRoot;
}

export function createFixtureGitRepository(parent: string): string {
  const repositoryRoot = join(parent, "repository");
  execFileSync("git", ["init", "--quiet", repositoryRoot]);
  writeFixtureProject(repositoryRoot);
  execFileSync("git", ["-C", repositoryRoot, "add", "src/schema.ts"]);
  execFileSync("git", [
    "-C",
    repositoryRoot,
    "-c",
    "user.name=SCORE Test",
    "-c",
    "user.email=score-test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture base"
  ]);
  return repositoryRoot;
}
