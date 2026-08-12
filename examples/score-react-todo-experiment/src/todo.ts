export interface Task {
  id: number;
  title: string;
  completed: boolean;
}

export function addTask(tasks: readonly Task[], title: string): readonly Task[] {
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
    { id: greatestId + 1, title: trimmedTitle, completed: false },
  ];
}

export function filterTasks(
  tasks: readonly Task[],
  filter: "all" | "active" | "completed",
): readonly Task[] {
  if (filter === "all") {
    return tasks;
  }

  const completed = filter === "completed";
  return tasks.filter((task) => task.completed === completed);
}

export function toggleTask(
  tasks: readonly Task[],
  taskId: number,
): readonly Task[] {
  return tasks.map((task) =>
    task.id === taskId ? { ...task, completed: !task.completed } : task,
  );
}
