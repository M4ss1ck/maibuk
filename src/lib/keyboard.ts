const NON_TYPING_INPUT_TYPES = new Set(["checkbox", "button", "submit", "reset", "color", "file"]);

// Key events the host has marked as coming from a typing target it cannot
// inspect, such as a key forwarded from a Frame's own document (#760). Keyed by
// the event, so entries live only as long as the event.
const typingEvents = new WeakSet<Event>();

/** Marks a replayed key event as one from a typing target. */
export function markTypingEvent(event: Event): void {
  typingEvents.add(event);
}

/**
 * Whether a key event came from a typing target: its own target is one, or the
 * host marked it because the key was forwarded from a Frame's typing target.
 */
export function isTypingEvent(event: Event): boolean {
  return typingEvents.has(event) || isTypingTarget(event.target);
}

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
