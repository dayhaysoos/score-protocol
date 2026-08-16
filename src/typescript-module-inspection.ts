import { createRequire } from "node:module";
import {
  lstatSync,
  readFileSync,
  realpathSync
} from "node:fs";
import { resolve, sep } from "node:path";

import {
  parseSync,
  type ExportNamedDeclaration,
  type Function as OxcFunction,
  type Program
} from "oxc-parser";

import { sha256Bytes } from "./canonical.js";
import { normalizeProjectRelativePath } from "./project-path.js";

const require = createRequire(import.meta.url);
const oxcParserPackage = require("oxc-parser/package.json") as { readonly version: string };
const MAX_TYPESCRIPT_MODULE_BYTES = 1024 * 1024;

export const TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION =
  "score.inspect-module@0.2.0" as const;

export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export interface ModuleInspectionDiagnostic {
  readonly severity: "error" | "warning" | "advice";
  readonly message: string;
  readonly labels: ReadonlyArray<{
    readonly message: string | null;
    readonly range: SourceRange;
  }>;
  readonly help: string | null;
}

export interface ModuleImportSummary {
  readonly source: string;
  readonly importedName: string | null;
  readonly localName: string | null;
  readonly kind: "type" | "value" | "side_effect";
  readonly range: SourceRange;
}

export type ExportNamespace = "type" | "value" | "type_and_value" | "unknown";
export type ModuleReferenceRole =
  | "parameter_type"
  | "return_type"
  | "declaration_type";

const TYPESCRIPT_GLOBAL_TYPES = new Set([
  "Array",
  "ReadonlyArray",
  "Promise",
  "Record",
  "Partial",
  "Required",
  "Readonly",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "NonNullable",
  "Parameters",
  "ConstructorParameters",
  "ReturnType",
  "InstanceType",
  "ThisParameterType",
  "OmitThisParameter",
  "ThisType",
  "Uppercase",
  "Lowercase",
  "Capitalize",
  "Uncapitalize",
  "Awaited",
  "Map",
  "ReadonlyMap",
  "WeakMap",
  "Set",
  "ReadonlySet",
  "WeakSet",
  "Date",
  "RegExp",
  "Error",
  "URL"
]);

export interface ModuleExportSummary {
  readonly name: string;
  readonly declarationKind: string;
  readonly namespace: ExportNamespace;
  readonly contractAvailable: boolean;
  readonly range: SourceRange;
}

export interface ModuleInspectionSuccess {
  readonly schemaVersion: typeof TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION;
  readonly status: "ok";
  readonly mode: "discovery";
  readonly module: {
    readonly path: string;
    readonly contentDigest: string;
    readonly language: "typescript";
    readonly parser: {
      readonly name: "oxc-parser";
      readonly version: string;
    };
  };
  readonly diagnostics: ReadonlyArray<ModuleInspectionDiagnostic>;
  readonly imports: ReadonlyArray<ModuleImportSummary>;
  readonly exports: ReadonlyArray<ModuleExportSummary>;
}

export interface ModuleInspectionContractSuccess {
  readonly schemaVersion: typeof TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION;
  readonly status: "ok";
  readonly mode: "contract";
  readonly module: ModuleInspectionSuccess["module"];
  readonly diagnostics: ReadonlyArray<ModuleInspectionDiagnostic>;
  readonly selectedExport: {
    readonly name: string;
    readonly declarationKind: string;
    readonly namespace: ExportNamespace;
    readonly declaration: string;
    readonly references: ReadonlyArray<{
      readonly name: string;
      readonly roles: ReadonlyArray<ModuleReferenceRole>;
      readonly resolution:
        | {
            readonly kind: "import";
            readonly source: string;
            readonly importedName: string;
            readonly localName: string;
            readonly importKind: "type" | "value";
          }
        | {
            readonly kind: "local_export";
            readonly name: string;
            readonly declarationKind: string;
            readonly namespace: ExportNamespace;
          }
        | { readonly kind: "typescript_global"; readonly name: string }
        | { readonly kind: "unresolved" };
    }>;
    readonly range: SourceRange;
  };
  readonly sliceDraftContext: {
    readonly ownerPath: string;
    readonly ownedDeclarationSeed: {
      readonly name: string;
      readonly declaration: string;
    };
    readonly consumerReference: {
      readonly name: string;
      readonly from: string;
    };
    readonly authorMustSupply: readonly ["ownedDeclaration.description", "consumerPath"];
  };
}

