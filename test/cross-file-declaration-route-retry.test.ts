import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { sha256Bytes } from "../src/canonical.js";
import {
  runCrossFileDeclarationRouteRetryExperiment
} from "../src/prototypes/cross-file-declaration-route-retry.js";

const baselineOwner =
  "export interface Account { readonly id: string; }\n";
const baselineConsumer =
  'import type { Account } from "./account.js";\n' +
  "export function formatAccount(account: Account): string { return account.id; }\n";
const ownerCandidate =
  "export interface Account { readonly id: string; readonly name: string; }\n";
const rejectedConsumerCandidate =
  'import type { Account } from "./wrong.js";\n' +
  "export function formatAccount(account: Account): string { return account.name; }\n";
const repairedConsumerCandidate =
  'import type { Account } from "./account.js";\n' +
  "export function formatAccount(account: Account): string { return account.name; }\n";

describe("cross-file declaration route retry experiment", () => {
  it("retains the owner, retries only the blamed consumer, and applies both together", () => {
    const projectRoot = realpathSync(
      mkdtempSync(join(tmpdir(), "score-cross-route-retry-"))
    );
    try {
      mkdirSync(join(projectRoot, "src"), { recursive: true });
      writeFileSync(join(projectRoot, "src/account.ts"), baselineOwner, "utf8");
      writeFileSync(join(projectRoot, "src/format-account.ts"), baselineConsumer, "utf8");

      const result = runCrossFileDeclarationRouteRetryExperiment({
        projectRoot,
        approvedRoute: {
          declaration: "Account",
          ownerTarget: "src/account.ts",
          consumerTarget: "src/format-account.ts",
          moduleSpecifier: "./account.js"
        },
        firstCandidates: [
          {
            targetPath: "src/account.ts",
            operation: "replace",
            content: ownerCandidate
          },
          {
            targetPath: "src/format-account.ts",
            operation: "replace",
            content: rejectedConsumerCandidate
          }
        ],
        repairedCandidate: {
          targetPath: "src/format-account.ts",
          operation: "replace",
          content: repairedConsumerCandidate
        }
      });

      assert.deepEqual(result.firstCheck, {
        status: "invalid",
        applicationState: "not_applied",
        retainedTargets: ["src/account.ts"],
        retryTargets: ["src/format-account.ts"],
        findings: [
          {
            code: "CONSUMED_DECLARATION_ROUTE_MISMATCH",
            targetPath: "src/format-account.ts",
            declaration: "Account",
            expectedModuleSpecifier: "./account.js",
            observedModuleSpecifiers: ["./wrong.js"]
          }
        ]
      });
      assert.equal(
        result.retainedOwnerDigest,
        sha256Bytes(ownerCandidate)
      );
      assert.deepEqual(result.repositoryAfterFirstCheck, {
        "src/account.ts": baselineOwner,
        "src/format-account.ts": baselineConsumer
      });
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
      assert.equal(
        readFileSync(join(projectRoot, "src/account.ts"), "utf8"),
        ownerCandidate
      );
      assert.equal(
        readFileSync(join(projectRoot, "src/format-account.ts"), "utf8"),
        repairedConsumerCandidate
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
