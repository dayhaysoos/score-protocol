import type { Task } from "./task.js";

export function priorityLabel(priority: Task["priority"]): string {
  switch (priority) {
    case "low":
      return "LOW";
    case "medium":
      return "MEDIUM";
    case "high":
      return "HIGH";
  }
}
