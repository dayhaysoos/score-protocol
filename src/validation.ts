import { validateBundleShape, type ValidationFinding } from "./bundle-schema.js";
import type { AcceptedInputPacket } from "./compiler-input.js";
import type {
  CompilationBundle,
  ContractInput,
  ContractInputBinding,
  ProposedDefinition
} from "./types.js";

function issue(
  code: string,
  location: string,
  message: string,
  detail: Record<string, unknown> = {},
  machineRepairable = true,
  kind: ValidationFinding["kind"] = "deterministic_validation"
): ValidationFinding {
  return {
    kind,
    code,
    severity: "error",
    location,
    message,
    detail,
    machine_repairable: machineRepairable,
    requires_human_input: !machineRepairable
  };
}

function exactVersionMatches(rule: string, actual: string): boolean {
  return rule === "*" || (rule.startsWith("=") && rule.slice(1) === actual);
}

function indexByHandle<T extends { handle: string }>(values: T[]): Map<string, T> {
  return new Map(values.map((value) => [value.handle, value]));
}

function hasExactKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value).toSorted();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

interface ParsedDocumentedDeclaration {
  readonly name: string;
  readonly declaration: string;
  readonly description: string;
}

interface ParsedConsumedDeclaration extends ParsedDocumentedDeclaration {
  readonly owner_target: string;
  readonly module_specifier: string;
}

