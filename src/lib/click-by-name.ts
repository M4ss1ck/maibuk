// Click by Name's DOM resolver (ADR 0016): finds the pressable control whose
// visible name the author said, and presses it the way `focus.activate` and
// `focus.toggle` do. Accessible names come from `dom-accessibility-api`, never
// a hand-rolled name; matching folds case, accents, and punctuation through
// the interpreter's `normalizePhrase`.
import { computeAccessibleName } from "dom-accessibility-api";
import { create } from "zustand";
import { normalizePhrase } from "@/features/dictation/normalize";
import { isOutsideLayer, topmostLayer } from "@/lib/top-layer";
import { pressKey } from "@/lib/focus-commands";

const PRESSABLE_SELECTOR = [
  "button",
  "a[href]",
  "input[type=checkbox]",
  "input[type=radio]",
  "[role=button]",
  "[role=link]",
  "[role=menuitem]",
  "[role=menuitemcheckbox]",
  "[role=menuitemradio]",
  "[role=tab]",
  "[role=checkbox]",
  "[role=switch]",
  "[role=radio]",
  "[role=option]",
  "[role=row]",
].join(", ");

function isDisabled(el: HTMLElement): boolean {
  if (el instanceof HTMLButtonElement && el.disabled) return true;
  if (el instanceof HTMLInputElement && el.disabled) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (el.closest('[aria-disabled="true"]') !== null) return true;
  if (el.closest("fieldset[disabled]") !== null) return true;
  return false;
}

function isHidden(el: HTMLElement, root: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    if (node.hasAttribute("hidden")) return true;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return true;
    node = node.parentElement;
  }
  if (root.hasAttribute("hidden")) return true;
  const rootStyle = window.getComputedStyle(root);
  if (
    root !== document.body &&
    (rootStyle.display === "none" || rootStyle.visibility === "hidden")
  ) {
    return true;
  }
  return false;
}

/** Every pressable control in `root` the author can see, in document order. */
export function collectPressable(root: HTMLElement = topmostLayer()): HTMLElement[] {
  const found = [...root.querySelectorAll<HTMLElement>(PRESSABLE_SELECTOR)];
  // The root itself may be pressable (a dialog is not, but a row could be).
  const all =
    root instanceof HTMLElement && root.matches(PRESSABLE_SELECTOR) ? [root, ...found] : found;
  return all.filter((el) => !isOutsideLayer(el) && !isDisabled(el) && !isHidden(el, root));
}

/** The pressables whose whole accessible name equals `spoken`, in document order. */
export function findByName(spoken: string, root: HTMLElement = topmostLayer()): HTMLElement[] {
  const want = normalizePhrase(spoken);
  if (want === "") return [];
  return collectPressable(root).filter((el) => normalizePhrase(computeAccessibleName(el)) === want);
}

const TOGGLE_ROLES = new Set([
  "checkbox",
  "switch",
  "radio",
  "option",
  "menuitemcheckbox",
  "menuitemradio",
]);

function isToggleControl(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    return true;
  }
  const role = el.getAttribute("role");
  return role !== null && TOGGLE_ROLES.has(role);
}

/** Focuses `el`, then presses Space for toggles and Enter for everything else. */
export function pressControl(el: HTMLElement): void {
  el.focus();
  pressKey(isToggleControl(el) ? " " : "Enter");
}

interface ClickChoicesState {
  choices: HTMLElement[];
}

export const useClickChoicesStore = create<ClickChoicesState>(() => ({ choices: [] }));

export type PressByNameResult =
  | { kind: "pressed"; name: string }
  | { kind: "choices"; count: number }
  | { kind: "not_found" };

export type PressChoiceResult = { kind: "pressed"; name: string } | { kind: "no_choice" };

/** Presses the one control called `spoken`, or lists the choices when several share the name. */
export function pressByName(spoken: string, root?: HTMLElement): PressByNameResult {
  const matches = findByName(spoken, root);
  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length === 1) {
    const name = computeAccessibleName(matches[0]);
    pressControl(matches[0]);
    return { kind: "pressed", name };
  }
  useClickChoicesStore.setState({ choices: matches });
  return { kind: "choices", count: matches.length };
}

/** Presses the 1-based numbered choice; clears the choices either way. */
export function pressChoice(n: number): PressChoiceResult {
  const choices = useClickChoicesStore.getState().choices;
  useClickChoicesStore.setState({ choices: [] });
  const target = choices[n - 1];
  if (!target) return { kind: "no_choice" };
  const name = computeAccessibleName(target);
  pressControl(target);
  return { kind: "pressed", name };
}

/** Drops pending numbered choices without pressing anything. */
export function clearChoices(): void {
  useClickChoicesStore.setState({ choices: [] });
}

/** Whether numbered Click by Name choices are pending. */
export function hasChoices(): boolean {
  return useClickChoicesStore.getState().choices.length > 0;
}
