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

export function repositoryRevisionContentDigest(input: {
  readonly orderedManifest: unknown;
}): string {
  return sha256Json({
    ordered_manifest: input.orderedManifest
  });
}
