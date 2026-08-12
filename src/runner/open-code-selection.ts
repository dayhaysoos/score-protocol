import { Effect } from "effect";

import type { AdapterConfiguration } from "./domain.js";
import { openCodeConfiguration } from "./open-code-catalog.js";
import type {
  RuntimeAdapterCatalog,
  RuntimeModel,
  RuntimeModelVariant
} from "./runtime-adapter-catalog.js";

export interface NonInteractiveOpenCodeSelection {
  readonly configuration: AdapterConfiguration;
  readonly model: RuntimeModel | null;
  readonly variant: RuntimeModelVariant | null;
}

export async function resolveNonInteractiveOpenCodeConfiguration(input: {
  readonly adapterCatalog: RuntimeAdapterCatalog<AdapterConfiguration>;
  readonly providerId: string;
  readonly modelId: string;
  readonly variantId?: string;
}): Promise<NonInteractiveOpenCodeSelection> {
  if (input.variantId === undefined) {
    return {
      configuration: openCodeConfiguration(input.providerId, input.modelId),
      model: null,
      variant: null
    };
  }

  const models = await Effect.runPromise(input.adapterCatalog.discoverModels);
  const model = models.find((candidate) => {
    const configuration = input.adapterCatalog.configurationFor(candidate);
    return (
      configuration.providerId === input.providerId &&
      configuration.modelId === input.modelId
    );
  });
  if (model === undefined) {
    throw new Error(
      `${input.adapterCatalog.label} does not advertise model ${input.providerId}/${input.modelId}`
    );
  }
  const variant = model.variants.find((candidate) => candidate.id === input.variantId);
  if (variant === undefined) {
    throw new Error(`${model.label} does not advertise variant ${input.variantId}`);
  }
  return {
    configuration: input.adapterCatalog.configurationFor(model, variant.id),
    model,
    variant
  };
}
