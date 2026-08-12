# Focus Board acceptance

The final three-slice result is acceptable when all of these observations hold:

- Submitting `  Plan launch  ` in Work adds exactly `Plan launch`, clears the
  input, and leaves Group available for the next task.
- Submitting whitespace adds nothing and does not create an empty list item.
- Adding a Personal task after a Work task preserves their order and labels.
- Checking one task changes only its checkbox state and updates the summary.
- Active hides completed tasks; Completed shows them; All restores both in
  their original order.
- The active filter uses `aria-pressed="true"`; selection is not color-only.
- Form submission, filter selection, and task toggling work with native keyboard
  operation and a logical focus order.
- The page has one `h1`, a named filter group, a visible status summary, a
  semantic `ul` in every filter state, and no horizontal page scroll at 320px.
