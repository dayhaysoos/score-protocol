# To-do app interaction and design constraints

This is a behavior-first slice. Preserve the scaffold's existing stylesheet and
container rather than introducing a visual redesign.

## Structure and copy

- Use one primary heading: `Tasks`.
- Present task creation as a semantic form.
- Use the visible label `New task` for the text input and `Add task` for its
  submit button.
- Present `All`, `Active`, and `Completed` as a clearly identified filter group.
- Render tasks as a semantic list, with one labeled checkbox per task.
- Use concise empty-state copy that identifies when the selected view has no
  tasks.

## Accessibility

- Every interactive control has an accessible name matching its visible
  purpose.
- The current filter is available programmatically and is not communicated by
  color alone.
- Completion state comes from the checkbox state and is not communicated by
  decoration alone.
- Keyboard users can submit the form, change filters, and toggle tasks using
  native controls.
- Preserve logical focus order and the browser's visible focus indication.

## Responsive boundary

The interface must remain usable at a 320-pixel viewport without horizontal
scrolling. No additional responsive styling is required for this slice.
