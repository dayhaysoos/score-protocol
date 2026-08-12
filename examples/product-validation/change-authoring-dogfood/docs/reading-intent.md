# Reading progress intent

Reading progress is local, deterministic domain logic. Functions must not mutate
the supplied reading or collection. Percentages are whole numbers so callers do
not need to choose their own rounding policy.
