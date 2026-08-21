import { createRequire } from "node:module";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { parseSync } from "oxc-parser";

import {
  assertIJson,
  sha256Bytes,
  sha256Json
} from "./canonical.js";

const require = createRequire(import.meta.url);
const parserPackage = require("oxc-parser/package.json") as {
  readonly version: string;
};

export const EXTERNAL_DECLARATION_EVIDENCE_VERSION =
  "score.external-declaration-evidence@1.0.0" as const;
export const EXTERNAL_DECLARATION_CONTEXT_VERSION =
  "score.external-declaration-context@1.0.0" as const;

const MAX_REQUESTS = 8;
const MAX_MEMBERS_PER_REQUEST = 8;
const MAX_SOURCE_FILES = 8;
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_DECLARATION_BYTES = 64 * 1024;
const MAX_SUPPORTING_DECLARATIONS = 16;
const RESOLUTION_TYPESCRIPT_VERSION = "7.0.2";
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
  "globalThis"
]);

export interface ExternalDeclarationRequest {
  readonly from: string;
  readonly names: ReadonlyArray<string>;
  readonly purpose: string;
}

export type ExternalDeclarationEvidenceFindingCode =
  | "EXTERNAL_DECLARATION_AMBIGUOUS"
  | "EXTERNAL_DECLARATION_INCOMPLETE"
  | "EXTERNAL_DECLARATION_MISSING"
  | "EXTERNAL_DECLARATION_SOURCE_MISSING"
  | "EXTERNAL_DECLARATION_UNSUPPORTED"
  | "EXTERNAL_EVIDENCE_LIMIT_EXCEEDED"
  | "EXTERNAL_EXPORT_CONDITION_UNRESOLVED"
  | "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED"
  | "EXTERNAL_PACKAGE_LOCK_MISMATCH"
  | "EXTERNAL_PACKAGE_LOCK_UNAVAILABLE"
  | "EXTERNAL_SUPPORTING_DECLARATION_AMBIGUOUS"
  | "EXTERNAL_SUPPORTING_DECLARATION_MISSING"
  | "EXTERNAL_SUPPORTING_DECLARATION_UNSUPPORTED";

export interface ExternalDeclarationEvidenceFinding {
  readonly code: ExternalDeclarationEvidenceFindingCode;
  readonly location: string;
  readonly message: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly machineRepairable: false;
}

type DeclarationNamespace = "type" | "value" | "type_and_value";

export interface ExternalSupportingDeclarationEvidence {
  readonly name: string;
  readonly declarationKind: string;
  readonly namespace: DeclarationNamespace;
  readonly declaration: string;
  readonly declarationDigest: string;
}

export interface ExternalPublicContractEvidence {
  readonly name: string;
  readonly declarationKind: string;
  readonly namespace: DeclarationNamespace;
  readonly declaration: string;
  readonly declarationDigest: string;
  readonly supportingDeclarations: ReadonlyArray<ExternalSupportingDeclarationEvidence>;
}

export interface ExternalDeclarationEvidenceBundle {
  readonly schemaVersion: typeof EXTERNAL_DECLARATION_EVIDENCE_VERSION;
  readonly parser: { readonly name: "oxc-parser"; readonly version: string };
  readonly resolutionProfile: {
    readonly mode: "import";
    readonly typescriptVersion: string;
  };
  readonly limits: {
    readonly maxRequests: number;
    readonly maxMembersPerRequest: number;
    readonly maxSourceFiles: number;
    readonly maxSourceBytes: number;
    readonly maxDeclarationBytes: number;
    readonly maxSupportingDeclarations: number;
    readonly supportingDepth: 1;
  };
  readonly provenance: {
    readonly files: ReadonlyArray<{ readonly path: string; readonly contentDigest: string }>;
  };
  readonly requests: ReadonlyArray<{
    readonly from: string;
    readonly purpose: string;
    readonly package: {
      readonly name: string;
      readonly version: string;
      readonly integrity: string;
    };
    readonly contracts: ReadonlyArray<ExternalPublicContractEvidence>;
  }>;
  readonly evidenceDigest: string;
  readonly agentContext: {
    readonly schemaVersion: typeof EXTERNAL_DECLARATION_CONTEXT_VERSION;
    readonly requests: ReadonlyArray<{
      readonly from: string;
      readonly purpose: string;
      readonly package: {
        readonly name: string;
        readonly version: string;
        readonly integrity: string;
      };
      readonly contracts: ReadonlyArray<ExternalPublicContractEvidence>;
    }>;
    readonly evidenceDigest: string;
  };
  readonly agentContextDigest: string;
  readonly contentDigest: string;
}

