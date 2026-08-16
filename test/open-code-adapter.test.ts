import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { Cause, Effect, Exit, Fiber, Layer } from "effect";

import {
  OPENCODE_CLI_VERSION,
  OPENCODE_V2_CLIENT_VERSION,
  OpenCodeAdapterLive,
  OpenCodeGateway,
  OpenCodeRuntimeLive
} from "../src/runner/open-code-adapter.js";
import { AttemptId, ClaimedJob, JobId, RunId } from "../src/runner/domain.js";
import {
  AdapterInvocationError,
  RuntimeAdapter
} from "../src/runner/runtime-adapter.js";
import type {
  RuntimeAttemptFact,
  RuntimeAttemptReporter
} from "../src/runner/runtime-attempt-observation.js";

function job(input: {
  readonly id: string;
  readonly targetPath: string;
  readonly operation?: "create" | "replace";
  readonly variantId?: string | null;
  readonly adapterKind?: "opencode" | "pi";
  readonly sdkVersion?: string;
  readonly cliVersion?: string;
  readonly workerProtocolVersion?: string;
}) {
  const operation = input.operation ?? "create";
  const adapterKind = input.adapterKind ?? "opencode";
  const targetState =
    operation === "create"
      ? { path: input.targetPath, state_at_base_revision: "absent" }
      : {
          path: input.targetPath,
          state_at_base_revision: "present",
          content: "export const original = true;\n"
        };
  return ClaimedJob.make({
    jobId: JobId.make(`job-${input.id}`),
    attemptId: AttemptId.make(`attempt-${input.id}`),
    runId: RunId.make("run-v2"),
    targetPath: input.targetPath,
    operation,
    controlJson: JSON.stringify({ target_path: input.targetPath, operation }),
    agentInputJson: JSON.stringify({
      objective: `${operation} ${input.targetPath}.`,
      target: {
        path: input.targetPath,
        operation,
        state_at_base_revision: targetState.state_at_base_revision
      },
      input_bindings: [
        {
          contract_input: "target-state",
          kind: "target_state",
          content: targetState
        }
      ]
    }),
    packageDigest: `sha256:${input.id}`,
    adapter:
      adapterKind === "opencode"
        ? {
            kind: "opencode",
            providerId: "test-provider",
            modelId: "test-model",
            variantId: input.variantId ?? null,
            sdkVersion: input.sdkVersion ?? OPENCODE_V2_CLIENT_VERSION,
            cliVersion: input.cliVersion ?? OPENCODE_CLI_VERSION
          }
        : {
            kind: "pi",
            providerId: "test-provider",
            modelId: "test-model",
            variantId: input.variantId ?? null,
            sdkVersion: input.sdkVersion ?? "pi-sdk-test",
            workerProtocolVersion:
              input.workerProtocolVersion ?? "pi-worker-test"
          }
  });
}

function creationJob(variantId: string | null = null) {
  return job({ id: "create", targetPath: "src/account-label.ts", variantId });
}

function replacementJob() {
  return job({ id: "replace", targetPath: "src/schema.ts", operation: "replace" });
}

type FakeScenario =
  | "success"
  | "unknown-after-tool"
  | "finish-error"
  | "provider-failure"
  | "provider-interruption"
  | "paginated-provider-failure"
  | "tool-failure"
  | "unsettled-tool"
  | "unknown-tool-status"
  | "never-completes"
  | "missing-assistant"
  | "missing-candidate"
  | "mismatched-admission"
  | "initial-model-delay"
  | "model-request-never-responds"
  | "health-never-responds"
  | "cleanup-never-responds"
  | "connect-failure"
  | "server-exit";

interface FakeCapture {
  readonly requests: ReadonlyArray<{
    readonly method: string;
    readonly pathname: string;
    readonly search: string;
    readonly authorization?: string;
    readonly body?: unknown;
  }>;
  readonly sessionIds: ReadonlyArray<string>;
  readonly removedSessionIds: ReadonlyArray<string>;
  readonly maxActive: number;
  readonly interrupted: boolean;
  readonly shutdown: boolean;
  readonly args: ReadonlyArray<string>;
  readonly environment: Record<string, string | undefined>;
  readonly ambientSkillVisible: boolean;
  readonly auth?: Record<string, unknown>;
  readonly config: Record<string, unknown>;
}

