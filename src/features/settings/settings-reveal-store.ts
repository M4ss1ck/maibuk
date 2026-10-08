import { create } from "zustand";

/**
 * Where a revealed row lands: centered ("row", a Command Palette result), or
 * with its section's heading at the top ("section", a link to a section).
 */
export type SettingsRowAlign = "row" | "section";

interface SettingsRevealState {
  pendingRowId: string | null;
  pendingAlign: SettingsRowAlign;
  requestRow: (id: string, align?: SettingsRowAlign) => void;
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
  pendingAlign: "row",
  requestRow: (id, align = "row") => set({ pendingRowId: id, pendingAlign: align }),
  clearRow: () => set({ pendingRowId: null, pendingAlign: "row" }),
  advancedOpen: false,
  setAdvancedOpen: (open) => set({ advancedOpen: open }),
  pasteCleanupAdvancedOpen: false,
  setPasteCleanupAdvancedOpen: (open) => set({ pasteCleanupAdvancedOpen: open }),
}));
