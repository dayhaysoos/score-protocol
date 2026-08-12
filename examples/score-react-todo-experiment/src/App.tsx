import { useState } from "react"
import type { JSX } from "react"
import { addTask, filterTasks, toggleTask } from "./todo"
import type { Task } from "./todo"

type Filter = "all" | "active" | "completed"

const emptyMessages: Record<Filter, string> = {
  all: "No tasks yet.",
  active: "No active tasks.",
  completed: "No completed tasks.",
}

export function App(): JSX.Element {
  const [tasks, setTasks] = useState<readonly Task[]>([])
  const [title, setTitle] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const visibleTasks = filterTasks(tasks, filter)

  return (
    <main className="starter">
      <p className="eyebrow">SCORE experiment</p>
      <h1>Tasks</h1>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          const nextTasks = addTask(tasks, title)

          if (nextTasks !== tasks) {
            setTasks(nextTasks)
            setTitle("")
          }
        }}
      >
        <label htmlFor="new-task">New task</label>
        <input
          id="new-task"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button type="submit">Add task</button>
      </form>

      <div role="group" aria-label="Task filters">
        {(["all", "active", "completed"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >
            {option[0].toUpperCase() + option.slice(1)}
          </button>
        ))}
      </div>

      {visibleTasks.length === 0 && <p>{emptyMessages[filter]}</p>}
      <ul>
        {visibleTasks.map((task) => (
          <li key={task.id}>
            <label>
              <input
                type="checkbox"
                checked={task.completed}
                onChange={() =>
                  setTasks((currentTasks) => toggleTask(currentTasks, task.id))
                }
              />
              {task.title}
            </label>
          </li>
        ))}
      </ul>
    </main>
  )
}