function validateDocumentedDeclarationContexts(
  definition: ProposedDefinition
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const contextItems = indexByHandle(definition.context_items);
  const parsedContexts = new Map<
    string,
    {
      owned: ParsedDocumentedDeclaration[];
      consumed: ParsedConsumedDeclaration[];
    }
  >();

  for (const contextItem of definition.context_items) {
    if (contextItem.kind !== "documented_declarations") continue;
    const contentLocation = `/context_items/${contextItem.handle}/content`;
    if (!hasExactKeys(contextItem.content, ["consumed", "owned"])) {
      findings.push(
        issue(
          "DOCUMENTED_DECLARATIONS_CONTENT_INVALID",
          contentLocation,
          "Documented declaration content must contain exactly owned and consumed arrays"
        )
      );
      continue;
    }

    const parsed = {
      owned: [] as ParsedDocumentedDeclaration[],
      consumed: [] as ParsedConsumedDeclaration[]
    };

    for (const group of ["owned", "consumed"] as const) {
      const declarations = contextItem.content[group];
      if (!Array.isArray(declarations)) {
        findings.push(
          issue(
            "DOCUMENTED_DECLARATIONS_CONTENT_INVALID",
            `${contentLocation}/${group}`,
            `Documented declarations ${group} must be an array`
          )
        );
        continue;
      }
      declarations.forEach((declaration, index) => {
        const expectedKeys =
          group === "owned"
            ? ["declaration", "description", "name"]
            : [
                "declaration",
                "description",
                "module_specifier",
                "name",
                "owner_target"
              ];
        if (
          !hasExactKeys(declaration, expectedKeys) ||
          typeof declaration.name !== "string" ||
          declaration.name.length === 0 ||
          typeof declaration.declaration !== "string" ||
          declaration.declaration.length === 0 ||
          typeof declaration.description !== "string" ||
          declaration.description.length === 0 ||
          (group === "consumed" &&
            (typeof declaration.owner_target !== "string" ||
              declaration.owner_target.length === 0 ||
              typeof declaration.module_specifier !== "string" ||
              declaration.module_specifier.length === 0))
        ) {
          findings.push(
            issue(
              "DOCUMENTED_DECLARATION_ENTRY_INVALID",
              `${contentLocation}/${group}/${index}`,
              group === "owned"
                ? "Each owned documented declaration must contain exactly nonempty name, declaration, and description text"
                : "Each consumed documented declaration must also contain exactly one nonempty owner target and module specifier"
            )
          );
        } else if (group === "owned") {
          parsed.owned.push({
            name: declaration.name,
            declaration: declaration.declaration,
            description: declaration.description
          });
        } else {
          parsed.consumed.push({
            name: declaration.name,
            declaration: declaration.declaration,
            description: declaration.description,
            owner_target: declaration.owner_target as string,
            module_specifier: declaration.module_specifier as string
          });
        }
      });
    }
    parsedContexts.set(contextItem.handle, parsed);
  }

  const declarationBindingsByCapsule = new Map<string, ContractInputBinding[]>();
  const capsulesByDeclarationContext = new Map<string, Set<string>>();
  for (const binding of definition.contract_input_bindings) {
    if (contextItems.get(binding.context_item_handle)?.kind !== "documented_declarations") {
      continue;
    }
    const capsuleBindings = declarationBindingsByCapsule.get(binding.capsule_handle) ?? [];
    capsuleBindings.push(binding);
    declarationBindingsByCapsule.set(binding.capsule_handle, capsuleBindings);
    const capsules = capsulesByDeclarationContext.get(binding.context_item_handle) ?? new Set();
    capsules.add(binding.capsule_handle);
    capsulesByDeclarationContext.set(binding.context_item_handle, capsules);
  }

  for (const capsule of definition.capsules) {
    const declarationBindings = declarationBindingsByCapsule.get(capsule.handle) ?? [];
    if (declarationBindings.length !== 1) {
      findings.push(
        issue(
          "DOCUMENTED_DECLARATIONS_BINDING_CARDINALITY",
          `/capsules/${capsule.handle}/documented_declarations`,
          `Capsule ${capsule.handle} must have exactly one bound documented declarations Context Item`,
          { expected: 1, actual: declarationBindings.length }
        )
      );
    }
  }

  for (const contextItem of definition.context_items) {
    if (contextItem.kind !== "documented_declarations") continue;
    const capsuleHandles = capsulesByDeclarationContext.get(contextItem.handle) ?? new Set();
    if (capsuleHandles.size !== 1) {
      findings.push(
        issue(
          "DOCUMENTED_DECLARATIONS_CONTEXT_CARDINALITY",
          `/context_items/${contextItem.handle}`,
          `Documented declaration Context Item ${contextItem.handle} must belong to exactly one Capsule`,
          { expected: 1, actual: capsuleHandles.size }
        )
      );
    }
  }

  const declarationsByCapsule = new Map<
    string,
    {
      contextItemHandle: string;
      owned: ParsedDocumentedDeclaration[];
      consumed: ParsedConsumedDeclaration[];
    }
  >();
  for (const capsule of definition.capsules) {
    const bindings = declarationBindingsByCapsule.get(capsule.handle) ?? [];
    if (bindings.length !== 1) continue;
    const binding = bindings[0]!;
    const parsed = parsedContexts.get(binding.context_item_handle);
    if (parsed === undefined) continue;
    declarationsByCapsule.set(capsule.handle, {
      contextItemHandle: binding.context_item_handle,
      ...parsed
    });
  }

  const ownedByCapsule = new Map<
    string,
    Map<string, ParsedDocumentedDeclaration>
  >();
  for (const [capsuleHandle, declarations] of declarationsByCapsule) {
    const ownedByName = new Map<string, ParsedDocumentedDeclaration>();
    declarations.owned.forEach((declaration, index) => {
      if (ownedByName.has(declaration.name)) {
        findings.push(
          issue(
            "DOCUMENTED_DECLARATION_OWNER_DUPLICATE",
            `/context_items/${declarations.contextItemHandle}/content/owned/${index}`,
            `Capsule ${capsuleHandle} owns documented declaration ${declaration.name} more than once`,
            { capsule_handle: capsuleHandle, name: declaration.name }
          )
        );
      } else {
        ownedByName.set(declaration.name, declaration);
      }
    });
    ownedByCapsule.set(capsuleHandle, ownedByName);
  }

  const prerequisiteCapsules = new Map<string, Set<string>>();
  for (const dependency of definition.dependencies) {
    if (dependency.prerequisite_kind !== "capsule") continue;
    const prerequisites = prerequisiteCapsules.get(dependency.dependent_capsule_handle) ?? new Set();
    prerequisites.add(dependency.prerequisite_handle);
    prerequisiteCapsules.set(dependency.dependent_capsule_handle, prerequisites);
  }

  for (const [capsuleHandle, declarations] of declarationsByCapsule) {
    const prerequisites = prerequisiteCapsules.get(capsuleHandle) ?? new Set<string>();
    const consumedRelations = new Set<string>();
    declarations.consumed.forEach((consumed, index) => {
      const owners = [...prerequisites].flatMap((prerequisiteHandle) => {
        const declaration = ownedByCapsule.get(prerequisiteHandle)?.get(consumed.name);
        return declaration === undefined
          ? []
          : [{ capsuleHandle: prerequisiteHandle, declaration }];
      });
      const location =
        `/context_items/${declarations.contextItemHandle}/content/consumed/${index}`;

      if (owners.length === 0) {
        findings.push(
          issue(
            "DOCUMENTED_DECLARATION_OWNER_MISSING",
            location,
            `Consumed documented declaration ${consumed.name} has no owning prerequisite Capsule`,
            { capsule_handle: capsuleHandle, name: consumed.name }
          )
        );
        return;
      }
      if (owners.length > 1) {
        findings.push(
          issue(
            "DOCUMENTED_DECLARATION_OWNER_DUPLICATE",
            location,
            `Consumed documented declaration ${consumed.name} resolves to more than one owner`,
            {
              capsule_handle: capsuleHandle,
              name: consumed.name,
              owner_capsules: owners.map((owner) => owner.capsuleHandle)
            }
          )
        );
        return;
      }

      const owner = owners[0]!;
      if (owner.capsuleHandle === capsuleHandle) {
        findings.push(
          issue(
            "DOCUMENTED_DECLARATION_OWNER_ALSO_CONSUMER",
            location,
            `Capsule ${capsuleHandle} cannot consume its own documented declaration ${consumed.name}`,
            { capsule_handle: capsuleHandle, name: consumed.name }
          )
        );
        return;
      }
      const relation = `${owner.capsuleHandle}\u0000${consumed.name}`;
      if (consumedRelations.has(relation)) {
        findings.push(
          issue(
            "DOCUMENTED_DECLARATION_CONSUMER_DUPLICATE",
            location,
            `Capsule ${capsuleHandle} consumes documented declaration ${consumed.name} from the same owner more than once`,
            {
              capsule_handle: capsuleHandle,
              owner_capsule_handle: owner.capsuleHandle,
              name: consumed.name
            }
          )
        );
        return;
      }
      consumedRelations.add(relation);
      const ownerTarget = definition.capsules.find(
        ({ handle }) => handle === owner.capsuleHandle
      )?.target_path;
      if (consumed.owner_target !== ownerTarget) {
        findings.push(
          issue(
            "DOCUMENTED_DECLARATION_CONSUMER_ROUTE_DIVERGENT",
            location,
            `Consumed documented declaration ${consumed.name} names a different owner target`,
            {
              capsule_handle: capsuleHandle,
              owner_capsule_handle: owner.capsuleHandle,
              name: consumed.name,
              expected_owner_target: ownerTarget,
              actual_owner_target: consumed.owner_target
            }
          )
        );
      }
      if (
        consumed.declaration !== owner.declaration.declaration ||
        consumed.description !== owner.declaration.description
      ) {
        findings.push(
          issue(
            "DOCUMENTED_DECLARATION_CONSUMER_DIVERGENT",
            location,
            `Consumed documented declaration ${consumed.name} differs from its owner`,
            {
              capsule_handle: capsuleHandle,
              owner_capsule_handle: owner.capsuleHandle,
              name: consumed.name
            }
          )
        );
      }
    });
  }

  return findings;
}

