// A small form inside a collection row: an inline rename, a delete confirm.
import type { KeyboardEvent } from "react";
import { focusablesIn } from "./stops";

/**
 * The `onKeyDown` of a small form inside a collection row. React Aria treats a
 * list as one Tab stop and sends a Tab pressed anywhere inside it out of the
 * list, which would make the form's other fields unreachable. Tab and
 * Shift+Tab move between the form's own controls; past its last control (or
 * before its first) the list takes the key and focus leaves it as usual.
 */
export function keepTabInRowForm(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
  const controls = focusablesIn(event.currentTarget, true);
  const index = controls.indexOf(event.target as HTMLElement);
  if (index < 0) return;
  const atEdge = event.shiftKey ? index === 0 : index === controls.length - 1;
  if (!atEdge) event.stopPropagation();
}

// React Aria's FocusScope restores focus by dispatching this bubbling event on
// the element it is about to focus; a collection intercepts it (for its
// virtualized rows) and moves focus to the row instead.
const RESTORE_FOCUS_EVENT = "react-aria-focus-scope-restore";
const stopRestoreFocus = (event: Event) => event.stopPropagation();

/**
 * The `ref` of a small form inside a collection row. When a popover the form
 * opened (the Chapter Type pick list) closes, React Aria hands focus back to
 * its trigger; without this the list intercepts that and moves focus to the
 * row, leaving the rest of the form unreachable.
 */
export function keepFocusRestoreInRowForm(form: HTMLElement | null): (() => void) | undefined {
  if (!form) return;
  form.addEventListener(RESTORE_FOCUS_EVENT, stopRestoreFocus);
  return () => form.removeEventListener(RESTORE_FOCUS_EVENT, stopRestoreFocus);
}

/** Spread on a small form inside a collection row: Tab and popover focus stay with the form. */
export const rowFormProps = {
  ref: keepFocusRestoreInRowForm,
  onKeyDown: keepTabInRowForm,
};
