import type { CompilationBundle } from "./types.js";

function cloneBundle(bundle: unknown): CompilationBundle {
  return structuredClone(bundle) as CompilationBundle;
}

export function createMalformedBundles(validBundle: unknown): Map<string, unknown> {
  const variants = new Map<string, unknown>();

  const replaceAbsent = cloneBundle(validBundle);
  const replaceCapsule = replaceAbsent.proposed_definition.capsules.find(
    (capsule) => capsule.handle === "replace_schema"
  );
  if (replaceCapsule) replaceCapsule.target_path = "src/missing.ts";
  variants.set("replace-target-absent", replaceAbsent);

  const createPresent = cloneBundle(validBundle);
  const createCapsule = createPresent.proposed_definition.capsules.find(
    (capsule) => capsule.handle === "create_account_label"
  );
  if (createCapsule) createCapsule.target_path = "src/schema.ts";
  variants.set("create-target-present", createPresent);

  const duplicateWriter = cloneBundle(validBundle);
  const duplicatedCapsule = structuredClone(duplicateWriter.proposed_definition.capsules[0]);
  if (duplicatedCapsule) {
    duplicatedCapsule.handle = "duplicate_schema_writer";
    duplicateWriter.proposed_definition.capsules.push(duplicatedCapsule);
  }
  variants.set("duplicate-writer", duplicateWriter);

  const missingBinding = cloneBundle(validBundle);
  missingBinding.proposed_definition.contract_input_bindings =
    missingBinding.proposed_definition.contract_input_bindings.filter(
      (binding) =>
        !(
          binding.capsule_handle === "replace_schema" &&
          binding.contract_input_handle === "target_state_input"
        )
    );
  variants.set("required-binding-missing", missingBinding);

  const danglingBinding = cloneBundle(validBundle);
  const dangling = danglingBinding.proposed_definition.contract_input_bindings.find(
    (binding) => binding.context_item_handle === "label_requirements"
  );
  if (dangling) dangling.context_item_handle = "missing_context_item";
  variants.set("binding-item-dangling", danglingBinding);

  const incompatibleBinding = cloneBundle(validBundle);
  const incompatible = incompatibleBinding.proposed_definition.contract_input_bindings.find(
    (binding) => binding.context_item_handle === "label_requirements"
  );
  if (incompatible) incompatible.actual_kind = "policy";
  variants.set("binding-kind-incompatible", incompatibleBinding);

  const unexplainedItem = cloneBundle(validBundle);
  const schemaContext = unexplainedItem.proposed_definition.context_sets.find(
    (contextSet) => contextSet.handle === "schema_context"
  );
  schemaContext?.member_handles.push("typescript_module_boundaries_skill");
  variants.set("context-item-unexplained", unexplainedItem);

  const lookupInstruction = cloneBundle(validBundle);
  const lookupItem = lookupInstruction.proposed_definition.context_items.find(
    (item) => item.handle === "label_requirements"
  );
  if (lookupItem) {
    lookupItem.resolution = "lookup";
    lookupItem.content = {
      instruction: "Read src/schema.ts to discover the Account declaration."
    };
  }
  variants.set("required-fact-lookup", lookupInstruction);

  const unknownField = cloneBundle(validBundle) as CompilationBundle & {
    unknown_bundle_field?: string;
  };
  unknownField.unknown_bundle_field = "must be rejected";
  variants.set("unknown-bundle-field", unknownField);

  return variants;
}
