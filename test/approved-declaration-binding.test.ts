import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { canonicalJson } from "../src/canonical.js";
import { prepareChange, type ChangeDraft } from "../src/change-authoring.js";
import { bindApprovedDeclarationRepair } from "../src/prototypes/approved-declaration-binding.js";
import { ScoreAlpha } from "../src/score-alpha.js";

const baselineSource =
  'export function label(): string { return "Existing"; }\n';
const documentedDeclaration = "export function label(): string;";
const prefixDeclaration = "export function prefix(): string;";

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "score-approved-binding-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/account-label.ts"), baselineSource, "utf8");
  return realpathSync(root);
}

function changeDraft(operation: "create" | "modify" = "modify"): ChangeDraft {
  return {
    title: "Approved declaration binding",
    objective: "Keep the account label declaration stable.",
    requirements: ["label returns an account label string."],
    files: [
      {
        path:
          operation === "modify"
            ? "src/account-label.ts"
            : "src/new-account-label.ts",
        operation,
        task: "Implement the approved label declaration.",
        requirements: ["label returns an account label string."],
        owns: [
          {
            name: "label",
            declaration: documentedDeclaration,
            description: "Returns the account label."
          }
        ],
        consumes: [],
        context: [],
        skills: [],
        constraints: ["Keep the declaration exact."]
      }
    ]
  };
}

function twoDeclarationChangeDraft(): ChangeDraft {
  const draft = changeDraft();
  const file = draft.files[0];
  if (file === undefined) throw new Error("Fixture File Brief is missing");
  return {
    ...draft,
    title: "Approved two-declaration binding",
    files: [
      {
        ...file,
        owns: [
          {
            name: "prefix",
            declaration: prefixDeclaration,
            description: "Returns the account-label prefix."
          },
          ...file.owns
        ]
      }
    ]
  };
}

function approvePreparedChange(projectRoot: string, draft: ChangeDraft) {
  const prepared = prepareChange({ projectRoot, changeDraft: draft });
  assert.equal(prepared.status, "review_ready");
  if (prepared.status !== "review_ready") throw new Error("Change was not prepared");

  const databasePath = join(projectRoot, ".score", "score.db");
  const plan = ScoreAlpha.listReviewedChangePlans(databasePath)[0];
  assert.ok(plan);
  ScoreAlpha.approveReviewedChangePlan(databasePath, {
    plan,
    authority: "local-cli:binding-experiment",
    decidedAt: "2026-08-20T18:00:00.000Z"
  });
  return ScoreAlpha.readApprovedPass(databasePath, prepared.passId);
}

function approvedJob(approvedPlan: ReturnType<typeof ScoreAlpha.readApprovedPass>) {
  const payload = approvedPlan.payloads[0];
  assert.ok(payload);
  return {
    targetPath: payload.target_path,
    agentInputJson: canonicalJson(payload.agent_input),
    packageDigest: payload.payload_digest
  };
}