export type ExternalDeclarationEvidenceResult =
  | { readonly status: "ok"; readonly bundle: ExternalDeclarationEvidenceBundle }
  | {
      readonly status: "invalid";
      readonly findings: ReadonlyArray<ExternalDeclarationEvidenceFinding>;
    };

interface Audit {
  readonly projectRoot: string;
  readonly files: Map<string, string>;
}

interface PackageLock {
  readonly packages?: Readonly<Record<string, unknown>>;
}

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly exports?: unknown;
  readonly types?: string;
  readonly typings?: string;
  readonly typesVersions?: unknown;
}

interface ParsedSource {
  readonly path: string;
  readonly source: string;
  readonly programBody: ReadonlyArray<unknown>;
  readonly imports: ReadonlyMap<
    string,
    {
      readonly source: string;
      readonly importedName: string;
      readonly kind: "named" | "namespace";
    }
  >;
}

interface SelectedDeclaration {
  readonly name: string;
  readonly declarationKind: string;
  readonly namespace: DeclarationNamespace;
  readonly declaration: string;
  readonly declarationDigest: string;
  readonly node: Readonly<Record<string, unknown>>;
}

class EvidenceFailure extends Error {
  constructor(readonly finding: ExternalDeclarationEvidenceFinding) {
    super(finding.message);
  }
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(
  code: ExternalDeclarationEvidenceFindingCode,
  location: string,
  message: string,
  detail: Readonly<Record<string, unknown>> = {}
): never {
  throw new EvidenceFailure({ code, location, message, detail, machineRepairable: false });
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function auditPath(audit: Audit, absolutePath: string): string {
  return relative(audit.projectRoot, absolutePath).split(sep).join("/");
}

function readBoundedFile(input: {
  readonly audit: Audit;
  readonly absolutePath: string;
  readonly allowedRoot: string;
  readonly location: string;
  readonly missingCode:
    | "EXTERNAL_PACKAGE_LOCK_UNAVAILABLE"
    | "EXTERNAL_DECLARATION_SOURCE_MISSING"
    | "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED";
}): Buffer {
  let realAllowedRoot: string;
  let realPath: string;
  try {
    const unresolvedPath = resolve(input.absolutePath);
    const unresolvedStatus = lstatSync(unresolvedPath);
    if (unresolvedStatus.isSymbolicLink()) throw new Error("symbolic links are not allowed");
    realAllowedRoot = realpathSync(input.allowedRoot);
    realPath = realpathSync(unresolvedPath);
    const status = lstatSync(realPath);
    if (!status.isFile() || status.isSymbolicLink()) throw new Error("not a regular file");
    if (status.size > MAX_SOURCE_BYTES) {
      fail(
        "EXTERNAL_EVIDENCE_LIMIT_EXCEEDED",
        input.location,
        "External declaration evidence source exceeds the approved byte limit",
        { maxSourceBytes: MAX_SOURCE_BYTES, actualSourceBytes: status.size }
      );
    }
  } catch (cause) {
    if (cause instanceof EvidenceFailure) throw cause;
    fail(input.missingCode, input.location, "Approved external evidence input is unavailable", {
      cause: cause instanceof Error ? cause.message : String(cause)
    });
  }
  if (!isWithin(realAllowedRoot, realPath!)) {
    fail(
      "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED",
      input.location,
      "External evidence source resolves outside its approved package boundary"
    );
  }
  const bytes = readFileSync(realPath!);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    fail(
      "EXTERNAL_DECLARATION_UNSUPPORTED",
      input.location,
      "External evidence source must contain exact round-trippable UTF-8 bytes"
    );
  }
  input.audit.files.set(auditPath(input.audit, realPath!), sha256Bytes(bytes));
  if (input.audit.files.size > MAX_SOURCE_FILES) {
    fail(
      "EXTERNAL_EVIDENCE_LIMIT_EXCEEDED",
      input.location,
      "External declaration evidence exceeds the approved source-file limit",
      { maxSourceFiles: MAX_SOURCE_FILES, actualSourceFiles: input.audit.files.size }
    );
  }
  return bytes;
}

function parseJsonFile(
  audit: Audit,
  absolutePath: string,
  allowedRoot: string,
  location: string,
  missingCode: "EXTERNAL_PACKAGE_LOCK_UNAVAILABLE" | "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED"
): unknown {
  const bytes = readBoundedFile({
    audit,
    absolutePath,
    allowedRoot,
    location,
    missingCode
  });
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    assertIJson(parsed);
    return parsed;
  } catch {
    fail(missingCode, location, "Approved external evidence metadata is not valid canonical JSON input");
  }
}

function packageNameFromSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return scope && name ? `${scope}/${name}` : undefined;
  }
  const [name] = specifier.split("/");
  return name || undefined;
}

function normalizedPackagePath(value: string): string | undefined {
  if (!value.startsWith("./") || value.includes("\\")) return undefined;
  const segments = value.slice(2).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return `./${segments.join("/")}`;
}

