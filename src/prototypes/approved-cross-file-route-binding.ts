/**
 * PROTOTYPE — freeze an explicitly reviewed project-local import route into
 * digest-bound approved input. This is not a production schema or Runner rule.
 */

import { sha256Json } from "../canonical.js";

export interface AuthoredCrossFileDeclarationRoute {
  readonly declaration: string;
  readonly ownerTarget: string;
  readonly consumerTarget: string;
  readonly moduleSpecifier: string;
}

interface ApprovedCrossFileRouteInput {
  readonly content: {
    readonly schema: string;
    readonly version: string;
    readonly changeRevisionId: string;
    readonly approvalDecisionId: string;
    readonly routes: ReadonlyArray<AuthoredCrossFileDeclarationRoute>;
  };
  readonly contentDigest: string;
}

interface AuthoredRouteInput {
  readonly changeRevisionId: string;
  readonly approvalDecisionId: string;
  readonly routes: ReadonlyArray<AuthoredCrossFileDeclarationRoute>;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function freezeApprovedCrossFileRouteInput(input: AuthoredRouteInput) {
  const content = {
    schema: "score.prototype.approved-cross-file-route-input" as const,
    version: "0.1.0" as const,
    changeRevisionId: input.changeRevisionId,
    approvalDecisionId: input.approvalDecisionId,
    routes: input.routes.map((route) => ({ ...route }))
  };
  return deepFreeze({
    content,
    contentDigest: sha256Json(content)
  });
}

export function bindApprovedCrossFileDeclarationRoute(input: {
  readonly approvedInput: ApprovedCrossFileRouteInput;
  readonly approvedInputDigest: string;
  readonly consumerTarget: string;
  readonly declaration: string;
}) {
  if (
    sha256Json(input.approvedInput.content) !== input.approvedInput.contentDigest ||
    input.approvedInput.contentDigest !== input.approvedInputDigest
  ) {
    return deepFreeze({
      status: "invalid" as const,
      findings: [
        {
          code: "APPROVED_ROUTE_INPUT_SUBSTITUTED" as const,
          location: "/approvedInput/contentDigest",
          message: "Cross-file declaration route input does not match the approved digest"
        }
      ] as const
    });
  }
  const matches = input.approvedInput.content.routes.filter(
    (route) =>
      route.consumerTarget === input.consumerTarget &&
      route.declaration === input.declaration
  );
  if (matches.length !== 1) {
    return deepFreeze({
      status: "invalid" as const,
      findings: [
        {
          code: "APPROVED_ROUTE_NOT_UNIQUE" as const,
          location: "/approvedInput/content/routes",
          message: "Approved input does not contain exactly one matching declaration route"
        }
      ] as const
    });
  }
  const approvedRoute = deepFreeze({ ...matches[0]! });
  const evidence = deepFreeze({
    changeRevisionId: input.approvedInput.content.changeRevisionId,
    approvalDecisionId: input.approvedInput.content.approvalDecisionId,
    approvedInputDigest: input.approvedInput.contentDigest
  });
  return deepFreeze({
    status: "bound" as const,
    approvedRoute,
    evidence,
    bindingDigest: sha256Json({
      schema: "score.prototype.approved-cross-file-route-binding",
      version: "0.1.0",
      evidence,
      approvedRoute
    })
  });
}
