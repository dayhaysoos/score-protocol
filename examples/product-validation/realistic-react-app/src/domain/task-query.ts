import type { Task } from "./task";

export function filterTasks(
  tasks: readonly Task[],
  filter: "all" | "active" | "completed",
): readonly Task[] {
  if (filter === "all") {
    return tasks;
  }

  return tasks.filter((task) => task.completed === (filter === "completed"));
}

export function countCompleted(tasks: readonly Task[]): number {
  let completedCount = 0;

  for (const task of tasks) {
    if (task.completed) {
      completedCount += 1;
    }
  }

  return completedCount;
}
