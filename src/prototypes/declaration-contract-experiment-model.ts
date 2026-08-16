/**
 * PROTOTYPE — disposable declaration-contract experiment.
 *
 * Question: can frozen source bytes, approved declaration intent, and candidate
 * bytes produce a deterministic, explainable declaration-conformance verdict
 * without constructing a TypeScript project or touching the repository?
 */

import { posix } from "node:path";

import { parseSync } from "oxc-parser";

import { canonicalJson, sha256Bytes, sha256Json } from "../canonical.js";

const SCHEMA_VERSION = "score.declaration-contract-experiment@0.1.0" as const;
const NORMALIZER_VERSION = "score.declaration-shape@0.1.0-experiment" as const;
const MAX_SOURCE_FILES = 256;
const MAX_TOTAL_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_SINGLE_SOURCE_BYTES = 512 * 1024;

const TYPESCRIPT_GLOBALS = new Set([
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
  "ReturnType",
  "Awaited",
  "Map",
  "ReadonlyMap",
  "Set",
  "ReadonlySet",
  "Date",
  "RegExp",
  "Error",
  "URL",
  "NodeJS",
  "const"
]);

type Namespace = "type" | "value";
type Visibility = "exported" | "local_supporting";

export interface ExperimentOwnedDeclaration {
  readonly name: string;
  readonly declaration: string;
}

export interface ExperimentConsumedDeclaration {
  readonly name: string;
  readonly ownerPath: string;
  readonly source: string;
  readonly importedName?: string;
  readonly localName?: string;
  readonly importKind: "type" | "value";
}

export interface ExperimentAgentBrief {
  readonly targetPath: string;
  readonly operation: "create" | "replace";
  readonly owned: ReadonlyArray<ExperimentOwnedDeclaration>;
  readonly consumed: ReadonlyArray<ExperimentConsumedDeclaration>;
  readonly contextPaths?: ReadonlyArray<string>;
}

export interface DeclarationContractExperimentInput {
  readonly sourceFiles: Readonly<Record<string, string>>;
  readonly candidateFiles: Readonly<Record<string, string>>;
  readonly agentBriefs: ReadonlyArray<ExperimentAgentBrief>;
  readonly externalDependencies?: Readonly<
    Record<string, { readonly version: string; readonly lockDigest: string }>
  >;
}

export interface ExperimentFinding {
  readonly code: string;
  readonly path: string;
  readonly declaration: string | null;
  readonly message: string;
}

export interface ExperimentContract {
  readonly path: string;
  readonly name: string;
  readonly namespace: Namespace;
  readonly visibility: Visibility;
  readonly declaration: string;
  readonly normalizedShape: unknown;
  readonly shapeDigest: string;
  readonly references: ReadonlyArray<{
    readonly name: string;
    readonly namespace: Namespace;
    readonly resolution:
      | { readonly kind: "local"; readonly path: string; readonly name: string }
      | {
          readonly kind: "project_import";
          readonly path: string;
          readonly source: string;
          readonly importedName: string;
        }
      | {
          readonly kind: "external";
          readonly source: string;
          readonly importedName: string;
        }
      | {
          readonly kind: "platform";
          readonly source: string;
          readonly importedName: string;
        }
      | { readonly kind: "typescript_global" };
  }>;
}

export interface DeclarationEvidenceExperimentResult {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly status: "ok" | "invalid";
  readonly parser: { readonly name: "oxc-parser"; readonly version: "0.144.0" };
  readonly normalizerVersion: typeof NORMALIZER_VERSION;
  readonly contracts: ReadonlyArray<ExperimentContract>;
  readonly externalReferences: ReadonlyArray<{
    readonly ownerPath: string;
    readonly packageName: string;
    readonly source: string;
    readonly importedName: string;
    readonly localName: string;
    readonly importKind: "type" | "value";
    readonly version: string;
    readonly lockDigest: string;
  }>;
  readonly platformReferences: ReadonlyArray<{
    readonly ownerPath: string;
    readonly source: string;
    readonly importedName: string;
    readonly localName: string;
    readonly importKind: "type" | "value";
  }>;
  readonly findings: ReadonlyArray<ExperimentFinding>;
  readonly evidenceDigest: string | null;
}

export interface DeclarationContractExperimentResult {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly status: "ok" | "invalid";
  readonly evidenceDigest: string | null;
  readonly candidateSetDigest: string;
  readonly verdictDigest: string;
  readonly contracts: ReadonlyArray<ExperimentContract>;
  readonly findings: ReadonlyArray<ExperimentFinding>;
}

interface ImportRoute {
  readonly source: string;
  readonly importedName: string;
  readonly localName: string;
  readonly importKind: "type" | "value";
}

interface ReferenceName {
  readonly name: string;
  readonly namespace: Namespace;
}

interface DeclarationEntry {
  readonly key: string;
  readonly name: string;
  readonly namespace: Namespace;
  readonly visibility: "exported" | "local";
  readonly declaration: string;
  readonly shape: unknown;
  readonly shapeJson: string;
  readonly shapeDigest: string;
  readonly node: Readonly<Record<string, unknown>>;
  readonly statementStart: number;
  readonly statementEnd: number;
}

interface ParsedModule {
  readonly path: string;
  readonly imports: ReadonlyArray<ImportRoute>;
  readonly declarations: ReadonlyArray<DeclarationEntry>;
  readonly unsupportedExportKinds: ReadonlyArray<string>;
  readonly findings: ReadonlyArray<ExperimentFinding>;
}

