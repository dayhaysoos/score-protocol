import { useState, type JSX } from "react";

export interface TaskComposerProps {
  onAdd: (title: string, group: "work" | "personal") => void;
}

export function TaskComposer(props: TaskComposerProps): JSX.Element {
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState<"work" | "personal">("work");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (title.trim() === "") {
      return;
    }

    props.onAdd(title, group);
    setTitle("");
  }

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <label className="field">
        <span>Task</span>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>

      <label className="field">
        <span>Group</span>
        <select
          value={group}
          onChange={(event) =>
            setGroup(event.target.value as "work" | "personal")
          }
        >
          <option value="work">Work</option>
          <option value="personal">Personal</option>
        </select>
      </label>

      <div className="form-actions">
        <button type="submit">Add task</button>
      </div>
    </form>
  );
}