function declarationSubstitution(value: string): string | undefined {
  const normalized = normalizedPackagePath(value);
  if (normalized === undefined) return undefined;
  if (/\.d\.(?:ts|mts|cts)$/u.test(normalized)) return normalized;
  if (normalized.endsWith(".mjs")) return `${normalized.slice(0, -4)}.d.mts`;
  if (normalized.endsWith(".cjs")) return `${normalized.slice(0, -4)}.d.cts`;
  if (normalized.endsWith(".js")) return `${normalized.slice(0, -3)}.d.ts`;
  return undefined;
}

function replaceWildcard(value: unknown, substitution: string): unknown {
  if (typeof value === "string") return value.replace("*", substitution);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([condition, nested]) => [
      condition,
      replaceWildcard(nested, substitution)
    ])
  );
}

function matchingExport(exportsValue: unknown, subpath: string): unknown {
  if (typeof exportsValue === "string") return subpath === "." ? exportsValue : undefined;
  if (!isRecord(exportsValue)) return undefined;
  if (subpath === "." && Object.keys(exportsValue).every((key) => !key.startsWith("."))) {
    return exportsValue;
  }
  if (subpath in exportsValue) return exportsValue[subpath];
  const matches = Object.entries(exportsValue)
    .flatMap(([key, target]) => {
      const star = key.indexOf("*");
      if (star === -1 || key.indexOf("*", star + 1) !== -1) return [];
      const prefix = key.slice(0, star);
      const suffix = key.slice(star + 1);
      if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) return [];
      const substitution = subpath.slice(prefix.length, subpath.length - suffix.length);
      return [
        {
          specificity: prefix.length + suffix.length,
          target: replaceWildcard(target, substitution)
        }
      ];
    })
    .toSorted((left, right) => right.specificity - left.specificity);
  return matches.length === 1 ? matches[0]?.target : undefined;
}

function parseVersion(value: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(value);
  return match === null
    ? undefined
    : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function versionAtLeast(range: string, version: string): boolean | undefined {
  if (range === "*") return true;
  const actual = parseVersion(version);
  const requested = /^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u.exec(range);
  if (actual === undefined || requested === null) return undefined;
  const minimum = [
    Number(requested[1]),
    Number(requested[2] ?? 0),
    Number(requested[3] ?? 0)
  ] as const;
  for (let index = 0; index < 3; index += 1) {
    if (actual[index]! > minimum[index]!) return true;
    if (actual[index]! < minimum[index]!) return false;
  }
  return true;
}

function selectConditionalTarget(value: unknown): string | "unsupported" | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "unsupported";
  for (const [condition, target] of Object.entries(value)) {
    const versioned = condition.startsWith("types@")
      ? versionAtLeast(condition.slice("types@".length), RESOLUTION_TYPESCRIPT_VERSION)
      : undefined;
    if (condition.startsWith("types@") && versioned === undefined) return "unsupported";
    if (
      condition !== "types" &&
      condition !== "import" &&
      condition !== "default" &&
      versioned !== true
    ) {
      continue;
    }
    const selected = selectConditionalTarget(target);
    if (selected !== undefined) return selected;
  }
  return undefined;
}

function applyTypesVersions(manifest: PackageManifest, baseTarget: string): string | "unsupported" | undefined {
  if (manifest.typesVersions === undefined) return undefined;
  if (!isRecord(manifest.typesVersions)) return "unsupported";
  for (const [range, mappings] of Object.entries(manifest.typesVersions)) {
    const matches = versionAtLeast(range, RESOLUTION_TYPESCRIPT_VERSION);
    if (matches === undefined) return "unsupported";
    if (!matches) continue;
    if (!isRecord(mappings)) return "unsupported";
    const base = baseTarget.startsWith("./") ? baseTarget.slice(2) : baseTarget;
    for (const [pattern, substitutions] of Object.entries(mappings)) {
      if (pattern !== "*" || !Array.isArray(substitutions) || substitutions.length !== 1) {
        return "unsupported";
      }
      const substitution = substitutions[0];
      if (typeof substitution !== "string") return "unsupported";
      return normalizedPackagePath(`./${substitution.replace("*", base)}`) ?? "unsupported";
    }
    return undefined;
  }
  return undefined;
}