function sourceBoundFindings(
  files: Readonly<Record<string, string>>
): ReadonlyArray<ExperimentFinding> {
  const entries = Object.entries(files).toSorted(([left], [right]) => left.localeCompare(right));
  const findings: ExperimentFinding[] = [];
  if (entries.length > MAX_SOURCE_FILES) {
    findings.push({
      code: "SOURCE_FILE_LIMIT_EXCEEDED",
      path: "<input>",
      declaration: null,
      message: `Frozen input contains ${entries.length} files; limit is ${MAX_SOURCE_FILES}`
    });
  }
  let totalBytes = 0;
  for (const [path, source] of entries) {
    const bytes = new TextEncoder().encode(source).byteLength;
    totalBytes += bytes;
    if (bytes > MAX_SINGLE_SOURCE_BYTES) {
      findings.push({
        code: "SOURCE_BYTES_LIMIT_EXCEEDED",
        path,
        declaration: null,
        message: `Source contains ${bytes} bytes; per-file limit is ${MAX_SINGLE_SOURCE_BYTES}`
      });
    }
  }
  if (totalBytes > MAX_TOTAL_SOURCE_BYTES) {
    findings.push({
      code: "TOTAL_SOURCE_BYTES_LIMIT_EXCEEDED",
      path: "<input>",
      declaration: null,
      message: `Frozen input contains ${totalBytes} bytes; total limit is ${MAX_TOTAL_SOURCE_BYTES}`
    });
  }
  return findings;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function identifierName(value: unknown): string | undefined {
  const record = asRecord(value);
  return record?.type === "Identifier" && typeof record.name === "string"
    ? record.name
    : undefined;
}

function rootEntityName(value: unknown): string | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const direct = identifierName(record);
  if (direct !== undefined) return direct;
  return record.type === "TSQualifiedName" ? rootEntityName(record.left) : undefined;
}

function normalizedPath(path: string): string | undefined {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\")) return undefined;
  const normalized = posix.normalize(path);
  return normalized === "." || normalized === ".." || normalized.startsWith("../")
    ? undefined
    : normalized;
}

function language(path: string): "ts" | "tsx" | "dts" | undefined {
  if (/\.d\.(?:ts|mts|cts)$/u.test(path)) return "dts";
  if (path.endsWith(".tsx")) return "tsx";
  if (/\.(?:ts|mts|cts)$/u.test(path)) return "ts";
  return undefined;
}

const OMITTED_AST_KEYS = new Set([
  "start",
  "end",
  "range",
  "loc",
  "raw",
  "parent",
  "scopeId",
  "symbolId",
  "referenceId"
]);

function normalizeNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeNode);
  const record = asRecord(value);
  if (record === undefined) return value;
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (OMITTED_AST_KEYS.has(key)) continue;
    normalized[key] = normalizeNode(child);
  }
  return normalized;
}

function normalizedDeclarationShape(
  declaration: Readonly<Record<string, unknown>>,
  declarator?: Readonly<Record<string, unknown>>
): unknown | undefined {
  const name = identifierName(declarator?.id ?? declaration.id);
  if (name === undefined) return undefined;
  if (declaration.type === "FunctionDeclaration" || declaration.type === "TSDeclareFunction") {
    return {
      kind: "function",
      name,
      async: declaration.async === true,
      generator: declaration.generator === true,
      typeParameters: normalizeNode(declaration.typeParameters ?? null),
      params: normalizeNode(declaration.params ?? []),
      returnType: normalizeNode(declaration.returnType ?? null)
    };
  }
  if (declaration.type === "TSInterfaceDeclaration") {
    return {
      kind: "interface",
      name,
      typeParameters: normalizeNode(declaration.typeParameters ?? null),
      extends: normalizeNode(declaration.extends ?? []),
      body: normalizeNode(declaration.body)
    };
  }
  if (declaration.type === "TSTypeAliasDeclaration") {
    return {
      kind: "type",
      name,
      typeParameters: normalizeNode(declaration.typeParameters ?? null),
      typeAnnotation: normalizeNode(declaration.typeAnnotation)
    };
  }
  if (declaration.type === "VariableDeclaration" && declarator !== undefined) {
    const id = asRecord(declarator.id);
    return {
      kind: declaration.kind,
      name,
      typeAnnotation: normalizeNode(id?.typeAnnotation ?? null),
      initializer: normalizeNode(declarator.init ?? null)
    };
  }
  return undefined;
}

interface ShapeDifference {
  readonly path: string;
  readonly expected: unknown;
  readonly observed: unknown;
}

function firstShapeDifference(
  expected: unknown,
  observed: unknown,
  path = ""
): ShapeDifference | undefined {
  if (Object.is(expected, observed)) return undefined;
  if (Array.isArray(expected) || Array.isArray(observed)) {
    if (!Array.isArray(expected) || !Array.isArray(observed)) {
      return { path: path || "/", expected, observed };
    }
    if (expected.length !== observed.length) {
      return {
        path: `${path}/length`,
        expected: expected.length,
        observed: observed.length
      };
    }
    for (const index of expected.keys()) {
      const difference = firstShapeDifference(
        expected[index],
        observed[index],
        `${path}/${index}`
      );
      if (difference !== undefined) return difference;
    }
    return undefined;
  }
  const expectedRecord = asRecord(expected);
  const observedRecord = asRecord(observed);
  if (expectedRecord !== undefined || observedRecord !== undefined) {
    if (expectedRecord === undefined || observedRecord === undefined) {
      return { path: path || "/", expected, observed };
    }
    const keys = [...new Set([...Object.keys(expectedRecord), ...Object.keys(observedRecord)])].toSorted();
    for (const key of keys) {
      const difference = firstShapeDifference(
        expectedRecord[key],
        observedRecord[key],
        `${path}/${key}`
      );
      if (difference !== undefined) return difference;
    }
    return undefined;
  }
  return { path: path || "/", expected, observed };
}

