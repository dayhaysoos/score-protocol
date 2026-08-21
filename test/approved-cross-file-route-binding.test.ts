import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { canonicalJson } from "../src/canonical.js";
import {
  bindApprovedCrossFileDeclarationRoute,
  freezeApprovedCrossFileRouteInput
} from "../src/prototypes/approved-cross-file-route-binding.js";
import { runCrossFileDeclarationRouteRetryExperiment } from "../src/prototypes/cross-file-declaration-route-retry.js";

const authoredRouteInput = {
  changeRevisionId: "change-revision-003",
  approvalDecisionId: "decision-007",
  routes: [
    {
      declaration: "Account",
      ownerTarget: "src/account.ts",
      consumerTarget: "src/format-account.ts",
      moduleSpecifier: "./account.js"
    }
  ]
} as const;

describe("approved cross-file declaration route binding experiment", () => {
  it("freezes identical reviewed routes into byte-identical approved input", () => {
    const first = freezeApprovedCrossFileRouteInput(authoredRouteInput);
    const second = freezeApprovedCrossFileRouteInput(structuredClone(authoredRouteInput));

    assert.equal(
      canonicalJson(first.content),
      '{"approvalDecisionId":"decision-007","changeRevisionId":"change-revision-003","routes":[{"consumerTarget":"src/format-account.ts","declaration":"Account","moduleSpecifier":"./account.js","ownerTarget":"src/account.ts"}],"schema":"score.prototype.approved-cross-file-route-input","version":"0.1.0"}'
    );
    assert.equal(
      first.contentDigest,
      "sha256:30cabaf50dd2588a007b91dc6ac0d7900178873a701da2ceb9636bc13b21f2e2"
    );
    assert.deepEqual(first, second);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.content), true);
    assert.equal(Object.isFrozen(first.content.routes), true);
    assert.equal(Object.isFrozen(first.content.routes[0]), true);
  });

  it("rejects a substituted route even when the substituted content digest reproduces", () => {
    const approved = freezeApprovedCrossFileRouteInput(authoredRouteInput);
    const substituted = {
      content: {
        ...structuredClone(approved.content),
        routes: [
          {
            ...structuredClone(approved.content.routes[0]!),
            moduleSpecifier: "./wrong.js"
          }
        ]
      },
      contentDigest:
        "sha256:76ea590befbde3f4dbaad8d6d335dea0eafbe973eb8b7bf5b0ef08167b3b768f"
    };

    assert.deepEqual(
      bindApprovedCrossFileDeclarationRoute({
        approvedInput: substituted,
        approvedInputDigest: approved.contentDigest,
        consumerTarget: "src/format-account.ts",
        declaration: "Account"
      }),
      {
        status: "invalid",
        findings: [
          {
            code: "APPROVED_ROUTE_INPUT_SUBSTITUTED",
            location: "/approvedInput/contentDigest",
            message: "Cross-file declaration route input does not match the approved digest"
          }
        ]
      }
    );
  });

  it("uses only the bound approved route to blame and recover the consumer", () => {
    const approved = freezeApprovedCrossFileRouteInput(authoredRouteInput);
    const binding = bindApprovedCrossFileDeclarationRoute({
      approvedInput: approved,
      approvedInputDigest: approved.contentDigest,
      consumerTarget: "src/format-account.ts",
      declaration: "Account"
    });
    assert.equal(binding.status, "bound");
    if (binding.status !== "bound") assert.fail("Expected one approved route binding");
    assert.deepEqual(binding.approvedRoute, authoredRouteInput.routes[0]);

    const projectRoot = realpathSync(
      mkdtempSync(join(tmpdir(), "score-approved-route-recovery-"))
    );
    try {
      mkdirSync(join(projectRoot, "src"), { recursive: true });
      writeFileSync(
        join(projectRoot, "src/account.ts"),
        "export interface Account { readonly id: string; }\n",
        "utf8"
      );
      writeFileSync(
        join(projectRoot, "src/format-account.ts"),
        'import type { Account } from "./account.js";\n' +
          "export function formatAccount(account: Account): string { return account.id; }\n",
        "utf8"
      );

      const result = runCrossFileDeclarationRouteRetryExperiment({
        projectRoot,
        approvedRoute: binding.approvedRoute,
        firstCandidates: [
          {
            targetPath: "src/account.ts",
            operation: "replace",
            content:
              "export interface Account { readonly id: string; readonly name: string; }\n"
          },
          {
            targetPath: "src/format-account.ts",
            operation: "replace",
            content:
              'import type { Account } from "./wrong.js";\n' +
              "export function formatAccount(account: Account): string { return account.name; }\n"
          }
        ],
        repairedCandidate: {
          targetPath: "src/format-account.ts",
          operation: "replace",
          content:
            'import type { Account } from "./account.js";\n' +
            "export function formatAccount(account: Account): string { return account.name; }\n"
        }
      });

      assert.deepEqual(result.firstCheck.retryTargets, ["src/format-account.ts"]);
      assert.deepEqual(result.firstCheck.retainedTargets, ["src/account.ts"]);
      assert.deepEqual(result.invocations, {
        first: ["src/account.ts", "src/format-account.ts"],
        retry: ["src/format-account.ts"],
        total: 3
      });
      assert.deepEqual(result.finalCheck, {
        status: "valid",
        applicationState: "applied",
        appliedTargets: ["src/account.ts", "src/format-account.ts"],
        findings: []
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
