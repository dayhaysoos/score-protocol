# Focus Board design constraints

The supplied stylesheet is frozen. Generated components must use its existing
class names and must not add inline styles or modify CSS.

## Structure

- `main.app-shell` contains the product.
- `header.hero` contains `p.eyebrow`, the `Focus Board` h1, and the short intro.
- `section.board-card` contains the composer, summary, filters, and task list.
- Use `.task-form`, `.field`, `.form-actions`, `.board-toolbar`, `.filter-group`,
  `.filter-button`, `.task-list`, `.task-item`, `.task-copy`, `.task-title`,
  `.task-group`, `.empty-state`, and `.summary` for their named roles.
- The eyebrow copy is `Daily focus`; the intro is `Keep the next useful thing visible.`

## Accessibility and responsive behavior

Use native labels, input, select, button, list, and checkbox elements. Give the
filter button container an accessible group name `Task filters`. Preserve the
browser focus ring. Do not hide labels. Do not communicate completion or filter
selection through color alone. The stylesheet has a 640px breakpoint and must
remain usable down to 320px without horizontal page scrolling.