export interface ModuleInspectionInvalid {
  readonly schemaVersion: typeof TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION;
  readonly status: "invalid";
  readonly findings: ReadonlyArray<{
    readonly code: string;
    readonly location: string;
    readonly message: string;
    readonly detail: Readonly<Record<string, unknown>>;
    readonly machineRepairable: boolean;
  }>;
}

export type ModuleInspectionResult =
  | ModuleInspectionSuccess
  | ModuleInspectionContractSuccess
  | ModuleInspectionInvalid;

function invalid(
  code: string,
  path: string,
  message: string,
  detail: Readonly<Record<string, unknown>> = {}
): ModuleInspectionInvalid {
  return {
    schemaVersion: TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION,
    status: "invalid",
    findings: [
      {
        code,
        location: "/path",
        message,
        detail: { path, ...detail },
        machineRepairable: true
      }
    ]
  };
}

function isWithinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function parserLanguage(path: string): "ts" | "tsx" | "dts" | undefined {
  if (/\.d\.(?:cts|mts|ts)$/u.test(path)) return "dts";
  if (/\.tsx$/u.test(path)) return "tsx";
  if (/\.(?:cts|mts|ts)$/u.test(path)) return "ts";
  return undefined;
}

function namespaceForDeclaration(type: string): ExportNamespace {
  switch (type) {
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
      return "type";
    case "ClassDeclaration":
    case "TSEnumDeclaration":
      return "type_and_value";
    case "FunctionDeclaration":
    case "TSDeclareFunction":
    case "VariableDeclaration":
      return "value";
    case "TSModuleDeclaration":
    case "TSImportEqualsDeclaration":
      return "unknown";
    default:
      return "unknown";
  }
}

function declarationKind(type: string, variableKind?: string): string {
  switch (type) {
    case "TSInterfaceDeclaration":
      return "interface";
    case "TSTypeAliasDeclaration":
      return "type";
    case "ClassDeclaration":
      return "class";
    case "TSEnumDeclaration":
      return "enum";
    case "FunctionDeclaration":
    case "TSDeclareFunction":
      return "function";
    case "VariableDeclaration":
      return variableKind ?? "variable";
    case "TSModuleDeclaration":
      return "namespace";
    case "TSImportEqualsDeclaration":
      return "import-equals";
    default:
      return type;
  }
}

function hasExplicitFunctionContract(declaration: OxcFunction): boolean {
  if (declaration.returnType == null) return false;
  return declaration.params.every((parameter) => {
    const candidate =
      parameter.type === "TSParameterProperty" ? parameter.parameter : parameter;
    if (candidate.type === "AssignmentPattern") return false;
    if (candidate.type === "RestElement") {
      return candidate.typeAnnotation != null || candidate.argument.typeAnnotation != null;
    }
    return candidate.typeAnnotation != null;
  });
}