function resolveDeclarationEntry(input: {
  readonly manifest: PackageManifest;
  readonly packageName: string;
  readonly moduleSpecifier: string;
  readonly location: string;
}): string {
  const subpath = input.moduleSpecifier === input.packageName
    ? "."
    : input.moduleSpecifier.startsWith(`${input.packageName}/`)
      ? `./${input.moduleSpecifier.slice(input.packageName.length + 1)}`
      : undefined;
  if (subpath === undefined) {
    fail(
      "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED",
      input.location,
      "External module specifier does not belong to its selected package",
      { from: input.moduleSpecifier, packageName: input.packageName }
    );
  }

  let target: string | "unsupported" | undefined;
  if (input.manifest.exports !== undefined) {
    target = selectConditionalTarget(matchingExport(input.manifest.exports, subpath));
    if (target === undefined) {
      fail(
        "EXTERNAL_EXPORT_CONDITION_UNRESOLVED",
        input.location,
        "No approved export condition selected one declaration entry",
        { from: input.moduleSpecifier, mode: "import" }
      );
    }
  } else {
    if (subpath !== ".") {
      fail(
        "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED",
        input.location,
        "A package without exports metadata can expose only its root declaration entry",
        { from: input.moduleSpecifier }
      );
    }
    const baseTarget = input.manifest.types ?? input.manifest.typings;
    if (baseTarget === undefined) {
      fail(
        "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED",
        input.location,
        "External package has no supported declaration entry metadata",
        { from: input.moduleSpecifier }
      );
    }
    target = applyTypesVersions(input.manifest, baseTarget) ?? baseTarget;
  }
  if (target === "unsupported") {
    fail(
      "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED",
      input.location,
      "External package uses declaration-resolution syntax outside the approved bounded subset",
      { from: input.moduleSpecifier }
    );
  }
  const declarationPath = declarationSubstitution(target!);
  if (declarationPath === undefined) {
    fail(
      "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED",
      input.location,
      "External package target has no supported declaration-file substitution",
      { from: input.moduleSpecifier, target }
    );
  }
  return declarationPath;
}

function sourceLanguage(path: string): "dts" | undefined {
  return /\.d\.(?:ts|mts|cts)$/u.test(path) ? "dts" : undefined;
}

function parseDeclarationSource(
  audit: Audit,
  packageRoot: string,
  packageRelativePath: string,
  location: string
): ParsedSource {
  if (sourceLanguage(packageRelativePath) === undefined) {
    fail(
      "EXTERNAL_DECLARATION_UNSUPPORTED",
      location,
      "External declaration evidence can parse only declaration files",
      { declarationPath: packageRelativePath }
    );
  }
  const bytes = readBoundedFile({
    audit,
    absolutePath: resolve(packageRoot, packageRelativePath),
    allowedRoot: packageRoot,
    location,
    missingCode: "EXTERNAL_DECLARATION_SOURCE_MISSING"
  });
  const source = bytes.toString("utf8");
  const parsed = parseSync(packageRelativePath, source, {
    lang: "dts",
    sourceType: "module",
    astType: "ts",
    range: true,
    preserveParens: true,
    showSemanticErrors: true
  });
  const errors = parsed.errors.filter(
    (error) => error.severity.toString().toLowerCase() === "error"
  );
  if (errors.length > 0) {
    fail(
      "EXTERNAL_DECLARATION_UNSUPPORTED",
      location,
      "Selected external declaration source did not parse cleanly",
      { messages: errors.map((error) => error.message) }
    );
  }
  const imports = new Map<
    string,
    { readonly source: string; readonly importedName: string; readonly kind: "named" | "namespace" }
  >();
  for (const statement of parsed.program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportNamespaceSpecifier") {
        imports.set(specifier.local.name, {
          source: statement.source.value,
          importedName: "*",
          kind: "namespace"
        });
      } else if (specifier.type === "ImportSpecifier") {
        imports.set(specifier.local.name, {
          source: statement.source.value,
          importedName:
            specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : specifier.imported.value,
          kind: "named"
        });
      }
    }
  }
  return { path: packageRelativePath, source, programBody: parsed.program.body, imports };
}

function declarationName(declaration: Readonly<Record<string, unknown>>): string | undefined {
  if (declaration.type === "VariableDeclaration" && Array.isArray(declaration.declarations)) {
    const names = declaration.declarations.flatMap((item) => {
      const candidate = isRecord(item) ? item : undefined;
      const id = isRecord(candidate?.id) ? candidate.id : undefined;
      return id?.type === "Identifier" && typeof id.name === "string" ? [id.name] : [];
    });
    return names.length === 1 ? names[0] : undefined;
  }
  const id = isRecord(declaration.id) ? declaration.id : undefined;
  if (id?.type === "Identifier" && typeof id.name === "string") return id.name;
  if (id?.type === "Literal" && typeof id.value === "string") return id.value;
  return undefined;
}

function namespaceFor(type: unknown): DeclarationNamespace {
  switch (type) {
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
      return "type";
    case "ClassDeclaration":
    case "TSEnumDeclaration":
      return "type_and_value";
    default:
      return "value";
  }
}

