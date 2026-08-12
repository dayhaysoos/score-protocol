export type DoctorCheckId =
  | "node"
  | "package"
  | "sqlite"
  | "opencode"
  | "auth"
  | "models"
  | "project";

export type DoctorCheckStatus = "pass" | "warning" | "fail" | "blocked";
export type DoctorActivity =
  | "inspection"
  | "in_memory"
  | "local_process"
  | "sensitive_local_read"
  | "isolated_runtime_network";

export interface DoctorCheck {
  readonly id: DoctorCheckId;
  readonly label: string;
  readonly status: DoctorCheckStatus;
  readonly summary: string;
  readonly activity: DoctorActivity;
  readonly code?: string;
  readonly repair?: string;
  readonly facts?: Readonly<Record<string, string | number | boolean>>;
}

export interface DoctorReport {
  readonly schemaVersion: 1;
  readonly status: "ready" | "ready_with_warnings" | "needs_attention";
  readonly checks: ReadonlyArray<DoctorCheck>;
  readonly safety: {
    readonly projectWrites: false;
    readonly persistentScoreWrites: false;
    readonly modelRequests: 0;
    readonly temporaryRuntimeStarted: boolean;
    readonly networkMayHaveBeenUsed: boolean;
  };
}

export interface DoctorDependencies {
  readonly inspectNode: () => { readonly version: string; readonly supported: boolean };
  readonly inspectPackage: () => {
    readonly version: string;
    readonly resourcesAvailable: boolean;
  };
  readonly inspectSqlite: () => Promise<void>;
  readonly inspectOpenCode: () => { readonly version: string };
  readonly inspectAuthentication: () => {
    readonly status: "configured" | "missing" | "invalid";
    readonly providerCount: number;
  };
  readonly discoverModels: () => Promise<{
    readonly enabledModelCount: number;
    readonly providerCount: number;
  }>;
  readonly inspectProject: () => {
    readonly projectRoot: string;
    readonly stateLocationReady: boolean;
    readonly issue?:
      | "project_not_writable"
      | "state_path_conflict"
      | "state_directory_not_writable"
      | "database_path_conflict"
      | "database_not_accessible";
  };
}

export interface RunDoctorInput {
  readonly projectRoot: string;
}

const labels = {
  node: "Node runtime",
  package: "SCORE package",
  sqlite: "SQLite runtime",
  opencode: "OpenCode runtime",
  auth: "Authentication",
  models: "Model discovery",
  project: "Project"
} as const satisfies Record<DoctorCheckId, string>;

function passed(
  id: DoctorCheckId,
  activity: DoctorActivity,
  summary: string,
  facts?: Readonly<Record<string, string | number | boolean>>
): DoctorCheck {
  return {
    id,
    label: labels[id],
    status: "pass",
    summary,
    activity,
    ...(facts === undefined ? {} : { facts })
  };
}

function failed(
  id: DoctorCheckId,
  activity: DoctorActivity,
  summary: string,
  code: string,
  repair: string
): DoctorCheck {
  return { id, label: labels[id], status: "fail", summary, activity, code, repair };
}

function projectStateFailure(
  issue: NonNullable<ReturnType<DoctorDependencies["inspectProject"]>["issue"]>
): DoctorCheck {
  switch (issue) {
    case "state_path_conflict":
      return failed(
        "project",
        "inspection",
        "The .score state path is not a directory.",
        "PROJECT_STATE_PATH_CONFLICT",
        "Move or remove the .score file, then rerun score doctor."
      );
    case "database_path_conflict":
      return failed(
        "project",
        "inspection",
        "The existing SCORE database path is not a regular file.",
        "PROJECT_DATABASE_PATH_CONFLICT",
        "Move or remove .score/score.db, then rerun score doctor."
      );
    case "database_not_accessible":
      return failed(
        "project",
        "inspection",
        "The existing SCORE database is not readable and writable.",
        "PROJECT_DATABASE_NOT_ACCESSIBLE",
        "Grant the current user read and write access to .score/score.db, then rerun score doctor."
      );
    case "state_directory_not_writable":
      return failed(
        "project",
        "inspection",
        "The .score state directory is not writable.",
        "PROJECT_STATE_DIRECTORY_NOT_WRITABLE",
        "Grant the current user write access to .score, then rerun score doctor."
      );
    case "project_not_writable":
      return failed(
        "project",
        "inspection",
        "The current directory does not permit SCORE state.",
        "PROJECT_DIRECTORY_NOT_WRITABLE",
        "Grant the current user write access or use a writable project copy."
      );
  }
}