function shapeDifferenceMessage(difference: ShapeDifference | undefined): string {
  if (difference === undefined) return "at an unavailable structural path";
  const render = (value: unknown) => {
    const text = JSON.stringify(value);
    return text === undefined ? "missing" : text.length <= 120 ? text : `${text.slice(0, 117)}...`;
  };
  return `at ${difference.path}: expected ${render(difference.expected)}, observed ${render(difference.observed)}`;
}

function declarationNamespace(type: unknown): Namespace | undefined {
  return type === "TSInterfaceDeclaration" || type === "TSTypeAliasDeclaration"
    ? "type"
    : type === "FunctionDeclaration" ||
        type === "TSDeclareFunction" ||
        type === "VariableDeclaration"
      ? "value"
      : undefined;
}

function declarationText(input: {
  readonly source: string;
  readonly statement: Readonly<Record<string, unknown>>;
  readonly declaration: Readonly<Record<string, unknown>>;
}): string {
  const start = typeof input.statement.start === "number" ? input.statement.start : 0;
  const end = typeof input.statement.end === "number" ? input.statement.end : input.source.length;
  const body = asRecord(input.declaration.body);
  if (
    (input.declaration.type === "FunctionDeclaration" ||
      input.declaration.type === "TSDeclareFunction") &&
    typeof body?.start === "number"
  ) {
    return `${input.source.slice(start, body.start).trimEnd()};`;
  }
  return input.source.slice(start, end).trim();
}

function declarationEntries(input: {
  readonly source: string;
  readonly statement: Readonly<Record<string, unknown>>;
  readonly declaration: Readonly<Record<string, unknown>>;
  readonly visibility: "exported" | "local";
}): ReadonlyArray<DeclarationEntry> {
  const namespace = declarationNamespace(input.declaration.type);
  if (namespace === undefined) return [];
  const declarators =
    input.declaration.type === "VariableDeclaration" &&
    Array.isArray(input.declaration.declarations)
      ? input.declaration.declarations
      : [undefined];
  return declarators.flatMap((candidate): ReadonlyArray<DeclarationEntry> => {
    const declarator = asRecord(candidate);
    const name = identifierName(declarator?.id ?? input.declaration.id);
    const shape = normalizedDeclarationShape(input.declaration, declarator);
    if (name === undefined || shape === undefined) return [];
    const shapeJson = canonicalJson(shape);
    return [
      {
        key: `${namespace}:${name}`,
        name,
        namespace,
        visibility: input.visibility,
        declaration: declarationText(input),
        shape,
        shapeJson,
        shapeDigest: sha256Bytes(shapeJson),
        node: declarator ?? input.declaration,
        statementStart:
          typeof input.statement.start === "number" ? input.statement.start : 0,
        statementEnd:
          typeof input.statement.end === "number"
            ? input.statement.end
            : input.source.length
      }
    ];
  });
}

function parseModule(path: string, source: string): ParsedModule {
  const lang = language(path);
  if (lang === undefined) {
    return {
      path,
      imports: [],
      declarations: [],
      unsupportedExportKinds: [],
      findings: [
        {
          code: "MODULE_LANGUAGE_UNSUPPORTED",
          path,
          declaration: null,
          message: "The experiment supports TypeScript module files only"
        }
      ]
    };
  }
  const parsed = parseSync(path, source, { lang });
  if (parsed.errors.length > 0) {
    return {
      path,
      imports: [],
      declarations: [],
      unsupportedExportKinds: [],
      findings: parsed.errors.map((error) => ({
        code: "MODULE_PARSE_FAILED",
        path,
        declaration: null,
        message: error.message
      }))
    };
  }

  const imports: ImportRoute[] = [];
  const declarations: DeclarationEntry[] = [];
  const unsupportedExportKinds: string[] = [];
  for (const unknownStatement of parsed.program.body) {
    const statement = asRecord(unknownStatement)!;
    if (statement.type === "ImportDeclaration") {
      const sourceValue = asRecord(statement.source)?.value;
      if (typeof sourceValue !== "string" || !Array.isArray(statement.specifiers)) continue;
      for (const unknownSpecifier of statement.specifiers) {
        const specifier = asRecord(unknownSpecifier)!;
        if (specifier.type !== "ImportSpecifier") continue;
        const importedName =
          identifierName(specifier.imported) ??
          (typeof asRecord(specifier.imported)?.value === "string"
            ? String(asRecord(specifier.imported)?.value)
            : undefined);
        const localName = identifierName(specifier.local);
        if (importedName === undefined || localName === undefined) continue;
        imports.push({
          source: sourceValue,
          importedName,
          localName,
          importKind:
            statement.importKind === "type" || specifier.importKind === "type"
              ? "type"
              : "value"
        });
      }
      continue;
    }

    if (statement.type === "ExportNamedDeclaration") {
      const declaration = asRecord(statement.declaration);
      if (declaration === undefined) {
        unsupportedExportKinds.push(statement.source === null ? "export-list" : "re-export");
        continue;
      }
      const entries = declarationEntries({
        source,
        statement,
        declaration,
        visibility: "exported"
      });
      if (entries.length === 0) {
        unsupportedExportKinds.push(String(declaration.type));
      } else {
        declarations.push(...entries);
      }
      continue;
    }

    if (
      statement.type === "ExportDefaultDeclaration" ||
      statement.type === "ExportAllDeclaration" ||
      statement.type === "TSExportAssignment"
    ) {
      unsupportedExportKinds.push(String(statement.type));
      continue;
    }

    declarations.push(
      ...declarationEntries({
        source,
        statement,
        declaration: statement,
        visibility: "local"
      })
    );
  }

  const duplicateKeys = declarations
    .map((entry) => entry.key)
    .filter((key, index, keys) => keys.indexOf(key) !== index);
  return {
    path,
    imports,
    declarations,
    unsupportedExportKinds,
    findings: [...new Set(duplicateKeys)].map((key) => ({
      code: "DECLARATION_MERGING_UNSUPPORTED",
      path,
      declaration: key,
      message: `Declaration ${key} has multiple top-level definitions`
    }))
  };
}

