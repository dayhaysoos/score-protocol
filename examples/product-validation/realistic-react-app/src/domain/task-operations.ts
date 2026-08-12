import type { Task } from "./task";

export function createTask(
  tasks: readonly Task[],
  title: string,
  group: "work" | "personal",
): readonly Task[] {
  const trimmedTitle = title.trim();

  if (trimmedTitle === "") {
    return tasks;
  }

  let greatestId = 0;

  for (const task of tasks) {
    if (task.id > greatestId) {
      greatestId = task.id;
    }
  }

  return [
    ...tasks,
    {
      id: greatestId + 1,
      title: trimmedTitle,
      completed: false,
      group,
    },
  ];
}

export function toggleTask(
  tasks: readonly Task[],
  taskId: number,
): readonly Task[] {
  return tasks.map((task) =>
    task.id === taskId ? { ...task, completed: !task.completed } : task,
  );
}
