/** Verify that the pinned OpenCode runtime discovers the prototype MCP server. */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isolatedOpenCodeEnvironment,
  prepareOpenCodeIsolation
} from "../runner/open-code-isolation.js";

const root = mkdtempSync(join(tmpdir(), "score-agent-preflight-mcp-smoke-"));
try {
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(
    join(workspace, "src", "example.ts"),
    "export function inspect(value: string): string { return value; }\n",
    "utf8"
  );
  const frozen = Buffer.from(
    JSON.stringify({
      targetPath: "src/example.ts",
      baselineSource:
        "export function inspect(value: string): string { return value; }\n",
      declarationName: "inspect",
      documentedDeclaration: "export function inspect(value: string): string;"
    }),
    "utf8"
  ).toString("base64url");
  const config = {
    autoupdate: false,
    mcp: {
      servers: {
        score_preflight: {
          type: "local",
          codemode: false,
          command: [
            join(process.cwd(), "node_modules", ".bin", "tsx"),
            join(process.cwd(), "src", "prototypes", "agent-preflight-mcp-server.ts")
          ],
          environment: { SCORE_AGENT_PREFLIGHT: frozen }
        }
      }
    }
  };
  const isolation = prepareOpenCodeIsolation(join(root, "runtime"));
  const configPath = join(root, "opencode.json");
  writeFileSync(configPath, `${JSON.stringify(config)}\n`, "utf8");
  const output = execFileSync(
    join(process.cwd(), "node_modules", ".bin", "opencode2"),
    ["api", "--standalone", "GET", "/api/mcp"],
    {
      cwd: workspace,
      env: isolatedOpenCodeEnvironment(isolation, configPath, config),
      encoding: "utf8",
      timeout: 20_000
    }
  );
  process.stdout.write(output);
  if (!/score_preflight/iu.test(output)) {
    throw new Error("Pinned OpenCode did not discover the assigned-file preflight MCP server");
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