function explicitContractComplete(declaration: Readonly<Record<string, unknown>>): boolean {
  if (declaration.type === "FunctionDeclaration" || declaration.type === "TSDeclareFunction") {
    if (declaration.returnType === null || declaration.returnType === undefined) return false;
    if (!Array.isArray(declaration.params)) return false;
    return declaration.params.every((parameter) => {
      const candidate = isRecord(parameter) ? parameter : undefined;
      if (candidate?.type === "RestElement") {
        const argument = isRecord(candidate.argument) ? candidate.argument : undefined;
        return candidate.typeAnnotation != null || argument?.typeAnnotation != null;
      }
      return candidate?.typeAnnotation != null;
    });
  }
  if (declaration.type === "VariableDeclaration") {
    if (!Array.isArray(declaration.declarations) || declaration.declarations.length !== 1) {
      return false;
    }
    const item = isRecord(declaration.declarations[0]) ? declaration.declarations[0] : undefined;
    const id = isRecord(item?.id) ? item.id : undefined;
    return id?.typeAnnotation != null;
  }
  return true;
}

function selectedDeclaration(
  parsed: ParsedSource,
  name: string,
  location: string,
  supporting: boolean
): SelectedDeclaration {
  const segments = name.split(".");
  const rootName = segments[0]!;
  const rootMatches: Array<{
    readonly declaration: Readonly<Record<string, unknown>>;
    readonly rangeNode: Readonly<Record<string, unknown>>;
  }> = [];
  let unsupportedExportMatch = false;
  for (const rawStatement of parsed.programBody) {
    const statement = isRecord(rawStatement) ? rawStatement : undefined;
    if (statement?.type !== "ExportNamedDeclaration") continue;
    const declaration = isRecord(statement.declaration) ? statement.declaration : undefined;
    if (declaration !== undefined && declarationName(declaration) === rootName) {
      rootMatches.push({ declaration, rangeNode: statement });
      continue;
    }
    if (
      declaration === undefined &&
      Array.isArray(statement.specifiers) &&
      statement.specifiers.some((rawSpecifier) => {
        const specifier = isRecord(rawSpecifier) ? rawSpecifier : undefined;
        return entityName(specifier?.exported) === rootName;
      })
    ) {
      unsupportedExportMatch = true;
    }
  }
  const missingCode = supporting
    ? "EXTERNAL_SUPPORTING_DECLARATION_MISSING"
    : "EXTERNAL_DECLARATION_MISSING";
  const ambiguousCode = supporting
    ? "EXTERNAL_SUPPORTING_DECLARATION_AMBIGUOUS"
    : "EXTERNAL_DECLARATION_AMBIGUOUS";
  if (rootMatches.length === 0) {
    if (unsupportedExportMatch) {
      fail(
        supporting
          ? "EXTERNAL_SUPPORTING_DECLARATION_UNSUPPORTED"
          : "EXTERNAL_DECLARATION_UNSUPPORTED",
        location,
        `External declaration ${name} uses an unsupported re-export form`,
        { name }
      );
    }
    fail(missingCode, location, `External module does not expose ${name}`, { name });
  }
  if (rootMatches.length !== 1) {
    fail(ambiguousCode, location, `External module exposes ${name} ambiguously`, {
      name,
      declarationCount: rootMatches.length
    });
  }
  let selected = rootMatches[0]!;
  for (const segment of segments.slice(1)) {
    if (selected.declaration.type !== "TSModuleDeclaration") {
      fail(
        "EXTERNAL_SUPPORTING_DECLARATION_UNSUPPORTED",
        location,
        `External supporting declaration ${name} is not a supported namespace member`,
        { name }
      );
    }
    const body = isRecord(selected.declaration.body) ? selected.declaration.body : undefined;
    const statements = Array.isArray(body?.body) ? body.body : [];
    const matches = statements.flatMap((rawStatement) => {
      const statement = isRecord(rawStatement) ? rawStatement : undefined;
      const declaration = statement?.type === "ExportNamedDeclaration"
        ? isRecord(statement.declaration)
          ? statement.declaration
          : undefined
        : statement;
      return declaration !== undefined && declarationName(declaration) === segment
        ? [{ declaration, rangeNode: statement! }]
        : [];
    });
    if (matches.length === 0) {
      fail(
        "EXTERNAL_SUPPORTING_DECLARATION_MISSING",
        location,
        `External namespace does not expose supporting declaration ${name}`,
        { name }
      );
    }
    if (matches.length !== 1) {
      fail(
        "EXTERNAL_SUPPORTING_DECLARATION_AMBIGUOUS",
        location,
        `External namespace exposes supporting declaration ${name} ambiguously`,
        { name, declarationCount: matches.length }
      );
    }
    selected = matches[0]!;
  }
  if (!explicitContractComplete(selected.declaration)) {
    fail(
      supporting ? "EXTERNAL_SUPPORTING_DECLARATION_UNSUPPORTED" : "EXTERNAL_DECLARATION_INCOMPLETE",
      location,
      `External declaration ${name} does not contain one complete explicit contract`,
      { name }
    );
  }
  const start = selected.rangeNode.start;
  const end = selected.rangeNode.end;
  if (typeof start !== "number" || typeof end !== "number") {
    fail(
      supporting ? "EXTERNAL_SUPPORTING_DECLARATION_UNSUPPORTED" : "EXTERNAL_DECLARATION_UNSUPPORTED",
      location,
      `External declaration ${name} has no stable source range`,
      { name }
    );
  }
  const declaration = parsed.source.slice(start, end).trim();
  return {
    name,
    declarationKind: String(selected.declaration.type),
    namespace: namespaceFor(selected.declaration.type),
    declaration,
    declarationDigest: sha256Bytes(declaration),
    node: selected.declaration
  };
}