function createFakeOpenCodeFixture(input: {
  readonly scenario?: FakeScenario;
  readonly completionDelayMs?: number;
  readonly concurrentCount?: number;
}) {
  const scenario = input.scenario ?? "success";
  const directory = mkdtempSync(join(tmpdir(), `score-opencode-v2-${scenario}-`));
  const workspaceParent = join(directory, "workspaces");
  const commandPath = join(directory, "fake-opencode2");
  const capturePath = join(directory, "capture.json");
  const startsPath = join(directory, "starts.txt");
  mkdirSync(workspaceParent);
  writeFileSync(
    commandPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
if (process.argv[2] === "--version") {
  process.stdout.write("opencode2 v${OPENCODE_CLI_VERSION}\\n");
  process.exit(0);
}
const capturePath = ${JSON.stringify(capturePath)};
const startsPath = ${JSON.stringify(startsPath)};
const scenario = ${JSON.stringify(scenario)};
const completionDelayMs = ${JSON.stringify(input.completionDelayMs ?? 10)};
const concurrentCount = ${JSON.stringify(input.concurrentCount ?? 0)};
const password = "test-server-password";
const expectedAuthorization = "Basic " + Buffer.from("opencode:" + password).toString("base64");
const authPath = path.join(process.env.XDG_DATA_HOME, "opencode", "auth.json");
fs.appendFileSync(startsPath, "start\\n");
const capture = {
  requests: [],
  sessionIds: [],
  removedSessionIds: [],
  maxActive: 0,
  interrupted: false,
  shutdown: false,
  args: process.argv.slice(2),
  environment: {
    config: process.env.XDG_CONFIG_HOME,
    data: process.env.XDG_DATA_HOME,
    cache: process.env.XDG_CACHE_HOME,
    state: process.env.XDG_STATE_HOME,
    database: process.env.OPENCODE_DB,
    projectConfigDisabled: process.env.OPENCODE_CONFIG_PROJECT_DISABLE,
    testHome: process.env.OPENCODE_TEST_HOME,
    password: process.env.OPENCODE_PASSWORD,
    serverPassword: process.env.OPENCODE_SERVER_PASSWORD
  },
  ambientSkillVisible: fs.existsSync(path.join(process.env.OPENCODE_TEST_HOME, ".claude", "skills")) ||
    fs.existsSync(path.join(process.env.OPENCODE_TEST_HOME, ".agents", "skills")),
  auth: fs.existsSync(authPath) ? JSON.parse(fs.readFileSync(authPath, "utf8")) : undefined,
  config: JSON.parse(process.env.OPENCODE_CONFIG_CONTENT)
};
const sessions = new Map();
let nextSession = 0;
let credentialConnected = false;
let integrationRequests = 0;
let modelRequests = 0;
let modelRequestsAfterConnect = 0;
const persist = () => {
  fs.writeFileSync(capturePath + ".tmp", JSON.stringify(capture));
  fs.renameSync(capturePath + ".tmp", capturePath);
};
const assistant = (session, finish, content = [], error) => ({
  id: "assistant-" + session.id + "-" + session.messages.length,
  type: "assistant",
  time: { created: Date.now(), completed: Date.now() + 1 },
  agent: "score-file-worker",
  model: { providerID: "test-provider", id: "test-model" },
  content,
  ...(finish === undefined ? {} : { finish }),
  ...(error === undefined ? {} : { error })
});
const finishWaiters = (session) => {
  for (const waiter of session.waiters.splice(0)) {
    try {
      waiter.statusCode = 204;
      waiter.end();
    } catch {}
  }
};
const completeSession = (session) => {
  if (session.completed) return;
  if (scenario === "server-exit") {
    persist();
    server.close();
    server.closeAllConnections();
    setTimeout(() => process.exit(17), 5);
    return;
  }
  const absoluteTarget = path.join(session.directory, session.targetPath);
  if (
    scenario !== "provider-failure" &&
    scenario !== "provider-interruption" &&
    scenario !== "missing-candidate"
  ) {
    fs.mkdirSync(path.dirname(absoluteTarget), { recursive: true });
    fs.writeFileSync(
      absoluteTarget,
      "export const generated = " + JSON.stringify(session.targetPath) + ";\\n"
    );
  }
  session.events.push({
    type: "session.input.promoted",
    data: { sessionID: session.id, inputID: session.inputID }
  });
  if (scenario === "provider-failure") {
    const error = {
      type: "APIError",
      message: "Rate limit exceeded; Authorization: Bearer provider-secret; raw_metadata={private:true}",
      status: 429
    };
    session.messages.push(assistant(session, undefined, [], error));
    session.events.push({
      type: "session.execution.failed",
      data: { sessionID: session.id, error }
    });
  } else if (scenario === "provider-interruption") {
    const error = {
      type: "AbortError",
      message: "Provider ended the request; Authorization: Bearer interrupted-secret"
    };
    session.messages.push(assistant(session, undefined, [], error));
    session.events.push({
      type: "session.execution.failed",
      data: { sessionID: session.id, error }
    });
  } else if (scenario === "paginated-provider-failure") {
    session.messages.push(assistant(session, "tool-calls", [{
      type: "tool",
      id: "tool-edit",
      name: "edit",
      time: { created: 1, completed: 2 },
      state: {
        status: "completed",
        input: {},
        content: [{ type: "text", text: "edited" }]
      }
    }]));
    const error = { type: "APIError", message: "Late rate limit", status: 429 };
    session.messages.push(assistant(session, undefined, [], error));
    session.events.push({
      type: "session.execution.failed",
      data: { sessionID: session.id, error }
    });
  } else if (scenario === "finish-error") {
    session.messages.push(assistant(session, "error"));
    session.events.push({ type: "session.execution.failed", data: { sessionID: session.id } });
  } else if (scenario === "tool-failure") {
    session.messages.push(assistant(session, "stop", [{
      type: "tool",
      id: "tool-edit",
      name: "contract-inspector",
      time: { created: 1, completed: 2 },
      state: {
        status: "error",
        input: {},
        error: {
          type: "ToolError",
          message: "Edit failed; Bearer tool-secret; private_metadata={trace:secret}"
        }
      }
    }]));
    session.events.push({ type: "session.execution.succeeded", data: { sessionID: session.id } });
  } else if (scenario === "unsettled-tool") {
    session.messages.push(assistant(session, "tool-calls", [{
      type: "tool",
      id: "tool-edit",
      name: "edit",
      state: { status: "running", input: {}, metadata: {} }
    }]));
    session.events.push({ type: "session.execution.succeeded", data: { sessionID: session.id } });
  } else if (scenario === "unknown-tool-status") {
    session.messages.push(assistant(session, "tool-calls", [{
      type: "tool",
      id: "tool-edit",
      name: "edit",
      state: { status: "paused", input: {}, metadata: {} }
    }]));
    session.events.push({ type: "session.execution.succeeded", data: { sessionID: session.id } });
  } else if (scenario === "unknown-after-tool") {
    session.messages.push(assistant(session, "tool-calls", [{
      type: "tool",
      id: "tool-edit",
      name: "edit",
      time: { created: 1, completed: 2 },
      state: {
        status: "completed",
        input: {},
        content: [{ type: "text", text: "edited" }]
      }
    }]));
    session.messages.push(assistant(session, "unknown"));
    session.events.push({ type: "session.execution.succeeded", data: { sessionID: session.id } });
  } else if (scenario === "missing-assistant") {
    session.events.push({ type: "session.execution.succeeded", data: { sessionID: session.id } });
  } else {
    session.messages.push(assistant(session, "stop"));
    session.events.push({ type: "session.execution.succeeded", data: { sessionID: session.id } });
  }
  session.completed = true;
  const active = Array.from(sessions.values()).filter((value) => value.admitted && !value.completed).length;
  capture.maxActive = Math.max(capture.maxActive, active + 1);
  finishWaiters(session);
  persist();
};
const maybeComplete = () => {
  const admitted = Array.from(sessions.values()).filter((session) => session.admitted);
  const ready = concurrentCount === 0 || admitted.length === concurrentCount;
  if (!ready || scenario === "never-completes") return;
  setTimeout(
    () => admitted.forEach((session) => {
      if (sessions.get(session.id) === session) completeSession(session);
    }),
    completionDelayMs
  );
};
const server = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const url = new URL(request.url, "http://127.0.0.1");
    const parsedBody = body ? JSON.parse(body) : undefined;
    capture.requests.push({
      method: request.method,
      pathname: url.pathname,
      search: url.search,
      authorization: request.headers.authorization,
      body: parsedBody
    });
    persist();
    if (request.headers.authorization !== expectedAuthorization) {
      response.statusCode = 401;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ message: "unauthorized" }));
      return;
    }
    const json = (value) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(value));
    };
    if (request.method === "GET" && url.pathname === "/api/health") {
      if (scenario === "health-never-responds") return;
      json({ healthy: true, version: ${JSON.stringify(OPENCODE_CLI_VERSION)}, pid: process.pid });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/integration") {
      integrationRequests += 1;
      json({ data: integrationRequests === 1 ? [] : [{ id: "test-provider" }] });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/model") {
      if (scenario === "model-request-never-responds") return;
      modelRequests += 1;
      if (credentialConnected) modelRequestsAfterConnect += 1;
      json({
        data: (credentialConnected && modelRequestsAfterConnect === 1) ||
          (scenario === "initial-model-delay" && modelRequests === 1)
          ? [{
              id: "catalog-refresh-pending",
              providerID: "test-provider",
              name: "Catalog refresh pending",
              enabled: true,
              variants: []
            }]
          : [{
              id: "test-model",
              providerID: "test-provider",
              name: "Test Model",
              enabled: true,
              variants: []
            }]
      });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/integration/test-provider/connect/key"
    ) {
      if (scenario === "connect-failure") {
        response.statusCode = 503;
        json({ message: "credential connection failed" });
        return;
      }
      credentialConnected = true;
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/session") {
      if (scenario === "initial-model-delay" && modelRequests < 2) {
        response.statusCode = 503;
        json({ message: "model catalog is still refreshing" });
        return;
      }
      const id = "session-v2-" + (++nextSession);
      sessions.set(id, {
        id,
        directory: parsedBody.location.directory,
        admitted: false,
        completed: false,
        messages: [],
        events: [],
        waiters: []
      });
      capture.sessionIds.push(id);
      persist();
      json({ data: { id } });
      return;
    }
    const match = url.pathname.match(/^\\/api\\/session\\/([^/]+)(?:\\/(.*))?$/);
    const sessionID = match && match[1];
    const action = match && match[2];
    const session = sessionID && sessions.get(sessionID);
    if (session && request.method === "POST" && action === "prompt") {
      session.admitted = true;
      session.inputID = parsedBody.id;
      session.targetPath = JSON.parse(parsedBody.text).target.path;
      const active = Array.from(sessions.values()).filter((value) => value.admitted && !value.completed).length;
      capture.maxActive = Math.max(capture.maxActive, active);
      json({
        data: {
          id: scenario === "mismatched-admission" ? "msg_wrong" : parsedBody.id,
          sessionID,
          timeCreated: Date.now(),
          type: "user",
          data: { text: parsedBody.text },
          delivery: "queue"
        }
      });
      maybeComplete();
      return;
    }
    if (session && request.method === "POST" && action === "wait") {
      if (session.completed) {
        response.statusCode = 204;
        response.end();
      } else {
        session.waiters.push(response);
      }
      return;
    }
    if (session && request.method === "GET" && action === "message") {
      if (scenario === "paginated-provider-failure") {
        const cursor = url.searchParams.get("cursor");
        if (cursor !== null && url.searchParams.has("order")) {
          response.statusCode = 400;
          json({ message: "cursor cannot be combined with order" });
          return;
        }
        json(
          cursor === null
            ? { data: session.messages.slice(0, 1), cursor: { next: "page-2" } }
            : { data: session.messages.slice(1), cursor: { previous: "page-1" } }
        );
        return;
      }
      json({ data: session.messages, cursor: {} });
      return;
    }
    if (session && request.method === "POST" && action === "interrupt") {
      capture.interrupted = true;
      finishWaiters(session);
      persist();
      response.statusCode = 204;
      response.end();
      return;
    }
    if (session && request.method === "DELETE" && !action) {
      if (scenario === "cleanup-never-responds") return;
      capture.removedSessionIds.push(sessionID);
      sessions.delete(sessionID);
      persist();
      response.statusCode = 204;
      response.end();
      return;
    }
    const logMatch = url.pathname.match(/^\\/api\\/experimental\\/session\\/([^/]+)\\/log$/);
    const logSession = logMatch && sessions.get(logMatch[1]);
    if (logSession && request.method === "GET") {
      response.setHeader("content-type", "text/event-stream");
      response.end();
      return;
    }
    response.statusCode = 404;
    json({ message: "not found: " + url.pathname });
  });
});
process.on("SIGTERM", () => {
  capture.shutdown = true;
  for (const session of sessions.values()) finishWaiters(session);
  persist();
  server.close(() => process.exit(0));
});
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
  return {
    directory,
    workspaceParent,
    commandPath,
    capturePath,
    readCapture: (): FakeCapture =>
      JSON.parse(readFileSync(capturePath, "utf8")) as FakeCapture,
    readServerStarts: (): number =>
      existsSync(startsPath)
        ? readFileSync(startsPath, "utf8").split("\n").filter(Boolean).length
        : 0,
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  };
}

