import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";

import { runDoctor, type DoctorDependencies, type DoctorReport } from "./doctor.js";
import { makeOpenCodeModelCatalog } from "./runner/open-code-catalog.js";
import { inspectOpenCodeVersion } from "./runner/open-code-process.js";
import { resolveRepositoryRoot } from "./runner/repository-application.js";

interface ScorePackageManifest {
  readonly version?: unknown;
  readonly bin?: unknown;
}

interface OpenCodePackageManifest {
  readonly version?: unknown;
  readonly bin?: string | Readonly<Record<string, string>>;
}

export interface DoctorRuntimeOptions {
  readonly projectRoot?: string;
  readonly openCodeCommand?: string;
  readonly openCodeAuthPath?: string;
  readonly openCodeProviderConfigPath?: string;
  readonly startTimeoutMs?: number;
}

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultAuthPath = join(homedir(), ".local", "share", "opencode", "auth.json");

function object(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function stringRecord(value: unknown): boolean {
  const record = object(value);
  return record !== undefined && Object.values(record).every((item) => typeof item === "string");
}

function validLegacyCredential(value: unknown): boolean {
  const credential = object(value);
  if (credential === undefined) return false;
  if (credential.type === "api") {
    return (
      nonemptyString(credential.key) &&
      (credential.metadata === undefined || stringRecord(credential.metadata))
    );
  }
  if (credential.type === "oauth") {
    return (
      nonemptyString(credential.refresh) &&
      nonemptyString(credential.access) &&
      Number.isSafeInteger(credential.expires) &&
      (credential.expires as number) >= 0 &&
      optionalString(credential.accountId) &&
      optionalString(credential.enterpriseUrl)
    );
  }
  if (credential.type === "wellknown") {
    return nonemptyString(credential.key) && nonemptyString(credential.token);
  }
  return false;
}

function pinnedOpenCode(): { readonly command: string; readonly version: string } {
  const manifestPath = require.resolve("@opencode-ai/cli/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as OpenCodePackageManifest;
  const binary =
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.opencode2;
  if (binary === undefined || typeof manifest.version !== "string") {
    throw new Error("Pinned OpenCode package is incomplete");
  }
  return { command: resolve(dirname(manifestPath), binary), version: manifest.version };
}

function inspectAuthentication(authPath: string | undefined): {
  readonly status: "configured" | "missing" | "invalid";
  readonly providerCount: number;
} {
  if (authPath === undefined || !existsSync(authPath)) {
    return { status: "missing", providerCount: 0 };
  }
  try {
    const document = object(JSON.parse(readFileSync(authPath, "utf8")));
    if (document === undefined) return { status: "invalid", providerCount: 0 };
    const credentials = Object.entries(document);
    if (
      credentials.some(
        ([provider, credential]) =>
          provider.replace(/\/+$/u, "").length === 0 || !validLegacyCredential(credential)
      )
    ) {
      return { status: "invalid", providerCount: 0 };
    }
    const providerCount = credentials.length;
    return providerCount === 0
      ? { status: "missing", providerCount: 0 }
      : { status: "configured", providerCount };
  } catch {
    return { status: "invalid", providerCount: 0 };
  }
}

export function inspectScorePackage(root = packageRoot): {
  readonly version: string;
  readonly resourcesAvailable: boolean;
} {
  const manifest = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8")
  ) as ScorePackageManifest;
  if (typeof manifest.version !== "string") throw new Error("SCORE package version is absent");
  const resourcesAvailable = [
    "migrations/001_initial.sql",
    "migrations/002_declaration_registry.sql",
    "migrations/003_declaration_registry_view.sql",
    "migrations/004_repository_project_settings.sql",
    "migrations/005_plan_intake_revisions.sql",
    "migrations/006_prepared_slice_publications.sql",
    "migrations/007_slice_identity_dependencies.sql",
    "schema/compilation-bundle.schema.json",
    "skills/score-authoring/SKILL.md",
    "CONTEXT.md"
  ].every((path) => {
    const resourcePath = join(root, path);
    try {
      if (!lstatSync(resourcePath).isFile()) return false;
      accessSync(resourcePath, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  });
  return { version: manifest.version, resourcesAvailable };
}

async function inspectSqlite(): Promise<void> {
  const [{ default: Database }, { ScoreAlpha }, { RunnerStore, RunnerStoreLive }] =
    await Promise.all([
      import("better-sqlite3"),
      import("./score-alpha.js"),
      import("./runner/runner-store.js")
    ]);
  const score = ScoreAlpha.open(":memory:");
  score.close();
  const runnerDatabase = new Database(":memory:");
  runnerDatabase.close();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function*() {
        const store = yield* RunnerStore;
        yield* store.initialize;
      }).pipe(Effect.provide(RunnerStoreLive(":memory:")))
    )
  );
}

