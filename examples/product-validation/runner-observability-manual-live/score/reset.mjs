import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const fixtureRoot = process.cwd();
for (const relativePath of [
  ".score",
  ".opencode",
  "dist",
  "src/format-sensor.ts",
  "src/sensor-summary.ts",
  "src/sensor.ts"
]) {
  rmSync(join(fixtureRoot, relativePath), { recursive: true, force: true });
}
mkdirSync(join(fixtureRoot, "src"), { recursive: true });
process.stdout.write("Manual live-feed fixture reset. Run `npm run start` to start.\n");
