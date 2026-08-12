import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";

export interface RunnerPathOptions {
  readonly platform?: NodeJS.Platform;
  readonly homeDirectory?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export function defaultRunnerDatabasePath(options: RunnerPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? homedir();
  const environment = options.environment ?? process.env;

  if (platform === "win32") {
    const configuredLocalData = environment.LOCALAPPDATA?.trim();
    const localData = configuredLocalData && win32.isAbsolute(configuredLocalData)
      ? configuredLocalData
      : win32.join(homeDirectory, "AppData", "Local");
    return win32.join(localData, "SCORE", "runner.db");
  }

  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Application Support", "SCORE", "runner.db");
  }

  const xdgDataHome = environment.XDG_DATA_HOME?.trim();
  if (xdgDataHome && isAbsolute(xdgDataHome)) {
    return join(xdgDataHome, "score", "runner.db");
  }

  return join(homeDirectory, ".local", "share", "score", "runner.db");
}
