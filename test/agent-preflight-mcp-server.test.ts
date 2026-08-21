import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const root = mkdtempSync(join(tmpdir(), "score-agent-preflight-mcp-"));
const workspace = join(root, "workspace");
const targetPath = "src/example.ts";
const absoluteTarget = join(workspace, targetPath);
mkdirSync(join(workspace, "src"), { recursive: true });

const baselineSource = `
type Result = { readonly status: "ok"; readonly value: string };
export function inspect(value: string): Result { return { status: "ok", value }; }
`;
const documentedDeclaration =
  'export function inspect(value: string): { readonly status: "ok"; readonly value: string };';
const correctedSource = `
type Result = { readonly status: "ok"; readonly value: string };
export function inspect(value: string): { readonly status: "ok"; readonly value: string } { return { status: "ok", value }; }
`;
writeFileSync(absoluteTarget, baselineSource, "utf8");

after(() => rmSync(root, { recursive: true, force: true }));

describe("assigned-file preflight MCP server", () => {
  it("supports the Agent sequence invalid, edit, valid without a path argument", async () => {
    const frozen = Buffer.from(
      JSON.stringify({
        targetPath,
        baselineSource,
        declarationName: "inspect",
        documentedDeclaration
      }),
      "utf8"
    ).toString("base64url");
    const child = spawn(
      join(process.cwd(), "node_modules", ".bin", "tsx"),
      [join(process.cwd(), "src/prototypes/agent-preflight-mcp-server.ts")],
      {
        cwd: workspace,
        env: { ...process.env, SCORE_AGENT_PREFLIGHT: frozen },
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));

    const waitForResponse = async (id: number) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const found = stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { readonly id?: number; readonly result?: unknown })
          .find((message) => message.id === id);
        if (found !== undefined) return found;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for MCP response ${id}: ${stderr}`);
    };

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: {} }
      })}\n`
    );
    await waitForResponse(1);

    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`
    );
    const listed = await waitForResponse(2);
    assert.deepEqual(
      (listed.result as { readonly tools: ReadonlyArray<{ readonly name: string }> }).tools.map(
        ({ name }) => name
      ),
      ["score_check_assigned_file"]
    );

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "score_check_assigned_file", arguments: {} }
      })}\n`
    );
    const invalid = await waitForResponse(3);
    assert.equal(
      (invalid.result as { readonly structuredContent: { readonly status: string } })
        .structuredContent.status,
      "invalid"
    );

    writeFileSync(absoluteTarget, correctedSource, "utf8");
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "score_check_assigned_file", arguments: {} }
      })}\n`
    );
    const valid = await waitForResponse(4);
    assert.equal(
      (valid.result as { readonly structuredContent: { readonly status: string } })
        .structuredContent.status,
      "valid"
    );

    child.stdin.end();
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`MCP server exited ${code}: ${stderr}`))
      );
    });
    assert.deepEqual(
      readFileSync(join(root, "preflight-audit.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { readonly sequence: number; readonly status: string })
        .map(({ sequence, status }) => ({ sequence, status })),
      [
        { sequence: 1, status: "invalid" },
        { sequence: 2, status: "valid" }
      ]
    );
  });
});
