export interface SourceReference {
  protocol_id: string;
  content_digest: string;
}

export interface CompilationBundle {
  schema: "score.compilation-bundle";
  schema_version: "0.1.0-alpha.6";
  profile: "score.coding";
  profile_version: "0.1.0-alpha.6";
  source_bindings: {
    accepted_specification: SourceReference;
    repository_revision: SourceReference;
    compilation_procedure: SourceReference;
    compiler_input_revision: SourceReference;
  };
  proposed_definition: ProposedDefinition;
  compiler_findings: {
    warnings: Array<{
      handle: string;
      code: string;
      affected_path: string;
      message: string;
      basis: string;
      provenance: string;
    }>;
    compilation_gaps: Array<{
      handle: string;
      affected_obligation: string;
      basis: string;
      detector_provenance: string;
      required_resolution: string;
    }>;
  };
}

export interface ProposedDefinition {
  manifest: {
    handle: string;
    label: string;
    objective: string;
    rationale: string;
  };
  compilation_report: { handle: string; summary: string };
  contract_set: { handle: string; logical_name: string; version: string; purpose: string };
  contracts: Contract[];
  contract_inputs: ContractInput[];
  coding_pass: {
    handle: string;
    manifest_handle: string;
    contract_set_handle: string;
    objective: string;
  };
  dependencies: Dependency[];
  context_items: ContextItem[];
  context_sets: ContextSet[];
  capsules: Capsule[];
  capsule_contract_roles: CapsuleContractRole[];
  contract_input_bindings: ContractInputBinding[];
  capability_requirements: CapabilityRequirement[];
  requirement_traceability: RequirementTraceability[];
  source_citations: SourceCitation[];
  source_bindings: SourceBinding[];
}

export interface Contract {
  handle: string;
  contract_set_handle: string;
  logical_name: string;
  version: string;
  kind: string;
  content: unknown;
}

export interface ContractInput {
  handle: string;
  contract_handle: string;
  logical_name: string;
  required: boolean;
  expected_kind: string;
  version_rule: string;
  min_cardinality: number;
  max_cardinality: number;
  purpose: string;
}

export interface Dependency {
  handle: string;
  pass_handle: string;
  dependent_capsule_handle: string;
  prerequisite_kind: "capsule" | "contract";
  prerequisite_handle: string;
  description: string;
}

export interface ContextItem {
  handle: string;
  kind: string;
  version: string;
  purpose: string;
  source: { kind: string; locator: string; version: string };
  resolution: "inline" | "lookup";
  content: unknown;
}

export interface ContextSet {
  handle: string;
  member_handles: string[];
}

export interface Capsule {
  handle: string;
  pass_handle: string;
  context_set_handle: string;
  target_path: string;
  operation: "create" | "replace" | "delete";
  objective: string;
  intended_outcome: string;
  constraints: string[];
  prohibited_effects: string[];
}

export interface CapsuleContractRole {
  capsule_handle: string;
  contract_handle: string;
  role: "implements" | "consumes";
}

export interface ContractInputBinding {
  capsule_handle: string;
  contract_input_handle: string;
  context_item_handle: string;
  actual_kind: string;
  actual_version: string;
  position: number;
}

export interface CapabilityRequirement {
  handle: string;
  capsule_handle: string;
  capability: string;
  version_rule: string;
  required: boolean;
  configuration: unknown;
}

export interface RequirementTraceability {
  requirement_protocol_id: string;
  contract_handles: string[];
  capsule_handles: string[];
  dependency_handles: string[];
  context_item_handles: string[];
}

export interface SourceCitation {
  handle: string;
  repository_revision_protocol_id: string;
  location: string;
  source_digest: string;
  purpose: string;
  excerpt: string;
}

export interface SourceBinding {
  citation_handle: string;
  target_kind: "contract" | "dependency" | "capsule" | "context_item";
  target_handle: string;
  purpose: string;
}
