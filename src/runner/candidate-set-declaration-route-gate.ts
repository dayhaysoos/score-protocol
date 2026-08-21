import { extname } from "node:path";

import { parseSync } from "oxc-parser";

import {
  parseJsonNoDuplicateKeys,
  sha256Bytes,
  sha256Json
} from "../canonical.js";
import type {
  CandidateDeclarationFailureEvidence,
  CandidateDeclarationFinding,
  CandidateFile
} from "./domain.js";

type RecordValue = Readonly<Record<string, unknown>>;

interface ApprovedRoute {
  readonly declaration: string;
  readonly ownerTarget: string;
  readonly moduleSpecifier: string;
}

export interface CandidateSetRouteRejection {
  readonly targetPath: string;
  readonly evidence: CandidateDeclarationFailureEvidence;
}

export type CandidateSetDeclarationRouteVerdict =
  | {
      readonly status: "valid";
      readonly candidateSetDigest: string;
      readonly verdictDigest: string;
      readonly rejections: readonly [];
    }
  | {
      readonly status: "invalid";
      readonly candidateSetDigest: string;
      readonly verdictDigest: string;
      readonly rejections: readonly [
        CandidateSetRouteRejection,
        ...CandidateSetRouteRejection[]
      ];
    };

function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function finding(
  code: string,
  declaration: string | null,
  message: string
): CandidateDeclarationFinding {
  return { code, declaration, message };
}

function parserLanguage(path: string): "ts" | "tsx" {
  return extname(path).toLowerCase() === ".tsx" ? "tsx" : "ts";
}

function containsUnsupportedRelevantImport(value: unknown, declaration: string): boolean {
  if (Array.isArray(value)) {
    return value.some((child) =>
      containsUnsupportedRelevantImport(child, declaration)
    );
  }
  const node = record(value);
  if (node === undefined) return false;
  if (node.type === "TSImportEqualsDeclaration") {
    const id = record(node.id);
    if (id?.type === "Identifier" && id.name === declaration) return true;
  }
  if (node.type === "TSImportType") {
    const qualifier = record(node.qualifier);
    if (qualifier?.type === "Identifier" && qualifier.name === declaration) {
      return true;
    }
  }
  return Object.entries(node).some(
    ([key, child]) =>
      key !== "parent" &&
      key !== "scopeId" &&
      key !== "symbolId" &&
      key !== "referenceId" &&
      containsUnsupportedRelevantImport(child, declaration)
  );
}

function inspectRoute(input: {
  readonly targetPath: string;
  readonly candidateSource: string;
  readonly route: ApprovedRoute;
}): CandidateDeclarationFinding | null {
  let parsed: ReturnType<typeof parseSync>;
  try {
    parsed = parseSync(input.targetPath, input.candidateSource, {
      lang: parserLanguage(input.targetPath),
      sourceType: "module",
      astType: "ts"
    });
  } catch {
    return finding(
      "CANDIDATE_SYNTAX_INVALID",
      input.route.declaration,
      "The final consumer candidate could not be parsed, so its approved declaration route cannot be verified"
    );
  }
  const observedSources = new Set<string>();
  const relevantStaticImportRanges: Array<{ readonly start: number; readonly end: number }> = [];
  let unsupportedStaticImport = false;
  for (const staticImport of parsed.module.staticImports) {
    for (const entry of staticImport.entries) {
      if (
        entry.importName.kind === "Name" &&
        entry.importName.name === input.route.declaration
      ) {
        relevantStaticImportRanges.push({
          start: staticImport.start,
          end: staticImport.end
        });
        observedSources.add(staticImport.moduleRequest.value);
      } else if (
        entry.localName.value === input.route.declaration &&
        (entry.importName.kind === "Default" ||
          entry.importName.kind === "NamespaceObject")
      ) {
        relevantStaticImportRanges.push({
          start: staticImport.start,
          end: staticImport.end
        });
        unsupportedStaticImport = true;
      }
    }
  }

  const relevantSyntaxError = parsed.errors.some((error) =>
    error.labels.some((label) =>
      relevantStaticImportRanges.some(
        (range) => label.start < range.end && label.end > range.start
      )
    )
  );
  if (relevantSyntaxError) {
    return finding(
      "CANDIDATE_SYNTAX_INVALID",
      input.route.declaration,
      "The approved declaration import has invalid TypeScript syntax, so its route cannot be verified"
    );
  }

  if (
    observedSources.size === 1 &&
    observedSources.has(input.route.moduleSpecifier)
  ) {
    return null;
  }
  if (
    unsupportedStaticImport ||
    containsUnsupportedRelevantImport(parsed.program, input.route.declaration)
  ) {
    return finding(
      "CONSUMED_DECLARATION_IMPORT_FORM_UNSUPPORTED",
      input.route.declaration,
      `The final consumer candidate uses an unsupported import form for the approved declaration route ${input.route.moduleSpecifier}`
    );
  }
  if (observedSources.size === 0) {
    return finding(
      "CONSUMED_DECLARATION_IMPORT_MISSING",
      input.route.declaration,
      `Import is missing from approved module specifier ${input.route.moduleSpecifier}`
    );
  }
  if (observedSources.size > 1) {
    return finding(
      "CONSUMED_DECLARATION_IMPORT_AMBIGUOUS",
      input.route.declaration,
      `Import must use only approved module specifier ${input.route.moduleSpecifier}`
    );
  }
  return finding(
    "CONSUMED_DECLARATION_ROUTE_MISMATCH",
    input.route.declaration,
    `Import must use approved module specifier ${input.route.moduleSpecifier}`
  );
}

