import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { canonicalJson } from "../src/canonical.js";
import { prepareExternalDeclarationEvidence } from "../src/external-declaration-evidence.js";
import { prepareSlice, type SliceDraft } from "../src/plan-intake.js";

function writeFixtureFile(root: string, path: string, content: string): void {
  const absolutePath = join(root, path);
  mkdirSync(join(absolutePath, ".."), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function createLockedPackageFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "score-external-evidence-"));
  writeFixtureFile(
    root,
    "package-lock.json",
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { "fixture-package": "1.2.3" } },
        "node_modules/fixture-package": {
          version: "1.2.3",
          integrity: "sha512:fixture-package-integrity"
        }
      }
    })
  );
  writeFixtureFile(
    root,
    "node_modules/fixture-package/package.json",
    JSON.stringify({
      name: "fixture-package",
      version: "1.2.3",
      exports: { "./api": "./dist/api.js" }
    })
  );
  writeFixtureFile(
    root,
    "node_modules/fixture-package/dist/api.d.ts",
    'import type { ImportedSupport } from "./support.ts";\n' +
      "export interface LocalSupport { readonly value: string; }\n" +
      "export declare function selected(input: LocalSupport, support: ImportedSupport): string;\n"
  );
  writeFixtureFile(
    root,
    "node_modules/fixture-package/dist/support.d.ts",
    "export interface ImportedSupport { readonly enabled: boolean; }\n"
  );
  return root;
}

