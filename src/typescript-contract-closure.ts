import { lstatSync } from "node:fs";
import { posix, resolve } from "node:path";

import { normalizeProjectRelativePath } from "./project-path.js";
import {
  inspectTypeScriptModule,
  TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION,
  type ModuleInspectionContractSuccess,
  type ModuleInspectionInvalid
} from "./typescript-module-inspection.js";

const MAX_CLOSURE_CONTRACTS = 64;
const MAX_CLOSURE_DECLARATION_BYTES = 256 * 1024;

export interface TypeScriptContractClosureSuccess {
  readonly schemaVersion: typeof TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION;
  readonly status: "ok";
  readonly mode: "closure";
  readonly root: {
    readonly path: string;
    readonly exportName: string;
  };
  readonly contracts: ReadonlyArray<{
    readonly module: ModuleInspectionContractSuccess["module"];
    readonly selectedExport: ModuleInspectionContractSuccess["selectedExport"];
  }>;
  readonly sliceDraftContext: {
    readonly rootDeclaration: {
      readonly ownerPath: string;
      readonly name: string;
      readonly declaration: string;
    };
    readonly supportingDeclarations: ReadonlyArray<{
      readonly ownerPath: string;
      readonly name: string;
      readonly declaration: string;
    }>;
    readonly authorMustSupply: readonly [
      "declarations[].description",
      "consumerPath",
      "exactImportAndUsage",
      "callerObservableBehavior"
    ];
  };
}

export type TypeScriptContractClosureResult =
  | TypeScriptContractClosureSuccess
  | ModuleInspectionInvalid;

function invalidClosure(
  code: string,
  message: string,
  detail: Readonly<Record<string, unknown>>
): ModuleInspectionInvalid {
  return {
    schemaVersion: TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION,
    status: "invalid",
    findings: [
      {
        code,
        location: "/closure",
        message,
        detail,
        machineRepairable: true
      }
    ]
  };
}

type ModuleResolution =
  | { readonly status: "ok"; readonly path: string }
  | { readonly status: "invalid"; readonly result: ModuleInspectionInvalid };

function sourceCandidates(ownerPath: string, source: string): ReadonlyArray<string> | undefined {
  if ((!source.startsWith("./") && !source.startsWith("../")) || /[?#]/u.test(source)) {
    return undefined;
  }
  const joined = posix.normalize(posix.join(posix.dirname(ownerPath), source));
  const base = normalizeProjectRelativePath(joined);
  if (base === undefined) return undefined;
  if (/\.d\.(?:cts|mts|ts)$/u.test(base) || /\.(?:cts|mts|ts|tsx)$/u.test(base)) {
    return [base];
  }
  if (base.endsWith(".js")) {
    const stem = base.slice(0, -3);
    return [`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`];
  }
  if (base.endsWith(".mjs")) {
    const stem = base.slice(0, -4);
    return [`${stem}.mts`, `${stem}.d.mts`];
  }
  if (base.endsWith(".cjs")) {
    const stem = base.slice(0, -4);
    return [`${stem}.cts`, `${stem}.d.cts`];
  }
  if (posix.extname(base) !== "") return undefined;
  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}.d.ts`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.mts`,
    `${base}/index.cts`,
    `${base}/index.d.ts`
  ];
}

function resolveRelativeTypeScriptModule(input: {
  readonly projectRoot: string;
  readonly ownerPath: string;
  readonly source: string;
  readonly referenceName: string;
}): ModuleResolution {
  const candidates = sourceCandidates(input.ownerPath, input.source);
  if (candidates === undefined) {
    return {
      status: "invalid",
      result: invalidClosure(
        "MODULE_CLOSURE_SPECIFIER_UNSUPPORTED",
        `Reference ${input.referenceName} uses a module specifier that cannot be resolved without project configuration`,
        {
          ownerPath: input.ownerPath,
          source: input.source,
          referenceName: input.referenceName
        }
      )
    };
  }

  const present: string[] = [];
  try {
    for (const candidate of candidates) {
      const status = lstatSync(resolve(input.projectRoot, candidate), {
        throwIfNoEntry: false
      });
      if (status !== undefined) present.push(candidate);
    }
  } catch {
    return {
      status: "invalid",
      result: invalidClosure(
        "MODULE_CLOSURE_MODULE_UNREADABLE",
        `Reference ${input.referenceName} could not be resolved safely`,
        {
          ownerPath: input.ownerPath,
          source: input.source,
          referenceName: input.referenceName
        }
      )
    };
  }

  if (present.length === 0) {
    return {
      status: "invalid",
      result: invalidClosure(
        "MODULE_CLOSURE_MODULE_NOT_FOUND",
        `Reference ${input.referenceName} does not resolve to a TypeScript module`,
        {
          ownerPath: input.ownerPath,
          source: input.source,
          referenceName: input.referenceName,
          candidates
        }
      )
    };
  }
  if (present.length > 1) {
    return {
      status: "invalid",
      result: invalidClosure(
        "MODULE_CLOSURE_MODULE_AMBIGUOUS",
        `Reference ${input.referenceName} resolves to more than one TypeScript module`,
        {
          ownerPath: input.ownerPath,
          source: input.source,
          referenceName: input.referenceName,
          candidates: present
        }
      )
    };
  }
  return { status: "ok", path: present[0]! };
}