/** Inspect SCORE readiness without writing project files, persistent SCORE state, or model prompts. */
export async function runDoctor(
  input: RunDoctorInput,
  dependencies: DoctorDependencies
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  try {
    const node = dependencies.inspectNode();
    checks.push(
      node.supported
        ? passed("node", "inspection", `Node ${node.version} is supported.`, {
            version: node.version
          })
        : failed(
            "node",
            "inspection",
            `Node ${node.version} is not supported.`,
            "NODE_UNSUPPORTED",
            "Install Node >=26.5.0 and <27, reopen the shell, then rerun score doctor."
          )
    );
  } catch {
    checks.push(
      failed(
        "node",
        "inspection",
        "The Node runtime could not be inspected.",
        "NODE_UNAVAILABLE",
        "Install Node >=26.5.0 and <27, reopen the shell, then rerun score doctor."
      )
    );
  }

  try {
    const packageStatus = dependencies.inspectPackage();
    checks.push(
      packageStatus.resourcesAvailable
        ? passed(
            "package",
            "inspection",
            `SCORE ${packageStatus.version} and its packaged resources are available.`,
            { version: packageStatus.version }
          )
        : failed(
            "package",
            "inspection",
            "Required SCORE package resources are missing.",
            "PACKAGE_RESOURCE_MISSING",
            "Reinstall SCORE from a complete package, then rerun score doctor."
          )
    );
  } catch {
    checks.push(
      failed(
        "package",
        "inspection",
        "Required SCORE package resources are missing.",
        "PACKAGE_RESOURCE_MISSING",
        "Reinstall SCORE from a complete package, then rerun score doctor."
      )
    );
  }

  try {
    await dependencies.inspectSqlite();
    checks.push(
      passed("sqlite", "in_memory", "SCORE databases can initialize in memory.")
    );
  } catch {
    checks.push(
      failed(
        "sqlite",
        "in_memory",
        "The SQLite runtime could not initialize SCORE databases in memory.",
        "SQLITE_NATIVE_UNAVAILABLE",
        "Approve and rebuild better-sqlite3 for this SCORE installation, then rerun score doctor."
      )
    );
  }

  let openCodeReady = false;
  try {
    const openCode = dependencies.inspectOpenCode();
    openCodeReady = true;
    checks.push(
      passed("opencode", "local_process", `OpenCode ${openCode.version} is available.`, {
        version: openCode.version
      })
    );
  } catch {
    checks.push(
      failed(
        "opencode",
        "local_process",
        "The pinned OpenCode runtime is unavailable.",
        "OPENCODE_BINARY_UNAVAILABLE",
        "Approve and rebuild @opencode-ai/cli for this SCORE installation, then rerun score doctor."
      )
    );
  }

  try {
    const auth = dependencies.inspectAuthentication();
    if (auth.status === "configured") {
      checks.push(
        passed(
          "auth",
          "sensitive_local_read",
          "OpenCode credential configuration is available.",
          { configuredProviderCount: auth.providerCount }
        )
      );
    } else if (auth.status === "missing") {
      checks.push({
        id: "auth",
        label: labels.auth,
        status: "warning",
        summary: "No OpenCode credential file is configured; models may still be available.",
        activity: "sensitive_local_read",
        code: "OPENCODE_AUTH_NOT_CONFIGURED",
        repair:
          "Configure a provider with opencode2 auth login <provider-url>, then rerun score doctor."
      });
    } else {
      checks.push(
        failed(
          "auth",
          "sensitive_local_read",
          "OpenCode credential configuration is invalid.",
          "OPENCODE_AUTH_INVALID",
          "Repair or replace the OpenCode credential configuration, then rerun score doctor."
        )
      );
    }
  } catch {
    checks.push(
      failed(
        "auth",
        "sensitive_local_read",
        "OpenCode credential configuration is invalid.",
        "OPENCODE_AUTH_INVALID",
        "Repair or replace the OpenCode credential configuration, then rerun score doctor."
      )
    );
  }

  let temporaryRuntimeStarted = false;
  let networkMayHaveBeenUsed = false;
  if (!openCodeReady) {
    checks.push({
      id: "models",
      label: labels.models,
      status: "blocked",
      summary: "Model discovery was skipped because the OpenCode runtime is unavailable.",
      activity: "isolated_runtime_network",
      code: "MODEL_DISCOVERY_BLOCKED",
      repair: "Repair the OpenCode runtime, then rerun score doctor."
    });
  } else {
    temporaryRuntimeStarted = true;
    networkMayHaveBeenUsed = true;
    try {
      const catalog = await dependencies.discoverModels();
      const modelNoun = catalog.enabledModelCount === 1 ? "model" : "models";
      const providerNoun = catalog.providerCount === 1 ? "provider" : "providers";
      const discoveryVerb = catalog.enabledModelCount === 1 ? "was" : "were";
      checks.push(
        catalog.enabledModelCount > 0
          ? passed(
              "models",
              "isolated_runtime_network",
              `${catalog.enabledModelCount} enabled ${modelNoun} from ${catalog.providerCount} ${providerNoun} ${discoveryVerb} discovered.`,
              {
                enabledModelCount: catalog.enabledModelCount,
                providerCount: catalog.providerCount
              }
            )
          : failed(
              "models",
              "isolated_runtime_network",
              "OpenCode did not report any enabled models.",
              "MODEL_DISCOVERY_EMPTY",
              "Confirm OpenCode provider and network configuration, then rerun score doctor."
            )
      );
    } catch {
      checks.push(
        failed(
          "models",
          "isolated_runtime_network",
          "OpenCode model discovery did not complete.",
          "MODEL_DISCOVERY_FAILED",
          "Confirm OpenCode provider and network configuration, then rerun score doctor."
        )
      );
    }
  }

  try {
    const project = dependencies.inspectProject();
    checks.push(
      project.stateLocationReady
        ? passed(
            "project",
            "inspection",
            "The current directory is ready for SCORE state."
          )
        : projectStateFailure(project.issue ?? "project_not_writable")
    );
  } catch {
    checks.push(
      failed(
        "project",
        "inspection",
        "The current project directory is unavailable.",
        "PROJECT_DIRECTORY_UNAVAILABLE",
        "Run score doctor from the project directory SCORE should use."
      )
    );
  }

  const hasNeedsAttention = checks.some(
    ({ status }) => status === "fail" || status === "blocked"
  );
  const status = hasNeedsAttention
    ? "needs_attention"
    : checks.some(({ status: checkStatus }) => checkStatus === "warning")
      ? "ready_with_warnings"
      : "ready";
  return {
    schemaVersion: 1,
    status,
    checks,
    safety: {
      projectWrites: false,
      persistentScoreWrites: false,
      modelRequests: 0,
      temporaryRuntimeStarted,
      networkMayHaveBeenUsed
    }
  };
}

const checkMarkers = {
  pass: "✓",
  warning: "!",
  fail: "✗",
  blocked: "-"
} as const satisfies Record<DoctorCheckStatus, string>;

export function formatDoctorReport(report: DoctorReport): string {
  const width = Math.max(...report.checks.map(({ label }) => label.length));
  const lines = report.checks.flatMap((check) => [
    `${check.label.padEnd(width)}  ${checkMarkers[check.status]} ${check.summary}`,
    ...(check.repair === undefined ? [] : [`${"".padEnd(width)}    Repair: ${check.repair}`])
  ]);
  const conclusion =
    report.status === "ready"
      ? "SCORE is ready."
      : report.status === "ready_with_warnings"
        ? "SCORE is ready with warnings."
        : "SCORE needs attention.";
  const discoveryBoundary = report.safety.temporaryRuntimeStarted
    ? "Model discovery used an isolated temporary OpenCode runtime and may contact provider services."
    : "Model discovery was skipped; no temporary OpenCode runtime was started.";
  return [
    "SCORE doctor",
    "",
    ...lines,
    "",
    conclusion,
    "No model was run. No project files or persistent SCORE state were written.",
    discoveryBoundary,
    ""
  ].join("\n");
}
