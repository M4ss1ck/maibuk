/**
 * The pressed state of a Plugin's Toggle Buttons (the `toolbar.setPressed`
 * method). The Plugin sets a button on or off; the editor toolbar reads it
 * through `useSyncExternalStore`. Maibuk never flips it itself: a click only
 * runs the button's Command. The state is in memory and is not persisted, so
 * a Plugin that stops or restarts starts every button off.
 */

const pressed = new Map<string, Set<string>>();
let revision = 0;
const listeners = new Set<() => void>();

function notify(): void {
  revision += 1;
  for (const listener of [...listeners]) listener();
}

/**
 * Sets one of a Plugin's Toggle Buttons on or off. Subscribers run only when
 * the state actually changes, so a repeated call with the same value is silent.
 * The caller checks that the button is a declared Toggle Button first.
 */
export function setToolbarPressed(pluginId: string, localId: string, value: boolean): void {
  const current = pressed.get(pluginId);
  const isOn = current?.has(localId) ?? false;
  if (isOn === value) return;
  if (value) {
    const set = current ?? new Set<string>();
    set.add(localId);
    pressed.set(pluginId, set);
  } else {
    current?.delete(localId);
    if (current?.size === 0) pressed.delete(pluginId);
  }
  notify();
}

/** Whether one of a Plugin's Toggle Buttons is set on. Off until the Plugin sets it. */
export function isToolbarPressed(pluginId: string, localId: string): boolean {
  return pressed.get(pluginId)?.has(localId) ?? false;
}

/**
 * Turns off every Toggle Button of one Plugin. The lifecycle calls it whenever
 * the Plugin leaves `ready` (stop, crash, disable, restart), so a dead Plugin
 * never leaves a button showing on. Subscribers run only if something was on.
 */
export function clearToolbarPressed(pluginId: string): void {
  if (!pressed.delete(pluginId)) return;
  notify();
}

/** Runs after every change to the pressed state. Returns unsubscribe. */
export function subscribeToolbarPressed(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A counter that changes on every pressed-state change, for `useSyncExternalStore`. */
export function toolbarPressedRevision(): number {
  return revision;
}