function validateUniqueHandles(definition: ProposedDefinition): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const seen = new Map<string, string>();
  const groups: Array<[string, Array<{ handle: string }>]> = [
    ["manifest", [definition.manifest]],
    ["compilation_report", [definition.compilation_report]],
    ["contract_set", [definition.contract_set]],
    ["contract", definition.contracts],
    ["contract_input", definition.contract_inputs],
    ["coding_pass", [definition.coding_pass]],
    ["dependency", definition.dependencies],
    ["context_item", definition.context_items],
    ["context_set", definition.context_sets],
    ["capsule", definition.capsules],
    ["capability_requirement", definition.capability_requirements],
    ["source_citation", definition.source_citations]
  ];

  for (const [kind, objects] of groups) {
    for (const object of objects) {
      const priorKind = seen.get(object.handle);
      if (priorKind) {
        findings.push(
          issue(
            "DUPLICATE_LOCAL_HANDLE",
            `/proposed_definition/${kind}`,
            `Bundle-local handle ${object.handle} is reused`,
            { handle: object.handle, first_kind: priorKind, duplicate_kind: kind }
          )
        );
      } else {
        seen.set(object.handle, kind);
      }
    }
  }
  return findings;
}

function validateSourceBindings(
  bundle: CompilationBundle,
  inputs: AcceptedInputPacket
): ValidationFinding[] {
  const expected = {
    accepted_specification: {
      protocol_id: inputs.accepted_specification.protocol_id,
      content_digest: inputs.accepted_specification.content_digest
    },
    repository_revision: {
      protocol_id: inputs.repository_revision.protocol_id,
      content_digest: inputs.repository_revision.content_digest
    },
    compilation_procedure: {
      protocol_id: inputs.compilation_procedure.protocol_id,
      content_digest: inputs.compilation_procedure.content_digest
    },
    compiler_input_revision: {
      protocol_id: inputs.compiler_input_revision.protocol_id,
      content_digest: inputs.compiler_input_revision.content_digest
    }
  };
  const findings: ValidationFinding[] = [];
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    const actual = bundle.source_bindings[key];
    if (
      actual.protocol_id !== expected[key].protocol_id ||
      actual.content_digest !== expected[key].content_digest
    ) {
      findings.push(
        issue(
          "SOURCE_BINDING_MISMATCH",
          `/source_bindings/${key}`,
          `Source binding ${key} does not identify the accepted input`,
          { expected: expected[key], actual }
        )
      );
    }
  }
  return findings;
}

