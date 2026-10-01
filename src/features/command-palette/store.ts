import { create } from "zustand";
import { commandStates } from "@/lib/command-runner";
import type { CommandId } from "@/lib/shortcut-registry";
import { isTutorialRunInProgress } from "@/features/tutorial/library-switch";

export type PaletteCommandState = "runnable" | "disabled";

interface CommandPaletteState {
  isOpen: boolean;
  /** The element that had focus when the palette opened; focus returns here. */
  opener: HTMLElement | null;
  /**
   * Every bound Command and its state, read before the dialog mounts. Item
   * Commands (chapterItem, noteItem, canvasNode, image, footnoteItem) bind
   * only while focus is inside their item, so the snapshot must be taken
   * while the opener still has focus.
   */
  snapshot: Map<CommandId, PaletteCommandState>;
  open: () => void;
  close: () => void;
}

// Intentionally NOT persisted: the palette is transient UI state that always
// starts closed and is discarded on reboot.
export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  isOpen: false,
  opener: null,
  snapshot: new Map(),
  open: () => {
    if (isTutorialRunInProgress()) return;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    set({ isOpen: true, opener, snapshot: commandStates() });
  },
  close: () => set({ isOpen: false }),
}));