function runtimeFor(
  fixture: ReturnType<typeof createFakeOpenCodeFixture>,
  options: {
    readonly startTimeoutMs?: number;
    readonly executionTimeoutMs?: number;
    readonly cleanupTimeoutMs?: number;
    readonly authPath?: string;
    readonly providerConfigPath?: string;
  } = {}
) {
  return OpenCodeRuntimeLive({
    workspaceParent: fixture.workspaceParent,
    command: fixture.commandPath,
    startTimeoutMs: options.startTimeoutMs ?? 3_000,
    executionTimeoutMs: options.executionTimeoutMs ?? 1_000,
    cleanupTimeoutMs: options.cleanupTimeoutMs ?? 1_000,
    ...(options.authPath === undefined ? {} : { authPath: options.authPath }),
    ...(options.providerConfigPath === undefined
      ? {}
      : { providerConfigPath: options.providerConfigPath })
  });
}

function invokeFake(
  fixture: ReturnType<typeof createFakeOpenCodeFixture>,
  testJob = creationJob(),
  options: {
    readonly startTimeoutMs?: number;
    readonly executionTimeoutMs?: number;
    readonly cleanupTimeoutMs?: number;
    readonly reporter?: RuntimeAttemptReporter;
  } = {}
) {
  return Effect.scoped(
    Effect.gen(function*() {
      const adapter = yield* RuntimeAdapter;
      return yield* adapter.invoke(testJob, options.reporter);
    }).pipe(Effect.provide(runtimeFor(fixture, options)))
  );
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for test condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function testGateway(
  invoke: typeof OpenCodeGateway.Service.invoke
): typeof OpenCodeGateway.Service {
  return OpenCodeGateway.of({ invoke, withRun: (use) => use(invoke) });
}

describe("OpenCode V2 Runtime Adapter", () => {
  it("reports adapter-neutral milestones in truthful order around candidate inspection", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "success" });
    const facts: RuntimeAttemptFact[] = [];
    try {
      const candidate = await Effect.runPromise(
        invokeFake(fixture, creationJob(), {
          reporter: {
            report: (fact) => Effect.sync(() => facts.push(fact))
          }
        })
      );

      assert.deepEqual(facts, [
        { kind: "runtime_session_created", runtimeSessionId: "session-v2-1" },
        { kind: "agent_input_admitted", runtimeSessionId: "session-v2-1" },
        { kind: "workspace_inspection_started", runtimeSessionId: "session-v2-1" }
      ]);
      assert.equal(candidate.targetOutputState, "present");
      assert.equal(
        candidate.targetOutputDigest,
        "sha256:09818af6ee99f74bd3fc35b5c8eec55bfaac4d27d66260e4b06f7634ac14e1f1"
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("isolates reporter nontermination, typed failures, and defects from live gateway deadlines", async () => {
    const fixtures = [
      createFakeOpenCodeFixture({ scenario: "success" }),
      createFakeOpenCodeFixture({ scenario: "success" }),
      createFakeOpenCodeFixture({ scenario: "success" }),
      createFakeOpenCodeFixture({ scenario: "success" })
    ] as const;
    try {
      const baseline = await Effect.runPromise(invokeFake(fixtures[0]));
      const afterTypedFailure = await Effect.runPromise(
        invokeFake(fixtures[1], creationJob(), {
          reporter: { report: () => Effect.fail("observer unavailable") }
        })
      );
      const afterDefect = await Effect.runPromise(
        invokeFake(fixtures[2], creationJob(), {
          reporter: {
            report: () => {
              throw new Error("observer defect");
            }
          }
        })
      );
      const afterNever = await Effect.runPromise(
        invokeFake(fixtures[3], creationJob(), {
          reporter: { report: () => Effect.never }
        })
      );

      assert.deepEqual(afterTypedFailure, baseline);
      assert.deepEqual(afterDefect, baseline);
      assert.deepEqual(afterNever, baseline);
    } finally {
      for (const fixture of fixtures) fixture.cleanup();
    }
  });

  it("does not await delayed, never-ending, or self-interrupting reporter effects", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-opencode-reporter-isolation-"));
    const workspaceParent = join(directory, "workspaces");
    mkdirSync(workspaceParent);
    try {
      const adapterLayer = OpenCodeAdapterLive({ workspaceParent }).pipe(
        Layer.provide(
          Layer.succeed(
            OpenCodeGateway,
            testGateway((input) =>
              Effect.gen(function*() {
                const report = (fact: RuntimeAttemptFact) =>
                  (input.reporter?.report(fact) ?? Effect.void).pipe(
                    Effect.catchCause(() => Effect.void)
                  );
                const runtimeSessionId = "isolated-reporter-session";
                yield* report({ kind: "runtime_session_created", runtimeSessionId });
                yield* report({ kind: "agent_input_admitted", runtimeSessionId });
                const target = join(input.workspacePath, input.targetPath);
                mkdirSync(dirname(target), { recursive: true });
                writeFileSync(target, "export const isolated = true;\n", "utf8");
                return { runtimeSessionId };
              })
            )
          )
        )
      );
      const invoke = (reporter?: RuntimeAttemptReporter) =>
        Effect.scoped(
          Effect.gen(function*() {
            return yield* (yield* RuntimeAdapter).invoke(creationJob(), reporter);
          }).pipe(Effect.provide(adapterLayer))
        ).pipe(Effect.timeout("1 second"));
      const baseline = await Effect.runPromise(invoke());
      let releaseDelayed: (() => void) | undefined;
      const delayed = new Promise<void>((resolve) => {
        releaseDelayed = resolve;
      });
      const reporters: ReadonlyArray<RuntimeAttemptReporter> = [
        { report: () => Effect.never },
        { report: () => Effect.promise(() => delayed) },
        { report: () => Effect.fail("synthetic reporter failure") },
        { report: () => Effect.die("synthetic reporter defect") },
        { report: () => Effect.interrupt }
      ];

      for (const reporter of reporters) {
        assert.deepEqual(await Effect.runPromise(invoke(reporter)), baseline);
      }
      releaseDelayed?.();
      assert.deepEqual(readdirSync(workspaceParent), []);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reuses one V2 server while keeping sequential File Jobs in separate sessions and Locations", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "success" });
    try {
      const candidates = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const adapter = yield* RuntimeAdapter;
            return yield* adapter.withRun((invoke) =>
              Effect.gen(function*() {
                const created = yield* invoke(creationJob());
                const replaced = yield* invoke(replacementJob());
                return [created, replaced] as const;
              })
            );
          }).pipe(Effect.provide(runtimeFor(fixture)))
        )
      );

      assert.equal(fixture.readServerStarts(), 1);
      assert.equal(candidates.length, 2);
      assert.equal(candidates[0].targetOutputState, "present");
      assert.equal(candidates[1].targetOutputState, "different");
      assert.equal(
        candidates[1].targetOutputDigest,
        "sha256:a4722314764ff06ecbc2fa63b4def45fa2040c7f1de302cc42b3115991a58c1b"
      );
      const capture = fixture.readCapture();
      assert.equal(capture.sessionIds.length, 2);
      assert.equal(capture.removedSessionIds.length, 2);
      const locations = capture.requests
        .filter(({ method, pathname }) => method === "POST" && pathname === "/api/session")
        .map(({ body }) => (body as { location: { directory: string } }).location.directory);
      assert.equal(new Set(locations).size, 2);
      assert.equal(capture.shutdown, true);
      assert.deepEqual(readdirSync(fixture.workspaceParent), []);
    } finally {
      fixture.cleanup();
    }
  });

  it("runs five isolated File Job sessions concurrently on the shared V2 server", async () => {
    const count = 5;
    const fixture = createFakeOpenCodeFixture({ scenario: "success", concurrentCount: count });
    const jobs = Array.from({ length: count }, (_, index) =>
      job({ id: `concurrent-${index}`, targetPath: `src/concurrent-${index}.ts` })
    );
    try {
      const candidates = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const adapter = yield* RuntimeAdapter;
            return yield* adapter.withRun((invoke) =>
              Effect.all(jobs.map((item) => invoke(item)), { concurrency: "unbounded" })
            );
          }).pipe(Effect.provide(runtimeFor(fixture)))
        )
      );

      assert.equal(candidates.length, count);
      const capture = fixture.readCapture();
      assert.equal(fixture.readServerStarts(), 1);
      assert.equal(capture.sessionIds.length, count);
      assert.equal(capture.removedSessionIds.length, count);
      assert.equal(capture.maxActive, count);
      assert.deepEqual(readdirSync(fixture.workspaceParent), []);
    } finally {
      fixture.cleanup();
    }
  });

  it("accepts V2 native wait completion after a completed edit tool and final unknown finish", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "unknown-after-tool" });
    try {
      const selectedJob = creationJob("fast");
      const candidate = await Effect.runPromise(invokeFake(fixture, selectedJob));

      assert.equal(candidate.content, 'export const generated = "src/account-label.ts";\n');
      const capture = fixture.readCapture();
      const session = capture.requests.find(
        ({ method, pathname }) => method === "POST" && pathname === "/api/session"
      );
      assert.deepEqual(
        (session?.body as { model?: unknown } | undefined)?.model,
        { id: "test-model", providerID: "test-provider", variant: "fast" }
      );
      const prompts = capture.requests.filter(
        ({ method, pathname }) => method === "POST" && pathname.endsWith("/prompt")
      );
      assert.equal(prompts.length, 1);
      const prompt = prompts[0];
      assert.equal(
        (prompt?.body as { text?: string } | undefined)?.text,
        selectedJob.agentInputJson
      );
      assert.equal((prompt?.body as { resume?: boolean } | undefined)?.resume, true);
      assert.match((prompt?.body as { id: string }).id, /^msg_[0-9a-f]{32}$/);
      assert.ok(capture.requests.some(({ pathname }) => pathname.endsWith("/wait")));
      assert.equal(
        capture.requests.some(({ pathname }) => pathname.includes("/experimental/")),
        false
      );
      assert.ok(capture.requests.every(({ authorization }) => authorization?.startsWith("Basic ")));
      assert.equal(capture.removedSessionIds.length, 1);
    } finally {
      fixture.cleanup();
    }
  });

  it("fails on a projected provider failure with useful diagnostics", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "provider-failure" });
    const facts: RuntimeAttemptFact[] = [];
    try {
      const error = await Effect.runPromise(
        Effect.flip(
          invokeFake(fixture, creationJob(), {
            reporter: {
              report: (fact) =>
                Effect.sync(() => facts.push(fact)).pipe(
                  Effect.andThen(Effect.fail("synthetic observation failure"))
                )
            }
          })
        )
      );

      assert.equal(error._tag, "AdapterInvocationError");
      assert.equal(error.failureEvidence.category, "provider");
      assert.equal(error.runtimeSessionId, "session-v2-1");
      assert.deepEqual(error.failureEvidence, {
        category: "provider",
        stage: null,
        name: "APIError",
        status: "error",
        statusCode: 429,
        reason: "OpenCode provider API failure (APIError, status 429): Rate limit exceeded; [REDACTED CREDENTIAL]; [REDACTED METADATA]"
      });
      assert.equal(error.targetOutputState, "missing");
      assert.equal(error.targetOutputDigest, undefined);
      assert.equal(error.diagnosticContent, undefined);
      assert.match(error.message, /provider API failure/i);
      assert.match(error.message, /Rate limit exceeded/);
      assert.match(error.message, /429/);
      assert.doesNotMatch(
        error.message,
        /authorization|bearer|provider-secret|raw_metadata|private:true/i
      );
      assert.deepEqual(facts, [
        { kind: "runtime_session_created", runtimeSessionId: "session-v2-1" },
        { kind: "agent_input_admitted", runtimeSessionId: "session-v2-1" },
        { kind: "workspace_inspection_started", runtimeSessionId: "session-v2-1" }
      ]);
      assert.equal(fixture.readCapture().removedSessionIds.length, 1);
      assert.equal(fixture.readCapture().shutdown, true);
      assert.deepEqual(readdirSync(fixture.workspaceParent), []);
    } finally {
      fixture.cleanup();
    }
  });

  it("classifies an explicit provider-aborted outcome as a retained interruption", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "provider-interruption" });
    try {
      const error = await Effect.runPromise(
        Effect.flip(invokeFake(fixture, creationJob()))
      );

      assert.equal(error.failureEvidence.category, "interruption");
      assert.equal(error.runtimeSessionId, "session-v2-1");
      assert.deepEqual(error.failureEvidence, {
        category: "interruption",
        stage: null,
        name: "AbortError",
        status: "aborted",
        statusCode: null,
        reason: "OpenCode provider response was aborted: Provider ended the request; [REDACTED CREDENTIAL]"
      });
      assert.equal(error.targetOutputState, "missing");
      assert.match(error.message, /provider response was aborted/i);
      assert.doesNotMatch(error.message, /interrupted-secret|authorization|bearer/i);
      assert.equal(fixture.readCapture().removedSessionIds.length, 1);
      assert.equal(fixture.readCapture().shutdown, true);
    } finally {
      fixture.cleanup();
    }
  });

  it("fails when a completed V2 assistant turn has an explicit error finish", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "finish-error" });
    try {
      const error = await Effect.runPromise(Effect.flip(invokeFake(fixture)));

      assert.match(error.message, /assistant turn finished with an error/i);
      assert.equal(fixture.readCapture().removedSessionIds.length, 1);
      assert.equal(fixture.readCapture().shutdown, true);
      assert.deepEqual(readdirSync(fixture.workspaceParent), []);
    } finally {
      fixture.cleanup();
    }
  });

  it("reads every V2 message page before accepting a terminal result", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "paginated-provider-failure" });
    try {
      const error = await Effect.runPromise(Effect.flip(invokeFake(fixture)));

      assert.match(error.message, /Late rate limit/);
      assert.equal(
        fixture
          .readCapture()
          .requests.filter(({ pathname }) => pathname.endsWith("/message")).length,
        2
      );
      const pages = fixture
        .readCapture()
        .requests.filter(({ pathname }) => pathname.endsWith("/message"));
      assert.equal(pages[0]?.search, "?order=asc");
      assert.equal(pages[1]?.search, "?cursor=page-2");
      assert.equal(fixture.readCapture().removedSessionIds.length, 1);
      assert.equal(fixture.readCapture().shutdown, true);
      assert.deepEqual(readdirSync(fixture.workspaceParent), []);
    } finally {
      fixture.cleanup();
    }
  });

  it("fails closed when V2 returns a mismatched prompt admission receipt", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "mismatched-admission" });
    try {
      const error = await Effect.runPromise(Effect.flip(invokeFake(fixture)));

      assert.match(error.message, /mismatched prompt admission receipt/i);
      const capture = fixture.readCapture();
      assert.equal(capture.removedSessionIds.length, 1);
      assert.equal(capture.shutdown, true);
      assert.deepEqual(readdirSync(fixture.workspaceParent), []);
    } finally {
      fixture.cleanup();
    }
  });

  it("fails when a V2 tool remains in an error state despite a terminal event", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "tool-failure" });
    try {
      const error = await Effect.runPromise(Effect.flip(invokeFake(fixture)));
      assert.match(error.message, /tool failure.*Edit failed/i);
      assert.equal(error.failureEvidence.category, "tool");
      assert.equal(error.runtimeSessionId, "session-v2-1");
      assert.deepEqual(error.failureEvidence, {
        category: "tool",
        stage: null,
        name: "contract-inspector",
        status: "error",
        statusCode: null,
        reason: "OpenCode tool failure: Edit failed; [REDACTED CREDENTIAL]; [REDACTED METADATA]"
      });
      assert.equal(error.targetOutputState, "present");
      assert.equal(
        error.targetOutputDigest,
        "sha256:09818af6ee99f74bd3fc35b5c8eec55bfaac4d27d66260e4b06f7634ac14e1f1"
      );
      assert.equal(error.diagnosticContent, 'export const generated = "src/account-label.ts";\n');
      assert.doesNotMatch(
        error.message,
        /bearer|tool-secret|private_metadata|trace:secret/i
      );
      assert.equal(fixture.readCapture().removedSessionIds.length, 1);
      assert.equal(fixture.readCapture().shutdown, true);
      assert.deepEqual(readdirSync(fixture.workspaceParent), []);
    } finally {
      fixture.cleanup();
    }
  });

  it("fails when a V2 tool remains unsettled after native wait completion", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "unsettled-tool" });
    try {
      const error = await Effect.runPromise(Effect.flip(invokeFake(fixture)));

      assert.match(error.message, /left tool edit unsettled/i);
      assert.equal(fixture.readCapture().removedSessionIds.length, 1);
      assert.equal(fixture.readCapture().shutdown, true);
      assert.deepEqual(readdirSync(fixture.workspaceParent), []);
    } finally {
      fixture.cleanup();
    }
  });

  it("fails closed when V2 returns an unknown tool status", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "unknown-tool-status" });
    try {
      const error = await Effect.runPromise(Effect.flip(invokeFake(fixture)));

      assert.match(error.message, /tool edit.*status paused.*only completed/i);
      assert.equal(error.failureEvidence.category, "tool");
      assert.deepEqual(error.failureEvidence, {
        category: "tool",
        stage: null,
        name: "edit",
        status: "unknown",
        statusCode: null,
        reason: "OpenCode tool edit has status paused; only completed tools are accepted"
      });
      assert.equal(fixture.readCapture().removedSessionIds.length, 1);
      assert.equal(fixture.readCapture().shutdown, true);
      assert.deepEqual(readdirSync(fixture.workspaceParent), []);
    } finally {
      fixture.cleanup();
    }
  });

  it("interrupts and removes a V2 session when the execution deadline expires", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "never-completes" });
    try {
      const error = await Effect.runPromise(
        Effect.flip(invokeFake(fixture, creationJob(), { executionTimeoutMs: 40 }))
      );

      assert.match(error.message, /execution deadline.*40ms/i);
      assert.equal(error.failureEvidence.category, "timeout");
      assert.equal(error.runtimeSessionId, "session-v2-1");
      assert.deepEqual(error.failureEvidence, {
        category: "timeout",
        stage: null,
        name: null,
        status: "aborted",
        statusCode: null,
        reason: "OpenCode model execution deadline exceeded after 40ms"
      });
      assert.equal(error.targetOutputState, "missing");
      const capture = fixture.readCapture();
      assert.equal(capture.interrupted, true);
      assert.equal(capture.removedSessionIds.length, 1);
      assert.equal(capture.shutdown, true);
    } finally {
      fixture.cleanup();
    }
  });

  it("bounds selected-model readiness when a V2 catalog request never responds", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "model-request-never-responds" });
    try {
      const error = await Effect.runPromise(
        Effect.flip(invokeFake(fixture, creationJob(), { startTimeoutMs: 500 }))
      );

      assert.match(error.message, /timeout|timed out|aborted/i);
      assert.equal(fixture.readCapture().shutdown, true);
      assert.deepEqual(readdirSync(fixture.workspaceParent), []);
    } finally {
      fixture.cleanup();
    }
  });

  it("bounds V2 health and session acquisition before model execution", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "health-never-responds" });
    try {
      const error = await Effect.runPromise(
        Effect.flip(invokeFake(fixture, creationJob(), { startTimeoutMs: 500 }))
      );

      assert.match(error.message, /session startup deadline exceeded after 500ms/i);
      assert.equal(error.failureEvidence.category, "runtime");
      assert.equal(error.runtimeSessionId, undefined);
      assert.equal(error.targetOutputState, "not observed");
      assert.equal(fixture.readCapture().shutdown, true);
      assert.deepEqual(readdirSync(fixture.workspaceParent), []);
    } finally {
      fixture.cleanup();
    }
  });

  it("bounds V2 session cleanup when deletion never responds", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "cleanup-never-responds" });
    try {
      const error = await Effect.runPromise(
        Effect.flip(invokeFake(fixture, creationJob(), { cleanupTimeoutMs: 40 }))
      );

      assert.match(error.message, /session deletion failed.*timeout|session deletion failed.*aborted/i);
      assert.equal(error.failureEvidence.category, "runtime");
      assert.equal(error.runtimeSessionId, "session-v2-1");
      assert.equal(error.targetOutputState, "present");
      assert.equal(
        error.targetOutputDigest,
        "sha256:09818af6ee99f74bd3fc35b5c8eec55bfaac4d27d66260e4b06f7634ac14e1f1"
      );
      assert.equal(fixture.readCapture().shutdown, true);
      assert.deepEqual(readdirSync(fixture.workspaceParent), []);
    } finally {
      fixture.cleanup();
    }
  });

  it("interrupts and removes a V2 session when Runner work is interrupted", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "never-completes" });
    try {
      const fiber = Effect.runFork(invokeFake(fixture));
      await waitFor(
        () =>
          existsSync(fixture.capturePath) &&
          fixture.readCapture().requests.some(({ pathname }) => pathname.endsWith("/wait"))
      );
      await Effect.runPromise(Fiber.interrupt(fiber));
      const exit = await Effect.runPromise(Fiber.await(fiber));

      assert.equal(Exit.isFailure(exit), true);
      if (Exit.isFailure(exit)) assert.equal(Cause.hasInterrupts(exit.cause), true);
      const capture = fixture.readCapture();
      assert.equal(capture.interrupted, true);
      assert.equal(capture.removedSessionIds.length, 1);
      assert.equal(capture.shutdown, true);
    } finally {
      fixture.cleanup();
    }
  });

  it("fails closed when wait returns without a completed assistant turn", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "missing-assistant" });
    try {
      const error = await Effect.runPromise(Effect.flip(invokeFake(fixture)));
      assert.match(error.message, /without a completed assistant turn/i);
      assert.equal(fixture.readCapture().removedSessionIds.length, 1);
    } finally {
      fixture.cleanup();
    }
  });

  it("distinguishes a V2 server exit during execution", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "server-exit" });
    try {
      const error = await Effect.runPromise(Effect.flip(invokeFake(fixture)));
      assert.match(error.message, /server process became unavailable/i);
    } finally {
      fixture.cleanup();
    }
  });

  it("reports a successful execution that produced no candidate as a boundary failure", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "missing-candidate" });
    try {
      const error = await Effect.runPromise(Effect.flip(invokeFake(fixture)));
      assert.equal(error._tag, "AdapterBoundaryError");
      assert.equal(error.failureEvidence.category, "missing output");
      assert.equal(error.runtimeSessionId, "session-v2-1");
      assert.equal(error.targetOutputState, "missing");
      assert.equal(error.targetOutputDigest, undefined);
      assert.equal(error.diagnosticContent, undefined);
      assert.match(error.message, /no such file|did not produce/iu);
      assert.equal(fixture.readCapture().shutdown, true);
      assert.deepEqual(readdirSync(fixture.workspaceParent), []);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects candidate bytes that are not valid UTF-8", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-opencode-invalid-utf8-"));
    const workspaceParent = join(directory, "workspaces");
    mkdirSync(workspaceParent);
    try {
      const adapterLayer = OpenCodeAdapterLive({ workspaceParent }).pipe(
        Layer.provide(
          Layer.succeed(
            OpenCodeGateway,
            testGateway((input) =>
              Effect.sync(() => {
                const target = join(input.workspacePath, input.targetPath);
                mkdirSync(dirname(target), { recursive: true });
                writeFileSync(target, Buffer.from([0xc3, 0x28]));
                return { runtimeSessionId: "invalid-utf8" };
              })
            )
          )
        )
      );
      const error = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            Effect.gen(function*() {
              return yield* (yield* RuntimeAdapter).invoke(creationJob());
            }).pipe(Effect.provide(adapterLayer))
          )
        )
      );

      assert.equal(error._tag, "AdapterBoundaryError");
      assert.match(error.message, /valid UTF-8/i);
      assert.equal(error.failureEvidence.category, "workspace integrity");
      assert.equal(error.runtimeSessionId, "invalid-utf8");
      assert.equal(error.targetOutputState, "present");
      assert.equal(
        error.targetOutputDigest,
        "sha256:eddf68639913a3cb8331cdfe7f87559e0beccf2c289c0d90ac4d89b3204004f8"
      );
      assert.equal(error.diagnosticContent, undefined);
      assert.deepEqual(readdirSync(workspaceParent), []);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts empty creations and unchanged replacements as opaque UTF-8 artifacts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-opencode-opaque-artifacts-"));
    const workspaceParent = join(directory, "workspaces");
    mkdirSync(workspaceParent);
    try {
      const adapterLayer = OpenCodeAdapterLive({ workspaceParent }).pipe(
        Layer.provide(
          Layer.succeed(
            OpenCodeGateway,
            testGateway((input) =>
              Effect.sync(() => {
                const target = join(input.workspacePath, input.targetPath);
                if (!existsSync(target)) {
                  mkdirSync(dirname(target), { recursive: true });
                  writeFileSync(target, "", "utf8");
                }
                return { runtimeSessionId: `opaque-${input.targetPath}` };
              })
            )
          )
        )
      );
      const [created, unchanged] = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const adapter = yield* RuntimeAdapter;
            return [
              yield* adapter.invoke(creationJob()),
              yield* adapter.invoke(replacementJob())
            ] as const;
          }).pipe(Effect.provide(adapterLayer))
        )
      );

      assert.equal(created.content, "");
      assert.equal(created.targetOutputState, "present");
      assert.equal(
        created.targetOutputDigest,
        "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      );
      assert.equal(unchanged.content, "export const original = true;\n");
      assert.equal(unchanged.targetOutputState, "unchanged");
      assert.equal(
        unchanged.targetOutputDigest,
        "sha256:11ae3083bdd2ca05deccb949ba637d0b91964fec13725588e675e037bf19ba25"
      );
      assert.deepEqual(readdirSync(workspaceParent), []);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects undeclared files and symbolic-link escapes after generation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-opencode-boundary-"));
    const workspaceParent = join(directory, "workspaces");
    const external = join(directory, "external");
    mkdirSync(workspaceParent);
    mkdirSync(external);
    try {
      const extraLayer = OpenCodeAdapterLive({ workspaceParent }).pipe(
        Layer.provide(
          Layer.succeed(
            OpenCodeGateway,
            testGateway((input) =>
              Effect.sync(() => {
                writeFileSync(join(input.workspacePath, input.targetPath), "candidate\n", "utf8");
                const extra = join(input.workspacePath, "notes", "extra.txt");
                mkdirSync(dirname(extra), { recursive: true });
                writeFileSync(extra, "extra\n", "utf8");
                return { runtimeSessionId: "extra" };
              })
            )
          )
        )
      );
      const extraError = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            Effect.gen(function*() {
              return yield* (yield* RuntimeAdapter).invoke(creationJob());
            }).pipe(Effect.provide(extraLayer))
          )
        )
      );
      assert.equal(extraError._tag, "AdapterBoundaryError");
      assert.match(extraError.message, /notes\/extra\.txt/);
      assert.equal(extraError.failureEvidence.category, "workspace integrity");
      assert.equal(extraError.runtimeSessionId, "extra");
      assert.equal(extraError.targetOutputState, "present");
      assert.equal(
        extraError.targetOutputDigest,
        "sha256:1e81270f1a47dce22a2e4985250c74b2e3374443734f1492b03ea2cd2af4ec48"
      );
      assert.equal(extraError.diagnosticContent, "candidate\n");

      writeFileSync(join(external, "schema.ts"), "external\n", "utf8");
      const linkLayer = OpenCodeAdapterLive({ workspaceParent }).pipe(
        Layer.provide(
          Layer.succeed(
            OpenCodeGateway,
            testGateway((input) =>
              Effect.sync(() => {
                unlinkSync(join(input.workspacePath, input.targetPath));
                rmSync(join(input.workspacePath, "src"), { recursive: true });
                symlinkSync(external, join(input.workspacePath, "src"));
                return { runtimeSessionId: "link" };
              })
            )
          )
        )
      );
      const linkError = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            Effect.gen(function*() {
              return yield* (yield* RuntimeAdapter).invoke(replacementJob());
            }).pipe(Effect.provide(linkLayer))
          )
        )
      );
      assert.equal(linkError._tag, "AdapterBoundaryError");
      assert.match(linkError.message, /symbolic link/i);
      assert.equal(linkError.failureEvidence.category, "workspace integrity");
      assert.equal(linkError.runtimeSessionId, "link");
      assert.equal(linkError.targetOutputState, "not observed");
      assert.deepEqual(readdirSync(workspaceParent), []);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("starts the pinned V2 CLI with isolated config, DB, credential, and provider state", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "success" });
    const authPath = join(fixture.directory, "auth.json");
    const providerConfigPath = join(fixture.directory, "provider.json");
    writeFileSync(
      authPath,
      JSON.stringify({
        "test-provider": { type: "api", key: "selected-secret" },
        "other-provider": { type: "api", key: "not-selected" }
      }),
      "utf8"
    );
    writeFileSync(
      providerConfigPath,
      JSON.stringify({
        provider: {
          "test-provider": { options: { baseURL: "https://provider.test" } },
          "other-provider": { options: { baseURL: "https://other.test" } }
        },
        instructions: ["must-not-be-copied.md"]
      }),
      "utf8"
    );
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            return yield* (yield* RuntimeAdapter).invoke(creationJob());
          }).pipe(
            Effect.provide(runtimeFor(fixture, { authPath, providerConfigPath }))
          )
        )
      );

      const capture = fixture.readCapture();
      assert.deepEqual(Object.keys(capture.auth ?? {}), ["test-provider"]);
      assert.deepEqual(
        capture.requests.find(
          ({ pathname }) => pathname === "/api/integration/test-provider/connect/key"
        )?.body,
        { key: "selected-secret", label: "default" }
      );
      assert.equal(
        capture.requests.filter(({ pathname }) => pathname === "/api/model").length,
        2
      );
      assert.equal(
        capture.requests.filter(({ pathname }) => pathname === "/api/integration").length,
        2
      );
      assert.deepEqual(Object.keys(capture.config.providers as object), ["test-provider"]);
      assert.deepEqual(capture.config.permissions, [
        { action: "*", resource: "*", effect: "deny" }
      ]);
      const agents = capture.config.agents as Record<
        string,
        {
          description?: string;
          system?: string;
          mode?: string;
          permissions: ReadonlyArray<unknown>;
        }
      >;
      assert.equal(
        agents["score-file-worker"]?.description,
        "Apply one approved SCORE Agent Input to its assigned file."
      );
      assert.equal(agents["score-file-worker"]?.mode, "primary");
      assert.equal(
        agents["score-file-worker"]?.system,
        [
          "You are SCORE's isolated file worker.",
          "Treat the user message as an immutable SCORE Agent Input for exactly one assigned target, not as a request to explain.",
          "Ensure that target exists and contains the complete candidate that follows every instruction; use the available file-editing tools to create or replace it when needed.",
          "The target file is the deliverable; prose or a code block in your response is not.",
          "Do not read or change any other path, and do not run project checks."
        ].join(" ")
      );
      assert.deepEqual(agents["score-file-worker"]?.permissions, [
        { action: "*", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow" },
        { action: "edit", resource: "*", effect: "allow" }
      ]);
      assert.equal(capture.environment.projectConfigDisabled, "1");
      assert.match(capture.environment.database ?? "", /score-opencode-run-.*opencode\.db/);
      assert.equal(capture.args.includes("--pure"), false);
      assert.ok(capture.args.includes("--log-level=error"));
      for (const key of ["config", "data", "cache", "state", "database"] as const) {
        assert.match(capture.environment[key] ?? "", /score-opencode-run-/);
      }
    } finally {
      fixture.cleanup();
    }
  });

  it("isolates V2 global discovery and scrubs ambient server-password controls", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "success" });
    const previousPassword = process.env.OPENCODE_PASSWORD;
    const previousServerPassword = process.env.OPENCODE_SERVER_PASSWORD;
    process.env.OPENCODE_PASSWORD = "ambient-password";
    process.env.OPENCODE_SERVER_PASSWORD = "ambient-server-password";
    try {
      await Effect.runPromise(invokeFake(fixture));

      const capture = fixture.readCapture();
      assert.equal(capture.environment.password, undefined);
      assert.equal(capture.environment.serverPassword, undefined);
      assert.match(capture.environment.testHome ?? "", /score-opencode-run-.*\/home$/);
      assert.equal(capture.ambientSkillVisible, false);
    } finally {
      if (previousPassword === undefined) delete process.env.OPENCODE_PASSWORD;
      else process.env.OPENCODE_PASSWORD = previousPassword;
      if (previousServerPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD;
      else process.env.OPENCODE_SERVER_PASSWORD = previousServerPassword;
      fixture.cleanup();
    }
  });

  it("waits for the selected V2 model before creating a session without an auth bridge", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "initial-model-delay" });
    try {
      await Effect.runPromise(invokeFake(fixture));

      const requests = fixture.readCapture().requests;
      const modelRequests = requests
        .map(({ pathname }, index) => ({ pathname, index }))
        .filter(({ pathname }) => pathname === "/api/model");
      const sessionIndex = requests.findIndex(({ pathname }) => pathname === "/api/session");
      assert.equal(modelRequests.length, 2);
      assert.ok(sessionIndex > modelRequests[1]!.index);
    } finally {
      fixture.cleanup();
    }
  });

  it("shuts down the shared V2 server when credential connection fails after startup", async () => {
    const fixture = createFakeOpenCodeFixture({ scenario: "connect-failure" });
    const authPath = join(fixture.directory, "auth.json");
    writeFileSync(
      authPath,
      JSON.stringify({ "test-provider": { type: "api", key: "selected-secret" } }),
      "utf8"
    );
    try {
      const error = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            Effect.gen(function*() {
            return yield* (yield* RuntimeAdapter).invoke(creationJob());
            }).pipe(Effect.provide(runtimeFor(fixture, { authPath })))
          )
        )
      );

      assert.match(error.message, /503.*credential connection failed/i);
      assert.equal(fixture.readCapture().shutdown, true);
      assert.deepEqual(readdirSync(fixture.workspaceParent), []);
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects Pi and pinned OpenCode identity mismatches before gateway admission", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runtime-adapter-mismatch-"));
    const workspaceParent = join(directory, "workspaces");
    mkdirSync(workspaceParent);
    let gatewayAdmissions = 0;
    try {
      const adapterLayer = OpenCodeAdapterLive({ workspaceParent }).pipe(
        Layer.provide(
          Layer.succeed(
            OpenCodeGateway,
            testGateway(() => {
              gatewayAdmissions += 1;
              return Effect.die("the gateway must not be admitted for an incompatible Job");
            })
          )
        )
      );
      const incompatibleJobs = [
        job({
          id: "pi-runtime",
          targetPath: "src/pi-runtime.ts",
          adapterKind: "pi"
        }),
        job({
          id: "wrong-sdk",
          targetPath: "src/wrong-sdk.ts",
          sdkVersion: "0.0.0-mismatched-sdk"
        }),
        job({
          id: "wrong-cli",
          targetPath: "src/wrong-cli.ts",
          cliVersion: "0.0.0-mismatched-cli"
        })
      ];

      for (const incompatibleJob of incompatibleJobs) {
        const error = (await Effect.runPromise(
          Effect.flip(
            Effect.scoped(
              Effect.gen(function*() {
                return yield* (yield* RuntimeAdapter).invoke(incompatibleJob);
              }).pipe(Effect.provide(adapterLayer))
            )
          )
        ));

        assert.ok(error instanceof AdapterInvocationError);
        assert.equal(error._tag, "AdapterInvocationError");
        assert.equal(error.failureEvidence.category, "runtime");
        assert.equal(error.targetOutputState, "not observed");
        assert.equal(error.runtimeSessionId, undefined);
        assert.match(error.message, /adapter|OpenCode|version/i);
      }
      assert.equal(gatewayAdmissions, 0);
      assert.deepEqual(readdirSync(workspaceParent), []);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