describe("approved declaration repair binding", () => {
  it("derives exact verifier and repair input from one approved prepared revision", () => {
    const projectRoot = createProject();
    try {
      const approvedPlan = approvePreparedChange(projectRoot, changeDraft());
      const result = bindApprovedDeclarationRepair({
        approvedPlan,
        job: approvedJob(approvedPlan),
        maxRepairs: 1
      });

      assert.equal(result.status, "bound");
      if (result.status !== "bound") throw new Error("Binding failed");
      assert.deepEqual(result.configuration, {
        targetPath: "src/account-label.ts",
        baselineSource,
        declarations: [
          { name: "label", documentedDeclaration }
        ],
        maxRepairs: 1
      });
      assert.equal(result.evidence.passId, approvedPlan.pass_id);
      assert.equal(result.evidence.reviewId, approvedPlan.publication.review_id);
      assert.equal(result.evidence.decisionId, approvedPlan.publication.decision_id);
      assert.equal(result.evidence.payloadId, approvedPlan.payloads[0]?.payload_id);
      assert.equal(result.evidence.agentInputDigest, approvedPlan.payloads[0]?.agent_input_digest);
      assert.match(result.bindingDigest, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(Object.isFrozen(result), true);
      assert.equal(Object.isFrozen(result.configuration), true);
      assert.equal(Object.isFrozen(result.configuration.declarations), true);
      assert.equal(Object.isFrozen(result.evidence), true);
      assert.equal(
        readFileSync(join(projectRoot, "src/account-label.ts"), "utf8"),
        baselineSource
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("binds two approved declarations from one Agent Brief in approved order", () => {
    const projectRoot = createProject();
    try {
      const approvedPlan = approvePreparedChange(
        projectRoot,
        twoDeclarationChangeDraft()
      );
      const result = bindApprovedDeclarationRepair({
        approvedPlan,
        job: approvedJob(approvedPlan),
        maxRepairs: 1
      });

      assert.equal(result.status, "bound");
      if (result.status !== "bound") throw new Error("Binding failed");
      assert.deepEqual(result.configuration, {
        targetPath: "src/account-label.ts",
        baselineSource,
        declarations: [
          { name: "prefix", documentedDeclaration: prefixDeclaration },
          { name: "label", documentedDeclaration }
        ],
        maxRepairs: 1
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("cannot obtain a binding source before the prepared revision is approved", () => {
    const projectRoot = createProject();
    try {
      const prepared = prepareChange({
        projectRoot,
        changeDraft: changeDraft()
      });
      assert.equal(prepared.status, "review_ready");
      if (prepared.status !== "review_ready") throw new Error("Change was not prepared");

      assert.throws(
        () =>
          ScoreAlpha.readApprovedPass(
            join(projectRoot, ".score", "score.db"),
            prepared.passId
          ),
        /not approved/iu
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("binds an approved greenfield absence without inventing baseline source", () => {
    const projectRoot = createProject();
    try {
      const approvedPlan = approvePreparedChange(
        projectRoot,
        changeDraft("create")
      );
      const result = bindApprovedDeclarationRepair({
        approvedPlan,
        job: approvedJob(approvedPlan),
        maxRepairs: 1
      });

      assert.equal(result.status, "bound");
      if (result.status !== "bound") throw new Error("Binding failed");
      assert.deepEqual(result.configuration, {
        targetPath: "src/new-account-label.ts",
        baselineSource: "",
        declarations: [
          { name: "label", documentedDeclaration }
        ],
        maxRepairs: 1
      });
      assert.equal(
        existsSync(join(projectRoot, "src/new-account-label.ts")),
        false
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns a byte-identical binding for the same approved revision", () => {
    const projectRoot = createProject();
    try {
      const approvedPlan = approvePreparedChange(projectRoot, changeDraft());
      const input = {
        approvedPlan,
        job: approvedJob(approvedPlan),
        maxRepairs: 1 as const
      };

      const first = bindApprovedDeclarationRepair(input);
      const second = bindApprovedDeclarationRepair(input);
      assert.deepEqual(first, second);
      assert.equal(canonicalJson(first), canonicalJson(second));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects target, Agent Input, package, and approved-byte substitutions", () => {
    const projectRoot = createProject();
    try {
      const approvedPlan = approvePreparedChange(projectRoot, changeDraft());
      const job = approvedJob(approvedPlan);
      const cases = [
        {
          input: {
            approvedPlan,
            job: { ...job, targetPath: "src/substituted.ts" },
            maxRepairs: 1 as const
          },
          code: "APPROVED_TARGET_MISMATCH"
        },
        {
          input: {
            approvedPlan,
            job: {
              ...job,
              agentInputJson: canonicalJson({ substituted: true })
            },
            maxRepairs: 1 as const
          },
          code: "APPROVED_JOB_INPUT_MISMATCH"
        },
        {
          input: {
            approvedPlan,
            job: { ...job, packageDigest: "sha256:not-approved" },
            maxRepairs: 1 as const
          },
          code: "APPROVED_PAYLOAD_NOT_FOUND"
        },
        {
          input: {
            approvedPlan: {
              ...approvedPlan,
              payloads: approvedPlan.payloads.map((payload) => ({
                ...payload,
                agent_input: {
                  ...(payload.agent_input as Record<string, unknown>),
                  declarations: {
                    owned: [
                      {
                        name: "label",
                        declaration: "export function label(): number;",
                        description: "Substituted after approval."
                      }
                    ],
                    consumed: []
                  }
                }
              }))
            },
            job,
            maxRepairs: 1 as const
          },
          code: "APPROVED_PAYLOAD_DIGEST_MISMATCH"
        }
      ] as const;

      for (const { input, code } of cases) {
        const result = bindApprovedDeclarationRepair(input);
        assert.equal(result.status, "invalid");
        if (result.status !== "invalid") throw new Error("Substitution was accepted");
        assert.equal(result.findings[0].code, code);
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
