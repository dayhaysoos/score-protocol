export interface AcceptedRequirementInput {
  readonly protocol_id: string;
  readonly label: string;
  readonly statement: string;
  readonly content_digest: string;
}

export interface AcceptedInputPacket {
  readonly schema: "score.compiler-input-packet";
  readonly version: "0.1.0-alpha.5";
  readonly accepted_specification: {
    readonly protocol_id: string;
    readonly authority: string;
    readonly accepted_at: string;
    readonly content: unknown;
    readonly content_digest: string;
  };
  readonly accepted_requirements: ReadonlyArray<AcceptedRequirementInput>;
  readonly compilation_procedure: {
    readonly protocol_id: string;
    readonly name: string;
    readonly version: string;
    readonly profile: string;
    readonly source: string;
    readonly content: string;
    readonly content_digest: string;
  };
  readonly repository_revision: {
    readonly protocol_id: string;
    readonly label: string;
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly media_type: string;
      readonly content: string;
      readonly content_digest: string;
    }>;
    readonly absent_paths: ReadonlyArray<string>;
    readonly ordered_manifest: ReadonlyArray<{
      readonly path: string;
      readonly media_type: string;
      readonly content_digest: string;
    }>;
    readonly content_digest: string;
  };
  readonly compiler_input_revision: {
    readonly protocol_id: string;
    readonly authority: string;
    readonly accepted_at: string;
    readonly content: unknown;
    readonly content_digest: string;
  };
}