function directExportSummaries(node: ExportNamedDeclaration): ModuleExportSummary[] {
  const declaration = node.declaration;
  if (declaration === null) {
    return node.specifiers.map((specifier) => ({
      name: specifier.exported.type === "Identifier" ? specifier.exported.name : specifier.exported.value,
      declarationKind: node.source === null ? "export" : "re-export",
      namespace:
        specifier.exportKind === "type" || node.exportKind === "type" ? "type" : "unknown",
      contractAvailable: false,
      range: { start: node.start, end: node.end }
    }));
  }

  if (declaration.type === "VariableDeclaration") {
    return declaration.declarations.flatMap((item) => {
      if (item.id.type !== "Identifier") return [];
      return [
        {
          name: item.id.name,
          declarationKind: declarationKind(declaration.type, declaration.kind),
          namespace: namespaceForDeclaration(declaration.type),
          contractAvailable:
            declaration.declarations.length === 1 && item.id.typeAnnotation != null,
          range: { start: node.start, end: node.end }
        }
      ];
    });
  }

  if (declaration.type === "TSModuleDeclaration") {
    const name =
      declaration.id.type === "Identifier"
        ? declaration.id.name
        : declaration.id.type === "Literal"
          ? declaration.id.value
          : undefined;
    return name === undefined
      ? []
      : [
          {
            name,
            declarationKind: declarationKind(declaration.type),
            namespace: namespaceForDeclaration(declaration.type),
            contractAvailable: false,
            range: { start: node.start, end: node.end }
          }
        ];
  }

  if (declaration.type === "TSImportEqualsDeclaration") {
    return [
      {
        name: declaration.id.name,
        declarationKind: declarationKind(declaration.type),
        namespace: namespaceForDeclaration(declaration.type),
        contractAvailable: false,
        range: { start: node.start, end: node.end }
      }
    ];
  }

  if (
    declaration.type !== "FunctionDeclaration" &&
    declaration.type !== "TSDeclareFunction" &&
    declaration.type !== "ClassDeclaration" &&
    declaration.type !== "TSInterfaceDeclaration" &&
    declaration.type !== "TSTypeAliasDeclaration" &&
    declaration.type !== "TSEnumDeclaration"
  ) {
    return [];
  }
  if (declaration.id === null) return [];
  return [
    {
      name: declaration.id.name,
      declarationKind: declarationKind(declaration.type),
      namespace: namespaceForDeclaration(declaration.type),
      contractAvailable:
        declaration.type === "FunctionDeclaration" || declaration.type === "TSDeclareFunction"
          ? hasExplicitFunctionContract(declaration)
          : declaration.type !== "ClassDeclaration" && declaration.type !== "TSEnumDeclaration",
      range: { start: node.start, end: node.end }
    }
  ];
}

