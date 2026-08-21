/**
 * PROTOTYPE — bounded external declaration selection for one locked Effect module.
 *
 * Run with:
 *   npm exec -- tsx src/prototypes/effect-external-declaration-evidence.ts
 *
 * This intentionally does not integrate with preparation, Agent Briefs, or the
 * Candidate Declaration Gate.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { parseSync, type Declaration, type ExportNamedDeclaration } from "oxc-parser";

import { canonicalJson, sha256Bytes, sha256Json } from "../canonical.js";

const require = createRequire(import.meta.url);
const parserPackage = require("oxc-parser/package.json") as { readonly version: string };

const SCHEMA_VERSION = "score.prototype.external-declaration-evidence@0.1.0" as const;
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_MEMBERS = 8;
const MAX_DECLARATION_BYTES = 32 * 1024;
const TYPESCRIPT_GLOBALS = new Set(["Array", "ReadonlyArray", "globalThis"]);

interface ReadAudit {
  readonly paths: Set<string>;
}

interface Finding {
  readonly code:
    | "EXTERNAL_DECLARATION_AMBIGUOUS"
    | "EXTERNAL_DECLARATION_MISSING"
    | "EXTERNAL_DECLARATION_UNSUPPORTED"
    | "EXTERNAL_EVIDENCE_LIMIT_EXCEEDED"
    | "EXTERNAL_PACKAGE_LOCK_MISMATCH"
    | "EXTERNAL_PACKAGE_RESOLUTION_FAILED";
  readonly location: string;
  readonly message: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

interface EvidenceSuccess {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly status: "ok";
  readonly evidence: {
    readonly package: {
      readonly name: string;
      readonly version: string;
      readonly integrity: string;
      readonly moduleSpecifier: string;
      readonly declarationPath: string;
    };
    readonly parser: { readonly name: "oxc-parser"; readonly version: string };
    readonly sourceDigest: string;
    readonly declarations: ReadonlyArray<{
      readonly name: string;
      readonly declarationKind: string;
      readonly namespace: "value";
      readonly declaration: string;
      readonly declarationDigest: string;
      readonly references: ReadonlyArray<{
        readonly name: string;
        readonly route:
          | { readonly kind: "imported_member"; readonly source: string }
          | { readonly kind: "same_module" }
          | { readonly kind: "typescript_global" }
          | { readonly kind: "type_parameter" };
      }>;
    }>;
    readonly limits: {
      readonly maxSourceBytes: number;
      readonly maxMembers: number;
      readonly maxDeclarationBytes: number;
    };
    readonly contentDigest: string;
  };
  readonly reads: ReadonlyArray<string>;
}

interface EvidenceInvalid {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly status: "invalid";
  readonly findings: ReadonlyArray<Finding>;
  readonly reads: ReadonlyArray<string>;
}

type EvidenceResult = EvidenceSuccess | EvidenceInvalid;

interface PackageLock {
  readonly packages?: Readonly<Record<string, {
    readonly version?: string;
    readonly integrity?: string;
  }>>;
}

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly exports?: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAuditPath(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath).split(sep).join("/");
}

function readAuditedFile(
  projectRoot: string,
  absolutePath: string,
  audit: ReadAudit,
  maxBytes = MAX_SOURCE_BYTES
): Buffer {
  const realProjectRoot = realpathSync(projectRoot);
  const requested = resolve(absolutePath);
  const realPath = realpathSync(requested);
  const relativePath = relative(realProjectRoot, realPath);
  if (relativePath === "" || relativePath.startsWith(`..${sep}`) || relativePath === "..") {
    throw new Error(`Prototype read escaped the project root: ${requested}`);
  }
  const status = lstatSync(realPath);
  if (!status.isFile() || status.isSymbolicLink() || status.size > maxBytes) {
    throw new Error(`Prototype input is not one bounded regular file: ${requested}`);
  }
  audit.paths.add(normalizeAuditPath(realProjectRoot, realPath));
  return readFileSync(realPath);
}

function parseJsonFile<T>(
  projectRoot: string,
  absolutePath: string,
  audit: ReadAudit
): T {
  return JSON.parse(readAuditedFile(projectRoot, absolutePath, audit).toString("utf8")) as T;
}

function invalid(audit: ReadAudit, finding: Finding): EvidenceInvalid {
  return {
    schemaVersion: SCHEMA_VERSION,
    status: "invalid",
    findings: [finding],
    reads: [...audit.paths].sort()
  };
}

function matchingExportTarget(
  exportsMap: Readonly<Record<string, unknown>>,
  subpath: string
): { readonly target: string; readonly key: string } | undefined {
  const exact = exportsMap[subpath];
  if (typeof exact === "string") return { target: exact, key: subpath };

  const wildcardMatches = Object.entries(exportsMap)
    .flatMap(([key, target]) => {
      if (typeof target !== "string") return [];
      const star = key.indexOf("*");
      if (star === -1 || key.indexOf("*", star + 1) !== -1) return [];
      const prefix = key.slice(0, star);
      const suffix = key.slice(star + 1);
      if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) return [];
      const substitution = subpath.slice(prefix.length, subpath.length - suffix.length);
      return [{ key, target: target.replace("*", substitution), specificity: prefix.length + suffix.length }];
    })
    .sort((left, right) => right.specificity - left.specificity || left.key.localeCompare(right.key));

  if (wildcardMatches.length !== 1) return undefined;
  return { target: wildcardMatches[0]!.target, key: wildcardMatches[0]!.key };
}

function declarationSubstitution(target: string): string | undefined {
  if (target.endsWith(".js")) return `${target.slice(0, -3)}.d.ts`;
  if (target.endsWith(".mjs")) return `${target.slice(0, -4)}.d.mts`;
  if (target.endsWith(".cjs")) return `${target.slice(0, -4)}.d.cts`;
  if (/\.d\.(?:ts|mts|cts)$/u.test(target)) return target;
  return undefined;
}

function declarationName(declaration: Declaration): string | undefined {
  if (declaration.type === "VariableDeclaration") {
    const names = declaration.declarations.flatMap((item) =>
      item.id.type === "Identifier" ? [item.id.name] : []
    );
    return names.length === 1 ? names[0] : undefined;
  }
  if ("id" in declaration && declaration.id?.type === "Identifier") {
    return declaration.id.name;
  }
  return undefined;
}

function collectTypeParameterNames(value: unknown, names: Set<string>, seen = new Set<object>()): void {
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  if (value.type === "TSTypeParameter" && isRecord(value.name) && typeof value.name.name === "string") {
    names.add(value.name.name);
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "parent") continue;
    if (Array.isArray(child)) {
      for (const item of child) collectTypeParameterNames(item, names, seen);
    } else {
      collectTypeParameterNames(child, names, seen);
    }
  }
}

function collectTypeReferenceNames(
  value: unknown,
  source: string,
  names: Set<string>,
  seen = new Set<object>()
): void {
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  if (
    value.type === "TSTypeReference" &&
    isRecord(value.typeName) &&
    typeof value.typeName.start === "number" &&
    typeof value.typeName.end === "number"
  ) {
    names.add(source.slice(value.typeName.start, value.typeName.end));
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "parent") continue;
    if (Array.isArray(child)) {
      for (const item of child) collectTypeReferenceNames(item, source, names, seen);
    } else {
      collectTypeReferenceNames(child, source, names, seen);
    }
  }
}

function selectDeclarations(input: {
  readonly source: string;
  readonly declarationPath: string;
  readonly memberNames: ReadonlyArray<string>;
}):
  | { readonly status: "ok"; readonly declarations: EvidenceSuccess["evidence"]["declarations"] }
  | { readonly status: "invalid"; readonly finding: Finding } {
  if (input.memberNames.length === 0 || input.memberNames.length > MAX_MEMBERS) {
    return {
      status: "invalid",
      finding: {
        code: "EXTERNAL_EVIDENCE_LIMIT_EXCEEDED",
        location: "/members",
        message: "Requested external declaration members exceed the bounded experiment limit",
        detail: { maxMembers: MAX_MEMBERS, actualMembers: input.memberNames.length }
      }
    };
  }

  const parsed = parseSync(input.declarationPath, input.source, {
    lang: "dts",
    sourceType: "module",
    astType: "ts",
    range: true,
    preserveParens: true,
    showSemanticErrors: true
  });
  const errors = parsed.errors.filter((error) => error.severity === "Error");
  if (errors.length > 0) {
    return {
      status: "invalid",
      finding: {
        code: "EXTERNAL_DECLARATION_UNSUPPORTED",
        location: "/source",
        message: "The selected external declaration source did not parse cleanly",
        detail: { messages: errors.map((error) => error.message) }
      }
    };
  }

  const imports = new Map(
    parsed.module.staticImports.flatMap((item) =>
      item.entries.flatMap((entry) =>
        entry.localName.value === "" ? [] : [[entry.localName.value, item.moduleRequest.value] as const]
      )
    )
  );
  const selected: Array<EvidenceSuccess["evidence"]["declarations"][number]> = [];
  let declarationBytes = 0;

  for (const memberName of input.memberNames) {
    const matches = parsed.program.body.flatMap((statement) => {
      if (statement.type !== "ExportNamedDeclaration" || statement.declaration === null) return [];
      return declarationName(statement.declaration) === memberName
        ? [{ statement, declaration: statement.declaration }]
        : [];
    });
    if (matches.length === 0) {
      return {
        status: "invalid",
        finding: {
          code: "EXTERNAL_DECLARATION_MISSING",
          location: `/members/${memberName}`,
          message: `External module does not export ${memberName}`,
          detail: { declarationPath: input.declarationPath, memberName }
        }
      };
    }
    if (matches.length > 1) {
      return {
        status: "invalid",
        finding: {
          code: "EXTERNAL_DECLARATION_AMBIGUOUS",
          location: `/members/${memberName}`,
          message: `External module exports more than one declaration named ${memberName}`,
          detail: { declarationPath: input.declarationPath, memberName, count: matches.length }
        }
      };
    }

    const { statement, declaration } = matches[0]! as {
      readonly statement: ExportNamedDeclaration;
      readonly declaration: Declaration;
    };
    const declarationText = input.source.slice(statement.start, statement.end);
    declarationBytes += Buffer.byteLength(declarationText, "utf8");
    if (declarationBytes > MAX_DECLARATION_BYTES) {
      return {
        status: "invalid",
        finding: {
          code: "EXTERNAL_EVIDENCE_LIMIT_EXCEEDED",
          location: "/members",
          message: "Selected external declaration bytes exceed the bounded experiment limit",
          detail: { maxDeclarationBytes: MAX_DECLARATION_BYTES, actualDeclarationBytes: declarationBytes }
        }
      };
    }

    const typeParameters = new Set<string>();
    collectTypeParameterNames(declaration, typeParameters);
    const referenceNames = new Set<string>();
    collectTypeReferenceNames(declaration, input.source, referenceNames);
    const references = [...referenceNames]
      .sort()
      .map((name) => {
        const root = name.split(".", 1)[0]!;
        const importedFrom = imports.get(root);
        const route = typeParameters.has(root)
          ? ({ kind: "type_parameter" } as const)
          : TYPESCRIPT_GLOBALS.has(root)
            ? ({ kind: "typescript_global" } as const)
            : importedFrom !== undefined
              ? ({ kind: "imported_member", source: importedFrom } as const)
              : ({ kind: "same_module" } as const);
        return { name, route };
      });

    selected.push({
      name: memberName,
      declarationKind: declaration.type,
      namespace: "value",
      declaration: declarationText,
      declarationDigest: sha256Bytes(declarationText),
      references
    });
  }
  return { status: "ok", declarations: selected };
}

function extractExternalEvidence(input: {
  readonly projectRoot: string;
  readonly packageName: string;
  readonly moduleSpecifier: string;
  readonly memberNames: ReadonlyArray<string>;
}): EvidenceResult {
  const audit: ReadAudit = { paths: new Set() };
  const packageRoot = join(input.projectRoot, "node_modules", input.packageName);
  const lock = parseJsonFile<PackageLock>(
    input.projectRoot,
    join(input.projectRoot, "package-lock.json"),
    audit
  );
  const manifest = parseJsonFile<PackageManifest>(
    input.projectRoot,
    join(packageRoot, "package.json"),
    audit
  );
  const locked = lock.packages?.[`node_modules/${input.packageName}`];
  if (
    manifest.name !== input.packageName ||
    typeof manifest.version !== "string" ||
    locked?.version !== manifest.version ||
    typeof locked.integrity !== "string"
  ) {
    return invalid(audit, {
      code: "EXTERNAL_PACKAGE_LOCK_MISMATCH",
      location: "/package",
      message: "Installed external package identity does not match the frozen dependency lock",
      detail: {
        packageName: input.packageName,
        installedVersion: manifest.version,
        lockedVersion: locked?.version,
        hasIntegrity: typeof locked?.integrity === "string"
      }
    });
  }
  if (!isRecord(manifest.exports)) {
    return invalid(audit, {
      code: "EXTERNAL_PACKAGE_RESOLUTION_FAILED",
      location: "/moduleSpecifier",
      message: "External package has no supported exports map",
      detail: { packageName: input.packageName }
    });
  }

  const suffix = input.moduleSpecifier === input.packageName
    ? "."
    : input.moduleSpecifier.startsWith(`${input.packageName}/`)
      ? `./${input.moduleSpecifier.slice(input.packageName.length + 1)}`
      : undefined;
  const resolved = suffix === undefined ? undefined : matchingExportTarget(manifest.exports, suffix);
  const declarationTarget = resolved === undefined ? undefined : declarationSubstitution(resolved.target);
  if (
    declarationTarget === undefined ||
    !declarationTarget.startsWith("./") ||
    declarationTarget.includes("..")
  ) {
    return invalid(audit, {
      code: "EXTERNAL_PACKAGE_RESOLUTION_FAILED",
      location: "/moduleSpecifier",
      message: "External package module did not resolve to one supported declaration entry",
      detail: { packageName: input.packageName, moduleSpecifier: input.moduleSpecifier }
    });
  }

  const declarationAbsolutePath = resolve(packageRoot, declarationTarget);
  const sourceBytes = readAuditedFile(
    input.projectRoot,
    declarationAbsolutePath,
    audit,
    MAX_SOURCE_BYTES
  );
  const source = sourceBytes.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(sourceBytes)) {
    return invalid(audit, {
      code: "EXTERNAL_DECLARATION_UNSUPPORTED",
      location: "/source",
      message: "External declaration source is not exact UTF-8",
      detail: { declarationTarget }
    });
  }

  const selected = selectDeclarations({
    source,
    declarationPath: declarationTarget,
    memberNames: input.memberNames
  });
  if (selected.status === "invalid") return invalid(audit, selected.finding);

  const evidenceWithoutDigest = {
    package: {
      name: input.packageName,
      version: manifest.version,
      integrity: locked.integrity,
      moduleSpecifier: input.moduleSpecifier,
      declarationPath: declarationTarget
    },
    parser: { name: "oxc-parser" as const, version: parserPackage.version },
    sourceDigest: sha256Bytes(sourceBytes),
    declarations: selected.declarations,
    limits: {
      maxSourceBytes: MAX_SOURCE_BYTES,
      maxMembers: MAX_MEMBERS,
      maxDeclarationBytes: MAX_DECLARATION_BYTES
    }
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    status: "ok",
    evidence: {
      ...evidenceWithoutDigest,
      contentDigest: sha256Json(evidenceWithoutDigest)
    },
    reads: [...audit.paths].sort()
  };
}

const projectRoot = process.cwd();
const validInput = {
  projectRoot,
  packageName: "effect",
  moduleSpecifier: "effect/Schema",
  memberNames: ["check", "isPattern"]
} as const;

const first = extractExternalEvidence(validInput);
const second = extractExternalEvidence(validInput);
const missing = extractExternalEvidence({
  ...validInput,
  memberNames: ["pattern"]
});

assert.equal(first.status, "ok");
assert.equal(second.status, "ok");
assert.equal(canonicalJson(first), canonicalJson(second));
assert.deepEqual(first.reads, [
  "node_modules/effect/dist/Schema.d.ts",
  "node_modules/effect/package.json",
  "package-lock.json"
]);
assert.deepEqual(first.evidence.declarations.map(({ name }) => name), ["check", "isPattern"]);
assert.match(first.evidence.declarations[0]!.declaration, /function check<S extends Top>/u);
assert.match(first.evidence.declarations[1]!.declaration, /function isPattern\(regExp: globalThis\.RegExp/u);
assert.equal(missing.status, "invalid");
assert.deepEqual(missing.findings.map(({ code }) => code), ["EXTERNAL_DECLARATION_MISSING"]);

const report = {
  experiment: "bounded Effect declaration evidence",
  question:
    "Can SCORE select exact contracts from one locked Effect module without recursively reading dependency internals?",
  verdict: "successful",
  assertions: {
    lockedPackageIdentityMatched: true,
    exactModuleDeclarationResolved: true,
    requestedMembersExtracted: first.evidence.declarations.map(({ name }) => name),
    unavailableMemberFinding: missing.findings[0]!.code,
    identicalRunsAreByteIdentical: true,
    unrelatedDependencyEvidenceFilesRead: false
  },
  validEvidence: first,
  missingMemberResult: missing
};

process.stdout.write(`${canonicalJson(report)}\n`);
