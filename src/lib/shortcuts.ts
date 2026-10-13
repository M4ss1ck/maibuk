import { useEffect, useRef } from "react";
import { isTypingTarget } from "@/lib/keyboard";
import { isMac } from "@/lib/platform/detect";
import { useModalStore } from "@/components/ui/modal-store";
import { useBoundShortcutIds } from "@/lib/bound-shortcuts";
import { registerCommandSource } from "@/lib/command-runner";
import { isTutorialStatusActive, useTutorialStore } from "@/features/tutorial/store";
import { getLiveShortcuts } from "@/lib/command-keys";
import { isIgnoredKeyEvent, stepsFromEvent } from "@/lib/shortcut-keys";
import type { CommandId, Step } from "@/lib/shortcut-registry";

/**
 * A binding names a Command; its keys come from the registry merged with the
 * author's Custom Shortcuts (ADR 0012), read when a key is pressed.
 */
export type ShortcutBinding = {
  id: CommandId;
  onTrigger: (event?: KeyboardEvent) => void;
  preventDefault?: boolean;
  allowInInput?: boolean;
  enabled?: boolean;
  /**
   * An app-shell screen binding whose Command also has an item Context defers
   * to another mounted binding of the same Command (the focused item row's
   * `useItemCommands` binding): the focused item is the more specific Context
   * and is what the author pointed at, so it runs the Command instead (#446).
   */
  deferToOtherSource?: boolean;
};

type UseShortcutsOptions = {
  enabled?: boolean;
  sequenceTimeout?: number;
};

// While a Tutorial run is under way only its own shortcuts work, so a stray
// key never acts on sample content (ADR 0008).
function isTutorialShortcut(binding: ShortcutBinding): boolean {
  return binding.id === "tutorial.skip";
}

type Candidate = { binding: ShortcutBinding; steps: readonly Step[] };

// One key press runs a Command once. An app-shell screen binding and an item
// row's binding can both declare the same Command (a target Command with a
// screen Context and an item Context, #446); each `useShortcuts` instance has
// its own `handled` set, so without a shared marker both would run it and send
// two requests. Keyed by the event, so entries live only as long as the event.
const handledCommandIds = new WeakMap<KeyboardEvent, Set<CommandId>>();

/** One mounted `useShortcuts` instance's live bindings, in mount order. */
type MountedShortcutSource = { getBindings: () => readonly ShortcutBinding[] };
const mountedSources: MountedShortcutSource[] = [];

/**
 * Whether a binding other than `self` is mounted now for this Command. A screen
 * binding that declares `deferToOtherSource` lets such a binding (a focused
 * item row's) run the Command instead, so one key press runs it once with the
 * more specific target (#446).
 */
function anotherSourceBinds(id: CommandId, self: MountedShortcutSource): boolean {
  return mountedSources.some(
    (source) =>
      source !== self &&
      source.getBindings().some((binding) => binding.id === id && binding.enabled !== false)
  );
}

