import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

rmSync(join(projectRoot, ".score"), { recursive: true, force: true });
rmSync(join(projectRoot, "dist"), { recursive: true, force: true });
rmSync(join(projectRoot, "src", "reading-progress.ts"), { force: true });
rmSync(join(projectRoot, "src", "reading-summary.ts"), { force: true });
mkdirSync(join(projectRoot, "src"), { recursive: true });
writeFileSync(
  join(projectRoot, "src", "reading.ts"),
  "export interface Reading {\n" +
    "  readonly id: string;\n" +
    "  readonly title: string;\n" +
    "  readonly totalPages: number;\n" +
    "}\n",
  "utf8"
);

process.stdout.write("Reset Change dogfood source, reviews, Runner state, and build output.\n");