describe("external declaration evidence", () => {
  it("freezes selected public contracts with only their direct supporting types", () => {
    const projectRoot = createLockedPackageFixture();
    try {
      const input = {
        projectRoot,
        requests: [
          {
            from: "fixture-package/api",
            names: ["selected"],
            purpose: "Call the installed fixture API."
          }
        ]
      } as const;

      const first = prepareExternalDeclarationEvidence(input);
      const second = prepareExternalDeclarationEvidence(input);

      assert.equal(first.status, "ok", canonicalJson(first));
      assert.equal(second.status, "ok");
      assert.equal(canonicalJson(first), canonicalJson(second));
      if (first.status !== "ok") return;
      assert.deepEqual(first.bundle.requests[0]?.contracts.map(({ name }) => name), [
        "selected"
      ]);
      assert.deepEqual(
        first.bundle.requests[0]?.contracts[0]?.supportingDeclarations.map(({ name }) =>
          name
        ),
        ["ImportedSupport", "LocalSupport"]
      );
      assert.deepEqual(first.bundle.provenance.files.map(({ path }) => path), [
        "node_modules/fixture-package/dist/api.d.ts",
        "node_modules/fixture-package/dist/support.d.ts",
        "node_modules/fixture-package/package.json",
        "package-lock.json"
      ]);
      assert.equal(
        canonicalJson(first.bundle.agentContext).includes("node_modules/"),
        false
      );
      assert.equal(
        canonicalJson(first.bundle.agentContext).includes("./support.ts"),
        false
      );
      assert.equal(
        readFileSync(
          join(projectRoot, "node_modules/fixture-package/dist/api.d.ts"),
          "utf8"
        ),
        'import type { ImportedSupport } from "./support.ts";\n' +
          "export interface LocalSupport { readonly value: string; }\n" +
          "export declare function selected(input: LocalSupport, support: ImportedSupport): string;\n"
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("binds reviewed external evidence into the prepared Agent Brief without dependency paths", () => {
    const projectRoot = createLockedPackageFixture();
    try {
      writeFixtureFile(
        projectRoot,
        "src/worker.ts",
        "export function work(value: string): string { return value; }\n"
      );
      const originalSource = readFileSync(join(projectRoot, "src/worker.ts"), "utf8");
      const draft: SliceDraft = {
        slice_id: "external-evidence-binding",
        title: "External Evidence Binding",
        objective: "Use one exact installed package contract.",
        requirements: ["The worker uses the selected package contract."],
        files: [
          {
            path: "src/worker.ts",
            operation: "modify",
            task: "Use the selected package contract without guessing its signature.",
            requirements: ["The worker uses the selected package contract."],
            owns: [
              {
                name: "work",
                declaration: "export function work(value: string): string;",
                description: "Returns the worker result."
              }
            ],
            consumes: [],
            external_declarations: [
              {
                from: "fixture-package/api",
                names: ["selected"],
                purpose: "Call the installed fixture API."
              }
            ],
            context: [],
            skills: [],
            constraints: []
          }
        ]
      };

      const result = prepareSlice({ projectRoot, sliceDraft: draft });

      assert.equal(result.status, "review_ready");
      if (result.status !== "review_ready") return;
      const snapshot = JSON.parse(readFileSync(result.snapshotPath, "utf8")) as {
        passes: Array<{
          capsules: Array<{
            context_items: Array<{ kind: string; content: unknown }>;
            agent_input: {
              input_bindings: Array<{
                kind: string;
                content: unknown;
              }>;
            };
          }>;
        }>;
      };
      const capsule = snapshot.passes[0]?.capsules[0];
      const storedEvidence = capsule?.context_items.find(
        ({ kind }) => kind === "external_declaration_evidence"
      );
      const agentEvidence = capsule?.agent_input.input_bindings.find(
        ({ kind }) => kind === "external_declaration_evidence"
      );
      assert.ok(storedEvidence);
      assert.ok(agentEvidence);
      assert.match(canonicalJson(storedEvidence.content), /node_modules\/fixture-package/u);
      assert.match(canonicalJson(agentEvidence.content), /function selected/u);
      assert.doesNotMatch(canonicalJson(agentEvidence.content), /node_modules\//u);
      assert.doesNotMatch(canonicalJson(agentEvidence.content), /\.\/support\.ts/u);
      const reviewHtml = readFileSync(result.reviewPath, "utf8");
      assert.match(reviewHtml, /External package contracts/u);
      assert.match(reviewHtml, /fixture-package\/api/u);
      assert.match(reviewHtml, /function selected/u);
      assert.equal(readFileSync(join(projectRoot, "src/worker.ts"), "utf8"), originalSource);
      assert.equal(existsSync(join(projectRoot, "src/worker.js")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns an exact unsupported finding instead of guessing through a re-export", () => {
    const projectRoot = createLockedPackageFixture();
    try {
      writeFixtureFile(
        projectRoot,
        "node_modules/fixture-package/dist/api.d.ts",
        'export { selected } from "./support.ts";\n'
      );

      const result = prepareExternalDeclarationEvidence({
        projectRoot,
        requests: [
          {
            from: "fixture-package/api",
            names: ["selected"],
            purpose: "Call the installed fixture API."
          }
        ]
      });

      assert.equal(result.status, "invalid");
      if (result.status !== "invalid") return;
      assert.deepEqual(result.findings.map(({ code }) => code), [
        "EXTERNAL_DECLARATION_UNSUPPORTED"
      ]);
      assert.equal(result.findings[0]?.location, "/requests/0/names/0");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns a typed preparation finding before creating review state", () => {
    const projectRoot = createLockedPackageFixture();
    try {
      writeFixtureFile(
        projectRoot,
        "src/worker.ts",
        "export function work(value: string): string { return value; }\n"
      );
      const result = prepareSlice({
        projectRoot,
        sliceDraft: {
          slice_id: "invalid-external-evidence",
          title: "Invalid External Evidence",
          objective: "Refuse an absent selected package member.",
          requirements: ["Preparation fails before review."],
          files: [
            {
              path: "src/worker.ts",
              operation: "modify",
              task: "Use one reviewed external package member.",
              requirements: ["Preparation fails before review."],
              owns: [],
              consumes: [],
              external_declarations: [
                {
                  from: "fixture-package/api",
                  names: ["absent"],
                  purpose: "Use the selected fixture API."
                }
              ],
              context: [],
              skills: [],
              constraints: []
            }
          ]
        }
      });

      assert.equal(result.status, "invalid");
      if (result.status !== "invalid") return;
      assert.deepEqual(result.findings.map(({ code }) => code), [
        "EXTERNAL_DECLARATION_MISSING"
      ]);
      assert.equal(
        result.findings[0]?.location,
        "/files/0/external_declarations/0/names/0"
      );
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("distinguishes missing, ambiguous, and incomplete selected declarations", () => {
    const scenarios = [
      {
        source: "export declare function another(): string;\n",
        code: "EXTERNAL_DECLARATION_MISSING"
      },
      {
        source:
          "export declare function selected(value: string): string;\n" +
          "export declare function selected(value: number): number;\n",
        code: "EXTERNAL_DECLARATION_AMBIGUOUS"
      },
      {
        source: "export declare function selected(value);\n",
        code: "EXTERNAL_DECLARATION_INCOMPLETE"
      }
    ] as const;

    for (const scenario of scenarios) {
      const projectRoot = createLockedPackageFixture();
      try {
        writeFixtureFile(
          projectRoot,
          "node_modules/fixture-package/dist/api.d.ts",
          scenario.source
        );
        const result = prepareExternalDeclarationEvidence({
          projectRoot,
          requests: [
            {
              from: "fixture-package/api",
              names: ["selected"],
              purpose: "Call the installed fixture API."
            }
          ]
        });
        assert.equal(result.status, "invalid");
        if (result.status !== "invalid") continue;
        assert.deepEqual(result.findings.map(({ code }) => code), [scenario.code]);
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    }
  });

  it("extracts the approved Effect contracts without recursive package closure", () => {
    const result = prepareExternalDeclarationEvidence({
      projectRoot: process.cwd(),
      requests: [
        {
          from: "effect/Schema",
          names: ["check", "isPattern"],
          purpose: "Use the installed Effect schema APIs."
        }
      ]
    });

    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.deepEqual(result.bundle.requests[0]?.contracts.map(({ name }) => name), [
      "check",
      "isPattern"
    ]);
    assert.deepEqual(
      result.bundle.requests[0]?.contracts.flatMap(({ supportingDeclarations }) =>
        supportingDeclarations.map(({ name }) => name)
      ),
      ["SchemaAST.Check", "Top", "Annotations.Filter", "SchemaAST.Filter"]
    );
    assert.deepEqual(result.bundle.provenance.files.map(({ path }) => path), [
      "node_modules/effect/dist/Schema.d.ts",
      "node_modules/effect/dist/SchemaAST.d.ts",
      "node_modules/effect/package.json",
      "package-lock.json"
    ]);
    assert.equal(result.bundle.limits.supportingDepth, 1);
    assert.equal(result.bundle.provenance.files.length, 4);
  });

  it("selects the types branch of a root conditional export", () => {
    const projectRoot = createLockedPackageFixture();
    try {
      writeFixtureFile(
        projectRoot,
        "node_modules/fixture-package/package.json",
        JSON.stringify({
          name: "fixture-package",
          version: "1.2.3",
          exports: {
            import: {
              types: "./dist/import-api.d.mts",
              default: "./dist/import-api.mjs"
            },
            require: {
              types: "./dist/require-api.d.cts",
              default: "./dist/require-api.cjs"
            }
          }
        })
      );
      writeFixtureFile(
        projectRoot,
        "node_modules/fixture-package/dist/import-api.d.mts",
        'export declare function selected(): "import-types";\n'
      );

      const result = prepareExternalDeclarationEvidence({
        projectRoot,
        requests: [
          {
            from: "fixture-package",
            names: ["selected"],
            purpose: "Use the import-mode package contract."
          }
        ]
      });

      assert.equal(result.status, "ok");
      if (result.status !== "ok") return;
      assert.match(
        result.bundle.requests[0]?.contracts[0]?.declaration ?? "",
        /import-types/u
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("applies the frozen bounded typesVersions profile", () => {
    const projectRoot = createLockedPackageFixture();
    try {
      writeFixtureFile(
        projectRoot,
        "node_modules/fixture-package/package.json",
        JSON.stringify({
          name: "fixture-package",
          version: "1.2.3",
          types: "./index.d.ts",
          typesVersions: { ">=7": { "*": ["ts7/*"] } }
        })
      );
      writeFixtureFile(
        projectRoot,
        "node_modules/fixture-package/ts7/index.d.ts",
        'export declare function selected(): "ts7";\n'
      );

      const result = prepareExternalDeclarationEvidence({
        projectRoot,
        requests: [
          {
            from: "fixture-package",
            names: ["selected"],
            purpose: "Use the frozen TypeScript-versioned contract."
          }
        ]
      });

      assert.equal(result.status, "ok", canonicalJson(result));
      if (result.status !== "ok") return;
      assert.match(result.bundle.requests[0]?.contracts[0]?.declaration ?? "", /ts7/u);
      assert.equal(result.bundle.resolutionProfile.typescriptVersion, "7.0.2");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects a selected declaration file symlink before reading it", () => {
    const projectRoot = createLockedPackageFixture();
    try {
      const declarationPath = join(
        projectRoot,
        "node_modules/fixture-package/dist/api.d.ts"
      );
      unlinkSync(declarationPath);
      symlinkSync("support.d.ts", declarationPath);

      const result = prepareExternalDeclarationEvidence({
        projectRoot,
        requests: [
          {
            from: "fixture-package/api",
            names: ["selected"],
            purpose: "Use the selected contract."
          }
        ]
      });

      assert.equal(result.status, "invalid");
      if (result.status !== "invalid") return;
      assert.deepEqual(result.findings.map(({ code }) => code), [
        "EXTERNAL_DECLARATION_SOURCE_MISSING"
      ]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
