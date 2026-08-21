import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";

import { validateBundleShape } from "../src/bundle-schema.js";
import { parseJsonNoDuplicateKeys, sha256Json } from "../src/canonical.js";
import { createMalformedBundles } from "../src/conformance.js";
import { createAcceptedInputPacket } from "../src/fixture-inputs.js";
import { ScoreAlpha } from "../src/score-alpha.js";
import type { CompilationBundle } from "../src/types.js";
import { validateCompilationBundle } from "../src/validation.js";

function readAuthoredBundle(): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), "fixtures", "account-status.bundle.json"), "utf8")
  );
}

describe("compiler-facing Compilation Bundle submission", () => {
  it("provides the exact accepted Account Status inputs without a repository lookup", () => {
    const packet = createAcceptedInputPacket();

    assert.equal(packet.repository_revision.files.length, 1);
    assert.deepEqual(packet.repository_revision.absent_paths, ["src/account-label.ts"]);
    assert.equal(packet.repository_revision.files[0]?.path, "src/schema.ts");
    assert.equal(
      packet.repository_revision.files[0]?.content_digest,
      "sha256:f5015bbb8e5fd4b979f39d84d21f28f9df2ad02e67ba34595f77e4eea9957371"
    );
    assert.match(packet.compilation_procedure.content, /one complete Compilation Bundle/);
  });

  it("rejects unknown fields under the closed alpha schema", () => {
    const findings = validateBundleShape({
      schema: "score.compilation-bundle",
      schema_version: "0.1.0-alpha.6",
      profile: "score.coding",
      profile_version: "0.1.0-alpha.6",
      source_bindings: {},
      proposed_definition: {},
      compiler_findings: { warnings: [], compilation_gaps: [] },
      unknown_field: "must not be ignored"
    });

    assert.ok(
      findings.some((finding) => finding.code === "SCHEMA_ADDITIONAL_PROPERTY"),
      JSON.stringify(findings, null, 2)
    );
  });

  it("rejects duplicate object names and invalid Unicode before canonicalization", () => {
    assert.throws(() => parseJsonNoDuplicateKeys('{"a":1,"a":2}'));
    assert.throws(() => parseJsonNoDuplicateKeys('{"value":"\\ud800"}'));
  });

  it("accepts the LLM-authored complete Account Status graph", () => {
    const findings = validateCompilationBundle(readAuthoredBundle(), createAcceptedInputPacket());
    assert.deepEqual(findings, []);
  });

  it("treats documented declaration text as opaque context", () => {
    const bundle = readAuthoredBundle() as CompilationBundle;
    const opaqueDeclaration =
      "ordinary documented prompt text with } unmatched syntax, import ???, and ``` fences";
    for (const context of bundle.proposed_definition.context_items) {
      if (context.kind !== "documented_declarations") continue;
      const content = context.content as {
        owned: Array<{ name: string; declaration: string; description: string }>;
        consumed: Array<{ name: string; declaration: string; description: string }>;
      };
      for (const declaration of [...content.owned, ...content.consumed]) {
        if (declaration.name === "Account") declaration.declaration = opaqueDeclaration;
      }
    }

    assert.deepEqual(validateCompilationBundle(bundle, createAcceptedInputPacket()), []);
  });

  it("rejects mismatched documented declaration consumers without creating prepared state", () => {
    const ownerless = structuredClone(readAuthoredBundle()) as CompilationBundle;
    const ownerlessDependency = ownerless.proposed_definition.dependencies[0];
    assert.ok(ownerlessDependency);
    ownerlessDependency.prerequisite_kind = "capsule";
    ownerlessDependency.prerequisite_handle = "replace_schema";
    const ownerlessContext = ownerless.proposed_definition.context_items.find(
      (item) => item.kind === "documented_declarations" &&
        Array.isArray((item.content as { consumed?: unknown }).consumed) &&
        (item.content as { consumed: unknown[] }).consumed.length > 0
    );
    assert.ok(ownerlessContext);
    const ownerlessDeclaration = (
      ownerlessContext.content as {
        consumed: Array<{ name: string; declaration: string; description: string }>;
      }
    ).consumed[0];
    assert.ok(ownerlessDeclaration);
    ownerlessDeclaration.name = "Ghost";

    const divergent = structuredClone(readAuthoredBundle()) as CompilationBundle;
    const divergentDependency = divergent.proposed_definition.dependencies[0];
    assert.ok(divergentDependency);
    divergentDependency.prerequisite_kind = "capsule";
    divergentDependency.prerequisite_handle = "replace_schema";
    const divergentContext = divergent.proposed_definition.context_items.find(
      (item) => item.kind === "documented_declarations" &&
        Array.isArray((item.content as { consumed?: unknown }).consumed) &&
        (item.content as { consumed: unknown[] }).consumed.length > 0
    );
    assert.ok(divergentContext);
    const divergentDeclaration = (
      divergentContext.content as {
        consumed: Array<{
          name: string;
          declaration: string;
          description: string;
        }>;
      }
    ).consumed[0];
    assert.ok(divergentDeclaration);
    divergentDeclaration.declaration = "export interface Account { ghost: true }";

    const duplicate = structuredClone(readAuthoredBundle()) as CompilationBundle;
    const duplicateDependency = duplicate.proposed_definition.dependencies[0];
    assert.ok(duplicateDependency);
    duplicateDependency.prerequisite_kind = "capsule";
    duplicateDependency.prerequisite_handle = "replace_schema";
    const duplicateContext = duplicate.proposed_definition.context_items.find(
      (item) => item.kind === "documented_declarations" &&
        Array.isArray((item.content as { consumed?: unknown }).consumed) &&
        (item.content as { consumed: unknown[] }).consumed.length > 0
    );
    assert.ok(duplicateContext);
    const duplicateContent = duplicateContext.content as {
      consumed: Array<{ name: string; declaration: string; description: string }>;
    };
    const duplicateDeclaration = duplicateContent.consumed[0];
    assert.ok(duplicateDeclaration);
    duplicateContent.consumed.push(structuredClone(duplicateDeclaration));

    const cases = [
      {
        label: "ownerless consumer",
        bundle: ownerless,
        code: "DOCUMENTED_DECLARATION_OWNER_MISSING"
      },
      {
        label: "divergent consumer text",
        bundle: divergent,
        code: "DOCUMENTED_DECLARATION_CONSUMER_DIVERGENT"
      },
      {
        label: "duplicate consumer relationship",
        bundle: duplicate,
        code: "DOCUMENTED_DECLARATION_CONSUMER_DUPLICATE"
      }
    ] as const;

    const directory = mkdtempSync(join(tmpdir(), "score-declaration-routing-"));
    const databasePath = join(directory, "score.db");
    try {
      const score = ScoreAlpha.open(databasePath);
      try {
        for (const [index, invalid] of cases.entries()) {
          const slug = `invalid-declaration-routing-${index + 1}`;
          const result = score.materializePreparedSliceRevision({
            sliceId: slug,
            displayTitle: invalid.label,
            requestedSlug: slug,
            inputDigest: sha256Json({ label: invalid.label, bundle: invalid.bundle }),
            draftDigest: sha256Json({ label: invalid.label }),
            sourcePath: null,
            resolvedDependencies: [],
            acceptedInputs: createAcceptedInputPacket(),
            bundle: invalid.bundle,
            submissionMetadata: {
              compiler_name: "test-compiler",
              model_id: "test-model",
              received_at: `2026-08-11T11:00:0${index}.000Z`,
              label: invalid.label
            },
            createdAt: `2026-08-11T11:00:0${index}.000Z`
          });

          assert.equal(result.status, "invalid", invalid.label);
          if (result.status !== "invalid") assert.fail(`${invalid.label}: unexpectedly prepared`);
          assert.equal(result.submission.outcome, "invalid");
          assert.equal(result.submission.manifest_id, undefined);
          assert.ok(
            result.submission.findings.some((finding) => finding.code === invalid.code),
            `${invalid.label}: ${result.submission.findings.map((finding) => finding.code).join(", ")}`
          );
        }

        const counts = score.inspectCounts();
        assert.equal(counts.compilation_submissions, cases.length);
        assert.equal(counts.run_manifests, 0);
        assert.equal(counts.coding_passes, 0);
        assert.equal(counts.capsules, 0);
        assert.equal(counts.context_items, 0);
        assert.equal(counts.publication_reviews, 0);
      } finally {
        score.close();
      }

      const stored = new Database(databasePath, { readonly: true, fileMustExist: true });
      try {
        for (const table of [
          "prepared_slices",
          "prepared_slice_revisions",
          "prepared_slice_publications",
          "prepared_slice_dependencies"
        ] as const) {
          const row = stored.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
            count: number;
          };
          assert.equal(row.count, 0, `${table} should remain empty`);
        }
      } finally {
        stored.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed or missing documented declaration routing before import", () => {
    const missingRouting = structuredClone(readAuthoredBundle()) as CompilationBundle;
    for (const contextItem of missingRouting.proposed_definition.context_items) {
      if (contextItem.kind === "documented_declarations") contextItem.kind = "ordinary_text";
    }
    for (const input of missingRouting.proposed_definition.contract_inputs) {
      if (input.expected_kind === "documented_declarations") input.expected_kind = "ordinary_text";
    }
    for (const binding of missingRouting.proposed_definition.contract_input_bindings) {
      if (binding.actual_kind === "documented_declarations") binding.actual_kind = "ordinary_text";
    }

    const extraContentField = structuredClone(readAuthoredBundle()) as CompilationBundle;
    const extraFieldContext = extraContentField.proposed_definition.context_items.find(
      (item) => item.kind === "documented_declarations"
    );
    assert.ok(extraFieldContext);
    (extraFieldContext.content as Record<string, unknown>).provider_path = "must-not-survive";

    const emptyDeclaration = structuredClone(readAuthoredBundle()) as CompilationBundle;
    const emptyDeclarationContext = emptyDeclaration.proposed_definition.context_items.find(
      (item) => item.kind === "documented_declarations"
    );
    assert.ok(emptyDeclarationContext);
    const emptyContent = emptyDeclarationContext.content as {
      owned: Array<{ declaration: string }>;
    };
    assert.ok(emptyContent.owned[0]);
    emptyContent.owned[0].declaration = "";

    const cases = [
      {
        label: "missing-documented-declarations-routing",
        bundle: missingRouting,
        code: "DOCUMENTED_DECLARATIONS_BINDING_CARDINALITY"
      },
      {
        label: "documented-declarations-extra-content-field",
        bundle: extraContentField,
        code: "DOCUMENTED_DECLARATIONS_CONTENT_INVALID"
      },
      {
        label: "documented-declaration-empty-text",
        bundle: emptyDeclaration,
        code: "DOCUMENTED_DECLARATION_ENTRY_INVALID"
      }
    ] as const;

    const directory = mkdtempSync(join(tmpdir(), "score-documented-declarations-validation-"));
    try {
      const score = ScoreAlpha.open(join(directory, "score.db"));
      score.initializeAcceptedInputs(createAcceptedInputPacket());
      for (const [index, malformed] of cases.entries()) {
        const submitted = score.submitCompilation(malformed.bundle, {
          compiler_name: "test-compiler",
          model_id: "test-model",
          received_at: `2026-08-11T12:00:0${index}.000Z`,
          label: malformed.label
        });
        assert.equal(submitted.outcome, "invalid");
        assert.equal(submitted.manifest_id, undefined);
        assert.ok(
          submitted.findings.some((finding) => finding.code === malformed.code),
          JSON.stringify(submitted.findings, null, 2)
        );
      }
      assert.equal(score.inspectCounts().compilation_submissions, cases.length);
      assert.equal(score.inspectCounts().run_manifests, 0);
      score.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("emits named deterministic findings for every declared malformed case", () => {
    const inputs = createAcceptedInputPacket();
    const malformed = createMalformedBundles(readAuthoredBundle());
    const expected = new Map([
      ["replace-target-absent", "TARGET_REPLACE_ABSENT"],
      ["create-target-present", "TARGET_CREATE_PRESENT"],
      ["duplicate-writer", "DUPLICATE_TARGET_WRITER"],
      ["required-binding-missing", "BINDING_REQUIRED_MISSING"],
      ["binding-item-dangling", "BINDING_ITEM_DANGLING"],
      ["binding-kind-incompatible", "BINDING_KIND_MISMATCH"],
      ["context-item-unexplained", "CONTEXT_ITEM_UNBOUND"],
      ["required-fact-lookup", "CONTEXT_LOOKUP_INSTRUCTION"],
      ["unknown-bundle-field", "SCHEMA_ADDITIONAL_PROPERTY"]
    ]);

    assert.deepEqual([...malformed.keys()], [...expected.keys()]);
    for (const [name, bundle] of malformed) {
      const codes = validateCompilationBundle(bundle, inputs).map((finding) => finding.code);
      assert.ok(codes.includes(expected.get(name) ?? ""), `${name}: ${codes.join(", ")}`);
    }
  });
});