function entityName(value: unknown): string | undefined {
  const candidate = isRecord(value) ? value : undefined;
  if (candidate?.type === "Identifier" && typeof candidate.name === "string") {
    return candidate.name;
  }
  if (candidate?.type === "TSQualifiedName") {
    const left = entityName(candidate.left);
    const right = entityName(candidate.right);
    return left && right ? `${left}.${right}` : undefined;
  }
  return undefined;
}

function typeParameterNames(value: unknown, names = new Set<string>()): ReadonlySet<string> {
  if (Array.isArray(value)) {
    for (const child of value) typeParameterNames(child, names);
    return names;
  }
  if (!isRecord(value)) return names;
  if (value.type === "TSTypeParameter") {
    const name = entityName(value.name);
    if (name !== undefined) names.add(name);
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== "parent") typeParameterNames(child, names);
  }
  return names;
}

function directTypeReferences(value: unknown): ReadonlyArray<string> {
  const names = new Set<string>();
  const bound = typeParameterNames(value);
  const visit = (child: unknown): void => {
    if (Array.isArray(child)) {
      for (const item of child) visit(item);
      return;
    }
    if (!isRecord(child)) return;
    if (child.type === "TSImportType") {
      fail(
        "EXTERNAL_DECLARATION_UNSUPPORTED",
        "/requests",
        "Inline imported types are outside the approved external evidence subset"
      );
    }
    const entity = child.type === "TSTypeReference"
      ? child.typeName
      : child.type === "TSExpressionWithTypeArguments" || child.type === "TSInterfaceHeritage"
        ? child.expression
        : child.type === "TSTypeQuery"
          ? child.exprName
          : undefined;
    const name = entityName(entity);
    const root = name?.split(".")[0];
    if (
      name !== undefined &&
      root !== undefined &&
      !bound.has(root) &&
      !TYPESCRIPT_GLOBALS.has(root)
    ) {
      names.add(name);
    }
    for (const [key, nested] of Object.entries(child)) {
      if (
        key !== "parent" &&
        key !== "typeName" &&
        key !== "expression" &&
        key !== "exprName"
      ) {
        visit(nested);
      }
    }
  };
  visit(value);
  return [...names].toSorted();
}

function importedDeclarationPath(currentPath: string, source: string): string | undefined {
  if (!source.startsWith(".")) return undefined;
  const joined = `./${relative(".", resolve(dirname(currentPath), source)).split(sep).join("/")}`;
  const normalized = normalizedPackagePath(joined);
  if (normalized === undefined) return undefined;
  if (/\.d\.(?:ts|mts|cts)$/u.test(normalized)) return normalized;
  if (normalized.endsWith(".mts")) return `${normalized.slice(0, -4)}.d.mts`;
  if (normalized.endsWith(".cts")) return `${normalized.slice(0, -4)}.d.cts`;
  if (normalized.endsWith(".ts")) return `${normalized.slice(0, -3)}.d.ts`;
  return undefined;
}

function supportingDeclaration(input: {
  readonly audit: Audit;
  readonly packageRoot: string;
  readonly rootSource: ParsedSource;
  readonly reference: string;
  readonly location: string;
  readonly parsedSources: Map<string, ParsedSource>;
}): ExternalSupportingDeclarationEvidence {
  const [rootName, ...tail] = input.reference.split(".");
  const imported = input.rootSource.imports.get(rootName!);
  let parsed = input.rootSource;
  let selectedName = input.reference;
  if (imported !== undefined) {
    const declarationPath = importedDeclarationPath(parsed.path, imported.source);
    if (declarationPath === undefined) {
      fail(
        "EXTERNAL_SUPPORTING_DECLARATION_UNSUPPORTED",
        input.location,
        `Supporting declaration ${input.reference} leaves the approved package boundary`,
        { reference: input.reference }
      );
    }
    parsed = input.parsedSources.get(declarationPath) ?? parseDeclarationSource(
      input.audit,
      input.packageRoot,
      declarationPath,
      input.location
    );
    input.parsedSources.set(declarationPath, parsed);
    selectedName = imported.kind === "namespace"
      ? tail.join(".")
      : [imported.importedName, ...tail].join(".");
  }
  const selected = selectedDeclaration(parsed, selectedName, input.location, true);
  return {
    name: input.reference,
    declarationKind: selected.declarationKind,
    namespace: selected.namespace,
    declaration: selected.declaration,
    declarationDigest: selected.declarationDigest
  };
}