function validateGraph(definition: ProposedDefinition, inputs: AcceptedInputPacket): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const contracts = indexByHandle(definition.contracts);
  const contractInputs = indexByHandle(definition.contract_inputs);
  const dependencies = indexByHandle(definition.dependencies);
  const contextItems = indexByHandle(definition.context_items);
  const contextSets = indexByHandle(definition.context_sets);
  const capsules = indexByHandle(definition.capsules);
  const citations = indexByHandle(definition.source_citations);
  const repositoryPaths = new Set(inputs.repository_revision.files.map((file) => file.path));
  const requirementIds = new Set<string>(
    inputs.accepted_requirements.map((requirement) => requirement.protocol_id)
  );
  const reportDuplicate = (
    seen: Set<string>,
    key: string,
    code: string,
    location: string,
    message: string
  ): void => {
    if (seen.has(key)) findings.push(issue(code, location, message));
    seen.add(key);
  };

  if (definition.coding_pass.manifest_handle !== definition.manifest.handle) {
    findings.push(issue("PASS_MANIFEST_DANGLING", "/proposed_definition/coding_pass/manifest_handle", "Coding Pass does not reference the proposed Manifest"));
  }
  if (definition.coding_pass.contract_set_handle !== definition.contract_set.handle) {
    findings.push(issue("PASS_CONTRACT_SET_DANGLING", "/proposed_definition/coding_pass/contract_set_handle", "Coding Pass does not reference the proposed Contract Set"));
  }
  const logicalContracts = new Set<string>();
  for (const contract of definition.contracts) {
    if (contract.contract_set_handle !== definition.contract_set.handle) {
      findings.push(issue("CONTRACT_SET_DANGLING", `/contracts/${contract.handle}`, "Contract references an unknown Contract Set"));
    }
    reportDuplicate(
      logicalContracts,
      `${contract.contract_set_handle}\u0000${contract.logical_name}\u0000${contract.version}`,
      "CONTRACT_LOGICAL_VERSION_DUPLICATE",
      `/contracts/${contract.handle}`,
      "Contract logical name and version are duplicated within the Contract Set"
    );
  }
  const logicalInputs = new Set<string>();
  for (const input of definition.contract_inputs) {
    if (!contracts.has(input.contract_handle)) {
      findings.push(issue("CONTRACT_INPUT_CONTRACT_DANGLING", `/contract_inputs/${input.handle}`, "Contract Input references an unknown Contract"));
    }
    if (input.min_cardinality > input.max_cardinality || (input.required && input.min_cardinality < 1)) {
      findings.push(issue("CONTRACT_INPUT_CARDINALITY_INVALID", `/contract_inputs/${input.handle}`, "Contract Input has invalid cardinality", { minimum: input.min_cardinality, maximum: input.max_cardinality, required: input.required }));
    }
    reportDuplicate(
      logicalInputs,
      `${input.contract_handle}\u0000${input.logical_name}`,
      "CONTRACT_INPUT_LOGICAL_NAME_DUPLICATE",
      `/contract_inputs/${input.handle}`,
      "Contract Input logical name is duplicated within one Contract"
    );
  }

  const targetOwners = new Map<string, string>();
  const contextSetOwners = new Map<string, string>();
  for (const capsule of definition.capsules) {
    if (capsule.pass_handle !== definition.coding_pass.handle) {
      findings.push(issue("CAPSULE_PASS_DANGLING", `/capsules/${capsule.handle}/pass_handle`, "Capsule references an unknown Coding Pass"));
    }
    if (!contextSets.has(capsule.context_set_handle)) {
      findings.push(issue("CAPSULE_CONTEXT_SET_DANGLING", `/capsules/${capsule.handle}/context_set_handle`, "Capsule references an unknown Context Set"));
    }
    const priorContextSetOwner = contextSetOwners.get(capsule.context_set_handle);
    if (priorContextSetOwner) {
      findings.push(
        issue(
          "CONTEXT_SET_MULTIPLE_CAPSULES",
          `/capsules/${capsule.handle}/context_set_handle`,
          `Context Set ${capsule.context_set_handle} is assigned to more than one Capsule`,
          { first_capsule: priorContextSetOwner, duplicate_capsule: capsule.handle }
        )
      );
    } else {
      contextSetOwners.set(capsule.context_set_handle, capsule.handle);
    }
    const priorOwner = targetOwners.get(capsule.target_path);
    if (priorOwner) {
      findings.push(issue("DUPLICATE_TARGET_WRITER", `/capsules/${capsule.handle}/target_path`, `Target ${capsule.target_path} has more than one writer`, { first_capsule: priorOwner, duplicate_capsule: capsule.handle }));
    } else {
      targetOwners.set(capsule.target_path, capsule.handle);
    }
    const present = repositoryPaths.has(capsule.target_path);
    if (capsule.operation === "replace" && !present) {
      findings.push(issue("TARGET_REPLACE_ABSENT", `/capsules/${capsule.handle}`, `Replace target ${capsule.target_path} is absent from the base revision`));
    }
    if (capsule.operation === "create" && present) {
      findings.push(issue("TARGET_CREATE_PRESENT", `/capsules/${capsule.handle}`, `Create target ${capsule.target_path} already exists in the base revision`));
    }
  }

  for (const contextSet of definition.context_sets) {
    for (const member of contextSet.member_handles) {
      if (!contextItems.has(member)) {
        findings.push(issue("CONTEXT_SET_ITEM_DANGLING", `/context_sets/${contextSet.handle}`, `Context Set member ${member} does not resolve`));
      }
    }
  }

  const rolesByCapsule = new Map<string, Set<string>>();
  const rolePairs = new Set<string>();
  for (const role of definition.capsule_contract_roles) {
    if (!capsules.has(role.capsule_handle)) {
      findings.push(issue("CONTRACT_ROLE_CAPSULE_DANGLING", "/capsule_contract_roles", `Contract role references unknown Capsule ${role.capsule_handle}`));
    }
    if (!contracts.has(role.contract_handle)) {
      findings.push(issue("CONTRACT_ROLE_CONTRACT_DANGLING", "/capsule_contract_roles", `Contract role references unknown Contract ${role.contract_handle}`));
    }
    reportDuplicate(
      rolePairs,
      `${role.capsule_handle}\u0000${role.contract_handle}`,
      "CONTRACT_ROLE_DUPLICATE",
      "/capsule_contract_roles",
      "Capsule-to-Contract role is duplicated"
    );
    const values = rolesByCapsule.get(role.capsule_handle) ?? new Set<string>();
    values.add(role.contract_handle);
    rolesByCapsule.set(role.capsule_handle, values);
  }

  const bindingsByCapsule = new Map<string, ContractInputBinding[]>();
  const bindingPositions = new Set<string>();
  const bindingSuppliers = new Set<string>();
  for (const binding of definition.contract_input_bindings) {
    const capsule = capsules.get(binding.capsule_handle);
    const input = contractInputs.get(binding.contract_input_handle);
    const item = contextItems.get(binding.context_item_handle);
    if (!capsule) {
      findings.push(issue("BINDING_CAPSULE_DANGLING", "/contract_input_bindings", `Binding references unknown Capsule ${binding.capsule_handle}`));
      continue;
    }
    if (!input) {
      findings.push(issue("BINDING_INPUT_DANGLING", "/contract_input_bindings", `Binding references unknown Contract Input ${binding.contract_input_handle}`));
      continue;
    }
    if (!item) {
      findings.push(issue("BINDING_ITEM_DANGLING", "/contract_input_bindings", `Binding references unknown Context Item ${binding.context_item_handle}`));
      continue;
    }
    const contextSet = contextSets.get(capsule.context_set_handle);
    if (!contextSet?.member_handles.includes(item.handle)) {
      findings.push(issue("BINDING_ITEM_OUTSIDE_CONTEXT_SET", "/contract_input_bindings", `Binding supplier ${item.handle} is not in Capsule ${capsule.handle}'s Context Set`));
    }
    if (binding.actual_kind !== item.kind || binding.actual_kind !== input.expected_kind) {
      findings.push(issue("BINDING_KIND_MISMATCH", "/contract_input_bindings", `Binding kind ${binding.actual_kind} is incompatible`, { expected_kind: input.expected_kind, item_kind: item.kind }));
    }
    if (binding.actual_version !== item.version || !exactVersionMatches(input.version_rule, binding.actual_version)) {
      findings.push(issue("BINDING_VERSION_MISMATCH", "/contract_input_bindings", `Binding version ${binding.actual_version} is incompatible`, { version_rule: input.version_rule, item_version: item.version }));
    }
    if (item.resolution === "lookup") {
      findings.push(issue("CONTEXT_LOOKUP_INSTRUCTION", `/context_items/${item.handle}`, `Bound Context Item ${item.handle} is a lookup instruction rather than resolved content`, {}, false));
    }
    const positionKey = `${binding.capsule_handle}\u0000${binding.contract_input_handle}\u0000${binding.position}`;
    if (bindingPositions.has(positionKey)) {
      findings.push(issue("BINDING_POSITION_DUPLICATE", "/contract_input_bindings", "Binding position is duplicated", { capsule_handle: binding.capsule_handle, contract_input_handle: binding.contract_input_handle, position: binding.position }));
    }
    bindingPositions.add(positionKey);
    reportDuplicate(
      bindingSuppliers,
      `${binding.capsule_handle}\u0000${binding.contract_input_handle}\u0000${binding.context_item_handle}`,
      "BINDING_SUPPLIER_DUPLICATE",
      "/contract_input_bindings",
      "The same Context Item supplier is bound more than once to one Capsule input"
    );
    const values = bindingsByCapsule.get(binding.capsule_handle) ?? [];
    values.push(binding);
    bindingsByCapsule.set(binding.capsule_handle, values);
  }

  for (const capsule of definition.capsules) {
    const capsuleBindings = bindingsByCapsule.get(capsule.handle) ?? [];
    const contractHandles = rolesByCapsule.get(capsule.handle) ?? new Set<string>();
    for (const input of definition.contract_inputs.filter((candidate) => contractHandles.has(candidate.contract_handle))) {
      const count = capsuleBindings.filter((binding) => binding.contract_input_handle === input.handle).length;
      if (count < input.min_cardinality) {
        findings.push(issue("BINDING_REQUIRED_MISSING", `/capsules/${capsule.handle}`, `Capsule ${capsule.handle} does not satisfy Contract Input ${input.handle}`, { minimum: input.min_cardinality, actual: count }));
      }
      if (count > input.max_cardinality) {
        findings.push(issue("BINDING_CARDINALITY_EXCEEDED", `/capsules/${capsule.handle}`, `Capsule ${capsule.handle} exceeds Contract Input ${input.handle} cardinality`, { maximum: input.max_cardinality, actual: count }));
      }
    }
    const contextSet = contextSets.get(capsule.context_set_handle);
    for (const member of contextSet?.member_handles ?? []) {
      if (!capsuleBindings.some((binding) => binding.context_item_handle === member)) {
        findings.push(issue("CONTEXT_ITEM_UNBOUND", `/context_sets/${capsule.context_set_handle}`, `Context Item ${member} is present but unexplained for Capsule ${capsule.handle}`));
      }
    }
  }

  for (const dependency of definition.dependencies) {
    if (dependency.pass_handle !== definition.coding_pass.handle) {
      findings.push(issue("DEPENDENCY_PASS_DANGLING", `/dependencies/${dependency.handle}`, "Dependency references an unknown Coding Pass"));
    }
    if (!capsules.has(dependency.dependent_capsule_handle)) {
      findings.push(issue("DEPENDENCY_CAPSULE_DANGLING", `/dependencies/${dependency.handle}`, "Dependency references an unknown dependent Capsule"));
    }
    const prerequisiteExists = dependency.prerequisite_kind === "capsule" ? capsules.has(dependency.prerequisite_handle) : contracts.has(dependency.prerequisite_handle);
    if (!prerequisiteExists) {
      findings.push(issue("DEPENDENCY_PREREQUISITE_DANGLING", `/dependencies/${dependency.handle}`, "Dependency prerequisite does not resolve"));
    }
  }

  const tracedRequirements = new Set<string>();
  for (const trace of definition.requirement_traceability) {
    if (tracedRequirements.has(trace.requirement_protocol_id)) {
      findings.push(
        issue(
          "TRACE_REQUIREMENT_DUPLICATE",
          "/requirement_traceability",
          `Accepted Requirement ${trace.requirement_protocol_id} has more than one traceability record`
        )
      );
    }
    tracedRequirements.add(trace.requirement_protocol_id);
    if (!requirementIds.has(trace.requirement_protocol_id)) {
      findings.push(issue("TRACE_REQUIREMENT_DANGLING", "/requirement_traceability", `Trace references unknown requirement ${trace.requirement_protocol_id}`));
    }
    for (const handle of trace.contract_handles) if (!contracts.has(handle)) findings.push(issue("TRACE_CONTRACT_DANGLING", "/requirement_traceability", `Trace references unknown Contract ${handle}`));
    for (const handle of trace.capsule_handles) if (!capsules.has(handle)) findings.push(issue("TRACE_CAPSULE_DANGLING", "/requirement_traceability", `Trace references unknown Capsule ${handle}`));
    for (const handle of trace.dependency_handles) if (!dependencies.has(handle)) findings.push(issue("TRACE_DEPENDENCY_DANGLING", "/requirement_traceability", `Trace references unknown Dependency ${handle}`));
    for (const handle of trace.context_item_handles) if (!contextItems.has(handle)) findings.push(issue("TRACE_CONTEXT_ITEM_DANGLING", "/requirement_traceability", `Trace references unknown Context Item ${handle}`));
  }
  for (const requirementId of requirementIds) {
    if (!tracedRequirements.has(requirementId)) {
      findings.push(issue("TRACE_REQUIREMENT_MISSING", "/requirement_traceability", `Accepted Requirement ${requirementId} has no implementation path`));
    }
  }

  for (const citation of definition.source_citations) {
    if (citation.repository_revision_protocol_id !== inputs.repository_revision.protocol_id) {
      findings.push(issue("SOURCE_CITATION_REVISION_MISMATCH", `/source_citations/${citation.handle}`, "Source citation does not identify the accepted Repository Revision"));
    }
    const file = inputs.repository_revision.files.find((candidate) => candidate.path === citation.location);
    const recognizedDigest = file?.content_digest === citation.source_digest || inputs.repository_revision.content_digest === citation.source_digest;
    if (!recognizedDigest) {
      findings.push(issue("SOURCE_CITATION_DIGEST_MISMATCH", `/source_citations/${citation.handle}`, "Source citation digest is not present in the accepted Repository Revision"));
    }
  }
  const sourceBindingKeys = new Set<string>();
  for (const binding of definition.source_bindings) {
    if (!citations.has(binding.citation_handle)) findings.push(issue("SOURCE_BINDING_CITATION_DANGLING", "/source_bindings", `Source binding references unknown citation ${binding.citation_handle}`));
    const targetMaps = { contract: contracts, dependency: dependencies, capsule: capsules, context_item: contextItems } as const;
    if (!targetMaps[binding.target_kind].has(binding.target_handle)) findings.push(issue("SOURCE_BINDING_TARGET_DANGLING", "/source_bindings", `Source binding references unknown ${binding.target_kind} ${binding.target_handle}`));
    reportDuplicate(
      sourceBindingKeys,
      `${binding.citation_handle}\u0000${binding.target_kind}\u0000${binding.target_handle}`,
      "SOURCE_BINDING_DUPLICATE",
      "/source_bindings",
      "Compilation Source Binding is duplicated"
    );
  }

  for (const capability of definition.capability_requirements) {
    const capsule = capsules.get(capability.capsule_handle);
    if (!capsule) {
      findings.push(issue("CAPABILITY_CAPSULE_DANGLING", `/capability_requirements/${capability.handle}`, "Capability references an unknown Capsule"));
    } else if (typeof capability.configuration === "object" && capability.configuration !== null && "target_path" in capability.configuration && capability.configuration.target_path !== capsule.target_path) {
      findings.push(issue("CAPABILITY_TARGET_MISMATCH", `/capability_requirements/${capability.handle}`, "Capability target differs from its Capsule target"));
    }
  }

  return findings;
}

