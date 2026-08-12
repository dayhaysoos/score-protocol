import { Schema } from "effect";

export interface RuntimeModelVariant {
  readonly id: string;
  readonly label: string;
  readonly summaryLabel: string;
}

export interface RuntimeModel {
  readonly key: string;
  readonly label: string;
  readonly sourceLabel?: string;
  readonly variants: ReadonlyArray<RuntimeModelVariant>;
}

export class AdapterCatalogDiscoveryError extends Schema.TaggedError<AdapterCatalogDiscoveryError>()(
  "AdapterCatalogDiscoveryError",
  {
    adapterId: Schema.String,
    message: Schema.String
  }
) {}

export interface RuntimeAdapterCatalog<Configuration = unknown> {
  readonly id: string;
  readonly label: string;
  readonly discoverModels: import("effect").Effect.Effect<
    ReadonlyArray<RuntimeModel>,
    AdapterCatalogDiscoveryError
  >;
  readonly configurationFor: (model: RuntimeModel, variantId?: string) => Configuration;
}