export function inspectTypeScriptContractClosure(input: {
  readonly projectRoot: string;
  readonly path: string;
  readonly exportName: string;
}): TypeScriptContractClosureResult {
  const contracts: Array<TypeScriptContractClosureSuccess["contracts"][number]> = [];
  const visited = new Set<string>();
  let declarationBytes = 0;

  const visit = (
    path: string,
    exportName: string,
    requestedBy?: {
      readonly ownerPath: string;
      readonly ownerExport: string;
      readonly referenceName: string;
    }
  ): ModuleInspectionInvalid | undefined => {
    const key = `${path}\0${exportName}`;
    if (visited.has(key)) return undefined;
    if (contracts.length >= MAX_CLOSURE_CONTRACTS) {
      return invalidClosure(
        "MODULE_CLOSURE_LIMIT_EXCEEDED",
        "Declaration closure exceeds the bounded Agent-context contract count",
        {
          maxContracts: MAX_CLOSURE_CONTRACTS,
          targetPath: path,
          targetExport: exportName
        }
      );
    }

    const inspected = inspectTypeScriptModule({
      projectRoot: input.projectRoot,
      path,
      exportName
    });
    if (inspected.status === "invalid") {
      if (requestedBy === undefined) return inspected;
      return invalidClosure(
        "MODULE_CLOSURE_REFERENCE_UNAVAILABLE",
        `Reference ${requestedBy.referenceName} does not have a usable exported contract`,
        {
          ownerPath: requestedBy.ownerPath,
          ownerExport: requestedBy.ownerExport,
          referenceName: requestedBy.referenceName,
          targetPath: path,
          targetExport: exportName,
          findingCodes: inspected.findings.map((finding) => finding.code)
        }
      );
    }
    if (inspected.mode !== "contract") {
      return invalidClosure(
        "MODULE_CLOSURE_REFERENCE_UNAVAILABLE",
        `Export ${exportName} did not produce a selectable contract`,
        { targetPath: path, targetExport: exportName }
      );
    }
    const nextDeclarationBytes = Buffer.byteLength(
      inspected.selectedExport.declaration,
      "utf8"
    );
    if (declarationBytes + nextDeclarationBytes > MAX_CLOSURE_DECLARATION_BYTES) {
      return invalidClosure(
        "MODULE_CLOSURE_LIMIT_EXCEEDED",
        "Declaration closure exceeds the bounded Agent-context byte count",
        {
          maxDeclarationBytes: MAX_CLOSURE_DECLARATION_BYTES,
          targetPath: path,
          targetExport: exportName
        }
      );
    }

    visited.add(key);
    declarationBytes += nextDeclarationBytes;
    contracts.push({
      module: inspected.module,
      selectedExport: inspected.selectedExport
    });

    for (const reference of inspected.selectedExport.references) {
      if (reference.resolution.kind === "unresolved") {
        return invalidClosure(
          "MODULE_CLOSURE_REFERENCE_UNAVAILABLE",
          `Reference ${reference.name} does not have provable module routing`,
          {
            ownerPath: path,
            ownerExport: exportName,
            referenceName: reference.name
          }
        );
      }
      if (reference.resolution.kind === "local_export") {
        const failure = visit(path, reference.resolution.name, {
          ownerPath: path,
          ownerExport: exportName,
          referenceName: reference.name
        });
        if (failure !== undefined) return failure;
        continue;
      }
      if (reference.resolution.kind === "typescript_global") continue;

      const resolved = resolveRelativeTypeScriptModule({
        projectRoot: input.projectRoot,
        ownerPath: path,
        source: reference.resolution.source,
        referenceName: reference.name
      });
      if (resolved.status === "invalid") return resolved.result;
      const failure = visit(resolved.path, reference.resolution.importedName, {
        ownerPath: path,
        ownerExport: exportName,
        referenceName: reference.name
      });
      if (failure !== undefined) return failure;
    }
    return undefined;
  };

  const failure = visit(input.path, input.exportName);
  if (failure !== undefined) return failure;
  const root = contracts[0]!;
  const declarations = contracts.map((contract) => ({
    ownerPath: contract.module.path,
    name: contract.selectedExport.name,
    declaration: contract.selectedExport.declaration
  }));
  return {
    schemaVersion: TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION,
    status: "ok",
    mode: "closure",
    root: { path: root.module.path, exportName: root.selectedExport.name },
    contracts,
    sliceDraftContext: {
      rootDeclaration: declarations[0]!,
      supportingDeclarations: declarations.slice(1),
      authorMustSupply: [
        "declarations[].description",
        "consumerPath",
        "exactImportAndUsage",
        "callerObservableBehavior"
      ]
    }
  };
}
