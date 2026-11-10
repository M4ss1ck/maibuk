const NON_TYPING_INPUT_TYPES = new Set(["checkbox", "button", "submit", "reset", "color", "file"]);

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName;
  if (tagName === "INPUT") {
    return !NON_TYPING_INPUT_TYPES.has((target as HTMLInputElement).type);
  }
  if (tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }

  return Boolean(target.closest("[contenteditable='true']"));
}

export function isModKey(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey;
}
