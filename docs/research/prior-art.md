# Prior art: planning and orchestration near SCORE Protocol

Status: research note, not normative protocol text  
Reviewed: 2026-07-31

This note compares nearby work using primary sources only. Statements under **Source findings** are paraphrases of the linked source. Statements under **Inference for SCORE** are interpretations, not claims made by those sources.

**Current-scope reconciliation:** Some inferences were written while SCORE was
considering a broader orchestration runtime. The current first alpha is narrower:
it compiles, validates, supports human approval, and exports closed File Briefs.
A user-owned Runner starts agents and writes files. Runtime lifecycle, results,
testing, verification, and benchmarking are deferred.

This historical note retains terms used by sources and by earlier SCORE drafts.
Current SCORE product language is defined by the
[terminology map](../terminology.md); older recommendations that prefer Capsule,
Executor, or Harness wording are superseded.

## Summary

| Work | Its center of gravity | Material overlap with SCORE | Important separation |
| --- | --- | --- | --- |
| Mise en Place (MEP) paper | Preparation methodology for agentic coding | Context grounding, specification, dependency-aware decomposition, bounded parallel work, integration verification | It is a methodology and one case study, not an interoperable execution protocol |
| CNCF Score | Portable container-workload specification | Versioned declarative input translated by independent implementations | Its implementations generate deployment configuration; they do not coordinate contract-bound work executors |
| Eclipse S-CORE | Safety-oriented automotive software platform and in-process orchestration | Executors, static graphs, dependencies, events, timing contracts, fault handling, observability | It schedules application tasks in automotive runtimes, not project work across interchangeable executors |
| Eclipse score (separate project) | Java workflow engine and orchestration-language compiler | Compiles workflow descriptions into executable plans | The official project record is sparse and shows no releases, so current activity is unknown |
| Orquesta | Collaborative PromptOps product for AI software teams | Shared/versioned prompts, routing to agents, plans, execution status, audit trail, review gates | Its public materials describe a product and product-specific APIs, not a vendor-neutral protocol or conformance target |

## Mise en Place for Agentic Coding

