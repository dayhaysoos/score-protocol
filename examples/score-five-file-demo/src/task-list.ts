import { formatTask } from "./format-task.js";
import type { Task } from "./task.js";

export function formatTaskList(tasks: readonly Task[]): string {
  return tasks.map((task) => formatTask(task)).join("\n");
}
