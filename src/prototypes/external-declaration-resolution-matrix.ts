/**
 * PROTOTYPE — tiny, fully in-memory package declaration-resolution matrix.
 *
 * Run with:
 *   npm exec -- tsx src/prototypes/external-declaration-resolution-matrix.ts
 *
 * This does not read a real package, tsconfig, project source, or node_modules
 * declaration. It does not invoke the TypeScript compiler or project service.
 */

import assert from "node:assert/strict";

import { parseSync, type Declaration } from "oxc-parser";

import { canonicalJson, sha256Bytes, sha256Json } from "../canonical.js";

const SCHEMA_VERSION = "score.prototype.external-resolution-matrix@0.1.0" as const;
const MAX_PACKAGE_FILES = 8;
const MAX_DECLARATION_BYTES = 4096;

interface FrozenPackage {
  readonly manifest: {
    readonly name: string;
    readonly version: string;
    readonly exports?: Readonly<Record<string, unknown>>;
    readonly types?: string;
    readonly typings?: string;
    readonly typesVersions?: Readonly<Record<string, Readonly<Record<string, ReadonlyArray<string>>>>>;
  };
  readonly integrity: string;
  readonly files: Readonly<Record<string, string>>;
}

interface ResolutionProfile {
  readonly typescriptVersion: string;
  readonly mode: "import" | "require";
}

type FindingCode =
  | "EXTERNAL_DECLARATION_SOURCE_MISSING"
  | "EXTERNAL_EXPORT_CONDITION_UNRESOLVED"
  | "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED"
  | "EXTERNAL_RESOLUTION_LIMIT_EXCEEDED";

interface ResolutionSuccess {
  readonly status: "ok";
  readonly route: "exports" | "typesVersions" | "types" | "typings";
  readonly declarationPath: string;
  readonly declaration: string;
  readonly declarationDigest: string;
  readonly evidenceDigest: string;
}

interface ResolutionInvalid {
  readonly status: "invalid";
  readonly finding: {
    readonly code: FindingCode;
    readonly message: string;
    readonly detail: Readonly<Record<string, unknown>>;
  };
}

type ResolutionResult = ResolutionSuccess | ResolutionInvalid;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedPackagePath(value: string): string | undefined {
  if (!value.startsWith("./") || value.includes("\\")) return undefined;
  const segments = value.slice(2).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return `./${segments.join("/")}`;
}

function parseVersion(value: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(value);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function matchesFrozenVersionRange(range: string, version: string): boolean | undefined {
  if (range === "*") return true;
  const versionParts = parseVersion(version);
  const match = /^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u.exec(range);
  if (versionParts === undefined || match === null) return undefined;
  const wanted = [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] as const;
  for (let index = 0; index < 3; index += 1) {
    if (versionParts[index]! > wanted[index]!) return true;
    if (versionParts[index]! < wanted[index]!) return false;
  }
  return true;
}

function selectConditionalTarget(
  value: unknown,
  profile: ResolutionProfile
): string | "unsupported" | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "unsupported";
  for (const [condition, target] of Object.entries(value)) {
    const versionedTypes = condition.startsWith("types@")
      ? matchesFrozenVersionRange(condition.slice("types@".length), profile.typescriptVersion)
      : undefined;
    if (versionedTypes === undefined && condition.startsWith("types@")) return "unsupported";
    const active =
      condition === "default" ||
      condition === "types" ||
      condition === profile.mode ||
      versionedTypes === true;
    if (!active) continue;
    const selected = selectConditionalTarget(target, profile);
    if (selected !== undefined) return selected;
  }
  return undefined;
}

function matchSubpathExport(
  exportsMap: Readonly<Record<string, unknown>>,
  subpath: string
): unknown {
  if (subpath in exportsMap) return exportsMap[subpath];
  const matches = Object.entries(exportsMap)
    .flatMap(([key, target]) => {
      const star = key.indexOf("*");
      if (star === -1 || key.indexOf("*", star + 1) !== -1) return [];
      const prefix = key.slice(0, star);
      const suffix = key.slice(star + 1);
      if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) return [];
      const substitution = subpath.slice(prefix.length, subpath.length - suffix.length);
      const replace = (value: unknown): unknown => {
        if (typeof value === "string") return value.replace("*", substitution);
        if (!isRecord(value)) return value;
        return Object.fromEntries(Object.entries(value).map(([condition, nested]) => [
          condition,
          replace(nested)
        ]));
      };
      return [{ specificity: prefix.length + suffix.length, target: replace(target) }];
    })
    .sort((left, right) => right.specificity - left.specificity);
  return matches.length === 1 ? matches[0]!.target : undefined;
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

