import { create } from "zustand";

interface SettingsRevealState {
  pendingRowId: string | null;
  requestRow: (id: string) => void;
  clearRow: () => void;
  advancedOpen: boolean;
  setAdvancedOpen: (open: boolean) => void;
  pasteCleanupAdvancedOpen: boolean;
  setPasteCleanupAdvancedOpen: (open: boolean) => void;
}

/**
 * Which collapsed Settings area is open, plus the row a Command Palette
 * result asked to focus. The Advanced block and the Paste Cleanup "advanced"
 * block live here (instead of component state) so focusing a row can open
 * them from outside the section that renders them.
 */
export const useSettingsRevealStore = create<SettingsRevealState>()((set) => ({
  pendingRowId: null,
  requestRow: (id) => set({ pendingRowId: id }),
  clearRow: () => set({ pendingRowId: null }),
  advancedOpen: false,
  setAdvancedOpen: (open) => set({ advancedOpen: open }),
  pasteCleanupAdvancedOpen: false,
  setPasteCleanupAdvancedOpen: (open) => set({ pasteCleanupAdvancedOpen: open }),
}));
