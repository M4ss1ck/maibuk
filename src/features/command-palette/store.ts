import { create } from "zustand";
import { commandStates } from "@/lib/command-runner";
import type { CommandId } from "@/lib/shortcut-registry";
import { isTutorialRunInProgress } from "@/features/tutorial/library-switch";
import {
  PALETTE_COMMAND_PREFIX,
  type PaletteMode,
} from "@/features/command-palette/palette-index";

export type PaletteCommandState = "runnable" | "disabled";

export interface CommandPaletteOpenOptions {
  /** Which mode to open in; Commands is the default, so F1 keeps its habit. */
  mode?: PaletteMode;
}

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
  /** What the field starts with: the Commands prefix, or nothing for Library Search. */
  initialQuery: string;
  open: (options?: CommandPaletteOpenOptions) => void;
  close: () => void;
}

// Intentionally NOT persisted: the palette is transient UI state that always
// starts closed and is discarded on reboot.
export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  isOpen: false,
  opener: null,
  snapshot: new Map(),
  initialQuery: PALETTE_COMMAND_PREFIX,
  open: (options) => {
    if (isTutorialRunInProgress()) return;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    set({
      isOpen: true,
      opener,
      snapshot: commandStates(),
      initialQuery: options?.mode === "library" ? "" : PALETTE_COMMAND_PREFIX,
    });
  },
  close: () => set({ isOpen: false }),
}));
