import { setTimeout as delay } from "node:timers/promises";

export interface OpenCodeV2StructuredError {
  readonly type: string;
  readonly message: string;
  readonly status?: number;
}

export interface OpenCodeV2AssistantTool {
  readonly type: "tool";
  readonly id: string;
  readonly name: string;
  readonly state:
    | { readonly status: "streaming" }
    | { readonly status: "running" }
    | { readonly status: "completed" }
    | { readonly status: "error"; readonly error: OpenCodeV2StructuredError };
}

export interface OpenCodeV2AssistantMessage {
  readonly id: string;
  readonly type: "assistant";
  readonly time: { readonly created: number; readonly completed?: number };
  readonly finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown";
  readonly error?: OpenCodeV2StructuredError;
  readonly content: ReadonlyArray<
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "reasoning"; readonly text: string }
    | OpenCodeV2AssistantTool
  >;
}

export type OpenCodeV2Message =
  | OpenCodeV2AssistantMessage
  | { readonly id: string; readonly type: string; readonly [key: string]: unknown };

export interface OpenCodeV2Provider {
  readonly id: string;
  readonly name: string;
}

export interface OpenCodeV2Integration {
  readonly id: string;
}

export interface OpenCodeV2Model {
  readonly id: string;
  readonly providerID: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly variants: ReadonlyArray<{ readonly id: string }>;
}

export interface OpenCodeV2Client {
  readonly health: (signal?: AbortSignal) => Promise<{ readonly healthy: true }>;
  readonly createSession: (
    input: {
      readonly title: string;
      readonly agent: string;
      readonly model: {
        readonly id: string;
        readonly providerID: string;
        readonly variant?: string;
      };
      readonly location: { readonly directory: string };
    },
    signal?: AbortSignal
  ) => Promise<{ readonly id: string }>;
  readonly prompt: (
    sessionId: string,
    input: { readonly id: string; readonly text: string; readonly resume: true },
    signal?: AbortSignal
  ) => Promise<{ readonly id: string; readonly sessionID: string }>;
  readonly wait: (sessionId: string, signal?: AbortSignal) => Promise<void>;
  readonly messages: (
    sessionId: string,
    signal?: AbortSignal
  ) => Promise<ReadonlyArray<OpenCodeV2Message>>;
  readonly interrupt: (sessionId: string, signal?: AbortSignal) => Promise<void>;
  readonly remove: (sessionId: string, signal?: AbortSignal) => Promise<void>;
  readonly integrations: (
    directory: string,
    signal?: AbortSignal
  ) => Promise<ReadonlyArray<OpenCodeV2Integration>>;
  readonly connectKey: (
    integrationId: string,
    directory: string,
    key: string,
    signal?: AbortSignal
  ) => Promise<void>;
  readonly providers: (
    directory: string,
    signal?: AbortSignal
  ) => Promise<ReadonlyArray<OpenCodeV2Provider>>;
  readonly models: (
    directory: string,
    signal?: AbortSignal
  ) => Promise<ReadonlyArray<OpenCodeV2Model>>;
}

function errorMessage(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.error === "string") return record.error;
  return undefined;
}

function queryLocation(directory: string): string {
  const parameters = new URLSearchParams();
  parameters.set("location[directory]", directory);
  return `?${parameters.toString()}`;
}