export function makeDoctorDependencies(options: DoctorRuntimeOptions = {}): DoctorDependencies {
  let pinned: { readonly command: string; readonly version: string } | undefined;
  const requestedAuthPath = options.openCodeAuthPath ?? defaultAuthPath;
  const authPath = existsSync(requestedAuthPath) ? requestedAuthPath : undefined;
  const projectRoot = options.projectRoot ?? process.cwd();
  const resolvePinned = () => (pinned ??= pinnedOpenCode());
  return {
    inspectNode: () => {
      const version = process.versions.node;
      const [major = 0, minor = 0] = version.split(".").map(Number);
      return { version, supported: major === 26 && minor >= 5 };
    },
    inspectPackage: inspectScorePackage,
    inspectSqlite,
    inspectOpenCode: () => {
      const resolved = resolvePinned();
      const version = inspectOpenCodeVersion(
        options.openCodeCommand ?? resolved.command,
        resolved.version,
        options.startTimeoutMs ?? 10_000
      );
      return { version };
    },
    inspectAuthentication: () => inspectAuthentication(authPath),
    discoverModels: async () => {
      const resolved = resolvePinned();
      const models = await Effect.runPromise(
        makeOpenCodeModelCatalog({
          command: options.openCodeCommand ?? resolved.command,
          ...(authPath === undefined ? {} : { authPath }),
          ...(options.openCodeProviderConfigPath === undefined
            ? {}
            : { providerConfigPath: options.openCodeProviderConfigPath }),
          startTimeoutMs: options.startTimeoutMs ?? 10_000
        }).discoverModels
      );
      return {
        enabledModelCount: models.length,
        providerCount: new Set(models.map(({ key }) => key.split("/", 1)[0])).size
      };
    },
    inspectProject: () => {
      const root = resolveRepositoryRoot(projectRoot);
      const stateDirectory = join(root, ".score");
      if (!pathEntryExists(stateDirectory)) {
        try {
          accessSync(root, constants.W_OK | constants.X_OK);
          return { projectRoot: root, stateLocationReady: true };
        } catch {
          return {
            projectRoot: root,
            stateLocationReady: false,
            issue: "project_not_writable"
          };
        }
      }
      if (!lstatSync(stateDirectory).isDirectory()) {
        return {
          projectRoot: root,
          stateLocationReady: false,
          issue: "state_path_conflict"
        };
      }
      try {
        accessSync(stateDirectory, constants.W_OK | constants.X_OK);
      } catch {
        return {
          projectRoot: root,
          stateLocationReady: false,
          issue: "state_directory_not_writable"
        };
      }
      const databasePath = join(stateDirectory, "score.db");
      if (!pathEntryExists(databasePath)) {
        return { projectRoot: root, stateLocationReady: true };
      }
      if (!lstatSync(databasePath).isFile()) {
        return {
          projectRoot: root,
          stateLocationReady: false,
          issue: "database_path_conflict"
        };
      }
      try {
        accessSync(databasePath, constants.R_OK | constants.W_OK);
      } catch {
        return {
          projectRoot: root,
          stateLocationReady: false,
          issue: "database_not_accessible"
        };
      }
      return { projectRoot: root, stateLocationReady: true };
    }
  };
}

export function runDefaultDoctor(options: DoctorRuntimeOptions = {}): Promise<DoctorReport> {
  const projectRoot = options.projectRoot ?? process.cwd();
  return runDoctor({ projectRoot }, makeDoctorDependencies({ ...options, projectRoot }));
}