function approvedRoutes(candidate: CandidateFile):
  | { readonly status: "valid"; readonly routes: ReadonlyArray<ApprovedRoute> }
  | { readonly status: "invalid" } {
  let root: RecordValue | undefined;
  try {
    root = record(parseJsonNoDuplicateKeys(candidate.agentInputJson));
  } catch {
    return { status: "invalid" };
  }
  const target = record(root?.target);
  const declarations = record(root?.declarations);
  if (
    root === undefined ||
    target?.path !== candidate.targetPath ||
    !Array.isArray(declarations?.consumed)
  ) {
    return { status: "invalid" };
  }
  const routes: ApprovedRoute[] = [];
  const seen = new Set<string>();
  for (const unknownDeclaration of declarations.consumed) {
    const declaration = record(unknownDeclaration);
    if (
      typeof declaration?.name !== "string" ||
      typeof declaration.owner_target !== "string" ||
      typeof declaration.module_specifier !== "string"
    ) {
      return { status: "invalid" };
    }
    const identity = `${declaration.name}\u0000${declaration.owner_target}\u0000${declaration.module_specifier}`;
    if (seen.has(identity)) return { status: "invalid" };
    seen.add(identity);
    routes.push({
      declaration: declaration.name,
      ownerTarget: declaration.owner_target,
      moduleSpecifier: declaration.module_specifier
    });
  }
  return { status: "valid", routes };
}

function candidateSetDigest(candidates: ReadonlyArray<CandidateFile>): string {
  return sha256Json(
    candidates
      .map((candidate) => ({
        targetPath: candidate.targetPath,
        operation: candidate.operation,
        candidateDigest: candidate.candidateDigest,
        agentInputDigest: candidate.agentInputDigest,
        packageDigest: candidate.packageDigest
      }))
      .toSorted((left, right) => left.targetPath.localeCompare(right.targetPath))
  );
}

export function verifyCandidateSetDeclarationRoutes(
  candidates: ReadonlyArray<CandidateFile>
): CandidateSetDeclarationRouteVerdict {
  const setDigest = candidateSetDigest(candidates);
  const candidateTargets = new Set(candidates.map(({ targetPath }) => targetPath));
  const rejections: CandidateSetRouteRejection[] = [];

  for (const candidate of [...candidates].toSorted((left, right) =>
    left.targetPath.localeCompare(right.targetPath)
  )) {
    const routeInput = approvedRoutes(candidate);
    const findings: CandidateDeclarationFinding[] = [];
    if (routeInput.status === "invalid") {
      findings.push(
        finding(
          "FROZEN_DECLARATION_ROUTE_INPUT_UNSUPPORTED",
          null,
          "The frozen Agent Input does not contain a complete supported declaration route"
        )
      );
    } else {
      for (const route of routeInput.routes) {
        if (!candidateTargets.has(route.ownerTarget)) {
          findings.push(
            finding(
              "CONSUMED_DECLARATION_OWNER_CANDIDATE_MISSING",
              route.declaration,
              "The complete candidate set does not contain the approved declaration owner"
            )
          );
          continue;
        }
        const routeFinding = inspectRoute({
          targetPath: candidate.targetPath,
          candidateSource: candidate.content,
          route
        });
        if (routeFinding !== null) findings.push(routeFinding);
      }
    }
    if (findings.length === 0) continue;

    const routes =
      routeInput.status === "valid"
        ? routeInput.routes
        : [];
    const bindingDigest = sha256Json({
      schema: "score.candidate-set-declaration-route-binding",
      version: "1.0.0",
      targetPath: candidate.targetPath,
      agentInputDigest: candidate.agentInputDigest,
      packageDigest: candidate.packageDigest,
      routes
    });
    const verdictDigest = sha256Json({
      schema: "score.candidate-set-declaration-route-verdict",
      version: "1.0.0",
      bindingDigest,
      candidateSetDigest: setDigest,
      candidateDigest: sha256Bytes(candidate.content),
      findings
    });
    rejections.push({
      targetPath: candidate.targetPath,
      evidence: {
        findings,
        bindingDigest,
        candidateDigest: candidate.candidateDigest,
        verdictDigest
      }
    });
  }

  const verdictDigest = sha256Json({
    schema: "score.complete-candidate-set-declaration-route-verdict",
    version: "1.0.0",
    candidateSetDigest: setDigest,
    rejections: rejections.map(({ targetPath, evidence }) => ({
      targetPath,
      bindingDigest: evidence.bindingDigest,
      candidateDigest: evidence.candidateDigest,
      verdictDigest: evidence.verdictDigest,
      findings: evidence.findings
    }))
  });
  return rejections.length === 0
    ? {
        status: "valid",
        candidateSetDigest: setDigest,
        verdictDigest,
        rejections: []
      }
    : {
        status: "invalid",
        candidateSetDigest: setDigest,
        verdictDigest,
        rejections: rejections as [
          CandidateSetRouteRejection,
          ...CandidateSetRouteRejection[]
        ]
      };
}