function typeParameterNames(value: unknown): ReadonlyArray<string> {
  const parameters = asRecord(asRecord(value)?.typeParameters)?.params;
  if (!Array.isArray(parameters)) return [];
  return parameters.flatMap((parameter) => {
    const name = identifierName(asRecord(parameter)?.name);
    return name === undefined ? [] : [name];
  });
}

function addReference(
  references: ReferenceName[],
  reference: ReferenceName,
  bound: ReadonlySet<string>
): void {
  if (bound.has(reference.name)) return;
  if (
    !references.some(
      (existing) =>
        existing.name === reference.name && existing.namespace === reference.namespace
    )
  ) {
    references.push(reference);
  }
}

function collectTypeReferences(
  value: unknown,
  references: ReferenceName[],
  bound: ReadonlySet<string> = new Set()
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectTypeReferences(item, references, bound);
    return;
  }
  const record = asRecord(value);
  if (record === undefined) return;
  const localParameters = typeParameterNames(record);
  const visible =
    localParameters.length === 0 ? bound : new Set([...bound, ...localParameters]);
  if (record.type === "TSImportType") {
    addReference(references, { name: "<inline-import>", namespace: "type" }, visible);
    return;
  }
  const entity =
    record.type === "TSTypeReference"
      ? record.typeName
      : record.type === "TSExpressionWithTypeArguments" || record.type === "TSInterfaceHeritage"
        ? record.expression
        : record.type === "TSTypeQuery"
          ? record.exprName
          : undefined;
  const entityName = rootEntityName(entity);
  if (entityName !== undefined) {
    addReference(
      references,
      { name: entityName, namespace: record.type === "TSTypeQuery" ? "value" : "type" },
      visible
    );
  }
  for (const [key, child] of Object.entries(record)) {
    if (
      OMITTED_AST_KEYS.has(key) ||
      key === "typeName" ||
      key === "expression" ||
      key === "exprName"
    ) {
      continue;
    }
    collectTypeReferences(child, references, visible);
  }
}

function collectValueReferences(
  value: unknown,
  references: ReferenceName[],
  parent?: Readonly<Record<string, unknown>>,
  parentKey?: string
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectValueReferences(item, references, parent, parentKey);
    return;
  }
  const record = asRecord(value);
  if (record === undefined) return;
  if (record.type === "Identifier") {
    const name = identifierName(record);
    const parentType = parent?.type;
    const excluded =
      parentKey === "id" ||
      parentKey === "imported" ||
      parentKey === "local" ||
      (parentKey === "key" && parent?.computed !== true) ||
      (parentKey === "property" && parent?.computed !== true) ||
      parentType === "TSTypeParameter";
    if (name !== undefined && !excluded) {
      addReference(references, { name, namespace: "value" }, new Set());
    }
    return;
  }
  if (typeof record.type === "string" && record.type.startsWith("TS")) {
    collectTypeReferences(record, references);
    if (
      record.type === "TSAsExpression" ||
      record.type === "TSTypeAssertion" ||
      record.type === "TSNonNullExpression" ||
      record.type === "TSSatisfiesExpression"
    ) {
      collectValueReferences(record.expression, references, record, "expression");
    }
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    if (OMITTED_AST_KEYS.has(key)) continue;
    collectValueReferences(child, references, record, key);
  }
}

function declarationReferences(entry: DeclarationEntry): ReadonlyArray<ReferenceName> {
  const references: ReferenceName[] = [];
  if (entry.node.type === "FunctionDeclaration" || entry.node.type === "TSDeclareFunction") {
    collectTypeReferences(entry.node.typeParameters, references);
    collectTypeReferences(entry.node.params, references);
    collectTypeReferences(entry.node.returnType, references);
  } else {
    collectTypeReferences(entry.node, references);
  }
  const initializer = entry.node.init;
  if (initializer !== undefined && initializer !== null) {
    collectValueReferences(initializer, references);
  }
  return references.filter((reference) => reference.name !== entry.name);
}

