# Code quality and context management

Status: research note, not normative protocol text  
Reviewed: 2026-08-04

These articles helped shape SCORE's thinking about compiled context, bounded execution, and independent verification. The summaries below describe the sources; the SCORE implications are our interpretations, not accepted protocol decisions.

**Current-scope reconciliation:** The first SQLite alpha stops at approved
Agent Package export. References below to execution outcomes, Context Gaps,
testing, or verification describe possible later research and do not add those
features to the alpha.

This historical note retains terms used by earlier SCORE drafts. Current
product language is defined by the [terminology map](../terminology.md).

## Configuration smells in coding-agent guidance

Source: [“Configuration Smells in AGENTS.md Files: Common Mistakes in Configuring Coding Agents” (arXiv:2606.15828v2)](https://arxiv.org/html/2606.15828v2)

### Short summary

This paper identifies six recurring problems in persistent coding-agent instructions: **Context Bloat**, **Skill Leakage**, **Lint Leakage**, **Blind References**, **Init Fossilization**, and **Conflicting Instructions**. Applying its detection methods to 100 popular repositories, it found at least one smell in 91 of their root `AGENTS.md` or `CLAUDE.md` files.

The important idea is not that every instruction file must be short. It is that always-on context tends to accumulate material that is irrelevant, stale, unexplained, mechanically enforceable elsewhere, or internally inconsistent. Context therefore needs selection and maintenance, not just storage.

### How it can shape SCORE

- A Context Set being immutable does not make it good. The Context Compiler should eventually be able to flag contradictions, stale inputs, unexplained references, and task-irrelevant guidance before a Pass begins.
- Specialized guidance should be selected while compiling a Capsule, not discovered later by its Executor. This preserves the Closed Context rule.
- A context reference should say why it is present and what authority or scope it has. A bare file path is not sufficient context.
- Deterministic rules such as formatting or schema constraints are candidates
  for deterministic validation or the user's external engineering tools rather
  than repeated prose. SCORE-owned code verification is deferred.

The paper studies the prevalence of these smells, not their causal effect on coding success. Its thresholds and model-assisted detection methods should not become protocol rules without SCORE-specific evaluation.

## Failure patterns in large codebases

Source: Tessl, [“What 1,281 agent runs reveal about coding agent failure in large codebases”](https://tessl.io/blog/coding-agent-failure-patterns-large-codebases/)

### Short summary

This article describes five related failure patterns: text search stops scaling, matching code is confused with architecturally relevant code, partial refactors miss distant dependencies, repeated search pollutes the context window, and extra retrieval tools can add more noise than signal.

Its central claim is that large-codebase performance depends less on giving an agent more ways to search and more on supplying precise, structurally relevant context. A locally correct edit can still be systemically wrong when the work boundary omits a consumer, contract, or integration dependency.

### How it can shape SCORE

- Closed execution removes search thrashing from the File Executor, but it transfers retrieval risk to the Context Compiler. SCORE must evaluate the compiler and planner, not only the clean Executor payload.
- “Minimal context” must mean **minimal and sufficient**. The compiler should eventually be able to explain why the selected contracts, files, and excerpts close the Capsule's obligations.
- A group of locally plausible single-file outputs can still form an incorrect
  whole. That is a reason to study later whole-Pass execution and verification,
  not a feature of the current payload-export alpha.
- Later execution experiments could measure irrelevant context, compiler
  backtracking, Context Gaps, retrieval cost, and whole-Pass correctness. The
  current alpha can inspect compiler submissions, binding coverage, and payload
  contents only.

This is a commercial first-party article summarizing benchmark and internal retrieval work, not the underlying dataset or a peer-reviewed paper. Its numeric performance claims are useful directional evidence but are not independently auditable from the article alone.

## Coding before testing and oracle bias

Source: [“On the risk of coding before testing: An empirical study on LLM-based test generation workflow” (arXiv:2607.05139v1)](https://arxiv.org/html/2607.05139v1)

### Short summary

This paper asks whether seeing a faulty implementation makes an LLM worse at writing tests that detect the fault. Across five models and three Python benchmarks, tests generated independently from the task description detected more faults than tests generated after the model was exposed to faulty code or retained the coding conversation.

Adding faulty code reduced fault detection by 9.1%–18.2%, depending on the model. Fresh test-generation sessions also outperformed preserved code-then-test sessions. More tests, chain-of-thought techniques, and high statement coverage did not remove the bias.

### How it could shape later SCORE work

- If SCORE later owns verification, acceptance criteria should be derived or
  frozen before implementation artifacts exist whenever possible.
- A separate verifier is not automatically independent. SCORE should record what specifications, implementation artifacts, sessions, and models were visible when an oracle or test was authored.
- Candidate code can be input to deterministic test execution without becoming an unacknowledged input to generating the tests that judge it.
- Passing post-hoc Executor-generated tests, test count, or coverage should not
  be treated as sufficient whole-Pass evidence. The current alpha deliberately
  includes no Acceptance Oracle or SCORE-owned test execution.

The study uses isolated Python benchmark problems selected for faulty but runnable implementations. It does not establish the same effect size for repository-scale work or every verification workflow.

## Combined lesson for SCORE

The sources point to three separate quality boundaries:

1. **Context quality:** selected inputs must be relevant, current, purposeful, and consistent.
2. **Dependency closure:** restricting Executor discovery only works when the compiler supplies the complete dependency cut needed for the Capsule and Pass.
3. **Verification independence:** the evidence judging an implementation should not inherit that implementation's assumptions by accident.

Together, they support SCORE's preparation-first direction: compile exact
context and make the resulting per-file definitions inspectable before an
external harness runs. They also identify later questions rather than current
claims: whether the compiled context is sufficient in practice and whether any
future verification can remain meaningfully independent of implementation.

## Questions to revisit

- What metadata makes a Context Item admissible and explains why it was selected?
- What evidence should a compiler retain to show dependency closure?
- Which constraints belong in instructions, deterministic checks, or both?
- What degree of informational separation makes verification independent enough?
- Which compiler-history and payload observations are meaningful at the alpha's
  export boundary, before execution outcomes or Context Gaps exist?
