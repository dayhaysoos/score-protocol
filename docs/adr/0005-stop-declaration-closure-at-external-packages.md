---
status: accepted
superseded_in_part_by: ADR-0014
---

# Stop declaration closure at external packages

Declaration Closure ends at external package boundaries and records
version-bound External Declaration References instead of recursively copying
installed package declarations. Agent Briefs should communicate the required
inputs and outputs without reproducing dependency internals; when package usage
requires additional behavioral guidance, the prepared revision must provide it
as separately approved context, while real project verification checks
compatibility with the frozen installed version.

ADR-0014 narrowly supersedes this decision only for explicitly selected public
package declarations: trusted preparation may freeze those declarations and one
bounded layer of directly required supporting types. External packages remain
closure boundaries, and recursive dependency type-graph traversal remains
prohibited.
