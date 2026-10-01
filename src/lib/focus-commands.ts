import { useEffect } from "react";
// React Aria's own Tab order, not a hand-rolled tabindex walk. A private
// export path; the focus-commands unit test guards the import so a React
// Aria upgrade that moves it fails loudly instead of silently reordering Tab.
import { getFocusableTreeWalker } from "react-aria/private/focus/FocusScope";
import { useBoundShortcutIds } from "@/lib/bound-shortcuts";
import { registerCommandSource, type RunnableBinding } from "@/lib/command-runner";
import { isOutsideLayer, topmostLayer } from "@/lib/top-layer";

export type FocusPressKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End"
  | "Enter"
  | " "
  | "Escape";

function codeFor(key: FocusPressKey): string {
  return key === " " ? "Space" : key;
}

// Presses a browser key the way the platform would: a keydown then its
// keyup on the focused element, so the focused control's own handler runs.
// A synthetic key runs no default action, so when nothing prevented the
// keydown an Enter or Space that would activate the control clicks it once,
// and an Enter in a form field submits its form.
export function pressKey(key: FocusPressKey): void {
  const target = document.activeElement ?? document.body;
  const code = codeFor(key);
  const down = new KeyboardEvent("keydown", {
    key,
    code,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  target.dispatchEvent(down);
  target.dispatchEvent(
    new KeyboardEvent("keyup", { key, code, bubbles: true, cancelable: true, composed: true })
  );
  if (down.defaultPrevented) return;
  if (!(target instanceof HTMLElement)) return;
  if (key === "Enter") {
    if (target instanceof HTMLButtonElement && !target.disabled) target.click();
    else if (target instanceof HTMLAnchorElement && target.hasAttribute("href")) target.click();
    else if (target instanceof HTMLInputElement) submitImplicitly(target);
  } else if (key === " ") {
    if (target instanceof HTMLButtonElement && !target.disabled) target.click();
    else if (
      target instanceof HTMLInputElement &&
      !target.disabled &&
      (target.type === "checkbox" || target.type === "radio")
    ) {
      target.click();
    }
  }
}

const NO_IMPLICIT_SUBMISSION = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

// A synthetic Enter never triggers the browser's implicit submission, so a
// voice "press enter" in a form field does it here the way the HTML spec
// does: press the form's default button, or submit a form that has none.
function submitImplicitly(field: HTMLInputElement): void {
  const form = field.form;
  if (!form || field.disabled || NO_IMPLICIT_SUBMISSION.has(field.type)) return;
  const defaultButton = Array.from(form.elements).find(
    (element): element is HTMLButtonElement | HTMLInputElement =>
      (element instanceof HTMLButtonElement && element.type === "submit") ||
      (element instanceof HTMLInputElement &&
        (element.type === "submit" || element.type === "image"))
  );
  if (defaultButton) {
    if (!defaultButton.disabled) defaultButton.click();
    return;
  }
  form.requestSubmit();
}

// Moves focus one tabbable stop in `direction`, wrapping at the ends. The
// order is React Aria's walker over the topmost layer, skipping anything
// outside it (an inert subtree never takes voice focus). A dialog's own
// focus containment keeps this inside while it is open.
export function moveFocus(direction: 1 | -1): void {
  const root = topmostLayer();
  const walker = getFocusableTreeWalker(root, { tabbable: true });
  walker.currentNode = root;
  const stops: HTMLElement[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node instanceof HTMLElement && !isOutsideLayer(node)) stops.push(node);
    node = walker.nextNode();
  }
  if (stops.length === 0) return;
  const active = document.activeElement;
  const index = active instanceof Element ? stops.indexOf(active as HTMLElement) : -1;
  if (index === -1) {
    (direction === 1 ? stops[0] : stops[stops.length - 1]).focus();
    return;
  }
  stops[(index + direction + stops.length) % stops.length].focus();
}

export const FOCUS_COMMAND_IDS = [
  "focus.next",
  "focus.previous",
  "focus.up",
  "focus.down",
  "focus.left",
  "focus.right",
  "focus.first",
  "focus.last",
  "focus.activate",
  "focus.toggle",
  "focus.escape",
] as const;

export function focusCommandBindings(): RunnableBinding[] {
  return [
    { id: "focus.next", onTrigger: () => moveFocus(1) },
    { id: "focus.previous", onTrigger: () => moveFocus(-1) },
    { id: "focus.up", onTrigger: () => pressKey("ArrowUp") },
    { id: "focus.down", onTrigger: () => pressKey("ArrowDown") },
    { id: "focus.left", onTrigger: () => pressKey("ArrowLeft") },
    { id: "focus.right", onTrigger: () => pressKey("ArrowRight") },
    { id: "focus.first", onTrigger: () => pressKey("Home") },
    { id: "focus.last", onTrigger: () => pressKey("End") },
    { id: "focus.activate", onTrigger: () => pressKey("Enter") },
    { id: "focus.toggle", onTrigger: () => pressKey(" ") },
    { id: "focus.escape", onTrigger: () => pressKey("Escape") },
  ];
}

// The browser owns these keys, so no `useShortcuts` binding ever handles
// them; they stay Bound Shortcuts through the bound-ids declaration and run
// by voice (or palette) through the command source. Mounted once in the app
// shell, above the Tutorial boundary, so they work while a run is under way.
export function useFocusCommands(): void {
  useBoundShortcutIds(FOCUS_COMMAND_IDS);
  useEffect(() => registerCommandSource(() => focusCommandBindings()), []);
}
