import { useState, type JSX } from "react";

import { FilterBar } from "./components/FilterBar";
import { TaskComposer } from "./components/TaskComposer";
import { TaskList } from "./components/TaskList";
import type { Task } from "./domain/task";
import { countCompleted, filterTasks } from "./domain/task-query";
import { createTask, toggleTask } from "./domain/task-operations";

export function App(): JSX.Element {
  const [tasks, setTasks] = useState<readonly Task[]>([]);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

  const visibleTasks = filterTasks(tasks, filter);
  const completedCount = countCompleted(tasks);

  const emptyMessage =
    filter === "active"
      ? "No active tasks."
      : filter === "completed"
        ? "No completed tasks."
        : "No tasks yet.";

  function handleAddTask(title: string, group: "work" | "personal"): void {
    setTasks((currentTasks) => createTask(currentTasks, title, group));
  }

  function handleToggleTask(taskId: number): void {
    setTasks((currentTasks) => toggleTask(currentTasks, taskId));
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Daily focus</p>
        <h1>Focus Board</h1>
        <p>Keep the next useful thing visible.</p>
      </header>
      <section className="board-card" aria-label="Task board">
        <TaskComposer onAdd={handleAddTask} />
        <div className="board-toolbar">
          <p className="summary">
            {completedCount} of {tasks.length} complete
          </p>
          <FilterBar current={filter} onChange={setFilter} />
        </div>
        <TaskList
          tasks={visibleTasks}
          onToggle={handleToggleTask}
          emptyMessage={emptyMessage}
        />
      </section>
    </main>
  );
}
