import type { JSX } from "react";

import type { Task } from "../domain/task";
import { TaskItem } from "./TaskItem";

export interface TaskListProps {
  tasks: readonly Task[];
  onToggle: (taskId: number) => void;
  emptyMessage: string;
}

export function TaskList(props: TaskListProps): JSX.Element {
  return (
    <>
      <ul className="task-list">
        {props.tasks.map((task) => (
          <TaskItem key={task.id} task={task} onToggle={props.onToggle} />
        ))}
      </ul>
      {props.tasks.length === 0 ? <p className="empty-state">{props.emptyMessage}</p> : null}
    </>
  );
}
