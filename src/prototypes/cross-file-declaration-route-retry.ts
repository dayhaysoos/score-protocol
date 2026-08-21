/**
 * PROTOTYPE — prove that one cross-file route failure can blame and retry only
 * the consumer while preserving the owner candidate for atomic application.
 * This is not production Runner policy.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseSync } from "oxc-parser";

import { sha256Bytes, sha256Json } from "../canonical.js";
import {
  repositoryRevisionContentDigest,
  type RepositorySourceSnapshot
} from "../repository-source-state.js";
import { applyCandidateSet } from "../runner/repository-application.js";

interface ApprovedRoute {
  readonly declaration: string;
  readonly ownerTarget: string;
  readonly consumerTarget: string;
  readonly moduleSpecifier: string;
}

interface Candidate {
  readonly targetPath: string;
  readonly operation: "create" | "replace";
  readonly content: string;
}

interface RouteFinding {
  readonly code: "CONSUMED_DECLARATION_ROUTE_MISMATCH";
  readonly targetPath: string;
  readonly declaration: string;
  readonly expectedModuleSpecifier: string;
  readonly observedModuleSpecifiers: ReadonlyArray<string>;
}

type RouteVerdict =
  | {
      readonly status: "valid";
      readonly findings: readonly [];
      readonly candidateSetDigest: string;
      readonly verdictDigest: string;
    }
  | {
      readonly status: "invalid";
      readonly findings: readonly [RouteFinding];
      readonly candidateSetDigest: string;
      readonly verdictDigest: string;
    };

function candidateDigest(candidate: Candidate): string {
  return sha256Bytes(Buffer.from(candidate.content, "utf8"));
}

function candidateSetDigest(candidates: ReadonlyArray<Candidate>): string {
  return sha256Json(
    candidates
      .map((candidate) => ({
        targetPath: candidate.targetPath,
        operation: candidate.operation,
        candidateDigest: candidateDigest(candidate)
      }))
      .toSorted((left, right) =>
        left.targetPath < right.targetPath
          ? -1
          : left.targetPath > right.targetPath
            ? 1
            : 0
      )
  );
}

function observedNamedImportSources(source: string, declaration: string): string[] {
  const parsed = parseSync("consumer.ts", source, {
    lang: "ts",
    sourceType: "module",
    astType: "ts"
  });
  if (parsed.errors.length > 0) return [];
  const observed = new Set<string>();
  for (const statement of parsed.program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    const importsDeclaration = statement.specifiers.some(
      (specifier) =>
        specifier.type === "ImportSpecifier" &&
        (specifier.imported.type === "Identifier"
          ? specifier.imported.name
          : specifier.imported.value) === declaration
    );
    if (importsDeclaration) observed.add(statement.source.value);
  }
  return [...observed].toSorted();
}

export function verifyCrossFileDeclarationRoute(input: {
  readonly approvedRoute: ApprovedRoute;
  readonly candidates: ReadonlyArray<Candidate>;
}): RouteVerdict {
  const digest = candidateSetDigest(input.candidates);
  const consumer = input.candidates.find(
    ({ targetPath }) => targetPath === input.approvedRoute.consumerTarget
  );
  const observed = consumer === undefined
    ? []
    : observedNamedImportSources(
        consumer.content,
        input.approvedRoute.declaration
      );
  const findings: readonly [] | readonly [RouteFinding] =
    observed.length === 1 && observed[0] === input.approvedRoute.moduleSpecifier
      ? []
      : [
          {
            code: "CONSUMED_DECLARATION_ROUTE_MISMATCH",
            targetPath: input.approvedRoute.consumerTarget,
            declaration: input.approvedRoute.declaration,
            expectedModuleSpecifier: input.approvedRoute.moduleSpecifier,
            observedModuleSpecifiers: observed
          }
        ];
  const verdictDigest = sha256Json({
    schema: "score.prototype.cross-file-declaration-route-verdict",
    version: "0.1.0",
    approvedRoute: input.approvedRoute,
    candidateSetDigest: digest,
    findings
  });
  return findings.length === 0
    ? { status: "valid", findings: [], candidateSetDigest: digest, verdictDigest }
    : {
        status: "invalid",
        findings: findings as readonly [RouteFinding],
        candidateSetDigest: digest,
        verdictDigest
      };
}

function sourceSnapshot(
  projectRoot: string,
  candidates: ReadonlyArray<Candidate>
): RepositorySourceSnapshot {
  const files = candidates
    .filter(({ operation }) => operation === "replace")
    .map(({ targetPath }) => {
      const content = readFileSync(join(projectRoot, targetPath));
      return {
        path: targetPath,
        media_type: "text/typescript; charset=utf-8",
        content_digest: sha256Bytes(content)
      };
    })
    .toSorted((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    );
  return {
    revision_id: "prototype-cross-file-route-base",
    files,
    content_digest: repositoryRevisionContentDigest({ orderedManifest: files })
  };
}

export function runCrossFileDeclarationRouteRetryExperiment(input: {
  readonly projectRoot: string;
  readonly approvedRoute: ApprovedRoute;
  readonly firstCandidates: readonly [Candidate, Candidate];
  readonly repairedCandidate: Candidate;
}) {
  const snapshot = sourceSnapshot(input.projectRoot, input.firstCandidates);
  const firstVerdict = verifyCrossFileDeclarationRoute({
    approvedRoute: input.approvedRoute,
    candidates: input.firstCandidates
  });
  if (firstVerdict.status !== "invalid") {
    throw new Error("The experiment requires one rejected first consumer candidate");
  }
  const retryTargets = [...new Set(firstVerdict.findings.map(({ targetPath }) => targetPath))];
  if (
    retryTargets.length !== 1 ||
    input.repairedCandidate.targetPath !== retryTargets[0]
  ) {
    throw new Error("The repair candidate must replace the one blamed consumer target");
  }
  const retained = input.firstCandidates.filter(
    ({ targetPath }) => !retryTargets.includes(targetPath)
  );
  const repositoryAfterFirstCheck = Object.fromEntries(
    input.firstCandidates
      .map(({ targetPath }) => [
        targetPath,
        readFileSync(join(input.projectRoot, targetPath), "utf8")
      ] as const)
      .toSorted(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0
      )
  );
  const completeCandidates = [...retained, input.repairedCandidate];
  const finalVerdict = verifyCrossFileDeclarationRoute({
    approvedRoute: input.approvedRoute,
    candidates: completeCandidates
  });
  if (finalVerdict.status !== "valid") {
    throw new Error("The repaired candidate set still has an invalid cross-file route");
  }
  const applied = applyCandidateSet({
    repositoryRoot: input.projectRoot,
    snapshot,
    approvedTargets: input.firstCandidates.map(({ targetPath, operation }) => ({
      targetPath,
      operation
    })),
    candidates: completeCandidates.map((candidate) => ({
      ...candidate,
      candidateDigest: candidateDigest(candidate)
    }))
  });
  const owner = retained.find(
    ({ targetPath }) => targetPath === input.approvedRoute.ownerTarget
  );
  if (owner === undefined) throw new Error("The owner candidate was not retained");
  return {
    firstCheck: {
      status: "invalid" as const,
      applicationState: "not_applied" as const,
      retainedTargets: retained.map(({ targetPath }) => targetPath).toSorted(),
      retryTargets,
      findings: firstVerdict.findings
    },
    retainedOwnerDigest: candidateDigest(owner),
    repositoryAfterFirstCheck,
    invocations: {
      first: input.firstCandidates.map(({ targetPath }) => targetPath),
      retry: [input.repairedCandidate.targetPath],
      total: input.firstCandidates.length + 1
    },
    finalCheck: {
      status: "valid" as const,
      applicationState: "applied" as const,
      appliedTargets: applied.appliedPaths,
      findings: [] as const
    },
    evidence: {
      firstCandidateSetDigest: firstVerdict.candidateSetDigest,
      firstVerdictDigest: firstVerdict.verdictDigest,
      finalCandidateSetDigest: finalVerdict.candidateSetDigest,
      finalVerdictDigest: finalVerdict.verdictDigest
    }
  };
}
