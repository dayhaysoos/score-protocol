import { Effect } from "effect";

import type { ReviewedChangePlan } from "../score-alpha.js";
import type {
  RuntimeAdapterCatalog,
  RuntimeModel,
  RuntimeModelVariant
} from "./runtime-adapter-catalog.js";
import type { RunId } from "./domain.js";
import type { ConfirmedTarget } from "./domain.js";
import type { RepositoryDriftFinding } from "./repository-application.js";

export class GuidedStartCancelled extends Error {
  constructor() {
    super("Nothing was approved or started.");
    this.name = "GuidedStartCancelled";
  }
}

export interface GuidedStartResult {
  readonly runId: RunId;
  readonly state: string;
}

export interface GuidedStartBackend {
  readonly listPlans: () => Promise<ReadonlyArray<ReviewedChangePlan>>;
  readonly prepareRepository: (
    plan: ReviewedChangePlan
  ) => Promise<{
    readonly repositoryRoot: string;
    readonly confirmedTargets: ReadonlyArray<ConfirmedTarget>;
    readonly repositoryDifferences: ReadonlyArray<RepositoryDriftFinding>;
  }>;
  readonly approve: (plan: ReviewedChangePlan) => Promise<void>;
  readonly start: (input: {
    readonly plan: ReviewedChangePlan;
    readonly model: RuntimeModel;
    readonly variant: RuntimeModelVariant | null;
    readonly concurrency: number;
    readonly repositoryRoot: string;
    readonly confirmedTargets: ReadonlyArray<ConfirmedTarget>;
  }) => Promise<GuidedStartResult>;
}

export interface GuidedStartPrompts {
  readonly selectPlan: (
    plans: ReadonlyArray<ReviewedChangePlan>
  ) => Promise<ReviewedChangePlan>;
  readonly showPlan: (plan: ReviewedChangePlan) => void;
  readonly selectModel: (
    adapterCatalog: RuntimeAdapterCatalog,
    models: ReadonlyArray<RuntimeModel>
  ) => Promise<RuntimeModel>;
  readonly selectVariant?: (
    adapterCatalog: RuntimeAdapterCatalog,
    model: RuntimeModel
  ) => Promise<RuntimeModelVariant | null>;
  readonly confirmStart: (input: {
    readonly adapterCatalog: RuntimeAdapterCatalog;
    readonly plan: ReviewedChangePlan;
    readonly model: RuntimeModel;
    readonly variant: RuntimeModelVariant | null;
    readonly willApprove: boolean;
    readonly repositoryRoot: string;
    readonly confirmedTargets: ReadonlyArray<ConfirmedTarget>;
    readonly repositoryDifferences: ReadonlyArray<RepositoryDriftFinding>;
  }) => Promise<boolean>;
}

function sameConfirmedTargets(
  left: ReadonlyArray<ConfirmedTarget>,
  right: ReadonlyArray<ConfirmedTarget>
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function runGuidedStart(input: {
  readonly backend: GuidedStartBackend;
  readonly prompts: GuidedStartPrompts;
  readonly adapterCatalog: RuntimeAdapterCatalog;
  readonly concurrency?: number;
  readonly variantOverride?: string;
}): Promise<GuidedStartResult> {
  const plans = await input.backend.listPlans();
  if (plans.length === 0) throw new Error("There are no reviewed Changes or Slices to run");
  const plan = await input.prompts.selectPlan(plans);
  input.prompts.showPlan(plan);
  if (plan.approvalStatus === "blocked") {
    throw new Error(`${plan.label} is blocked and cannot run`);
  }
  if (plan.approvalStatus === "review_required") {
    throw new Error(`${plan.label} has warnings that require explicit review`);
  }
  const preparedRepository = await input.backend.prepareRepository(plan);

  const models = await Effect.runPromise(input.adapterCatalog.discoverModels);
  if (models.length === 0) {
    throw new Error(`${input.adapterCatalog.label} did not report any available models`);
  }
  const model = await input.prompts.selectModel(input.adapterCatalog, models);
  let variant: RuntimeModelVariant | null = null;
  if (input.variantOverride !== undefined) {
    variant = model.variants.find((candidate) => candidate.id === input.variantOverride) ?? null;
    if (variant === null) {
      throw new Error(`${model.label} does not advertise variant ${input.variantOverride}`);
    }
  } else if (model.variants.length > 0) {
    if (input.prompts.selectVariant === undefined) {
      throw new Error(`No variant prompt is available for ${model.label}`);
    }
    const selected = await input.prompts.selectVariant(input.adapterCatalog, model);
    if (selected !== null) {
      variant = model.variants.find((candidate) => candidate.id === selected.id) ?? null;
      if (variant === null) {
        throw new Error(`${model.label} does not advertise variant ${selected.id}`);
      }
    }
  }
  const willApprove = plan.approvalStatus === "needs_approval";
  const confirmed = await input.prompts.confirmStart({
    adapterCatalog: input.adapterCatalog,
    plan,
    model,
    variant,
    willApprove,
    repositoryRoot: preparedRepository.repositoryRoot,
    confirmedTargets: preparedRepository.confirmedTargets,
    repositoryDifferences: preparedRepository.repositoryDifferences
  });
  if (!confirmed) throw new GuidedStartCancelled();
  const finalRepository = await input.backend.prepareRepository(plan);
  if (finalRepository.repositoryRoot !== preparedRepository.repositoryRoot) {
    throw new Error("Repository binding changed during guided confirmation");
  }
  if (
    !sameConfirmedTargets(
      finalRepository.confirmedTargets,
      preparedRepository.confirmedTargets
    )
  ) {
    throw new Error("Repository targets changed during guided confirmation");
  }
  if (willApprove) await input.backend.approve(plan);
  return input.backend.start({
    plan,
    model,
    variant,
    concurrency: input.concurrency ?? 5,
    repositoryRoot: finalRepository.repositoryRoot,
    confirmedTargets: preparedRepository.confirmedTargets
  });
}