export function validateCompilationBundle(
  bundle: unknown,
  inputs: AcceptedInputPacket
): ValidationFinding[] {
  const shapeFindings = validateBundleShape(bundle);
  if (shapeFindings.length > 0) {
    return shapeFindings;
  }
  const typedBundle = bundle as CompilationBundle;
  const findings = [
    ...validateSourceBindings(typedBundle, inputs),
    ...validateUniqueHandles(typedBundle.proposed_definition),
    ...validateDocumentedDeclarationContexts(typedBundle.proposed_definition),
    ...validateGraph(typedBundle.proposed_definition, inputs)
  ];
  for (const warning of typedBundle.compiler_findings.warnings) {
    findings.push({
      kind: "heuristic_warning",
      code: warning.code,
      severity: "warning",
      location: warning.affected_path,
      message: warning.message,
      detail: { basis: warning.basis, provenance: warning.provenance },
      machine_repairable: false,
      requires_human_input: true
    });
  }
  for (const gap of typedBundle.compiler_findings.compilation_gaps) {
    findings.push(issue("COMPILATION_GAP_OPEN", `/compiler_findings/compilation_gaps/${gap.handle}`, gap.basis, { affected_obligation: gap.affected_obligation, detector_provenance: gap.detector_provenance, required_resolution: gap.required_resolution }, false, "compilation_gap"));
  }
  return findings.sort((left, right) => `${left.location}\u0000${left.code}`.localeCompare(`${right.location}\u0000${right.code}`));
}

export function hasBlockingFindings(findings: ValidationFinding[]): boolean {
  return findings.some((finding) => finding.severity === "error");
}