export function makeOpenCodeV2Client(input: {
  readonly baseUrl: string;
  readonly headers: Readonly<Record<string, string>>;
}): OpenCodeV2Client {
  const request = async (
    path: string,
    init: RequestInit,
    expectedStatus: number,
    signal?: AbortSignal
  ): Promise<Response> => {
    const response = await fetch(new URL(path, input.baseUrl), {
      ...init,
      ...(signal === undefined ? {} : { signal }),
      headers: {
        ...input.headers,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers
      }
    });
    if (response.status === expectedStatus) return response;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    throw new Error(
      `OpenCode V2 request failed with status ${response.status}: ${errorMessage(body) ?? "no response message"}`
    );
  };

  const json = async <A>(
    path: string,
    init: RequestInit,
    signal?: AbortSignal
  ): Promise<A> => {
    const response = await request(path, init, 200, signal);
    return (await response.json()) as A;
  };

  const empty = async (
    path: string,
    init: RequestInit,
    signal?: AbortSignal
  ): Promise<void> => {
    await request(path, init, 204, signal);
  };

  return {
    health: (signal) => json("/api/health", { method: "GET" }, signal),
    createSession: async (body, signal) => {
      const response = await json<{ readonly data: { readonly id: string } }>(
        "/api/session",
        { method: "POST", body: JSON.stringify(body) },
        signal
      );
      return response.data;
    },
    prompt: async (sessionId, body, signal) => {
      const response = await json<{
        readonly data: { readonly id: string; readonly sessionID: string };
      }>(
        `/api/session/${encodeURIComponent(sessionId)}/prompt`,
        { method: "POST", body: JSON.stringify(body) },
        signal
      );
      return response.data;
    },
    wait: (sessionId, signal) =>
      empty(`/api/session/${encodeURIComponent(sessionId)}/wait`, { method: "POST" }, signal),
    messages: async (sessionId, signal) => {
      const messages: OpenCodeV2Message[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      while (true) {
        const parameters = new URLSearchParams(
          cursor === undefined ? { order: "asc" } : { cursor }
        );
        const response = await json<{
          readonly data: ReadonlyArray<OpenCodeV2Message>;
          readonly cursor: { readonly next?: string | null };
        }>(
          `/api/session/${encodeURIComponent(sessionId)}/message?${parameters.toString()}`,
          { method: "GET" },
          signal
        );
        messages.push(...response.data);
        const next =
          typeof response.cursor.next === "string" && response.cursor.next.length > 0
            ? response.cursor.next
            : undefined;
        if (next === undefined) return messages;
        if (seenCursors.has(next)) {
          throw new Error("OpenCode V2 returned a repeated message-page cursor");
        }
        seenCursors.add(next);
        cursor = next;
      }
    },
    interrupt: (sessionId, signal) =>
      empty(
        `/api/session/${encodeURIComponent(sessionId)}/interrupt`,
        { method: "POST" },
        signal
      ),
    remove: (sessionId, signal) =>
      empty(`/api/session/${encodeURIComponent(sessionId)}`, { method: "DELETE" }, signal),
    integrations: async (directory, signal) => {
      const response = await json<{ readonly data: ReadonlyArray<OpenCodeV2Integration> }>(
        `/api/integration${queryLocation(directory)}`,
        { method: "GET" },
        signal
      );
      return response.data;
    },
    connectKey: (integrationId, directory, key, signal) =>
      empty(
        `/api/integration/${encodeURIComponent(integrationId)}/connect/key${queryLocation(directory)}`,
        {
          method: "POST",
          body: JSON.stringify({ key, label: "default" })
        },
        signal
      ),
    providers: async (directory, signal) => {
      const response = await json<{ readonly data: ReadonlyArray<OpenCodeV2Provider> }>(
        `/api/provider${queryLocation(directory)}`,
        { method: "GET" },
        signal
      );
      return response.data;
    },
    models: async (directory, signal) => {
      const response = await json<{ readonly data: ReadonlyArray<OpenCodeV2Model> }>(
        `/api/model${queryLocation(directory)}`,
        { method: "GET" },
        signal
      );
      return response.data;
    }
  };
}

const INTEGRATION_READY_POLL_MS = 250;

function boundedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)));
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

async function waitBeforeRetry(timeoutMs: number, signal?: AbortSignal): Promise<void> {
  await delay(timeoutMs, undefined, signal === undefined ? undefined : { signal });
}

export async function waitForOpenCodeV2Integrations(
  client: OpenCodeV2Client,
  directory: string,
  integrationIds: ReadonlyArray<string>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  if (integrationIds.length === 0) return;
  const expected = new Set(integrationIds);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `OpenCode V2 did not load integration(s): ${[...expected].toSorted().join(", ")}`
      );
    }
    let integrations: ReadonlyArray<OpenCodeV2Integration>;
    try {
      integrations = await client.integrations(
        directory,
        boundedSignal(signal, remainingMs)
      );
    } catch (cause) {
      if (Date.now() >= deadline && signal?.aborted !== true) {
        throw new Error(
          `OpenCode V2 did not load integration(s): ${[...expected].toSorted().join(", ")}`,
          { cause }
        );
      }
      throw cause;
    }
    for (const { id } of integrations) expected.delete(id);
    if (expected.size === 0) return;

    await waitBeforeRetry(
      Math.min(INTEGRATION_READY_POLL_MS, Math.max(1, deadline - Date.now())),
      signal
    );
  }
}

export async function waitForOpenCodeV2Model(
  client: OpenCodeV2Client,
  directory: string,
  providerId: string,
  modelId: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `OpenCode V2 did not load model ${providerId}/${modelId} after connecting its credential`
      );
    }
    let models: ReadonlyArray<OpenCodeV2Model>;
    try {
      models = await client.models(directory, boundedSignal(signal, remainingMs));
    } catch (cause) {
      if (Date.now() >= deadline && signal?.aborted !== true) {
        throw new Error(
          `OpenCode V2 did not load model ${providerId}/${modelId} after connecting its credential`,
          { cause }
        );
      }
      throw cause;
    }
    if (
      models.some(
        (model) =>
          model.enabled && model.providerID === providerId && model.id === modelId
      )
    ) {
      return;
    }

    await waitBeforeRetry(
      Math.min(INTEGRATION_READY_POLL_MS, Math.max(1, deadline - Date.now())),
      signal
    );
  }
}
