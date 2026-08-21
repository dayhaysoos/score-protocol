/**
 * PROTOTYPE — pathless MCP wrapper for one assigned-file declaration check.
 *
 * OpenCode starts this process with the disposable Agent workspace as cwd.
 * The frozen contract arrives through SCORE-owned process configuration, not
 * through Agent arguments. The Agent can only ask to check its assigned file.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix } from "node:path";
import { createInterface } from "node:readline";

import {
  checkAssignedFileDeclaration,
  type AssignedFileDeclarationCheckInput
} from "./agent-preflight-feedback-model.js";

interface JsonRpcRequest {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

function configuredInput(): Omit<AssignedFileDeclarationCheckInput, "candidateSource"> {
  const encoded = process.env.SCORE_AGENT_PREFLIGHT;
  if (encoded === undefined) throw new Error("Missing frozen assigned-file preflight input");
  const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  for (const key of [
    "targetPath",
    "baselineSource",
    "declarationName",
    "documentedDeclaration"
  ] as const) {
    if (typeof value[key] !== "string") throw new Error(`Invalid preflight field: ${key}`);
  }
  const targetPath = value.targetPath as string;
  const normalized = posix.normalize(targetPath);
  if (
    targetPath.length === 0 ||
    isAbsolute(targetPath) ||
    targetPath.includes("\\") ||
    normalized !== targetPath ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error("Invalid assigned target path");
  }
  return {
    targetPath,
    baselineSource: value.baselineSource as string,
    declarationName: value.declarationName as string,
    documentedDeclaration: value.documentedDeclaration as string
  };
}

const input = configuredInput();
const workspacePath = process.cwd();
const candidatePath = join(workspacePath, input.targetPath);
const auditPath = join(dirname(workspacePath), "preflight-audit.jsonl");
let sequence = 0;

function response(id: unknown, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function failure(id: unknown, code: number, message: string): void {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`
  );
}

function callAssignedFileCheck(id: unknown): void {
  let candidateSource: string;
  try {
    candidateSource = readFileSync(candidatePath, "utf8");
  } catch {
    response(id, {
      isError: false,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "invalid",
            findings: [
              {
                code: "ASSIGNED_FILE_UNREADABLE",
                declaration: input.declarationName,
                message: "The assigned candidate file is missing or unreadable."
              }
            ]
          })
        }
      ]
    });
    return;
  }

  const result = checkAssignedFileDeclaration({ ...input, candidateSource });
  sequence += 1;
  appendFileSync(
    auditPath,
    `${JSON.stringify({ sequence, ...result })}\n`,
    "utf8"
  );
  response(id, {
    isError: false,
    structuredContent: result,
    content: [{ type: "text", text: JSON.stringify(result) }]
  });
}

const lines = createInterface({ input: process.stdin, terminal: false });
lines.on("line", (line) => {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    return;
  }
  if (request.id === undefined) return;
  if (request.method === "initialize") {
    const params =
      typeof request.params === "object" && request.params !== null
        ? (request.params as Record<string, unknown>)
        : undefined;
    response(request.id, {
      protocolVersion:
        typeof params?.protocolVersion === "string"
          ? params.protocolVersion
          : "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "score-agent-preflight-prototype", version: "0.1.0" }
    });
    return;
  }
  if (request.method === "tools/list") {
    response(request.id, {
      tools: [
        {
          name: "score_check_assigned_file",
          description:
            "Check the current assigned candidate against its frozen documented declaration. Takes no path or source arguments.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false }
        }
      ]
    });
    return;
  }
  if (request.method === "tools/call") {
    const params =
      typeof request.params === "object" && request.params !== null
        ? (request.params as Record<string, unknown>)
        : undefined;
    if (params?.name !== "score_check_assigned_file") {
      failure(request.id, -32602, "Unknown tool");
      return;
    }
    callAssignedFileCheck(request.id);
    return;
  }
  failure(request.id, -32601, "Method not found");
});
