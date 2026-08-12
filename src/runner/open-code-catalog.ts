import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Effect } from "effect";

import {
  OPENCODE_CLI_VERSION,
  OPENCODE_V2_CLIENT_VERSION
} from "./open-code-adapter.js";
import {
  AdapterCatalogDiscoveryError,
  type RuntimeAdapterCatalog,
  type RuntimeModel
} from "./runtime-adapter-catalog.js";
import type { AdapterConfiguration } from "./domain.js";
import {
  isolatedOpenCodeEnvironment,
  prepareOpenCodeIsolation
} from "./open-code-isolation.js";
import {
  assertOpenCodeVersion,
  startOpenCodeServer,
  stopOpenCodeProcess
} from "./open-code-process.js";
import {
  makeOpenCodeV2Client,
  waitForOpenCodeV2Integrations,
  type OpenCodeV2Model,
  type OpenCodeV2Provider
} from "./open-code-v2-client.js";

const CATALOG_READY_POLL_MS = 250;

function catalogSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)))]);
}

export interface OpenCodeCatalogOptions {
  readonly command?: string;
  readonly authPath?: string;
  readonly providerConfigPath?: string;
  readonly startTimeoutMs?: number;
}

interface OpenCodeModelKey {
  readonly providerId: string;
  readonly modelId: string;
}

function parseModelKey(key: string): OpenCodeModelKey {
  const separator = key.indexOf("/");
  if (separator <= 0 || separator === key.length - 1) {
    throw new Error(`OpenCode returned an invalid model key: ${key}`);
  }
  return {
    providerId: key.slice(0, separator),
    modelId: key.slice(separator + 1)
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function providerDefinitions(configPath: string | undefined): Record<string, unknown> | undefined {
  if (configPath === undefined) return undefined;
  const document = record(JSON.parse(readFileSync(configPath, "utf8")));
  const providers = record(document?.providers) ?? record(document?.provider);
  if (providers === undefined) {
    throw new Error("OpenCode provider config does not contain a providers object");
  }
  return providers;
}

function apiCredentials(
  authPath: string | undefined
): ReadonlyArray<{ readonly providerId: string; readonly key: string }> {
  if (authPath === undefined) return [];
  const document = record(JSON.parse(readFileSync(authPath, "utf8")));
  if (document === undefined) throw new Error("OpenCode auth file must contain an object");
  return Object.entries(document).flatMap(([providerId, value]) => {
    const credential = record(value);
    if (credential?.type !== "api") return [];
    if (typeof credential.key !== "string" || credential.key.length === 0) {
      throw new Error(`OpenCode API credential for ${providerId} does not contain a key`);
    }
    return [{ providerId, key: credential.key }];
  });
}

function displayVariant(variantId: string): string {
  if (variantId === "xhigh") return "Extra high";
  const words = variantId.replace(/[-_]+/gu, " ").trim();
  return words.length === 0
    ? variantId
    : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function variantSummary(variantId: string, label: string): string {
  if (variantId === "none") return "No reasoning";
  return `${label} reasoning`;
}

async function readReadyCatalog(
  client: ReturnType<typeof makeOpenCodeV2Client>,
  directory: string,
  timeoutMs: number,
  ready: (
    providers: ReadonlyArray<OpenCodeV2Provider>,
    models: ReadonlyArray<OpenCodeV2Model>
  ) => boolean = (providers, models) => providers.length > 0 && models.length > 0,
  signal?: AbortSignal
) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error("OpenCode V2 model catalog did not become ready before its deadline");
    }
    const requestSignal =
      signal === undefined
        ? AbortSignal.timeout(Math.max(1, remainingMs))
        : catalogSignal(signal, remainingMs);
    const [providers, models] = await Promise.all([
      client.providers(directory, requestSignal),
      client.models(directory, requestSignal)
    ]);
    if (ready(providers, models)) return { providers, models };

    const retryMs = deadline - Date.now();
    if (retryMs <= 0) return { providers, models };
    await delay(
      Math.min(CATALOG_READY_POLL_MS, retryMs),
      undefined,
      signal === undefined ? undefined : { signal }
    );
  }
}

