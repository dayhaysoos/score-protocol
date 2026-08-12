import { sha256Json } from "./canonical.js";

export interface RepositorySourceSnapshot {
  readonly revision_id: string;
  readonly content_digest: string;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly media_type: string;
    readonly content_digest: string;
  }>;
}

export function compareRepositoryPaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function repositoryRevisionContentDigest(input: {
  readonly orderedManifest: unknown;
}): string {
  return sha256Json({
    ordered_manifest: input.orderedManifest
  });
}