function exportSummaries(program: Program): ModuleExportSummary[] {
  return program.body.flatMap((node): ModuleExportSummary[] => {
    if (node.type === "ExportNamedDeclaration") return directExportSummaries(node);
    if (node.type === "ExportAllDeclaration") {
      return [
        {
          name:
            node.exported === null
              ? "*"
              : node.exported.type === "Identifier"
                ? node.exported.name
                : node.exported.value,
          declarationKind: "export-all",
          namespace: node.exportKind === "type" ? "type" : "unknown",
          contractAvailable: false,
          range: { start: node.start, end: node.end }
        }
      ];
    }
    if (node.type === "ExportDefaultDeclaration") {
      return [
        {
          name: "default",
          declarationKind: declarationKind(node.declaration.type),
          namespace: namespaceForDeclaration(node.declaration.type),
          contractAvailable: false,
          range: { start: node.start, end: node.end }
        }
      ];
    }
    if (node.type === "TSExportAssignment") {
      return [
        {
          name: "export=",
          declarationKind: "export-assignment",
          namespace: "unknown",
          contractAvailable: false,
          range: { start: node.start, end: node.end }
        }
      ];
    }
    if (node.type === "TSNamespaceExportDeclaration") {
      return [
        {
          name: node.id.name,
          declarationKind: "namespace-export",
          namespace: "unknown",
          contractAvailable: false,
          range: { start: node.start, end: node.end }
        }
      ];
    }
    return [];
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function rootEntityName(value: unknown): string | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  if (record.type === "Identifier" && typeof record.name === "string") {
    return record.name;
  }
  if (record.type === "TSQualifiedName") return rootEntityName(record.left);
  return undefined;
}

function topLevelTypeParameterNames(value: unknown): ReadonlyArray<string> {
  const record = asRecord(value);
  const typeParameters = asRecord(record?.typeParameters);
  if (!Array.isArray(typeParameters?.params)) return [];
  return typeParameters.params.flatMap((parameter) => {
    const name = rootEntityName(asRecord(parameter)?.name);
    return name === undefined ? [] : [name];
  });
}

function localTopLevelDeclarationNames(program: Program): ReadonlySet<string> {
  const names = new Set<string>();
  for (const node of program.body) {
    if (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
      continue;
    }
    if (node.type === "VariableDeclaration") {
      for (const declaration of node.declarations) {
        if (declaration.id.type === "Identifier") names.add(declaration.id.name);
      }
      continue;
    }
    const id = asRecord(asRecord(node)?.id);
    if (id?.type === "Identifier" && typeof id.name === "string") names.add(id.name);
  }
  return names;
}

function collectTypeReferenceNames(
  value: unknown,
  names: string[],
  unsupportedInlineImports: string[],
  boundTypeParameters: ReadonlySet<string> = new Set()
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTypeReferenceNames(
        item,
        names,
        unsupportedInlineImports,
        boundTypeParameters
      );
    }
    return;
  }
  const record = asRecord(value);
  if (record === undefined) return;
  const locallyBoundTypeParameters = topLevelTypeParameterNames(record);
  const visibleTypeParameters =
    locallyBoundTypeParameters.length === 0
      ? boundTypeParameters
      : new Set([...boundTypeParameters, ...locallyBoundTypeParameters]);
  if (record.type === "TSImportType") {
    const source = asRecord(record.source)?.value;
    const label = typeof source === "string" ? source : "unknown";
    if (!unsupportedInlineImports.includes(label)) unsupportedInlineImports.push(label);
    return;
  }
  const entity =
    record.type === "TSTypeReference"
      ? record.typeName
      : record.type === "TSExpressionWithTypeArguments"
        ? record.expression
        : record.type === "TSInterfaceHeritage"
          ? record.expression
        : record.type === "TSTypeQuery"
          ? record.exprName
          : undefined;
  const entityName = rootEntityName(entity);
  if (
    entityName !== undefined &&
    !visibleTypeParameters.has(entityName) &&
    !names.includes(entityName)
  ) {
    names.push(entityName);
  }
  for (const [key, child] of Object.entries(record)) {
    if (
      key === "parent" ||
      key === "range" ||
      key === "start" ||
      key === "end" ||
      key === "typeName" ||
      key === "expression" ||
      key === "exprName"
    ) {
      continue;
    }
    collectTypeReferenceNames(
      child,
      names,
      unsupportedInlineImports,
      visibleTypeParameters
    );
  }
}

function parameterTypeAnnotation(parameter: unknown): unknown {
  const record = asRecord(parameter);
  if (record === undefined) return undefined;
  if (record.type === "TSParameterProperty") {
    return parameterTypeAnnotation(record.parameter);
  }
  if (record.typeAnnotation !== undefined && record.typeAnnotation !== null) {
    return record.typeAnnotation;
  }
  const argument = asRecord(record.argument);
  return argument?.typeAnnotation;
}

function selectedFunctionContract(
  node: ExportNamedDeclaration,
  sourceText: string
): {
  readonly declaration: string;
  readonly references: ReadonlyArray<{
    readonly name: string;
    readonly roles: ReadonlyArray<ModuleReferenceRole>;
  }>;
  readonly unsupportedInlineImports: ReadonlyArray<string>;
} | undefined {
  const declaration = node.declaration;
  if (
    declaration?.type !== "FunctionDeclaration" &&
    declaration?.type !== "TSDeclareFunction"
  ) {
    return undefined;
  }
  const signatureEnd = declaration.body?.start ?? node.end;
  const signature = sourceText.slice(node.start, signatureEnd).trimEnd();
  const roles = new Map<string, ModuleReferenceRole[]>();
  const unsupportedInlineImports: string[] = [];
  for (const parameter of declaration.params) {
    const names: string[] = [];
    collectTypeReferenceNames(
      parameterTypeAnnotation(parameter),
      names,
      unsupportedInlineImports
    );
    for (const name of names) {
      const current = roles.get(name) ?? [];
      if (!current.includes("parameter_type")) current.push("parameter_type");
      roles.set(name, current);
    }
  }
  const returnNames: string[] = [];
  collectTypeReferenceNames(
    declaration.returnType,
    returnNames,
    unsupportedInlineImports
  );
  for (const name of returnNames) {
    const current = roles.get(name) ?? [];
    if (!current.includes("return_type")) current.push("return_type");
    roles.set(name, current);
  }
  for (const name of topLevelTypeParameterNames(declaration)) roles.delete(name);
  return {
    declaration: signature.endsWith(";") ? signature : `${signature};`,
    references: [...roles].map(([name, referenceRoles]) => ({
      name,
      roles: referenceRoles
    })),
    unsupportedInlineImports
  };
}

