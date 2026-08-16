import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tsxPath = join(repositoryRoot, "node_modules", ".bin", "tsx");
const cliPath = join(repositoryRoot, "src", "cli.ts");

const moduleSource =
  'import type { Account } from "./account.js";\n' +
  'import { formatStatus as format } from "./format.js";\n' +
  "\n" +
  "export interface AccountView {\n" +
  "  readonly id: string;\n" +
  "  readonly label: string;\n" +
  "}\n" +
  "\n" +
  'export const DEFAULT_LABEL: string = "Unknown";\n' +
  "\n" +
  "export function buildAccountView(account: Account, label: string): AccountView {\n" +
  "  return { id: account.id, label };\n" +
  "}\n";

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "score-inspect-module-"));
  const sourcePath = join(root, "src", "account-view.ts");
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, moduleSource, "utf8");
  return realpathSync(root);
}

function runCli(projectRoot: string, args: ReadonlyArray<string>) {
  return spawnSync(tsxPath, [cliPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 20_000
  });
}

describe("score inspect-module CLI", () => {
  it("discovers the compact TypeScript module surface without returning implementation bodies", () => {
    const projectRoot = createProject();
    try {
      const result = runCli(projectRoot, ["inspect-module", "src/account-view.ts"]);

      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.match(result.stdout, /^[^\n]+\n$/u);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(output.schemaVersion, "score.inspect-module@0.2.0");
      assert.equal(output.status, "ok");
      assert.equal(output.mode, "discovery");
      assert.deepEqual(output.module, {
        path: "src/account-view.ts",
        contentDigest: "sha256:9fa21b107cfbf4daac539e2a97a465748b71f28673c317becd0be90faf3c5dc1",
        language: "typescript",
        parser: { name: "oxc-parser", version: "0.144.0" }
      });
      assert.deepEqual(output.diagnostics, []);
      assert.deepEqual(output.imports, [
        {
          source: "./account.js",
          importedName: "Account",
          localName: "Account",
          kind: "type",
          range: { start: 0, end: 44 }
        },
        {
          source: "./format.js",
          importedName: "formatStatus",
          localName: "format",
          kind: "value",
          range: { start: 45, end: 98 }
        }
      ]);
      assert.deepEqual(output.exports, [
        {
          name: "AccountView",
          declarationKind: "interface",
          namespace: "type",
          contractAvailable: true,
          range: { start: 100, end: 181 }
        },
        {
          name: "DEFAULT_LABEL",
          declarationKind: "const",
          namespace: "value",
          contractAvailable: true,
          range: { start: 183, end: 230 }
        },
        {
          name: "buildAccountView",
          declarationKind: "function",
          namespace: "value",
          contractAvailable: true,
          range: { start: 232, end: 350 }
        }
      ]);
      assert.doesNotMatch(result.stdout, /return \{ id: account\.id, label \}/u);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("projects one selected export into exact context and an intentional Slice Draft binding seed", () => {
    const projectRoot = createProject();
    try {
      const result = runCli(projectRoot, [
        "inspect-module",
        "src/account-view.ts",
        "--export",
        "buildAccountView"
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.match(result.stdout, /^[^\n]+\n$/u);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(output.schemaVersion, "score.inspect-module@0.2.0");
      assert.equal(output.status, "ok");
      assert.equal(output.mode, "contract");
      assert.deepEqual(output.module, {
        path: "src/account-view.ts",
        contentDigest: "sha256:9fa21b107cfbf4daac539e2a97a465748b71f28673c317becd0be90faf3c5dc1",
        language: "typescript",
        parser: { name: "oxc-parser", version: "0.144.0" }
      });
      assert.deepEqual(output.diagnostics, []);
      assert.deepEqual(output.selectedExport, {
        name: "buildAccountView",
        declarationKind: "function",
        namespace: "value",
        declaration:
          "export function buildAccountView(account: Account, label: string): AccountView;",
        references: [
          {
            name: "Account",
            roles: ["parameter_type"],
            resolution: {
              kind: "import",
              source: "./account.js",
              importedName: "Account",
              localName: "Account",
              importKind: "type"
            }
          },
          {
            name: "AccountView",
            roles: ["return_type"],
            resolution: {
              kind: "local_export",
              name: "AccountView",
              declarationKind: "interface",
              namespace: "type"
            }
          }
        ],
        range: { start: 232, end: 350 }
      });
      assert.deepEqual(output.sliceDraftContext, {
        ownerPath: "src/account-view.ts",
        ownedDeclarationSeed: {
          name: "buildAccountView",
          declaration:
            "export function buildAccountView(account: Account, label: string): AccountView;"
        },
        consumerReference: {
          name: "buildAccountView",
          from: "src/account-view.ts"
        },
        authorMustSupply: ["ownedDeclaration.description", "consumerPath"]
      });
      assert.doesNotMatch(result.stdout, /return \{ id: account\.id, label \}/u);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("resolves the complete relative TypeScript declaration closure for Slice context", () => {
    const projectRoot = createProject();
    try {
      writeFileSync(
        join(projectRoot, "src", "account.ts"),
        'import type { AccountId } from "./account-id.js";\n' +
          "export interface Account { readonly id: AccountId; readonly aliases: ReadonlyArray<string>; }\n",
        "utf8"
      );
      writeFileSync(
        join(projectRoot, "src", "account-id.ts"),
        "export type AccountId = string;\n",
        "utf8"
      );

      const result = runCli(projectRoot, [
        "inspect-module",
        "src/account-view.ts",
        "--export",
        "buildAccountView",
        "--closure"
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      const output = JSON.parse(result.stdout) as {
        readonly schemaVersion: string;
        readonly status: string;
        readonly mode: string;
        readonly root: { readonly path: string; readonly exportName: string };
        readonly contracts: ReadonlyArray<{
          readonly module: { readonly path: string };
          readonly selectedExport: {
            readonly name: string;
            readonly declaration: string;
          };
        }>;
        readonly sliceDraftContext: {
          readonly rootDeclaration: Record<string, unknown>;
          readonly supportingDeclarations: ReadonlyArray<Record<string, unknown>>;
          readonly authorMustSupply: ReadonlyArray<string>;
        };
      };
      assert.equal(output.schemaVersion, "score.inspect-module@0.2.0");
      assert.equal(output.status, "ok");
      assert.equal(output.mode, "closure");
      assert.deepEqual(output.root, {
        path: "src/account-view.ts",
        exportName: "buildAccountView"
      });
      assert.deepEqual(
        output.contracts.map((contract) => ({
          path: contract.module.path,
          name: contract.selectedExport.name,
          declaration: contract.selectedExport.declaration
        })),
        [
          {
            path: "src/account-view.ts",
            name: "buildAccountView",
            declaration:
              "export function buildAccountView(account: Account, label: string): AccountView;"
          },
          {
            path: "src/account.ts",
            name: "Account",
            declaration:
              "export interface Account { readonly id: AccountId; readonly aliases: ReadonlyArray<string>; }"
          },
          {
            path: "src/account-id.ts",
            name: "AccountId",
            declaration: "export type AccountId = string;"
          },
          {
            path: "src/account-view.ts",
            name: "AccountView",
            declaration:
              "export interface AccountView {\n" +
              "  readonly id: string;\n" +
              "  readonly label: string;\n" +
              "}"
          }
        ]
      );
      assert.deepEqual(output.sliceDraftContext.rootDeclaration, {
        ownerPath: "src/account-view.ts",
        name: "buildAccountView",
        declaration:
          "export function buildAccountView(account: Account, label: string): AccountView;"
      });
      assert.deepEqual(
        output.sliceDraftContext.supportingDeclarations.map(
          ({ ownerPath, name, declaration }) => ({ ownerPath, name, declaration })
        ),
        [
          {
            ownerPath: "src/account.ts",
            name: "Account",
            declaration:
              "export interface Account { readonly id: AccountId; readonly aliases: ReadonlyArray<string>; }"
          },
          {
            ownerPath: "src/account-id.ts",
            name: "AccountId",
            declaration: "export type AccountId = string;"
          },
          {
            ownerPath: "src/account-view.ts",
            name: "AccountView",
            declaration:
              "export interface AccountView {\n" +
              "  readonly id: string;\n" +
              "  readonly label: string;\n" +
              "}"
          }
        ]
      );
      assert.deepEqual(output.sliceDraftContext.authorMustSupply, [
        "declarations[].description",
        "consumerPath",
        "exactImportAndUsage",
        "callerObservableBehavior"
      ]);
      assert.doesNotMatch(result.stdout, /return \{ id: account\.id, label \}/u);
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for unprovable module resolution and terminates declaration cycles", () => {
    const projectRoot = createProject();
    try {
      writeFileSync(
        join(projectRoot, "src", "bare.ts"),
        'import type { External } from "external-package";\n' +
          "export function useExternal(value: External): void {}\n",
        "utf8"
      );
      writeFileSync(
        join(projectRoot, "src", "missing.ts"),
        'import type { Missing } from "./not-present.js";\n' +
          "export function useMissing(value: Missing): void {}\n",
        "utf8"
      );
      writeFileSync(
        join(projectRoot, "src", "ambiguous.ts"),
        'import type { Shared } from "./shared.js";\n' +
          "export function useShared(value: Shared): void {}\n",
        "utf8"
      );
      writeFileSync(
        join(projectRoot, "src", "shared.ts"),
        "export interface Shared { readonly source: 'ts' }\n",
        "utf8"
      );
      writeFileSync(
        join(projectRoot, "src", "shared.tsx"),
        "export interface Shared { readonly source: 'tsx' }\n",
        "utf8"
      );

      const failures = [
        {
          path: "src/bare.ts",
          exportName: "useExternal",
          code: "MODULE_CLOSURE_SPECIFIER_UNSUPPORTED"
        },
        {
          path: "src/missing.ts",
          exportName: "useMissing",
          code: "MODULE_CLOSURE_MODULE_NOT_FOUND"
        },
        {
          path: "src/ambiguous.ts",
          exportName: "useShared",
          code: "MODULE_CLOSURE_MODULE_AMBIGUOUS"
        }
      ];
      for (const failure of failures) {
        const result = runCli(projectRoot, [
          "inspect-module",
          failure.path,
          "--export",
          failure.exportName,
          "--closure"
        ]);
        assert.equal(result.status, 2, result.stderr);
        const output = JSON.parse(result.stdout) as {
          readonly findings: ReadonlyArray<{ readonly code: string }>;
        };
        assert.equal(output.findings[0]?.code, failure.code);
        assert.doesNotMatch(result.stdout, /sliceDraftContext/u);
      }

      writeFileSync(
        join(projectRoot, "src", "cycle-a.ts"),
        'import type { CycleB } from "./cycle-b.js";\n' +
          "export interface CycleA { readonly b: CycleB }\n",
        "utf8"
      );
      writeFileSync(
        join(projectRoot, "src", "cycle-b.ts"),
        'import type { CycleA } from "./cycle-a.js";\n' +
          "export interface CycleB { readonly a: CycleA }\n",
        "utf8"
      );
      const cycle = runCli(projectRoot, [
        "inspect-module",
        "src/cycle-a.ts",
        "--export",
        "CycleA",
        "--closure"
      ]);
      assert.equal(cycle.status, 0, cycle.stderr);
      const cycleOutput = JSON.parse(cycle.stdout) as {
        readonly contracts: ReadonlyArray<{
          readonly module: { readonly path: string };
          readonly selectedExport: { readonly name: string };
        }>;
      };
      assert.deepEqual(
        cycleOutput.contracts.map((contract) => [
          contract.module.path,
          contract.selectedExport.name
        ]),
        [
          ["src/cycle-a.ts", "CycleA"],
          ["src/cycle-b.ts", "CycleB"]
        ]
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("bounds recursive closure output before it becomes unfit for Agent context", () => {
    const projectRoot = createProject();
    try {
      for (let index = 0; index <= 64; index += 1) {
        const next = index + 1;
        writeFileSync(
          join(projectRoot, "src", `chain-${index}.ts`),
          index === 64
            ? `export interface Chain${index} { readonly done: true }\n`
            : `import type { Chain${next} } from "./chain-${next}.js";\n` +
                `export interface Chain${index} { readonly next: Chain${next} }\n`,
          "utf8"
        );
      }

      const result = runCli(projectRoot, [
        "inspect-module",
        "src/chain-0.ts",
        "--export",
        "Chain0",
        "--closure"
      ]);
      assert.equal(result.status, 2, result.stderr);
      const output = JSON.parse(result.stdout) as {
        readonly findings: ReadonlyArray<{ readonly code: string }>;
      };
      assert.equal(output.findings[0]?.code, "MODULE_CLOSURE_LIMIT_EXCEEDED");
      assert.doesNotMatch(result.stdout, /sliceDraftContext/u);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("preserves an imported type when a nested generic shadows the same name", () => {
    const projectRoot = createProject();
    try {
      writeFileSync(
        join(projectRoot, "src", "nested-generic.ts"),
        'import type { T } from "./supporting-t.js";\n' +
          "export interface GenericApi {\n" +
          "  readonly value: T;\n" +
          "  map<T>(value: T): T;\n" +
          "}\n",
        "utf8"
      );
      writeFileSync(
        join(projectRoot, "src", "supporting-t.ts"),
        "export interface T { readonly id: string }\n",
        "utf8"
      );

      const result = runCli(projectRoot, [
        "inspect-module",
        "src/nested-generic.ts",
        "--export",
        "GenericApi",
        "--closure"
      ]);
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout) as {
        readonly contracts: ReadonlyArray<{
          readonly module: { readonly path: string };
          readonly selectedExport: { readonly name: string };
        }>;
      };
      assert.deepEqual(
        output.contracts.map((contract) => [
          contract.module.path,
          contract.selectedExport.name
        ]),
        [
          ["src/nested-generic.ts", "GenericApi"],
          ["src/supporting-t.ts", "T"]
        ]
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not mistake a shadowing local declaration for a TypeScript library type", () => {
    const projectRoot = createProject();
    try {
      writeFileSync(
        join(projectRoot, "src", "shadowed-global.ts"),
        "interface Promise { readonly localOnly: true }\n" +
          "export function localPromise(): Promise { return { localOnly: true }; }\n",
        "utf8"
      );

      const result = runCli(projectRoot, [
        "inspect-module",
        "src/shadowed-global.ts",
        "--export",
        "localPromise",
        "--closure"
      ]);
      assert.equal(result.status, 2, result.stderr);
      const output = JSON.parse(result.stdout) as {
        readonly findings: ReadonlyArray<{
          readonly code: string;
          readonly detail: { readonly findingCodes?: ReadonlyArray<string> };
        }>;
      };
      assert.equal(output.findings[0]?.code, "MODULE_REFERENCE_ROUTING_UNAVAILABLE");
      assert.doesNotMatch(result.stdout, /sliceDraftContext/u);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects an oversized module before parsing it", () => {
    const projectRoot = createProject();
    try {
      writeFileSync(
        join(projectRoot, "src", "oversized.ts"),
        Buffer.alloc(1024 * 1024 + 1, 0x20)
      );

      const result = runCli(projectRoot, ["inspect-module", "src/oversized.ts"]);
      assert.equal(result.status, 2, result.stderr);
      const output = JSON.parse(result.stdout) as {
        readonly findings: ReadonlyArray<{ readonly code: string }>;
      };
      assert.equal(output.findings[0]?.code, "MODULE_SOURCE_TOO_LARGE");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("distinguishes an unknown export from one whose contract shape is unsupported", () => {
    const projectRoot = createProject();
    try {
      const unknown = runCli(projectRoot, [
        "inspect-module",
        "src/account-view.ts",
        "--export",
        "MissingView"
      ]);
      assert.equal(unknown.status, 2, unknown.stderr);
      assert.equal(unknown.stderr, "");
      assert.deepEqual(JSON.parse(unknown.stdout), {
        schemaVersion: "score.inspect-module@0.2.0",
        status: "invalid",
        findings: [
          {
            code: "MODULE_EXPORT_NOT_FOUND",
            location: "/export",
            message: "No export named MissingView was found",
            detail: {
              path: "src/account-view.ts",
              exportName: "MissingView"
            },
            machineRepairable: true
          }
        ]
      });

      const inferredPath = join(projectRoot, "src", "inferred.ts");
      writeFileSync(inferredPath, "export const inferred = { enabled: true };\n", "utf8");
      const unsupported = runCli(projectRoot, [
        "inspect-module",
        "src/inferred.ts",
        "--export",
        "inferred"
      ]);
      assert.equal(unsupported.status, 2, unsupported.stderr);
      assert.equal(unsupported.stderr, "");
      const unsupportedOutput = JSON.parse(unsupported.stdout) as {
        readonly findings: ReadonlyArray<Record<string, unknown>>;
      };
      assert.equal(unsupportedOutput.findings[0]?.code, "MODULE_EXPORT_CONTRACT_UNAVAILABLE");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when source syntax cannot produce a complete declaration-only contract", () => {
    const projectRoot = createProject();
    try {
      const sourcePath = join(projectRoot, "src", "edge-cases.ts");
      writeFileSync(
        sourcePath,
        'import type { Account } from "./account.js";\n' +
          "export function accept(input: { id: string; account: Account }): void {}\n" +
          "export function inferred(input: Account) { return input.id; }\n" +
          'export const FIRST: string = "first", SECOND: string = "second";\n',
        "utf8"
      );

      const discovery = runCli(projectRoot, ["inspect-module", "src/edge-cases.ts"]);
      assert.equal(discovery.status, 0, discovery.stderr);
      const discoveryOutput = JSON.parse(discovery.stdout) as {
        readonly exports: ReadonlyArray<{
          readonly name: string;
          readonly contractAvailable: boolean;
        }>;
      };
      assert.deepEqual(
        discoveryOutput.exports.map(({ name, contractAvailable }) => ({
          name,
          contractAvailable
        })),
        [
          { name: "accept", contractAvailable: true },
          { name: "inferred", contractAvailable: false },
          { name: "FIRST", contractAvailable: false },
          { name: "SECOND", contractAvailable: false }
        ]
      );

      const selected = runCli(projectRoot, [
        "inspect-module",
        "src/edge-cases.ts",
        "--export",
        "accept"
      ]);
      assert.equal(selected.status, 0, selected.stderr);
      const selectedOutput = JSON.parse(selected.stdout) as {
        readonly selectedExport: {
          readonly references: ReadonlyArray<{ readonly name: string }>;
        };
      };
      assert.deepEqual(
        selectedOutput.selectedExport.references.map(({ name }) => name),
        ["Account"]
      );

      for (const exportName of ["inferred", "FIRST", "SECOND"]) {
        const unsupported = runCli(projectRoot, [
          "inspect-module",
          "src/edge-cases.ts",
          "--export",
          exportName
        ]);
        assert.equal(unsupported.status, 2, unsupported.stderr);
        const output = JSON.parse(unsupported.stdout) as {
          readonly findings: ReadonlyArray<{ readonly code: string }>;
        };
        assert.equal(output.findings[0]?.code, "MODULE_EXPORT_CONTRACT_UNAVAILABLE");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("finds external interface references without mistaking fields or type parameters for types", () => {
    const projectRoot = createProject();
    try {
      const sourcePath = join(projectRoot, "src", "wrapper.ts");
      writeFileSync(
        sourcePath,
        'import type { Account, Entity } from "./account.js";\n' +
          "export interface Wrapper<T> extends Entity {\n" +
          "  readonly account: Account;\n" +
          "  readonly value: T;\n" +
          "  readonly metadata: { readonly label: string };\n" +
          "}\n",
        "utf8"
      );

      const selected = runCli(projectRoot, [
        "inspect-module",
        "src/wrapper.ts",
        "--export",
        "Wrapper"
      ]);
      assert.equal(selected.status, 0, selected.stderr);
      const output = JSON.parse(selected.stdout) as {
        readonly selectedExport: {
          readonly declaration: string;
          readonly references: ReadonlyArray<Record<string, unknown>>;
        };
      };
      assert.equal(
        output.selectedExport.declaration,
        "export interface Wrapper<T> extends Entity {\n" +
          "  readonly account: Account;\n" +
          "  readonly value: T;\n" +
          "  readonly metadata: { readonly label: string };\n" +
          "}"
      );
      assert.deepEqual(output.selectedExport.references, [
        {
          name: "Entity",
          roles: ["declaration_type"],
          resolution: {
            kind: "import",
            source: "./account.js",
            importedName: "Entity",
            localName: "Entity",
            importKind: "type"
          }
        },
        {
          name: "Account",
          roles: ["declaration_type"],
          resolution: {
            kind: "import",
            source: "./account.js",
            importedName: "Account",
            localName: "Account",
            importKind: "type"
          }
        }
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects an overloaded export instead of returning only one apparent signature", () => {
    const projectRoot = createProject();
    try {
      const sourcePath = join(projectRoot, "src", "overloaded.ts");
      writeFileSync(
        sourcePath,
        "export function choose(value: string): string;\n" +
          "export function choose(value: number): number;\n" +
          "export function choose(value: string | number): string | number { return value; }\n",
        "utf8"
      );

      const selected = runCli(projectRoot, [
        "inspect-module",
        "src/overloaded.ts",
        "--export",
        "choose"
      ]);
      assert.equal(selected.status, 2, selected.stderr);
      assert.deepEqual(JSON.parse(selected.stdout), {
        schemaVersion: "score.inspect-module@0.2.0",
        status: "invalid",
        findings: [
          {
            code: "MODULE_EXPORT_AMBIGUOUS",
            location: "/export",
            message: "Export choose has multiple declarations and cannot be selected exactly",
            detail: {
              path: "src/overloaded.ts",
              exportName: "choose",
              declarationCount: 3
            },
            machineRepairable: true
          }
        ]
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("keeps default and export-all forms visible when their contract is not projectable", () => {
    const projectRoot = createProject();
    try {
      const sourcePath = join(projectRoot, "src", "module-forms.ts");
      writeFileSync(
        sourcePath,
        'import "./polyfill.js";\n' +
          'export * from "./shared.js";\n' +
          'export { Account as Renamed } from "./account.js";\n' +
          "export default class Service {}\n",
        "utf8"
      );

      const discovery = runCli(projectRoot, [
        "inspect-module",
        "src/module-forms.ts"
      ]);
      assert.equal(discovery.status, 0, discovery.stderr);
      const output = JSON.parse(discovery.stdout) as {
        readonly imports: ReadonlyArray<Record<string, unknown>>;
        readonly exports: ReadonlyArray<Record<string, unknown>>;
      };
      assert.deepEqual(output.imports, [
        {
          source: "./polyfill.js",
          importedName: null,
          localName: null,
          kind: "side_effect",
          range: { start: 0, end: 23 }
        }
      ]);
      assert.deepEqual(
        output.exports.map(({ name, declarationKind, namespace, contractAvailable }) => ({
          name,
          declarationKind,
          namespace,
          contractAvailable
        })),
        [
          {
            name: "*",
            declarationKind: "export-all",
            namespace: "unknown",
            contractAvailable: false
          },
          {
            name: "Renamed",
            declarationKind: "re-export",
            namespace: "unknown",
            contractAvailable: false
          },
          {
            name: "default",
            declarationKind: "class",
            namespace: "type_and_value",
            contractAvailable: false
          }
        ]
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("keeps declaration-file namespace and export-assignment forms visible", () => {
    const projectRoot = createProject();
    try {
      writeFileSync(
        join(projectRoot, "src", "namespace.d.ts"),
        "export as namespace ToolGlobal;\n" +
          "export namespace Tools { interface Config { readonly id: string } }\n" +
          "export import Alias = Tools;\n",
        "utf8"
      );
      const namespaceResult = runCli(projectRoot, [
        "inspect-module",
        "src/namespace.d.ts"
      ]);
      assert.equal(namespaceResult.status, 0, namespaceResult.stderr);
      const namespaceOutput = JSON.parse(namespaceResult.stdout) as {
        readonly exports: ReadonlyArray<Record<string, unknown>>;
      };
      assert.deepEqual(
        namespaceOutput.exports.map(
          ({ name, declarationKind, contractAvailable }) => ({
            name,
            declarationKind,
            contractAvailable
          })
        ),
        [
          {
            name: "ToolGlobal",
            declarationKind: "namespace-export",
            contractAvailable: false
          },
          {
            name: "Tools",
            declarationKind: "namespace",
            contractAvailable: false
          },
          {
            name: "Alias",
            declarationKind: "import-equals",
            contractAvailable: false
          }
        ]
      );

      writeFileSync(
        join(projectRoot, "src", "assignment.d.cts"),
        "declare namespace Tool { interface Options { readonly id: string } }\n" +
          "export = Tool;\n",
        "utf8"
      );
      const assignmentResult = runCli(projectRoot, [
        "inspect-module",
        "src/assignment.d.cts"
      ]);
      assert.equal(assignmentResult.status, 0, assignmentResult.stderr);
      const assignmentOutput = JSON.parse(assignmentResult.stdout) as {
        readonly exports: ReadonlyArray<Record<string, unknown>>;
      };
      assert.deepEqual(
        assignmentOutput.exports.map(
          ({ name, declarationKind, contractAvailable }) => ({
            name,
            declarationKind,
            contractAvailable
          })
        ),
        [
          {
            name: "export=",
            declarationKind: "export-assignment",
            contractAvailable: false
          }
        ]
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not treat method-local type parameters as module dependencies", () => {
    const projectRoot = createProject();
    try {
      writeFileSync(
        join(projectRoot, "src", "generic-api.ts"),
        "export interface API {\n" +
          "  map<T>(value: T): T;\n" +
          "}\n",
        "utf8"
      );

      const selected = runCli(projectRoot, [
        "inspect-module",
        "src/generic-api.ts",
        "--export",
        "API"
      ]);
      assert.equal(selected.status, 0, selected.stderr);
      const output = JSON.parse(selected.stdout) as {
        readonly selectedExport: {
          readonly references: ReadonlyArray<Record<string, unknown>>;
        };
      };
      assert.deepEqual(output.selectedExport.references, []);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when referenced type routing is incomplete or declaration-merged", () => {
    const projectRoot = createProject();
    try {
      const sourcePath = join(projectRoot, "src", "routing.ts");
      writeFileSync(
        sourcePath,
        "interface PrivateAccount { readonly id: string }\n" +
          "export interface Merged { readonly first: string }\n" +
          "export interface Merged { readonly second: string }\n" +
          "export function privateAccount(): PrivateAccount { return { id: 'x' }; }\n" +
          "export function merged(): Merged { return { first: 'x', second: 'y' }; }\n" +
          'export function inline(): import("./account.js").Account { throw new Error(); }\n',
        "utf8"
      );

      const expectations = [
        { exportName: "privateAccount", unresolved: ["PrivateAccount"], inline: [] },
        { exportName: "merged", unresolved: ["Merged"], inline: [] },
        { exportName: "inline", unresolved: [], inline: ["./account.js"] }
      ];
      for (const expectation of expectations) {
        const selected = runCli(projectRoot, [
          "inspect-module",
          "src/routing.ts",
          "--export",
          expectation.exportName
        ]);
        assert.equal(selected.status, 2, selected.stderr);
        const output = JSON.parse(selected.stdout) as {
          readonly findings: ReadonlyArray<{
            readonly code: string;
            readonly detail: {
              readonly unresolvedReferences: ReadonlyArray<string>;
              readonly inlineImportSources: ReadonlyArray<string>;
            };
          }>;
        };
        assert.equal(output.findings[0]?.code, "MODULE_REFERENCE_ROUTING_UNAVAILABLE");
        assert.deepEqual(
          output.findings[0]?.detail.unresolvedReferences,
          expectation.unresolved
        );
        assert.deepEqual(output.findings[0]?.detail.inlineImportSources, expectation.inline);
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects unsafe paths and bytes without emitting raw terminal controls", () => {
    const projectRoot = createProject();
    try {
      const outside = runCli(projectRoot, ["inspect-module", "../outside.ts"]);
      assert.equal(outside.status, 2, outside.stderr);
      assert.equal(JSON.parse(outside.stdout).findings[0].code, "MODULE_PATH_INVALID");

      const absolute = runCli(projectRoot, [
        "inspect-module",
        join(projectRoot, "src", "account-view.ts")
      ]);
      assert.equal(absolute.status, 2, absolute.stderr);
      assert.equal(JSON.parse(absolute.stdout).findings[0].code, "MODULE_PATH_INVALID");

      symlinkSync(join(projectRoot, "src", "account-view.ts"), join(projectRoot, "src", "link.ts"));
      const symlink = runCli(projectRoot, ["inspect-module", "src/link.ts"]);
      assert.equal(symlink.status, 2, symlink.stderr);
      assert.equal(JSON.parse(symlink.stdout).findings[0].code, "MODULE_FILE_NOT_REGULAR");

      mkdirSync(join(projectRoot, "src", "directory.ts"));
      const directory = runCli(projectRoot, ["inspect-module", "src/directory.ts"]);
      assert.equal(directory.status, 2, directory.stderr);
      assert.equal(JSON.parse(directory.stdout).findings[0].code, "MODULE_FILE_NOT_REGULAR");

      mkdirSync(join(projectRoot, "linked-source"));
      writeFileSync(join(projectRoot, "linked-source", "value.ts"), "export const value: string = 'x';\n");
      symlinkSync(join(projectRoot, "linked-source"), join(projectRoot, "src", "linked"));
      const ancestorSymlink = runCli(projectRoot, [
        "inspect-module",
        "src/linked/value.ts"
      ]);
      assert.equal(ancestorSymlink.status, 2, ancestorSymlink.stderr);
      assert.equal(JSON.parse(ancestorSymlink.stdout).findings[0].code, "MODULE_PATH_ESCAPE");

      writeFileSync(join(projectRoot, "src", "invalid.ts"), Buffer.from([0xff, 0xfe]));
      const invalidUtf8 = runCli(projectRoot, ["inspect-module", "src/invalid.ts"]);
      assert.equal(invalidUtf8.status, 2, invalidUtf8.stderr);
      assert.equal(
        JSON.parse(invalidUtf8.stdout).findings[0].code,
        "MODULE_ENCODING_UNSUPPORTED"
      );

      const privateSource = "private-token-that-must-not-appear";
      writeFileSync(
        join(projectRoot, "src", "broken.ts"),
        `const secret = "${privateSource}";\nexport function broken(`,
        "utf8"
      );
      const parseFailure = runCli(projectRoot, ["inspect-module", "src/broken.ts"]);
      assert.equal(parseFailure.status, 2, parseFailure.stderr);
      assert.equal(JSON.parse(parseFailure.stdout).findings[0].code, "MODULE_PARSE_ERROR");
      assert.doesNotMatch(parseFailure.stdout, new RegExp(privateSource, "u"));

      const maliciousName = "Missing\u001b[2J";
      const terminalSafe = runCli(projectRoot, [
        "inspect-module",
        "src/account-view.ts",
        "--export",
        maliciousName
      ]);
      assert.equal(terminalSafe.status, 2, terminalSafe.stderr);
      assert.doesNotMatch(terminalSafe.stdout, /\u001b/u);
      assert.equal(JSON.parse(terminalSafe.stdout).findings[0].detail.exportName, maliciousName);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