function applyTypesVersions(
  pkg: FrozenPackage,
  profile: ResolutionProfile,
  baseTarget: string
): string | "unsupported" | undefined {
  if (pkg.manifest.typesVersions === undefined) return undefined;
  for (const [range, mappings] of Object.entries(pkg.manifest.typesVersions)) {
    const matches = matchesFrozenVersionRange(range, profile.typescriptVersion);
    if (matches === undefined) return "unsupported";
    if (!matches) continue;
    const relativeTarget = baseTarget.startsWith("./") ? baseTarget.slice(2) : baseTarget;
    for (const [pattern, substitutions] of Object.entries(mappings)) {
      if (pattern !== "*" || substitutions.length !== 1) return "unsupported";
      return normalizedPackagePath(`./${substitutions[0]!.replace("*", relativeTarget)}`) ?? "unsupported";
    }
    return undefined;
  }
  return undefined;
}

function declarationName(declaration: Declaration): string | undefined {
  if (declaration.type === "VariableDeclaration") {
    const names = declaration.declarations.flatMap((item) =>
      item.id.type === "Identifier" ? [item.id.name] : []
    );
    return names.length === 1 ? names[0] : undefined;
  }
  if ("id" in declaration && declaration.id?.type === "Identifier") return declaration.id.name;
  return undefined;
}

