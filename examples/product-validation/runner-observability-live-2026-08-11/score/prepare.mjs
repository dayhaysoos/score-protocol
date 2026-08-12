import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scoreProtocolRoot = process.env.SCORE_PROTOCOL_ROOT ??
  fileURLToPath(new URL("../../../../", import.meta.url));
const { prepareSlices } = await import(
  pathToFileURL(join(scoreProtocolRoot, "src", "plan-intake-tool.ts")).href
);
const result = prepareSlices({
  runnerDatabasePath: join(process.cwd(), ".score", "runner.db")
});

if (result.status === "invalid") {
  process.stderr.write("SCORE could not prepare the Runner observability fixture.\n");
  process.stderr.write(`${JSON.stringify(result.findings, null, 2)}\n`);
  process.exitCode = 1;
} else {
  for (const slice of result.slices) {
    if (slice.state === "implemented") {
      process.stdout.write(`✓ ${slice.title} v${slice.revision} · already applied · Run ${slice.runId}\n`);
    } else if (slice.state === "review_ready") {
      process.stdout.write(`○ ${slice.title} v${slice.revision} · review ready\n`);
      process.stdout.write(`  Change Plan: ${slice.passId}\n`);
      process.stdout.write(`  Review: ${slice.reviewPath}\n`);
    } else {
      process.stdout.write(`… ${slice.title} · waiting for ${slice.waitingFor.join(", ")}\n`);
    }
  }
  process.stdout.write("No application source files were changed.\n");
}
