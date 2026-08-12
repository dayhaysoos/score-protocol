import { spawn, spawnSync, type ChildProcess } from "node:child_process";

export interface StartedOpenCodeProcess {
  readonly process: ChildProcess;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly close: () => Promise<void>;
}

export function inspectOpenCodeVersion(
  command: string,
  expectedVersion: string,
  timeoutMs = 10_000
): string {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs
  });
  if (result.error) throw result.error;
  const actualVersion = result.stdout.trim();
  const normalizedVersion = actualVersion.startsWith("opencode2 v")
    ? actualVersion.slice("opencode2 v".length)
    : actualVersion;
  if (result.status !== 0 || normalizedVersion !== expectedVersion) {
    throw new Error(
      `OpenCode CLI version mismatch: expected ${expectedVersion}, received ${actualVersion || "no version"}`
    );
  }
  return normalizedVersion;
}

export function assertOpenCodeVersion(command: string, expectedVersion: string): void {
  inspectOpenCodeVersion(command, expectedVersion);
}

export function stopOpenCodeProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let failureTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (forceTimer) clearTimeout(forceTimer);
      if (failureTimer) clearTimeout(failureTimer);
      process.off("exit", onExit);
    };
    const onExit = () => {
      cleanup();
      resolve();
    };
    process.once("exit", onExit);

    if (globalThis.process.platform === "win32" && process.pid) {
      spawnSync("taskkill", ["/pid", String(process.pid), "/T"], { windowsHide: true });
    } else {
      process.kill("SIGTERM");
    }
    forceTimer = setTimeout(() => {
      if (process.exitCode !== null || process.signalCode !== null) return;
      if (globalThis.process.platform === "win32" && process.pid) {
        spawnSync("taskkill", ["/pid", String(process.pid), "/T", "/F"], {
          windowsHide: true
        });
      } else {
        process.kill("SIGKILL");
      }
    }, 2_000);
    failureTimer = setTimeout(() => {
      cleanup();
      reject(new Error("OpenCode server did not exit after forced shutdown"));
    }, 5_000);
  });
}

export function startOpenCodeServer(input: {
  readonly command: string;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly startTimeoutMs: number;
  readonly signal?: AbortSignal;
}): Promise<StartedOpenCodeProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      input.command,
      ["serve", "--hostname=127.0.0.1", "--port=0", "--log-level=error"],
      {
        cwd: input.cwd,
        env: input.environment,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let output = "";
    let serverUrl: string | undefined;
    let serverPassword: string | undefined;
    let settled = false;
    const timeout = setTimeout(
      () => finish(new Error(`Timed out waiting for OpenCode after ${input.startTimeoutMs}ms`)),
      input.startTimeoutMs
    );
    const cleanup = () => {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
      child.off("error", onError);
      child.off("exit", onExit);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      if (!error && (serverUrl === undefined || serverPassword === undefined)) return;
      settled = true;
      cleanup();
      if (error) {
        void stopOpenCodeProcess(child).then(
          () => reject(error),
          (stopError: unknown) =>
            reject(
              new Error(
                `${error.message}; shutdown also failed: ${
                  stopError instanceof Error ? stopError.message : String(stopError)
                }`
              )
            )
        );
      } else if (serverUrl && serverPassword) {
        resolve({
          process: child,
          url: serverUrl,
          headers: {
            authorization: `Basic ${Buffer.from(`opencode:${serverPassword}`, "utf8").toString("base64")}`
          },
          close: () => stopOpenCodeProcess(child)
        });
      }
    };
    const onData = (chunk: Buffer | string) => {
      output = `${output}${chunk.toString()}`.slice(-16_000);
      for (const line of output.split("\n")) {
        const urlMatch = line.match(/server listening on\s+(https?:\/\/[^\s]+)/u);
        if (urlMatch?.[1]) serverUrl = urlMatch[1];
        const passwordMatch = line.match(/server password\s+([^\s]+)/u);
        if (passwordMatch?.[1]) serverPassword = passwordMatch[1];
      }
      finish();
    };
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(
        new Error(
          `OpenCode exited before startup (code ${String(code)}, signal ${String(signal)})${
            output.trim()
              ? `: ${output.replace(/server password\s+[^\s]+/gu, "server password [redacted]").trim()}`
              : ""
          }`
        )
      );
    const onAbort = () => finish(new Error("OpenCode startup was interrupted"));

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", onError);
    child.on("exit", onExit);
    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) onAbort();
  });
}
