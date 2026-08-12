# Metric report intent

Build a tiny metrics domain with one immutable metric contract, one reusable
formatter, and one report function. Metric values are finite numbers. The
formatter must emit `label: value unit`. The report must preserve input order,
include only highlighted metrics, and return `No highlighted metrics` when the
highlighted selection is empty.
