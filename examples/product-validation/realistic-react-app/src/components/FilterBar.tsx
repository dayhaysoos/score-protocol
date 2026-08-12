import type { JSX } from "react";

export interface FilterBarProps {
  current: "all" | "active" | "completed";
  onChange: (filter: "all" | "active" | "completed") => void;
}

export function FilterBar(props: FilterBarProps): JSX.Element {
  return (
    <div className="filter-group" role="group" aria-label="Task filters">
      <button
        type="button"
        className="filter-button"
        aria-pressed={props.current === "all"}
        onClick={() => props.onChange("all")}
      >
        All
      </button>
      <button
        type="button"
        className="filter-button"
        aria-pressed={props.current === "active"}
        onClick={() => props.onChange("active")}
      >
        Active
      </button>
      <button
        type="button"
        className="filter-button"
        aria-pressed={props.current === "completed"}
        onClick={() => props.onChange("completed")}
      >
        Completed
      </button>
    </div>
  );
}
