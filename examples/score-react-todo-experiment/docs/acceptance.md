# To-do app acceptance contract

The implementation is acceptable when all of the following observable behaviors
are present together in one candidate state.

## State behavior

- Adding `  Read the plan  ` creates one active task titled `Read the plan`.
- Adding an empty or whitespace-only title creates no task.
- Toggling one task changes only that task's completion state.
- Filtering returns the matching tasks in their original creation order and
  does not mutate the task collection.

## User interaction behavior

- The initial page exposes the `Tasks` heading, the labeled task input, the add
  action, all three filters, an always-present semantic task list, and an empty
  state.
- Submitting a valid title displays the new task and clears the input.
- Submitting an invalid title does not add a blank task.
- Activating a task's checkbox marks it complete.
- Selecting `Active` hides completed tasks; selecting `Completed` shows them;
  selecting `All` restores the complete ordered list.
- The selected filter is programmatically exposed, such as with
  `aria-pressed="true"`.