function providerModelSignature(
  models: ReadonlyArray<OpenCodeV2Model>,
  providerId: string
): string {
  return JSON.stringify(
    models
      .filter((model) => model.providerID === providerId)
      .map((model) => ({
        id: model.id,
        enabled: model.enabled,
        variants: model.variants.map(({ id }) => id)
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id))
  );
}

function discoverModels(
  options: OpenCodeCatalogOptions
): Effect.Effect<ReadonlyArray<RuntimeModel>, AdapterCatalogDiscoveryError> {
  return Effect.acquireUseRelease(
    Effect.try({
      try: () => mkdtempSync(join(tmpdir(), "score-opencode-models-")),
      catch: (cause) =>
        new AdapterCatalogDiscoveryError({
          adapterId: "opencode",
          message: cause instanceof Error ? cause.message : String(cause)
        })
    }),
    (directory) =>
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: async () => {
            const command = options.command ?? "opencode2";
            assertOpenCodeVersion(command, OPENCODE_CLI_VERSION);

            const isolation = prepareOpenCodeIsolation(directory);
            if (options.authPath !== undefined) {
              const authDirectory = join(isolation.xdgDataPath, "opencode");
              mkdirSync(authDirectory, { recursive: true });
              copyFileSync(options.authPath, join(authDirectory, "auth.json"));
            }
            const providers = providerDefinitions(options.providerConfigPath);
            const discoveryConfig = {
              autoupdate: false,
              ...(providers === undefined ? {} : { providers })
            };
            const discoveryConfigPath = join(directory, "opencode.json");
            writeFileSync(discoveryConfigPath, `${JSON.stringify(discoveryConfig)}\n`, "utf8");
            const environment = isolatedOpenCodeEnvironment(
              isolation,
              discoveryConfigPath,
              discoveryConfig
            );

            return startOpenCodeServer({
              command,
              cwd: directory,
              environment,
              startTimeoutMs: options.startTimeoutMs ?? 10_000
            });
          },
          catch: (cause) =>
            new AdapterCatalogDiscoveryError({
              adapterId: "opencode",
              message: cause instanceof Error ? cause.message : String(cause)
            })
        }),
      (server) =>
        Effect.tryPromise({
          try: async (signal) => {
            const client = makeOpenCodeV2Client({
              baseUrl: server.url,
              headers: server.headers
            });
            const timeoutMs = options.startTimeoutMs ?? 10_000;
            const discoverySignal = catalogSignal(signal, timeoutMs);
            const initialCatalog = await readReadyCatalog(
              client,
              directory,
              timeoutMs,
              undefined,
              discoverySignal
            );
            const credentials = apiCredentials(options.authPath);
            await waitForOpenCodeV2Integrations(
              client,
              directory,
              credentials.map(({ providerId }) => providerId),
              timeoutMs,
              discoverySignal
            );
            for (const { providerId, key } of credentials) {
              await client.connectKey(providerId, directory, key, discoverySignal);
            }
            const baseline = new Map(
              credentials.map(({ providerId }) => [
                providerId,
                providerModelSignature(initialCatalog.models, providerId)
              ])
            );
            const { providers: providersResponse, models: modelsResponse } =
              credentials.length === 0
                ? initialCatalog
                : await readReadyCatalog(
                    client,
                    directory,
                    timeoutMs,
                    (providers, models) =>
                      providers.length > 0 &&
                      models.length > 0 &&
                      credentials.every(
                        ({ providerId }) =>
                          providerModelSignature(models, providerId) !== baseline.get(providerId)
                      ),
                    discoverySignal
                  );
            const providers = new Map(
              providersResponse.map((provider) => [provider.id, provider.name] as const)
            );
            const models = modelsResponse
              .filter((model) => model.enabled && providers.has(model.providerID))
              .map((model): RuntimeModel => ({
                key: `${model.providerID}/${model.id}`,
                label: model.name,
                sourceLabel: providers.get(model.providerID) ?? model.providerID,
                variants: model.variants.map(({ id }) => {
                  const label = displayVariant(id);
                  return { id, label, summaryLabel: variantSummary(id, label) };
                })
              }));
            if (models.length === 0) {
              throw new Error("OpenCode did not report any models from connected providers");
            }
            return models;
          },
          catch: (cause) =>
            new AdapterCatalogDiscoveryError({
              adapterId: "opencode",
              message: cause instanceof Error ? cause.message : String(cause)
            })
        }),
      (server) =>
        Effect.tryPromise({
          try: () => stopOpenCodeProcess(server.process),
          catch: (cause) =>
            new AdapterCatalogDiscoveryError({
              adapterId: "opencode",
              message: cause instanceof Error ? cause.message : String(cause)
            })
        })
      ),
    (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
  );
}

export function openCodeConfiguration(
  providerId: string,
  modelId: string,
  variantId?: string
): AdapterConfiguration {
  return {
    kind: "opencode",
    providerId,
    modelId,
    variantId: variantId ?? null,
    sdkVersion: OPENCODE_V2_CLIENT_VERSION,
    cliVersion: OPENCODE_CLI_VERSION
  };
}

export function makeOpenCodeModelCatalog(
  options: OpenCodeCatalogOptions = {}
): RuntimeAdapterCatalog<AdapterConfiguration> {
  return {
    id: "opencode",
    label: "OpenCode",
    discoverModels: discoverModels(options),
    configurationFor: (model, variantId) => {
      const { providerId, modelId } = parseModelKey(model.key);
      return openCodeConfiguration(providerId, modelId, variantId);
    }
  };
}