function sourceCandidates(ownerPath: string, source: string): ReadonlyArray<string> | undefined {
  if ((!source.startsWith("./") && !source.startsWith("../")) || /[?#]/u.test(source)) {
    return undefined;
  }
  const base = normalizedPath(posix.join(posix.dirname(ownerPath), source));
  if (base === undefined) return undefined;
  if (/\.d\.(?:ts|mts|cts)$/u.test(base) || /\.(?:ts|tsx|mts|cts)$/u.test(base)) {
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
    `${base}/index.d.ts`
  ];
}

function resolveProjectImport(
  files: Readonly<Record<string, string>>,
  ownerPath: string,
  source: string
): { readonly status: "external" } | { readonly status: "ok"; readonly path: string } | {
  readonly status: "platform";
} | {
  readonly status: "invalid";
  readonly candidates: ReadonlyArray<string>;
} {
  if (source.startsWith("node:")) return { status: "platform" };
  const candidates = sourceCandidates(ownerPath, source);
  if (candidates === undefined) return { status: "external" };
  const present = candidates.filter((candidate) => files[candidate] !== undefined);
  return present.length === 1
    ? { status: "ok", path: present[0]! }
    : { status: "invalid", candidates: present.length === 0 ? candidates : present };
}

function packageNameFromSpecifier(source: string): string {
  if (!source.startsWith("@")) return source.split("/")[0] ?? source;
  return source.split("/").slice(0, 2).join("/");
}

function selectedDeclarations(
  module: ParsedModule,
  name: string,
  namespace?: Namespace,
  exportedOnly = false
): ReadonlyArray<DeclarationEntry> {
  return module.declarations.filter(
    (entry) =>
      entry.name === name &&
      (namespace === undefined || entry.namespace === namespace) &&
      (!exportedOnly || entry.visibility === "exported")
  );
}

export function compileDeclarationEvidenceExperiment(input: {
  readonly sourceFiles: Readonly<Record<string, string>>;
  readonly externalDependencies?: Readonly<
    Record<string, { readonly version: string; readonly lockDigest: string }>
  >;
  readonly roots: ReadonlyArray<{
    readonly path: string;
    readonly name: string;
    readonly namespace?: Namespace;
  }>;
}): DeclarationEvidenceExperimentResult {
  const boundFindings = sourceBoundFindings(input.sourceFiles);
  if (boundFindings.length > 0) {
    return {
      schemaVersion: SCHEMA_VERSION,
      status: "invalid",
      parser: { name: "oxc-parser", version: "0.144.0" },
      normalizerVersion: NORMALIZER_VERSION,
      contracts: [],
      externalReferences: [],
      platformReferences: [],
      findings: boundFindings,
      evidenceDigest: null
    };
  }
  const cache = new Map<string, ParsedModule>();
  const contracts: ExperimentContract[] = [];
  const externalReferences: DeclarationEvidenceExperimentResult["externalReferences"][number][] = [];
  const platformReferences: DeclarationEvidenceExperimentResult["platformReferences"][number][] = [];
  const findings: ExperimentFinding[] = [];
  const visited = new Set<string>();

  const moduleAt = (path: string): ParsedModule | undefined => {
    const cached = cache.get(path);
    if (cached !== undefined) return cached;
    const source = input.sourceFiles[path];
    if (source === undefined) return undefined;
    const parsed = parseModule(path, source);
    cache.set(path, parsed);
    return parsed;
  };

  const visit = (
    path: string,
    name: string,
    namespace: Namespace | undefined,
    exportedOnly: boolean
  ): void => {
    const module = moduleAt(path);
    if (module === undefined) {
      findings.push({
        code: "MODULE_NOT_AVAILABLE",
        path,
        declaration: name,
        message: `Module ${path} is not present in the frozen input`
      });
      return;
    }
    if (module.findings.length > 0) {
      findings.push(...module.findings);
      return;
    }
    const entries = selectedDeclarations(module, name, namespace, exportedOnly);
    if (entries.length === 0) {
      findings.push({
        code: "DECLARATION_NOT_AVAILABLE",
        path,
        declaration: name,
        message: `Declaration ${name} is not available in ${path}`
      });
      return;
    }
    for (const entry of entries) {
      const visitKey = `${path}\0${entry.key}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);
      const routedReferences: ExperimentContract["references"][number][] = [];
      const contract: ExperimentContract = {
        path,
        name: entry.name,
        namespace: entry.namespace,
        visibility: entry.visibility === "exported" ? "exported" : "local_supporting",
        declaration: entry.declaration,
        normalizedShape: entry.shape,
        shapeDigest: entry.shapeDigest,
        references: routedReferences
      };
      contracts.push(contract);

      for (const reference of declarationReferences(entry)) {
        if (reference.name === "<inline-import>") {
          findings.push({
            code: "INLINE_IMPORT_TYPE_UNSUPPORTED",
            path,
            declaration: entry.name,
            message: `Declaration ${entry.name} uses an inline import type`
          });
          continue;
        }
        if (TYPESCRIPT_GLOBALS.has(reference.name)) {
          routedReferences.push({
            name: reference.name,
            namespace: reference.namespace,
            resolution: { kind: "typescript_global" }
          });
          continue;
        }
        const local = selectedDeclarations(module, reference.name, reference.namespace);
        if (local.length === 1) {
          routedReferences.push({
            name: reference.name,
            namespace: reference.namespace,
            resolution: { kind: "local", path, name: reference.name }
          });
          visit(path, reference.name, reference.namespace, false);
          continue;
        }
        const imported = module.imports.filter(
          (route) =>
            route.localName === reference.name &&
            (reference.namespace === "value" || route.importKind === "type" || route.importKind === "value")
        );
        if (imported.length !== 1) {
          findings.push({
            code: "REFERENCE_ROUTING_UNAVAILABLE",
            path,
            declaration: entry.name,
            message: `Reference ${reference.name} from ${entry.name} has no exact route`
          });
          continue;
        }
        const route = imported[0]!;
        const resolution = resolveProjectImport(input.sourceFiles, path, route.source);
        if (resolution.status === "platform") {
          routedReferences.push({
            name: reference.name,
            namespace: reference.namespace,
            resolution: {
              kind: "platform",
              source: route.source,
              importedName: route.importedName
            }
          });
          if (
            !platformReferences.some(
              (existing) =>
                existing.ownerPath === path &&
                existing.source === route.source &&
                existing.importedName === route.importedName &&
                existing.localName === route.localName
            )
          ) {
            platformReferences.push({ ownerPath: path, ...route });
          }
          continue;
        }
        if (resolution.status === "external") {
          const packageName = packageNameFromSpecifier(route.source);
          const dependency = input.externalDependencies?.[packageName];
          if (dependency === undefined) {
            findings.push({
              code: "EXTERNAL_DEPENDENCY_EVIDENCE_MISSING",
              path,
              declaration: entry.name,
              message: `External package ${packageName} has no frozen version and lock provenance`
            });
            continue;
          }
          routedReferences.push({
            name: reference.name,
            namespace: reference.namespace,
            resolution: {
              kind: "external",
              source: route.source,
              importedName: route.importedName
            }
          });
          if (
            !externalReferences.some(
              (existing) =>
                existing.ownerPath === path &&
                existing.source === route.source &&
                existing.importedName === route.importedName &&
                existing.localName === route.localName
            )
          ) {
            externalReferences.push({
              ownerPath: path,
              packageName,
              ...route,
              version: dependency.version,
              lockDigest: dependency.lockDigest
            });
          }
          continue;
        }
        if (resolution.status === "invalid") {
          findings.push({
            code: "PROJECT_IMPORT_UNRESOLVED",
            path,
            declaration: entry.name,
            message: `Import ${route.source} from ${path} does not resolve exactly`
          });
          continue;
        }
        routedReferences.push({
          name: reference.name,
          namespace: reference.namespace,
          resolution: {
            kind: "project_import",
            path: resolution.path,
            source: route.source,
            importedName: route.importedName
          }
        });
        visit(resolution.path, route.importedName, reference.namespace, true);
      }
    }
  };

  for (const root of input.roots) visit(root.path, root.name, root.namespace, true);
  const evidenceWithoutDigest = {
    schemaVersion: SCHEMA_VERSION,
    parser: { name: "oxc-parser" as const, version: "0.144.0" as const },
    normalizerVersion: NORMALIZER_VERSION,
    contracts,
    externalReferences,
    platformReferences
  };
  return {
    ...evidenceWithoutDigest,
    status: findings.length === 0 ? "ok" : "invalid",
    findings,
    evidenceDigest: findings.length === 0 ? sha256Json(evidenceWithoutDigest) : null
  };
}

function generatedExpectedSource(brief: ExperimentAgentBrief): string {
  const imports = brief.consumed.map((consumed) => {
    const importedName = consumed.importedName ?? consumed.name;
    const localName = consumed.localName ?? consumed.name;
    const binding = importedName === localName ? importedName : `${importedName} as ${localName}`;
    return `import${consumed.importKind === "type" ? " type" : ""} { ${binding} } from ${JSON.stringify(consumed.source)};`;
  });
  return [...imports, ...brief.owned.map((owned) => owned.declaration), ""].join("\n");
}

function replacedExpectedSource(input: {
  readonly brief: ExperimentAgentBrief;
  readonly baseline: string;
}): { readonly source?: string; readonly findings: ReadonlyArray<ExperimentFinding> } {
  const baselineModule = parseModule(input.brief.targetPath, input.baseline);
  if (baselineModule.findings.length > 0) {
    return { findings: baselineModule.findings };
  }
  const plannedSource = generatedExpectedSource({
    ...input.brief,
    operation: "create"
  });
  const plannedModule = parseModule(input.brief.targetPath, plannedSource);
  if (plannedModule.findings.length > 0) {
    return { findings: plannedModule.findings };
  }
  for (const owned of input.brief.owned) {
    if (
      !plannedModule.declarations.some(
        (entry) => entry.visibility === "exported" && entry.name === owned.name
      )
    ) {
      return {
        findings: [
          {
            code: "PLANNED_DECLARATION_EXPORT_MISSING",
            path: input.brief.targetPath,
            declaration: owned.name,
            message: `Planned declaration ${owned.name} does not contain its named export`
          }
        ]
      };
    }
  }

  const plannedKeys = new Set(
    plannedModule.declarations.map((entry) => `${entry.visibility}:${entry.key}`)
  );
  const removalRanges = new Map<string, { readonly start: number; readonly end: number }>();
  for (const baselineEntry of baselineModule.declarations) {
    if (!plannedKeys.has(`${baselineEntry.visibility}:${baselineEntry.key}`)) continue;
    const rangeKey = `${baselineEntry.statementStart}:${baselineEntry.statementEnd}`;
    removalRanges.set(rangeKey, {
      start: baselineEntry.statementStart,
      end: baselineEntry.statementEnd
    });
  }
  let remaining = input.baseline;
  for (const range of [...removalRanges.values()].toSorted((left, right) => right.start - left.start)) {
    remaining = `${remaining.slice(0, range.start)}${remaining.slice(range.end)}`;
  }

  const missingImports = input.brief.consumed.filter((consumed) => {
    const expected = {
      source: consumed.source,
      importedName: consumed.importedName ?? consumed.name,
      localName: consumed.localName ?? consumed.name,
      importKind: consumed.importKind
    };
    return !baselineModule.imports.some(
      (route) => canonicalJson(route) === canonicalJson(expected)
    );
  });
  const prefix = generatedExpectedSource({
    ...input.brief,
    operation: "create",
    owned: [],
    consumed: missingImports
  });
  return {
    source: `${prefix}${remaining.trim()}\n${input.brief.owned.map((owned) => owned.declaration).join("\n")}\n`,
    findings: []
  };
}

function expectedFiles(input: DeclarationContractExperimentInput): {
  readonly files: Readonly<Record<string, string>>;
  readonly findings: ReadonlyArray<ExperimentFinding>;
} {
  const files: Record<string, string> = { ...input.sourceFiles };
  const findings: ExperimentFinding[] = [];
  for (const brief of input.agentBriefs) {
    if (brief.operation === "create") {
      files[brief.targetPath] = generatedExpectedSource(brief);
      continue;
    }
    if (files[brief.targetPath] === undefined) {
      findings.push({
        code: "BASELINE_TARGET_MISSING",
        path: brief.targetPath,
        declaration: null,
        message: "Replacement target is missing from frozen source input"
      });
      continue;
    }
    if (brief.owned.length > 0) {
      const replaced = replacedExpectedSource({
        brief,
        baseline: files[brief.targetPath]!
      });
      findings.push(...replaced.findings);
      if (replaced.source !== undefined) files[brief.targetPath] = replaced.source;
    }
  }
  return { files, findings };
}

function exportMap(module: ParsedModule): ReadonlyMap<string, DeclarationEntry> {
  return new Map(
    module.declarations
      .filter((entry) => entry.visibility === "exported")
      .map((entry) => [entry.key, entry])
  );
}

function contractKey(contract: ExperimentContract): string {
  return `${contract.path}\0${contract.namespace}:${contract.name}`;
}

export function runDeclarationContractExperiment(
  input: DeclarationContractExperimentInput
): DeclarationContractExperimentResult {
  const candidateSetDigest = sha256Json(input.candidateFiles);
  const boundFindings = sourceBoundFindings({ ...input.sourceFiles, ...input.candidateFiles });
  if (boundFindings.length > 0) {
    const verdictBase = {
      schemaVersion: SCHEMA_VERSION,
      status: "invalid" as const,
      evidenceDigest: null,
      candidateSetDigest,
      contracts: [] as ReadonlyArray<ExperimentContract>,
      findings: boundFindings
    };
    return { ...verdictBase, verdictDigest: sha256Json(verdictBase) };
  }
  const expected = expectedFiles(input);
  const findings: ExperimentFinding[] = [...expected.findings];
  const candidateFiles = { ...input.sourceFiles, ...input.candidateFiles };
  const roots: Array<{ path: string; name: string; namespace: Namespace }> = [];

  for (const brief of input.agentBriefs) {
    const expectedSource = expected.files[brief.targetPath];
    const candidateSource = input.candidateFiles[brief.targetPath];
    if (expectedSource === undefined || candidateSource === undefined) {
      findings.push({
        code: "CANDIDATE_FILE_MISSING",
        path: brief.targetPath,
        declaration: null,
        message: `Candidate ${brief.targetPath} is missing`
      });
      continue;
    }
    const expectedModule = parseModule(brief.targetPath, expectedSource);
    const candidateModule = parseModule(brief.targetPath, candidateSource);
    findings.push(...expectedModule.findings, ...candidateModule.findings);
    for (const kind of expectedModule.unsupportedExportKinds) {
      findings.push({
        code: "EXPECTED_EXPORT_FORM_UNSUPPORTED",
        path: brief.targetPath,
        declaration: null,
        message: `Expected export form ${kind} is unsupported`
      });
    }
    for (const kind of candidateModule.unsupportedExportKinds) {
      findings.push({
        code: "CANDIDATE_EXPORT_FORM_UNSUPPORTED",
        path: brief.targetPath,
        declaration: null,
        message: `Candidate export form ${kind} is unsupported`
      });
    }
    const expectedExports = exportMap(expectedModule);
    const candidateExports = exportMap(candidateModule);
    for (const [key, expectedEntry] of expectedExports) {
      roots.push({
        path: brief.targetPath,
        name: expectedEntry.name,
        namespace: expectedEntry.namespace
      });
      const candidate = candidateExports.get(key);
      if (candidate === undefined) {
        findings.push({
          code: "EXPECTED_EXPORT_MISSING",
          path: brief.targetPath,
          declaration: expectedEntry.name,
          message: `Candidate is missing approved export ${key}`
        });
      } else if (candidate.shapeJson !== expectedEntry.shapeJson) {
        const difference = firstShapeDifference(expectedEntry.shape, candidate.shape);
        findings.push({
          code: "EXPORT_SHAPE_MISMATCH",
          path: brief.targetPath,
          declaration: expectedEntry.name,
          message: `Candidate export ${key} differs ${shapeDifferenceMessage(difference)}`
        });
      }
    }
    for (const [key, candidate] of candidateExports) {
      if (!expectedExports.has(key)) {
        findings.push({
          code: "UNEXPECTED_EXPORT",
          path: brief.targetPath,
          declaration: candidate.name,
          message: `Candidate adds unapproved export ${key}`
        });
      }
    }

    for (const consumed of brief.consumed) {
      const expectedImport = {
        source: consumed.source,
        importedName: consumed.importedName ?? consumed.name,
        localName: consumed.localName ?? consumed.name,
        importKind: consumed.importKind
      };
      if (
        !candidateModule.imports.some(
          (route) => canonicalJson(route) === canonicalJson(expectedImport)
        )
      ) {
        findings.push({
          code: "REQUIRED_IMPORT_MISSING",
          path: brief.targetPath,
          declaration: consumed.name,
          message: `Candidate does not contain the approved import route for ${consumed.name}`
        });
      }
    }

    const allowedProjectPaths = new Set([
      ...(brief.contextPaths ?? []),
      ...brief.consumed.map((consumed) => consumed.ownerPath)
    ]);
    if (brief.operation === "replace") {
      const baseline = parseModule(brief.targetPath, input.sourceFiles[brief.targetPath] ?? "");
      for (const route of baseline.imports) {
        const resolved = resolveProjectImport(candidateFiles, brief.targetPath, route.source);
        if (resolved.status === "ok") allowedProjectPaths.add(resolved.path);
      }
    }
    for (const route of candidateModule.imports) {
      const resolved = resolveProjectImport(candidateFiles, brief.targetPath, route.source);
      if (resolved.status === "ok" && !allowedProjectPaths.has(resolved.path)) {
        findings.push({
          code: "PROJECT_IMPORT_NOT_APPROVED",
          path: brief.targetPath,
          declaration: route.localName,
          message: `Candidate imports unapproved project file ${resolved.path}`
        });
      }
      if (resolved.status === "invalid") {
        findings.push({
          code: "PROJECT_IMPORT_UNRESOLVED",
          path: brief.targetPath,
          declaration: route.localName,
          message: `Candidate import ${route.source} does not resolve exactly`
        });
      }
    }
  }

  const expectedEvidence = compileDeclarationEvidenceExperiment({
    sourceFiles: expected.files,
    roots,
    ...(input.externalDependencies === undefined
      ? {}
      : { externalDependencies: input.externalDependencies })
  });
  const candidateEvidence = compileDeclarationEvidenceExperiment({
    sourceFiles: candidateFiles,
    roots,
    ...(input.externalDependencies === undefined
      ? {}
      : { externalDependencies: input.externalDependencies })
  });
  if (expectedEvidence.status === "invalid") {
    findings.push(
      ...expectedEvidence.findings.map((finding) => ({
        ...finding,
        code: `EXPECTED_${finding.code}`
      }))
    );
  }
  if (candidateEvidence.status === "invalid") {
    findings.push(
      ...candidateEvidence.findings.map((finding) => ({
        ...finding,
        code: `CANDIDATE_${finding.code}`
      }))
    );
  }
  if (expectedEvidence.status === "ok" && candidateEvidence.status === "ok") {
    const candidateContracts = new Map(
      candidateEvidence.contracts.map((contract) => [contractKey(contract), contract])
    );
    for (const contract of expectedEvidence.contracts) {
      const candidate = candidateContracts.get(contractKey(contract));
      if (candidate === undefined) {
        findings.push({
          code: "SUPPORTING_DECLARATION_MISSING",
          path: contract.path,
          declaration: contract.name,
          message: `Candidate closure is missing ${contract.namespace}:${contract.name}`
        });
      } else if (candidate.shapeDigest !== contract.shapeDigest) {
        const difference = firstShapeDifference(
          contract.normalizedShape,
          candidate.normalizedShape
        );
        findings.push({
          code: "SUPPORTING_DECLARATION_SHAPE_MISMATCH",
          path: contract.path,
          declaration: contract.name,
          message: `Candidate closure changes ${contract.namespace}:${contract.name} ${shapeDifferenceMessage(difference)}`
        });
      } else if (canonicalJson(candidate.references) !== canonicalJson(contract.references)) {
        const difference = firstShapeDifference(contract.references, candidate.references);
        findings.push({
          code: "SUPPORTING_DECLARATION_ROUTING_MISMATCH",
          path: contract.path,
          declaration: contract.name,
          message: `Candidate closure reroutes ${contract.namespace}:${contract.name} ${shapeDifferenceMessage(difference)}`
        });
      }
    }
  }

  const uniqueFindings = findings.filter(
    (finding, index, all) =>
      all.findIndex((candidate) => canonicalJson(candidate) === canonicalJson(finding)) === index
  );
  const verdictBase = {
    schemaVersion: SCHEMA_VERSION,
    status: uniqueFindings.length === 0 ? ("ok" as const) : ("invalid" as const),
    evidenceDigest: expectedEvidence.evidenceDigest,
    candidateSetDigest,
    contracts: expectedEvidence.contracts,
    findings: uniqueFindings
  };
  return { ...verdictBase, verdictDigest: sha256Json(verdictBase) };
}