export function useShortcuts(shortcuts: ShortcutBinding[], options: UseShortcutsOptions = {}) {
  const shortcutsRef = useRef(shortcuts);
  const sequenceRef = useRef<{ step: Step; time: number } | null>(null);
  const tutorialRunning = useTutorialStore((s) => isTutorialStatusActive(s.status));
  const isLive = (binding: ShortcutBinding) =>
    binding.enabled !== false && (!tutorialRunning || isTutorialShortcut(binding));

  // Listed as bound regardless of open dialogs: the shortcut help is a dialog.
  const boundIds = options.enabled === false ? [] : shortcuts.filter(isLive).map((b) => b.id);
  useBoundShortcutIds(boundIds);

  const tutorialRunningRef = useRef(tutorialRunning);
  const optionsEnabledRef = useRef(options.enabled);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
    tutorialRunningRef.current = tutorialRunning;
    optionsEnabledRef.current = options.enabled;
  }, [shortcuts, tutorialRunning, options.enabled]);

  // This instance's live bindings, read by another source's deferral check.
  const sourceRef = useRef<MountedShortcutSource | null>(null);
  if (sourceRef.current === null) {
    sourceRef.current = {
      getBindings: () => (optionsEnabledRef.current === false ? [] : shortcutsRef.current),
    };
  }

  // One source per hook instance, registered in mount order; later prop
  // changes never reorder. The getter reads the live bindings at run time.
  useEffect(() => {
    const source = sourceRef.current;
    if (source === null) return;
    mountedSources.push(source);
    const unregister = registerCommandSource(source.getBindings);
    return () => {
      unregister();
      const index = mountedSources.indexOf(source);
      if (index >= 0) mountedSources.splice(index, 1);
    };
  }, []);

  useEffect(() => {
    if (options.enabled === false) return;
    const timeout = options.sequenceTimeout ?? 600;
    const mac = isMac();

    // A shortcut already handled from the capture pass must not fire twice when
    // the same event also reaches the bubble listener.
    const handled = new WeakSet<KeyboardEvent>();

    const trigger = (binding: ShortcutBinding, event: KeyboardEvent) => {
      // A screen binding whose Command also has an item Context yields to the
      // focused item row's binding for the same Command: it is the more specific
      // Context and what the author pointed at. The row's own listener marks the
      // id, so the Command still runs exactly once (#446).
      const self = sourceRef.current;
      if (binding.deferToOtherSource && self !== null && anotherSourceBinds(binding.id, self)) {
        return;
      }
      const alreadyRun = handledCommandIds.get(event);
      if (alreadyRun?.has(binding.id)) return;
      if (alreadyRun) alreadyRun.add(binding.id);
      else handledCommandIds.set(event, new Set([binding.id]));
      handled.add(event);
      if (binding.preventDefault !== false) event.preventDefault();
      binding.onTrigger(event);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (handled.has(event)) return;
      if (isIgnoredKeyEvent(event)) return;

      const steps = stepsFromEvent(event, mac);
      if (steps.length === 0) return;

      const isTyping = isTypingTarget(event.target);
      const now = Date.now();
      const candidates: Candidate[] = shortcutsRef.current
        .filter(
          (binding) =>
            binding.enabled !== false &&
            (!tutorialRunningRef.current || isTutorialShortcut(binding)) &&
            (binding.allowInInput === true || !isTyping)
        )
        .flatMap((binding) =>
          getLiveShortcuts(binding.id).map((shortcut) => ({ binding, steps: shortcut }))
        );

      // The key-derived step wins over the physical-key fallback, so a layout's
      // own letters keep their meaning.
      const find = (predicate: (candidate: Candidate, step: Step) => boolean) => {
        for (const step of steps) {
          const match = candidates.find((candidate) => predicate(candidate, step));
          if (match) return { match, step };
        }
        return null;
      };

      const pending = sequenceRef.current;
      sequenceRef.current = null;
      if (pending && now - pending.time <= timeout) {
        const second = find(
          (candidate, step) =>
            candidate.steps.length === 2 &&
            candidate.steps[0] === pending.step &&
            candidate.steps[1] === step
        );
        if (second) {
          trigger(second.match.binding, event);
          return;
        }
      }

      const starter = find(
        (candidate, step) => candidate.steps.length === 2 && candidate.steps[0] === step
      );
      if (starter) {
        if (starter.match.binding.preventDefault !== false) event.preventDefault();
        sequenceRef.current = { step: starter.step, time: now };
        return;
      }

      const single = find(
        (candidate, step) => candidate.steps.length === 1 && candidate.steps[0] === step
      );
      if (single) trigger(single.match.binding, event);
    };

    // React Spectrum pressables (React Aria menus, listboxes, toolbars) call
    // stopPropagation() on keydown, which hides modifier shortcuts while one of
    // their controls has focus. Those combos, and function keys (F6 lands on a
    // Pane's control and must still move on), are handled in the capture
    // phase, where that cannot reach. Other bare keys stay on the bubble
    // listener so those controls keep their arrow, Enter, Space, and
    // typeahead keys.
    const handleCaptureKeyDown = (event: KeyboardEvent) => {
      const functionKey = /^F\d{1,2}$/.test(event.key);
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !functionKey) return;
      handleKeyDown(event);
    };

    const removeListeners = () => {
      window.removeEventListener("keydown", handleCaptureKeyDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
    // Modal changes gate listeners, not rendered UI. Subscribing through the
    // React hook would render every screen that binds a Command on open and
    // close, blowing the Command Palette's frame budget (#376).
    // The gate reopens synchronously, so a key that closes the last dialog
    // would still reach the bubble listener added mid-dispatch. That key
    // belonged to the dialog and must not also run a Command behind it.
    let inFlight: KeyboardEvent | null = null;
    const trackKeyDown = (event: KeyboardEvent) => {
      inFlight = event;
    };
    const syncModalScope = () => {
      removeListeners();
      sequenceRef.current = null;
      if (useModalStore.getState().modalIds.length > 0) return;
      if (inFlight && inFlight.eventPhase !== Event.NONE) handled.add(inFlight);
      window.addEventListener("keydown", handleCaptureKeyDown, true);
      window.addEventListener("keydown", handleKeyDown);
    };
    window.addEventListener("keydown", trackKeyDown, true);
    const unsubscribe = useModalStore.subscribe((state, previous) => {
      if (state.modalIds.length !== previous.modalIds.length) syncModalScope();
    });
    syncModalScope();
    return () => {
      unsubscribe();
      removeListeners();
      window.removeEventListener("keydown", trackKeyDown, true);
    };
  }, [options.enabled, options.sequenceTimeout]);
}