Primary source: Andrew Zigler, [“Mise en Place for Agentic Coding: Deliberate Preparation as Context Engineering Methodology,” arXiv:2605.05400v1](https://arxiv.org/html/2605.05400) (6 May 2026).

### Source findings

- MEP is a three-phase, preparation-first methodology: externalize tacit/domain knowledge into persistent context, create a detailed specification through human-agent dialogue, then convert the specification into dependency-aware task records. All three phases are intended to finish before implementation begins.
- Its backward-design principle starts from desired outputs and success criteria. Its specification phase records rationale and exclusions so an agent can make aligned local decisions without repeatedly escalating to the practitioner.
- Its task records carry priorities, dependencies, and acceptance criteria. Fine-grained tasks with explicit boundaries are intended to enable parallel execution, moving coordination work from runtime into preparation. Parallel outputs then converge in integration verification.
- The case study used 64 task records (“beads”) as the interface between preparation and execution and sent work to four parallel subagents. The paper reports useful observations, but explicitly limits the evidence to a single practitioner in one five-hour hackathon with no control condition. It does not claim the observed low rework was caused by the method.
- The paper itself calls for a matched preparation-first versus iteration-first comparison, asks how much context is sufficient, and asks whether the approach scales to multi-month development.

### Inference for SCORE

- **Closest conceptual prior art:** MEP already covers much of the rationale for planning from an outcome, supplying rich context, recording constraints, decomposing work by dependency, running bounded work concurrently, and verifying the integration. SCORE should cite it directly rather than present those ideas as novel.
- **Potential protocol contribution:** the paper describes workflow phases and
  example artifacts, but does not define SCORE's proposed immutable per-file
  definition, closed Context Set, explicit Contract Input bindings, publication
  digest boundary, or conformance schema.
- **Unspecified execution concerns:** it does not standardize claiming or leases,
  heartbeats, retries, cancellation, abandoned work, Artifact transport, or
  acceptance. SCORE once considered these near-term concerns; they are now
  deferred unless a future reporting integration demonstrates a real need.
- **Optional evaluation consequence:** A later comparison could address the
  paper's research gap, but benchmarking is not SCORE's central workflow or a
  first-alpha requirement. Any comparison should count preparation as well as
  execution cost.

## CNCF Score

Primary sources: [Score overview](https://docs.score.dev/) and [guide for creating a Score implementation](https://docs.score.dev/docs/how-to/create-a-score-implementation/).

### Source findings

- Score is a CNCF Sandbox project and a platform- and environment-agnostic specification for container-based workloads. A `score.yaml` file describes one workload’s containers, service ports, and resource dependencies without using target-platform syntax.
- Its documented flow is: author a Score file, pass it to a Score implementation, generate target-platform configuration, then apply that configuration with the target platform’s normal tooling. Reference implementations include `score-compose` and `score-k8s`; an implementation need not be a CLI.
- Score deliberately describes workload-level properties rather than replacing all platform configuration. It draws a boundary between developer-owned workload configuration and platform-owned infrastructure configuration.
- A Score implementation’s core responsibilities are to collect and validate workload files, provision or resolve declared resources, and convert workloads into target-specific manifests while resolving placeholders. Generation is required to be additive and idempotent.

### Inference for SCORE

- The reusable architectural lesson is the split between a portable declarative
  specification and independently built implementations. The semantics are
  otherwise different: CNCF Score generates deployment manifests; SCORE
  Protocol exports closed work definitions for a user-owned agentic harness.
- CNCF Score “resources” are runtime dependencies requested by a container
  workload. SCORE currently uses declared effects and Profile rules; a generic
  Resource Claim remains an open future question and should not be presented as
  current vocabulary.
- Because `Score`, `score.yaml`, the `score.dev` namespace, and `score-*` implementation names are established in cloud-native tooling, capitalization alone will not prevent search, package, command, or conversational confusion with `SCORE Protocol`.

## Eclipse S-CORE

Primary sources: [S-CORE platform documentation](https://eclipse-score.github.io/score/main/), [Orchestration feature (v0.5 beta)](https://eclipse-score.github.io/score/main/features/orchestration/index.html), and [Lifecycle feature](https://eclipse-score.github.io/score/main/features/lifecycle/index.html).

### Source findings

- Eclipse S-CORE is a code-first open-source software platform foundation for onboard automotive ECUs, especially safety-critical ADAS, body, and chassis systems. Its documentation says it is a generic foundation for commercial distributions, not a ready-to-integrate series product.
- Its experimental orchestration feature proposes two coupled runtime frameworks. The **Executor** supplies cooperative user-space multitasking over statically configured thread pools, with explicit priority, affinity, blocking-task, and safety-critical scheduling behavior. The **Orchestrator** defines runtime-static **Program** graphs.
- A Program can express sequential, parallel, conditional, and bounded/periodic flows; events and cross-program synchronization; deadlines and timeouts; and fallback or retry behavior. Each Program is deployed to one Executor, multiple Programs may share an Executor, and events form their synchronization interface.
- The Orchestrator uses a code-first API rather than a textual DSL or IDL. Its observability covers Program transitions, task lifecycle, timing violations, queueing, and correlation with OS scheduling.
- S-CORE’s separate lifecycle feature starts, stops, and supervises processes or containers according to configured run states and functional dependencies. It includes health monitoring and recovery concerns.

### Inference for SCORE

- The domain boundary is strong: S-CORE orchestrates deterministic application
  computation on automotive runtimes, while SCORE Protocol compiles portable
  work definitions that user-owned integrations may route to heterogeneous
  Executors. Similar graph vocabulary does not imply compatible execution units.
- The terminology collision is substantial. S-CORE already uses **Executor**, task lifecycle events, static graphs, dependencies, events, timing contracts, retries, and observability. SCORE documents should define these terms by domain and avoid implying that its Executor abstraction is derived from, or compatible with, S-CORE’s runtime framework.
- The `eclipse-score` organization, `/score/` documentation paths, and the styled name `S-CORE` create a second discovery and naming collision beyond CNCF Score.

## Separate Eclipse `score` workflow engine

Primary source: Eclipse Foundation [project governance record for Eclipse score](https://projects.eclipse.org/projects/soa.score/governance).

### Source findings

- This is a project distinct from automotive S-CORE. The Eclipse record describes lowercase `score` as a generic Java workflow engine that can run execution plans.
- Its stated scope includes compilers that convert XML/JSON workflow descriptions into executable plans, support for multiple orchestration languages through a standard compiler interface, and prebuilt Java actions. The record lists a creation review dated 5 November 2014 and no releases.

### Inference for SCORE

- This is a closer wording-level antecedent than automotive S-CORE because it explicitly joins workflow compilation, orchestration languages, and execution plans under the exact name `score`.
- The reviewed official record does not establish whether the project remains active. That uncertainty limits product comparison but not the naming and searchability risk. Its history should be checked before making novelty claims about “compiling” plans for execution.

## Orquesta

Primary sources: Orquesta’s [first-party product page](https://getorquesta.com/) and [documentation](https://getorquesta.com/docs). A public first-party GitHub organization also exists at [Getorquesta](https://github.com/Getorquesta).

### Source findings

- Orquesta describes itself as a collaborative PromptOps platform for AI software teams. Team members submit prompts into a shared project; a local or remote agent executes them; and the product records prompts, logs, code changes, review, and deployment activity.
- Its explicit orchestra metaphor says prompts are the “score,” humans set direction and approval gates, and agents “play their parts.” Prompts are presented as shared, versioned, replayable production assets.
- The product routes prompts among multiple execution modes, maintains project context, records an attributed/reversible timeline, and supports review before merge. Its documentation exposes a prompt lifecycle of `pending`, `evaluating`, `running`, `processing`, and `completed`.
- Its planning UI can break a plan into items and dispatch an item as a prompt. Its external-agent API submits prompts, reads their status/results/logs, inspects the queue, and retrieves project context, plans, and tickets.

### Inference for SCORE

- Orquesta is a more direct product-neighbor than its metaphor alone suggests: it joins planning, prompt dispatch, code execution, structured status, auditability, and human gates in one AI-development control plane.
- The reviewed first-party material describes Orquesta-specific product entities, execution modes, APIs, and workflows. It does not present a provider-neutral capsule protocol, independent implementation contract, or conformance suite. That distinction should be verified again if Orquesta publishes a formal specification later.
- SCORE should not use the orchestra metaphor as its differentiator. Orquesta
  already owns a clear “prompts are the score / agents play their parts / human
  conductor” story in this market. SCORE's current technical distinction is the
  compiled, immutable, contract-bound per-file definition with closed resolved
  context, explicit bindings, human publication, and portable Harness Payloads.

## Cross-cutting ambiguity and coupling risks

1. **Name and discovery risk.** “SCORE Protocol” is fixed, but CNCF Score, automotive Eclipse S-CORE, and a separate Eclipse `score` workflow engine already occupy nearby namespaces; Orquesta also uses “score” as its central AI-development metaphor. A separate trademark and package/domain availability review is warranted; this note makes no legal conclusion.
2. **“Execution” is overloaded.** CNCF Score generates deployable configuration,
   S-CORE schedules application tasks, and Orquesta runs development prompts.
   SCORE should state immediately that an external user-owned harness executes
   its published definitions.
3. **Capsule versus task or prompt.** If a Capsule is merely a task record or
   enhanced prompt, MEP and Orquesta already cover much of the space. Its current
   identity is sharper: immutable objective and Contract, closed resolved
   Context Set, explicit input bindings, Capability requirements, and declared
   effects. Runtime Artifacts and lifecycle are not required for the alpha.
4. **Executor ambiguity.** S-CORE’s Executor is a concrete thread-pool runtime. SCORE’s proposed Executor is any human or machine capable of accepting a capsule. Consider always using “SCORE executor” in prose and reserving the unqualified schema term only within the protocol namespace.
5. **Preparation versus protocol.** MEP supplies a strong planning method, but
   Core should not require one planning methodology. The first SQLite alpha does
   deliberately require an LLM Context Compiler so it tests the intended product
   flow rather than a manually authored database fixture.
6. **Avoid accidental coding-only coupling.** The paper and Orquesta center AI coding, while CNCF Score and S-CORE show how quickly generic terms acquire domain-specific meanings. Keep repository paths, patches, tests, and worktrees in a Coding Profile unless the core invariant truly applies to every executor type.
