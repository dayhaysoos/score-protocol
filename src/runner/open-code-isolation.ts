import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface OpenCodeIsolation {
  readonly configDirectory: string;
  readonly databasePath: string;
  readonly runtimeHomePath: string;
  readonly xdgConfigPath: string;
  readonly xdgDataPath: string;
  readonly xdgCachePath: string;
  readonly xdgStatePath: string;
}

export function prepareOpenCodeIsolation(root: string): OpenCodeIsolation {
  const isolation = {
    configDirectory: join(root, "config-directory"),
    databasePath: join(root, "opencode.db"),
    runtimeHomePath: join(root, "home"),
    xdgConfigPath: join(root, "xdg-config"),
    xdgDataPath: join(root, "xdg-data"),
    xdgCachePath: join(root, "xdg-cache"),
    xdgStatePath: join(root, "xdg-state")
  };
  for (const path of [
    isolation.configDirectory,
    isolation.runtimeHomePath,
    isolation.xdgConfigPath,
    isolation.xdgDataPath,
    isolation.xdgCachePath,
    isolation.xdgStatePath
  ]) {
    mkdirSync(path, { recursive: true });
  }
  return isolation;
}

export function isolatedOpenCodeEnvironment(
  isolation: OpenCodeIsolation,
  configPath: string,
  config: unknown
): NodeJS.ProcessEnv {
  const environment = { ...globalThis.process.env };
  delete environment.OPENCODE_CONFIG;
  delete environment.OPENCODE_CONFIG_CONTENT;
  delete environment.OPENCODE_CONFIG_DIR;
  delete environment.OPENCODE_CONFIG_PROJECT_DISABLE;
  delete environment.OPENCODE_DB;
  delete environment.OPENCODE_PASSWORD;
  delete environment.OPENCODE_SERVER_PASSWORD;
  delete environment.OPENCODE_TEST_HOME;
  return {
    ...environment,
    OPENCODE_CONFIG: configPath,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_CONFIG_DIR: isolation.configDirectory,
    OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    OPENCODE_DB: isolation.databasePath,
    OPENCODE_TEST_HOME: isolation.runtimeHomePath,
    XDG_CONFIG_HOME: isolation.xdgConfigPath,
    XDG_DATA_HOME: isolation.xdgDataPath,
    XDG_CACHE_HOME: isolation.xdgCachePath,
    XDG_STATE_HOME: isolation.xdgStatePath
  };
}
