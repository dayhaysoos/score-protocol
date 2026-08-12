import type { JSX } from "react";
import type { Task } from "../domain/task";

export interface TaskItemProps {
  task: Task;
  onToggle: (taskId: number) => void;
}

export function TaskItem(props: TaskItemProps): JSX.Element {
  const { task } = props;
  const inputId = `task-${task.id}`;
  const groupLabel = task.group === "work" ? "Work" : "Personal";

  return (
    <li className="task-item">
      <input
        id={inputId}
        type="checkbox"
        checked={task.completed}
        onChange={() => props.onToggle(task.id)}
      />
      <label className="task-copy" htmlFor={inputId}>
        <span className="task-title">{task.title}</span>
        <span className="task-group">{groupLabel}</span>
      </label>
    </li>
  );
}