function selectContract(source: string, declarationPath: string): string | undefined {
  const parsed = parseSync(declarationPath, source, {
    lang: "dts",
    sourceType: "module",
    astType: "ts",
    range: true,
    showSemanticErrors: true
  });
  if (parsed.errors.some((error) => error.severity === "Error")) return undefined;
  const matches = parsed.program.body.flatMap((statement) => {
    if (statement.type !== "ExportNamedDeclaration" || statement.declaration === null) return [];
    return declarationName(statement.declaration) === "contract"
      ? [source.slice(statement.start, statement.end)]
      : [];
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function resolveDeclaration(
  pkg: FrozenPackage,
  moduleSpecifier: string,
  profile: ResolutionProfile
): ResolutionResult {
  if (Object.keys(pkg.files).length > MAX_PACKAGE_FILES) {
    return {
      status: "invalid",
      finding: {
        code: "EXTERNAL_RESOLUTION_LIMIT_EXCEEDED",
        message: "Frozen package fixture exceeds the experiment file limit",
        detail: { maxPackageFiles: MAX_PACKAGE_FILES, actualPackageFiles: Object.keys(pkg.files).length }
      }
    };
  }
  const subpath = moduleSpecifier === pkg.manifest.name
    ? "."
    : moduleSpecifier.startsWith(`${pkg.manifest.name}/`)
      ? `./${moduleSpecifier.slice(pkg.manifest.name.length + 1)}`
      : undefined;
  if (subpath === undefined) {
    return {
      status: "invalid",
      finding: {
        code: "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED",
        message: "Module specifier does not belong to the frozen package",
        detail: { moduleSpecifier, packageName: pkg.manifest.name }
      }
    };
  }

  let route: ResolutionSuccess["route"];
  let target: string | "unsupported" | undefined;
  if (pkg.manifest.exports !== undefined) {
    route = "exports";
    target = selectConditionalTarget(matchSubpathExport(pkg.manifest.exports, subpath), profile);
    if (target === undefined) {
      return {
        status: "invalid",
        finding: {
          code: "EXTERNAL_EXPORT_CONDITION_UNRESOLVED",
          message: "No approved export condition selected a declaration entry",
          detail: { moduleSpecifier, mode: profile.mode }
        }
      };
    }
  } else {
    const baseTarget = pkg.manifest.types ?? pkg.manifest.typings;
    if (baseTarget === undefined) {
      return {
        status: "invalid",
        finding: {
          code: "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED",
          message: "Package has no supported declaration entry metadata",
          detail: { moduleSpecifier }
        }
      };
    }
    const versioned = applyTypesVersions(pkg, profile, baseTarget);
    if (versioned !== undefined) {
      route = "typesVersions";
      target = versioned;
    } else {
      route = pkg.manifest.types !== undefined ? "types" : "typings";
      target = baseTarget;
    }
  }

  if (target === "unsupported") {
    return {
      status: "invalid",
      finding: {
        code: "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED",
        message: "Package uses resolution syntax outside the bounded experiment subset",
        detail: { moduleSpecifier }
      }
    };
  }
  const declarationPath = declarationSubstitution(target);
  if (declarationPath === undefined) {
    return {
      status: "invalid",
      finding: {
        code: "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED",
        message: "Selected package target has no supported declaration substitution",
        detail: { moduleSpecifier, target }
      }
    };
  }
  const source = pkg.files[declarationPath];
  if (source === undefined) {
    return {
      status: "invalid",
      finding: {
        code: "EXTERNAL_DECLARATION_SOURCE_MISSING",
        message: "Selected declaration entry is absent from the frozen package",
        detail: { moduleSpecifier, declarationPath }
      }
    };
  }
  if (Buffer.byteLength(source, "utf8") > MAX_DECLARATION_BYTES) {
    return {
      status: "invalid",
      finding: {
        code: "EXTERNAL_RESOLUTION_LIMIT_EXCEEDED",
        message: "Selected declaration entry exceeds the experiment byte limit",
        detail: { declarationPath, maxDeclarationBytes: MAX_DECLARATION_BYTES }
      }
    };
  }
  const declaration = selectContract(source, declarationPath);
  if (declaration === undefined) {
    return {
      status: "invalid",
      finding: {
        code: "EXTERNAL_PACKAGE_LAYOUT_UNSUPPORTED",
        message: "Selected declaration entry does not contain one usable contract export",
        detail: { declarationPath }
      }
    };
  }
  const withoutDigest = {
    package: {
      name: pkg.manifest.name,
      version: pkg.manifest.version,
      integrity: pkg.integrity
    },
    moduleSpecifier,
    profile,
    route,
    declarationPath,
    declaration,
    declarationDigest: sha256Bytes(declaration)
  };
  return {
    status: "ok",
    route,
    declarationPath,
    declaration,
    declarationDigest: withoutDigest.declarationDigest,
    evidenceDigest: sha256Json(withoutDigest)
  };
}

const conditionalPackage: FrozenPackage = {
  manifest: {
    name: "conditional-pkg",
    version: "1.0.0",
    exports: {
      "./feature": {
        import: {
          types: "./types/import-feature.d.mts",
          default: "./esm/feature.mjs"
        },
        require: {
          types: "./types/require-feature.d.cts",
          default: "./cjs/feature.cjs"
        }
      },
      "./wild/*": {
        types: "./types/wild/*.d.ts",
        default: "./dist/wild/*.js"
      }
    }
  },
  integrity: "sha512:conditional-fixture",
  files: {
    "./types/import-feature.d.mts": "export declare function contract(): \"import-types\";",
    "./types/require-feature.d.cts": "export declare function contract(): \"require-types\";",
    "./types/wild/name.d.ts": "export declare function contract(): \"wildcard-types\";"
  }
};

const typesVersionsPackage: FrozenPackage = {
  manifest: {
    name: "versioned-pkg",
    version: "2.0.0",
    types: "./index.d.ts",
    typesVersions: {
      ">=7": { "*": ["ts7/*"] },
      "*": { "*": ["legacy/*"] }
    }
  },
  integrity: "sha512:types-versions-fixture",
  files: {
    "./ts7/index.d.ts": "export declare function contract(): \"ts7\";",
    "./legacy/index.d.ts": "export declare function contract(): \"legacy\";"
  }
};

const noMatchingConditionPackage: FrozenPackage = {
  manifest: {
    name: "custom-condition-pkg",
    version: "1.0.0",
    exports: {
      "./feature": { browser: "./browser/feature.js" }
    }
  },
  integrity: "sha512:custom-condition-fixture",
  files: {}
};

const generatedTypesMissingPackage: FrozenPackage = {
  manifest: {
    name: "generated-types-pkg",
    version: "1.0.0",
    exports: {
      "./feature": { types: "./generated/feature.d.ts", default: "./dist/feature.js" }
    }
  },
  integrity: "sha512:generated-types-fixture",
  files: {}
};

const scenarios = [
  {
    name: "conditional import types",
    result: resolveDeclaration(conditionalPackage, "conditional-pkg/feature", {
      typescriptVersion: "7.0.2",
      mode: "import"
    }),
    expected: { status: "ok", route: "exports", declarationPath: "./types/import-feature.d.mts" }
  },
  {
    name: "conditional require types",
    result: resolveDeclaration(conditionalPackage, "conditional-pkg/feature", {
      typescriptVersion: "7.0.2",
      mode: "require"
    }),
    expected: { status: "ok", route: "exports", declarationPath: "./types/require-feature.d.cts" }
  },
  {
    name: "conditional wildcard types",
    result: resolveDeclaration(conditionalPackage, "conditional-pkg/wild/name", {
      typescriptVersion: "7.0.2",
      mode: "import"
    }),
    expected: { status: "ok", route: "exports", declarationPath: "./types/wild/name.d.ts" }
  },
  {
    name: "typesVersions selects frozen TypeScript generation",
    result: resolveDeclaration(typesVersionsPackage, "versioned-pkg", {
      typescriptVersion: "7.0.2",
      mode: "import"
    }),
    expected: { status: "ok", route: "typesVersions", declarationPath: "./ts7/index.d.ts" }
  },
  {
    name: "unknown custom condition fails closed",
    result: resolveDeclaration(noMatchingConditionPackage, "custom-condition-pkg/feature", {
      typescriptVersion: "7.0.2",
      mode: "import"
    }),
    expected: { status: "invalid", code: "EXTERNAL_EXPORT_CONDITION_UNRESOLVED" }
  },
  {
    name: "generated declaration missing fails closed",
    result: resolveDeclaration(generatedTypesMissingPackage, "generated-types-pkg/feature", {
      typescriptVersion: "7.0.2",
      mode: "import"
    }),
    expected: { status: "invalid", code: "EXTERNAL_DECLARATION_SOURCE_MISSING" }
  }
] as const;

for (const scenario of scenarios) {
  assert.equal(scenario.result.status, scenario.expected.status, scenario.name);
  if (scenario.result.status === "ok" && "route" in scenario.expected) {
    assert.equal(scenario.result.route, scenario.expected.route, scenario.name);
    assert.equal(scenario.result.declarationPath, scenario.expected.declarationPath, scenario.name);
  }
  if (scenario.result.status === "invalid" && "code" in scenario.expected) {
    assert.equal(scenario.result.finding.code, scenario.expected.code, scenario.name);
  }
}

const reportWithoutDigest = {
  schemaVersion: SCHEMA_VERSION,
  question:
    "Can frozen package metadata select conditional and versioned declaration entries while tiny controlled strange layouts fail closed?",
  verdict: "successful",
  executionBoundary: {
    packageFixtures: "in_memory",
    projectFilesRead: false,
    realNodeModulesDeclarationsRead: false,
    tsconfigRead: false,
    typescriptCompilerOrProjectServiceInvoked: false,
    oxcParsesSelectedDeclarationOnly: true
  },
  bounds: {
    maxPackageFiles: MAX_PACKAGE_FILES,
    maxDeclarationBytes: MAX_DECLARATION_BYTES,
    positiveScenarios: 4,
    strangePackageScenarios: 2
  },
  scenarios: scenarios.map(({ name, result }) => ({ name, result }))
};
const report = {
  ...reportWithoutDigest,
  reportDigest: sha256Json(reportWithoutDigest)
};

const first = canonicalJson(report);
const second = canonicalJson({ ...reportWithoutDigest, reportDigest: sha256Json(reportWithoutDigest) });
assert.equal(first, second);
process.stdout.write(`${first}\n`);