function selectedDeclarationContract(
  program: Program,
  sourceText: string,
  exportName: string
): {
  readonly summary: ModuleExportSummary;
  readonly declaration: string;
  readonly references: ReadonlyArray<{
    readonly name: string;
    readonly roles: ReadonlyArray<ModuleReferenceRole>;
  }>;
  readonly unsupportedInlineImports: ReadonlyArray<string>;
} | undefined {
  for (const statement of program.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const summaries = directExportSummaries(statement);
    const summary = summaries.find((item) => item.name === exportName);
    if (summary === undefined || !summary.contractAvailable) continue;
    const functionContract = selectedFunctionContract(statement, sourceText);
    if (functionContract !== undefined) {
      return { summary, ...functionContract };
    }
    if (
      statement.declaration?.type === "TSInterfaceDeclaration" ||
      statement.declaration?.type === "TSTypeAliasDeclaration"
    ) {
      const names: string[] = [];
      const unsupportedInlineImports: string[] = [];
      if (statement.declaration.type === "TSInterfaceDeclaration") {
        collectTypeReferenceNames(
          statement.declaration.extends,
          names,
          unsupportedInlineImports
        );
        collectTypeReferenceNames(
          statement.declaration.body,
          names,
          unsupportedInlineImports
        );
      } else {
        collectTypeReferenceNames(
          statement.declaration.typeAnnotation,
          names,
          unsupportedInlineImports
        );
      }
      const typeParameters = new Set(
        topLevelTypeParameterNames(statement.declaration)
      );
      return {
        summary,
        declaration: sourceText.slice(statement.start, statement.end),
        references: names
          .filter((name) => !typeParameters.has(name))
          .map((name) => ({ name, roles: ["declaration_type"] })),
        unsupportedInlineImports
      };
    }
    if (statement.declaration?.type === "VariableDeclaration") {
      const declarator = statement.declaration.declarations.find(
        (item) => item.id.type === "Identifier" && item.id.name === exportName
      );
      if (declarator?.id.type === "Identifier" && declarator.id.typeAnnotation != null) {
        const names: string[] = [];
        const unsupportedInlineImports: string[] = [];
        collectTypeReferenceNames(
          declarator.id.typeAnnotation,
          names,
          unsupportedInlineImports
        );
        return {
          summary,
          declaration: `${sourceText.slice(statement.start, declarator.id.typeAnnotation.end)};`,
          references: names.map((name) => ({ name, roles: ["declaration_type"] })),
          unsupportedInlineImports
        };
      }
    }
  }
  return undefined;
}