function packageIdentity(input: {
  readonly audit: Audit;
  readonly projectRoot: string;
  readonly moduleSpecifier: string;
  readonly location: string;
}): {
  readonly packageRoot: string;
  readonly packageName: string;
  readonly version: string;
  readonly integrity: string;
  readonly manifest: PackageManifest;
} {
  const packageName = packageNameFromSpecifier(input.moduleSpecifier);
  if (packageName === undefined) {
    fail(
      "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED",
      input.location,
      "External declaration request must name one package module",
      { from: input.moduleSpecifier }
    );
  }
  const projectStatus = statSync(input.projectRoot);
  if (!projectStatus.isDirectory()) {
    fail("EXTERNAL_PACKAGE_LOCK_UNAVAILABLE", input.location, "Project root is not a directory");
  }
  const packageRoot = resolve(input.projectRoot, "node_modules", packageName);
  let packageStatus;
  try {
    packageStatus = lstatSync(packageRoot);
  } catch {
    fail(
      "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED",
      input.location,
      "Selected external package is not installed",
      { packageName }
    );
  }
  if (!packageStatus!.isDirectory() || packageStatus!.isSymbolicLink()) {
    fail(
      "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED",
      input.location,
      "Selected external package must be one real directory",
      { packageName }
    );
  }
  const lockValue = parseJsonFile(
    input.audit,
    resolve(input.projectRoot, "package-lock.json"),
    input.projectRoot,
    input.location,
    "EXTERNAL_PACKAGE_LOCK_UNAVAILABLE"
  );
  const manifestValue = parseJsonFile(
    input.audit,
    resolve(packageRoot, "package.json"),
    packageRoot,
    input.location,
    "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED"
  );
  const lock = isRecord(lockValue) ? lockValue as PackageLock : undefined;
  const manifest = isRecord(manifestValue) ? manifestValue as PackageManifest : undefined;
  const lockedValue = lock?.packages?.[`node_modules/${packageName}`];
  const locked = isRecord(lockedValue) ? lockedValue : undefined;
  if (
    manifest?.name !== packageName ||
    typeof manifest.version !== "string" ||
    locked?.version !== manifest.version ||
    typeof locked.integrity !== "string"
  ) {
    fail(
      "EXTERNAL_PACKAGE_LOCK_MISMATCH",
      input.location,
      "Installed external package identity does not match its dependency lock entry",
      {
        packageName,
        installedVersion: manifest?.version,
        lockedVersion: locked?.version,
        hasIntegrity: typeof locked?.integrity === "string"
      }
    );
  }
  return {
    packageRoot,
    packageName,
    version: manifest.version,
    integrity: locked.integrity,
    manifest
  };
}

