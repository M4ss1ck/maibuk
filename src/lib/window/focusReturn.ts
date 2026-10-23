// A window the author returns to (Alt+Tab, a taskbar click, un-minimizing)
// gets its focus back from the browser, on the control that had it. React Aria
// keeps the modality from before the window left, and typing counts as
// keyboard, so every keyboard focus ring (the Pane frame, `useFocusRing`
// rings) came back over the last-used area until the next click.
//
// A private export path, guarded by the focusReturn test like PaneFocusFrame
// guards its `isFocusVisible` import.
import { setInteractionModality } from "react-aria/private/interactions/useFocusVisible";

/**
 * Treats focus the browser restores on window return as no keyboard
 * evidence: the modality turns to pointer, so focus rings stay hidden until a
 * key moves focus again. A key press or pointer press between leaving and
 * returning means the author moved focus themselves, and is left alone.
 * Returns the uninstaller.
 *
 * WebKitGTK (the Linux desktop app) fires `focus` without `focusin` on a
 * return, and fires it twice; React Aria reads the second as virtual focus,
 * which shows rings. So this listens to `focus`, runs after React Aria's own
 * listener (installed when React Aria loads), and stays armed for every focus
 * on the same control until a key, a pointer press, or focus elsewhere.
 */
export function installFocusReturn(): () => void {
  let lastFocused: EventTarget | null = null;
  // The control that held focus when the window lost it to another app.
  let leftFrom: EventTarget | null = null;

  const onFocus = (event: FocusEvent) => {
    if (leftFrom !== null && event.target === leftFrom) {
      setInteractionModality("pointer");
      return;
    }
    leftFrom = null;
    lastFocused = event.target;
  };
  const onWindowBlur = (event: FocusEvent) => {
    // Only the window's own blur; a control's blur reaches a window listener
    // too. Focus moving into a Plugin's iframe also blurs the window, but the
    // iframe takes focus in this document first, so its return lands
    // elsewhere and is left alone.
    if (event.target instanceof Node) return;
    leftFrom = lastFocused;
  };
  const onUserInput = () => {
    leftFrom = null;
  };

  document.addEventListener("focus", onFocus, true);
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("keydown", onUserInput, true);
  window.addEventListener("pointerdown", onUserInput, true);
  return () => {
    document.removeEventListener("focus", onFocus, true);
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("keydown", onUserInput, true);
    window.removeEventListener("pointerdown", onUserInput, true);
  };
}