export function inspectTypeScriptModule(input: {
  readonly projectRoot: string;
  readonly path: string;
  readonly exportName?: string;
}): ModuleInspectionResult {
  const normalizedPath = normalizeProjectRelativePath(input.path);
  if (normalizedPath === undefined) {
    return invalid(
      "MODULE_PATH_INVALID",
      input.path,
      "Module path must be one normalized project-relative path"
    );
  }
  const language = parserLanguage(normalizedPath);
  if (language === undefined) {
    return invalid(
      "MODULE_LANGUAGE_UNSUPPORTED",
      normalizedPath,
      "inspect-module supports .ts, .tsx, .mts, .cts, and declaration files"
    );
  }

  let projectRoot: string;
  let bytes: Buffer;
  try {
    projectRoot = realpathSync(resolve(input.projectRoot));
    const absolutePath = resolve(projectRoot, normalizedPath);
    const status = lstatSync(absolutePath);
    if (!status.isFile() || status.isSymbolicLink()) {
      return invalid(
        "MODULE_FILE_NOT_REGULAR",
        normalizedPath,
        "Module must be one regular file and not a symbolic link"
      );
    }
    if (status.size > MAX_TYPESCRIPT_MODULE_BYTES) {
      return invalid(
        "MODULE_SOURCE_TOO_LARGE",
        normalizedPath,
        "Module exceeds the bounded source size for inspection",
        { maxBytes: MAX_TYPESCRIPT_MODULE_BYTES, actualBytes: status.size }
      );
    }
    const realPath = realpathSync(absolutePath);
    if (!isWithinRoot(projectRoot, realPath) || realPath !== absolutePath) {
      return invalid(
        "MODULE_PATH_ESCAPE",
        normalizedPath,
        "Module path must not traverse a symbolic link or leave the project root"
      );
    }
    bytes = readFileSync(realPath);
  } catch {
    return invalid(
      "MODULE_FILE_UNREADABLE",
      normalizedPath,
      "Module file could not be read"
    );
  }

  if (bytes.length > MAX_TYPESCRIPT_MODULE_BYTES) {
    return invalid(
      "MODULE_SOURCE_TOO_LARGE",
      normalizedPath,
      "Module exceeds the bounded source size for inspection",
      { maxBytes: MAX_TYPESCRIPT_MODULE_BYTES, actualBytes: bytes.length }
    );
  }
  const sourceText = bytes.toString("utf8");
  if (!Buffer.from(sourceText, "utf8").equals(bytes)) {
    return invalid(
      "MODULE_ENCODING_UNSUPPORTED",
      normalizedPath,
      "Module must contain exact round-trippable UTF-8 bytes"
    );
  }

  const parsed = parseSync(normalizedPath, sourceText, {
    lang: language,
    sourceType: "module",
    astType: "ts",
    range: true,
    preserveParens: true,
    showSemanticErrors: true
  });
  const diagnostics: ModuleInspectionDiagnostic[] = parsed.errors.map((error) => ({
    severity: error.severity.toLowerCase() as ModuleInspectionDiagnostic["severity"],
    message: error.message,
    labels: error.labels.map((label) => ({
      message: label.message,
      range: { start: label.start, end: label.end }
    })),
    help: error.helpMessage
  }));

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      schemaVersion: TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION,
      status: "invalid",
      findings: diagnostics.map((diagnostic) => ({
        code: "MODULE_PARSE_ERROR",
        location: "/source",
        message: diagnostic.message,
        detail: { labels: diagnostic.labels, help: diagnostic.help },
        machineRepairable: true
      }))
    };
  }

  const module = {
    path: normalizedPath,
    contentDigest: sha256Bytes(bytes),
    language: "typescript" as const,
    parser: { name: "oxc-parser" as const, version: oxcParserPackage.version }
  };
  const imports: ModuleImportSummary[] = parsed.module.staticImports.flatMap(
    (statement): ModuleImportSummary[] =>
      statement.entries.length === 0
        ? [
            {
              source: statement.moduleRequest.value,
              importedName: null,
              localName: null,
              kind: "side_effect" as const,
              range: { start: statement.start, end: statement.end }
            }
          ]
        : statement.entries.map((entry) => ({
            source: statement.moduleRequest.value,
            importedName:
              entry.importName.kind === "Default"
                ? "default"
                : entry.importName.kind === "NamespaceObject"
                  ? "*"
                  : entry.importName.name ?? "",
            localName: entry.localName.value,
            kind: entry.isType ? ("type" as const) : ("value" as const),
            range: { start: statement.start, end: statement.end }
          }))
  );
  const exports = exportSummaries(parsed.program);
  const localDeclarationNames = localTopLevelDeclarationNames(parsed.program);

  if (input.exportName !== undefined) {
    const matchingExports = exports.filter((item) => item.name === input.exportName);
    if (matchingExports.length === 0) {
      return {
        schemaVersion: TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION,
        status: "invalid",
        findings: [
          {
            code: "MODULE_EXPORT_NOT_FOUND",
            location: "/export",
            message: `No export named ${input.exportName} was found`,
            detail: { path: normalizedPath, exportName: input.exportName },
            machineRepairable: true
          }
        ]
      };
    }
    if (matchingExports.length > 1) {
      return {
        schemaVersion: TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION,
        status: "invalid",
        findings: [
          {
            code: "MODULE_EXPORT_AMBIGUOUS",
            location: "/export",
            message: `Export ${input.exportName} has multiple declarations and cannot be selected exactly`,
            detail: {
              path: normalizedPath,
              exportName: input.exportName,
              declarationCount: matchingExports.length
            },
            machineRepairable: true
          }
        ]
      };
    }
    const selected = selectedDeclarationContract(parsed.program, sourceText, input.exportName);
    if (selected === undefined) {
      return {
        schemaVersion: TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION,
        status: "invalid",
        findings: [
          {
            code: "MODULE_EXPORT_CONTRACT_UNAVAILABLE",
            location: "/export",
            message: `No supported direct exported declaration named ${input.exportName} was found`,
            detail: { path: normalizedPath, exportName: input.exportName },
            machineRepairable: true
          }
        ]
      };
    }
    const references = selected.references.map((reference) => {
      const imported = imports.find(
        (item) =>
          item.localName === reference.name &&
          item.importedName !== null &&
          item.kind !== "side_effect"
      );
      if (
        imported !== undefined &&
        imported.importedName !== null &&
        imported.localName !== null &&
        imported.kind !== "side_effect"
      ) {
        return {
          ...reference,
          resolution: {
            kind: "import" as const,
            source: imported.source,
            importedName: imported.importedName,
            localName: imported.localName,
            importKind: imported.kind
          }
        };
      }
      const localMatches = exports.filter((item) => item.name === reference.name);
      return {
        ...reference,
        resolution:
          localMatches.length !== 1
            ? !localDeclarationNames.has(reference.name) &&
              TYPESCRIPT_GLOBAL_TYPES.has(reference.name)
              ? ({ kind: "typescript_global" as const, name: reference.name } as const)
              : ({ kind: "unresolved" } as const)
            : ({
                kind: "local_export" as const,
                name: localMatches[0]!.name,
                declarationKind: localMatches[0]!.declarationKind,
                namespace: localMatches[0]!.namespace
              } as const)
      };
    });
    const unresolvedReferences = references
      .filter((reference) => reference.resolution.kind === "unresolved")
      .map((reference) => reference.name);
    if (
      unresolvedReferences.length > 0 ||
      selected.unsupportedInlineImports.length > 0
    ) {
      return {
        schemaVersion: TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION,
        status: "invalid",
        findings: [
          {
            code: "MODULE_REFERENCE_ROUTING_UNAVAILABLE",
            location: "/export",
            message: `Export ${input.exportName} has type references whose module routing cannot be proven`,
            detail: {
              path: normalizedPath,
              exportName: input.exportName,
              unresolvedReferences,
              inlineImportSources: selected.unsupportedInlineImports
            },
            machineRepairable: true
          }
        ]
      };
    }
    return {
      schemaVersion: TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION,
      status: "ok",
      mode: "contract",
      module,
      diagnostics,
      selectedExport: {
        name: selected.summary.name,
        declarationKind: selected.summary.declarationKind,
        namespace: selected.summary.namespace,
        declaration: selected.declaration,
        references,
        range: selected.summary.range
      },
      sliceDraftContext: {
        ownerPath: normalizedPath,
        ownedDeclarationSeed: {
          name: selected.summary.name,
          declaration: selected.declaration
        },
        consumerReference: {
          name: selected.summary.name,
          from: normalizedPath
        },
        authorMustSupply: ["ownedDeclaration.description", "consumerPath"]
      }
    };
  }

  return {
    schemaVersion: TYPESCRIPT_MODULE_INSPECTION_SCHEMA_VERSION,
    status: "ok",
    mode: "discovery",
    module,
    diagnostics,
    imports,
    exports
  };
}