function prepareRequest(input: {
  readonly audit: Audit;
  readonly projectRoot: string;
  readonly request: ExternalDeclarationRequest;
  readonly requestIndex: number;
}): ExternalDeclarationEvidenceBundle["requests"][number] {
  const location = `/requests/${input.requestIndex}`;
  if (
    input.request.from.length === 0 ||
    input.request.purpose.length === 0 ||
    input.request.names.length === 0 ||
    input.request.names.length > MAX_MEMBERS_PER_REQUEST ||
    new Set(input.request.names).size !== input.request.names.length ||
    input.request.names.some((name) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name))
  ) {
    fail(
      "EXTERNAL_EVIDENCE_LIMIT_EXCEEDED",
      location,
      "External declaration request must contain one bounded unique member list",
      { maxMembersPerRequest: MAX_MEMBERS_PER_REQUEST }
    );
  }
  const identity = packageIdentity({
    audit: input.audit,
    projectRoot: input.projectRoot,
    moduleSpecifier: input.request.from,
    location
  });
  const declarationPath = resolveDeclarationEntry({
    manifest: identity.manifest,
    packageName: identity.packageName,
    moduleSpecifier: input.request.from,
    location
  });
  const rootSource = parseDeclarationSource(
    input.audit,
    identity.packageRoot,
    declarationPath,
    location
  );
  const parsedSources = new Map([[declarationPath, rootSource]]);
  let declarationBytes = 0;
  let supportingCount = 0;
  const contracts = input.request.names.map((name, memberIndex) => {
    const memberLocation = `${location}/names/${memberIndex}`;
    const selected = selectedDeclaration(rootSource, name, memberLocation, false);
    declarationBytes += Buffer.byteLength(selected.declaration, "utf8");
    const supportingDeclarations = directTypeReferences(selected.node)
      .map((reference) => supportingDeclaration({
        audit: input.audit,
        packageRoot: identity.packageRoot,
        rootSource,
        reference,
        location: memberLocation,
        parsedSources
      }))
      .toSorted((left, right) => compareText(left.name, right.name));
    supportingCount += supportingDeclarations.length;
    declarationBytes += supportingDeclarations.reduce(
      (total, declaration) => total + Buffer.byteLength(declaration.declaration, "utf8"),
      0
    );
    if (
      supportingCount > MAX_SUPPORTING_DECLARATIONS ||
      declarationBytes > MAX_DECLARATION_BYTES
    ) {
      fail(
        "EXTERNAL_EVIDENCE_LIMIT_EXCEEDED",
        memberLocation,
        "Selected external declarations exceed the approved evidence limits",
        {
          maxSupportingDeclarations: MAX_SUPPORTING_DECLARATIONS,
          maxDeclarationBytes: MAX_DECLARATION_BYTES,
          actualSupportingDeclarations: supportingCount,
          actualDeclarationBytes: declarationBytes
        }
      );
    }
    return {
      name: selected.name,
      declarationKind: selected.declarationKind,
      namespace: selected.namespace,
      declaration: selected.declaration,
      declarationDigest: selected.declarationDigest,
      supportingDeclarations
    };
  });
  return {
    from: input.request.from,
    purpose: input.request.purpose,
    package: {
      name: identity.packageName,
      version: identity.version,
      integrity: identity.integrity
    },
    contracts
  };
}

export function prepareExternalDeclarationEvidence(input: {
  readonly projectRoot: string;
  readonly requests: ReadonlyArray<ExternalDeclarationRequest>;
}): ExternalDeclarationEvidenceResult {
  try {
    const projectRoot = realpathSync(resolve(input.projectRoot));
    if (input.requests.length === 0 || input.requests.length > MAX_REQUESTS) {
      fail(
        "EXTERNAL_EVIDENCE_LIMIT_EXCEEDED",
        "/requests",
        "External declaration evidence requires one bounded request list",
        { maxRequests: MAX_REQUESTS, actualRequests: input.requests.length }
      );
    }
    const audit: Audit = { projectRoot, files: new Map() };
    const requests = input.requests.map((request, requestIndex) =>
      prepareRequest({ audit, projectRoot, request, requestIndex })
    );
    const limits = {
      maxRequests: MAX_REQUESTS,
      maxMembersPerRequest: MAX_MEMBERS_PER_REQUEST,
      maxSourceFiles: MAX_SOURCE_FILES,
      maxSourceBytes: MAX_SOURCE_BYTES,
      maxDeclarationBytes: MAX_DECLARATION_BYTES,
      maxSupportingDeclarations: MAX_SUPPORTING_DECLARATIONS,
      supportingDepth: 1 as const
    };
    const evidence = {
      schemaVersion: EXTERNAL_DECLARATION_EVIDENCE_VERSION,
      parser: { name: "oxc-parser" as const, version: parserPackage.version },
      resolutionProfile: {
        mode: "import" as const,
        typescriptVersion: RESOLUTION_TYPESCRIPT_VERSION
      },
      limits,
      provenance: {
        files: [...audit.files]
          .map(([path, contentDigest]) => ({ path, contentDigest }))
          .toSorted((left, right) => compareText(left.path, right.path))
      },
      requests
    };
    const evidenceDigest = sha256Json(evidence);
    const agentContext = {
      schemaVersion: EXTERNAL_DECLARATION_CONTEXT_VERSION,
      requests,
      evidenceDigest
    };
    const agentContextDigest = sha256Json(agentContext);
    const contentDigest = sha256Json({ evidence, evidenceDigest, agentContext, agentContextDigest });
    return deepFreeze({
      status: "ok",
      bundle: {
        ...evidence,
        evidenceDigest,
        agentContext,
        agentContextDigest,
        contentDigest
      }
    });
  } catch (cause) {
    if (cause instanceof EvidenceFailure) {
      return deepFreeze({ status: "invalid", findings: [cause.finding] });
    }
    return deepFreeze({
      status: "invalid",
      findings: [
        {
          code: "EXTERNAL_PACKAGE_LOCK_UNAVAILABLE",
          location: "/projectRoot",
          message: "External declaration evidence could not bind the canonical project root",
          detail: { cause: cause instanceof Error ? cause.message : String(cause) },
          machineRepairable: false
        }
      ]
    });
  }
}
