import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scoreProtocolRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const { prepareSlices } = await import(
  pathToFileURL(join(scoreProtocolRoot, "src", "plan-intake-tool.ts")).href
);
const result = prepareSlices({
  runnerDatabasePath: join(process.cwd(), ".score", "runner.db")
});

if (result.status === "invalid") {
  process.stderr.write(`${JSON.stringify(result.findings, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write("No application source files were changed.\n");
}
