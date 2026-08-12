import assert from "node:assert/strict";

import { createTask, toggleTask } from "../src/domain/task-operations.js";
import { countCompleted, filterTasks } from "../src/domain/task-query.js";

let tasks = createTask([], "  Plan launch  ", "work");
assert.deepEqual(tasks, [
  { id: 1, title: "Plan launch", completed: false, group: "work" }
]);
assert.equal(createTask(tasks, "   ", "personal"), tasks);
tasks = createTask(tasks, "Buy tea", "personal");
tasks = toggleTask(tasks, 1);
assert.equal(tasks[0]?.completed, true);
assert.equal(tasks[1]?.completed, false);
assert.deepEqual(filterTasks(tasks, "active").map((task) => task.title), ["Buy tea"]);
assert.deepEqual(filterTasks(tasks, "completed").map((task) => task.title), ["Plan launch"]);
assert.deepEqual(filterTasks(tasks, "all").map((task) => task.title), ["Plan launch", "Buy tea"]);
assert.equal(countCompleted(tasks), 1);
process.stdout.write("Focus Board QA acceptance passed.\n");
