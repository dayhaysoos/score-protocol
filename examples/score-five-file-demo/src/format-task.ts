import { priorityLabel } from "./priority.js";
import type { Task } from "./task.js";

export function formatTask(task: Task): string {
  const completedSuffix = task.completed ? " ✓" : "";
  return `[${priorityLabel(task.priority)}] ${task.title} — ${task.assignee}${completedSuffix}`;
}
