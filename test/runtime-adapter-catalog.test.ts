import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { OPENCODE_CLI_VERSION } from "../src/runner/open-code-adapter.js";
import { makeOpenCodeModelCatalog } from "../src/runner/open-code-catalog.js";

describe("Runtime Adapter model catalog", () => {
  it("exposes only enabled V2 models from providers in the active catalog", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-opencode-v2-models-"));
    const commandPath = join(directory, "fake-opencode2");
    const capturePath = join(directory, "capture.json");
    const authPath = join(directory, "auth.json");
    writeFileSync(
      authPath,
      JSON.stringify({ opencode: { type: "api", key: "catalog-secret" } }),
      "utf8"
    );
    writeFileSync(
      commandPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
if (process.argv[2] === "--version") {
  process.stdout.write("opencode2 v${OPENCODE_CLI_VERSION}\\n");
  process.exit(0);
}
if (process.argv[2] !== "serve") process.exit(2);
const capturePath = ${JSON.stringify(capturePath)};
const password = "catalog-password";
const authorization = "Basic " + Buffer.from("opencode:" + password).toString("base64");
const capture = {
  config: JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "null"),
  isolated: Boolean(process.env.XDG_CONFIG_HOME && process.env.OPENCODE_DB),
  requests: []
};
let providerRequests = 0;
let modelRequests = 0;
let connectedModelRequests = 0;
let connected = false;
const persist = () => fs.writeFileSync(capturePath, JSON.stringify(capture));
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  capture.requests.push({
    method: request.method,
    pathname: url.pathname,
    search: url.search,
    authorized: request.headers.authorization === authorization
  });
  persist();
  response.setHeader("content-type", "application/json");
  if (request.headers.authorization !== authorization) {
    response.statusCode = 401;
    response.end(JSON.stringify({ message: "unauthorized" }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/provider") {
    providerRequests += 1;
    response.end(JSON.stringify({
      location: { directory: "fixture", project: { id: "p", directory: "fixture", canonical: "fixture" } },
      data: providerRequests === 1 ? [] : [
        { id: "opencode", name: "OpenCode Zen", package: "zen" },
        { id: "anthropic", name: "Anthropic", package: "anthropic" }
      ]
    }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/integration") {
    response.end(JSON.stringify({ data: [{ id: "opencode" }] }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/integration/opencode/connect/key") {
    connected = true;
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/model") {
    modelRequests += 1;
    if (connected) connectedModelRequests += 1;
    const model = (id, providerID, name, variants = [], enabled = true) => ({
      id,
      modelID: id,
      providerID,
      name,
      variants: variants.map((variant) => ({ id: variant })),
      enabled
    });
    response.end(JSON.stringify({
      location: { directory: "fixture", project: { id: "p", directory: "fixture", canonical: "fixture" } },
      data: modelRequests === 1 ? [] : connected && connectedModelRequests > 1 ? [
        model("claude-sonnet-4-6", "opencode", "Claude Sonnet 4.6"),
        model("gpt-5.4", "opencode", "GPT-5.4", ["none", "low", "medium", "high", "xhigh", "fast"]),
        model("claude-sonnet-4-6", "anthropic", "Claude Sonnet 4.6"),
        model("disabled", "opencode", "Disabled", [], false),
        model("openai/gpt-5.4-fast", "anyapi", "Unconnected")
      ] : [
        model("big-pickle", "opencode", "Big Pickle")
      ]
    }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ message: url.pathname }));
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
server.listen(0, "127.0.0.1", () => {
  persist();
  const address = server.address();
  process.stdout.write("server listening on http://127.0.0.1:" + address.port + "\\n");
  process.stdout.write("server password " + password + "\\n");
});
`,
      "utf8"
    );
    chmodSync(commandPath, 0o755);

    try {
      const adapterCatalog = makeOpenCodeModelCatalog({ command: commandPath, authPath });
      const models = await Effect.runPromise(adapterCatalog.discoverModels);

      assert.equal(adapterCatalog.id, "opencode");
      assert.equal(adapterCatalog.label, "OpenCode");
      assert.deepEqual(models, [
        {
          key: "opencode/claude-sonnet-4-6",
          label: "Claude Sonnet 4.6",
          sourceLabel: "OpenCode Zen",
          variants: []
        },
        {
          key: "opencode/gpt-5.4",
          label: "GPT-5.4",
          sourceLabel: "OpenCode Zen",
          variants: [
            { id: "none", label: "None", summaryLabel: "No reasoning" },
            { id: "low", label: "Low", summaryLabel: "Low reasoning" },
            { id: "medium", label: "Medium", summaryLabel: "Medium reasoning" },
            { id: "high", label: "High", summaryLabel: "High reasoning" },
            { id: "xhigh", label: "Extra high", summaryLabel: "Extra high reasoning" },
            { id: "fast", label: "Fast", summaryLabel: "Fast reasoning" }
          ]
        },
        {
          key: "anthropic/claude-sonnet-4-6",
          label: "Claude Sonnet 4.6",
          sourceLabel: "Anthropic",
          variants: []
        }
      ]);
      assert.deepEqual(adapterCatalog.configurationFor(models[1]!, "fast"), {
        kind: "opencode",
        providerId: "opencode",
        modelId: "gpt-5.4",
        variantId: "fast",
        sdkVersion: OPENCODE_CLI_VERSION,
        cliVersion: OPENCODE_CLI_VERSION
      });
      assert.deepEqual(adapterCatalog.configurationFor(models[0]!), {
        kind: "opencode",
        providerId: "opencode",
        modelId: "claude-sonnet-4-6",
        variantId: null,
        sdkVersion: OPENCODE_CLI_VERSION,
        cliVersion: OPENCODE_CLI_VERSION
      });
      const capture = JSON.parse(readFileSync(capturePath, "utf8")) as {
        config: { autoupdate?: unknown };
        isolated: boolean;
        requests: Array<{
          method: string;
          pathname: string;
          search: string;
          authorized: boolean;
        }>;
      };
      assert.equal(capture.config.autoupdate, false);
      assert.equal(capture.isolated, true);
      assert.deepEqual(
        capture.requests.map(({ method, pathname }) => ({ method, pathname })).toSorted(
          (left, right) => left.pathname.localeCompare(right.pathname)
        ),
        [
          { method: "GET", pathname: "/api/integration" },
          { method: "POST", pathname: "/api/integration/opencode/connect/key" },
          { method: "GET", pathname: "/api/model" },
          { method: "GET", pathname: "/api/model" },
          { method: "GET", pathname: "/api/model" },
          { method: "GET", pathname: "/api/model" },
          { method: "GET", pathname: "/api/provider" },
          { method: "GET", pathname: "/api/provider" },
          { method: "GET", pathname: "/api/provider" },
          { method: "GET", pathname: "/api/provider" }
        ]
      );
      assert.ok(capture.requests.every(({ search }) => search.includes("location%5Bdirectory%5D")));
      assert.ok(capture.requests.every(({ authorized }) => authorized));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("aborts and shuts down when a V2 catalog endpoint never responds", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-opencode-v2-catalog-timeout-"));
    const commandPath = join(directory, "fake-opencode2");
    const shutdownPath = join(directory, "shutdown.txt");
    writeFileSync(
      commandPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
if (process.argv[2] === "--version") {
  process.stdout.write("opencode2 v${OPENCODE_CLI_VERSION}\\n");
  process.exit(0);
}
const password = "catalog-timeout-password";
const authorization = "Basic " + Buffer.from("opencode:" + password).toString("base64");
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.headers.authorization !== authorization) {
    response.statusCode = 401;
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/provider") return;
  response.setHeader("content-type", "application/json");
  if (request.method === "GET" && url.pathname === "/api/model") {
    response.end(JSON.stringify({ data: [] }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ message: "not found" }));
});
process.on("SIGTERM", () => {
  fs.writeFileSync(${JSON.stringify(shutdownPath)}, "stopped\\n");
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write("server listening on http://127.0.0.1:" + address.port + "\\n");
  process.stdout.write("server password " + password + "\\n");
});
`,
      "utf8"
    );
    chmodSync(commandPath, 0o755);

    try {
      const catalog = makeOpenCodeModelCatalog({
        command: commandPath,
        startTimeoutMs: 500
      });
      const startedAt = Date.now();
      const error = await Effect.runPromise(Effect.flip(catalog.discoverModels));

      assert.match(error.message, /timeout|timed out|aborted|deadline/i);
      assert.ok(Date.now() - startedAt < 2_000);
      assert.equal(existsSync(shutdownPath), true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
