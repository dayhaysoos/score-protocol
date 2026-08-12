import { formatTaskList } from "./task-list.js";
import type { Task } from "./task.js";

export function summarizeTasks(tasks: readonly Task[]): string {
  const completedCount = tasks.filter((task) => task.completed).length;
  const summary = `${tasks.length} tasks · ${completedCount} complete`;

  if (tasks.length === 0) {
    return summary;
  }

  return `${summary}\n${formatTaskList(tasks)}`;
}
