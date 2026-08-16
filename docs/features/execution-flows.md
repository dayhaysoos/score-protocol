# Execution Flows

**Status:** Planned. No active Slice.

## Outcome

An author can describe important behavioral steps once and deliver that plan,
unchanged, only to the Agents whose work depends on it.

## Expected behavior

- Execution Flows are optional and do not alter flow-free Changes or Slices.
- A flow names its recipient Agent Briefs and contains plain-language steps.
- Nested groups state whether their steps are sequential or may occur in any
  order, while preserving authored order.
- A step may reference an approved declaration, but does not have to.
- Invalid paths, recipients, references, duplicates, or structure fail before
  any partial flow is prepared.
- Review, storage, and Agent delivery contain the same frozen flow data.
- Unrelated Agents receive no copy of the flow.
- Revising a flow creates a new revision rather than changing prior approvals.

## Boundaries

An Execution Flow communicates intended behavior. SCORE does not infer it from
source code and does not claim that candidate code followed it. Candidate
verification remains separate.

## Acceptance examples

- A flow-free Change prepares exactly as it did before this feature.
- Two Agents can receive the same ordered flow while a third receives nothing.
- Repeated preparation produces identical bytes and preserves every authored
  ordering choice.
- A flow referring to an unknown Agent Brief or declaration is rejected before
  review.

## Historical evidence

- [Retired Execution Flow Slice](../../score/retired-slices/execution-flow-contracts.json)
