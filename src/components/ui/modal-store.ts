import { create } from "zustand";

interface ModalState {
  modalIds: string[];
  openCount: number;
  register: (id: string) => void;
  unregister: (id: string) => void;
}

export const useModalStore = create<ModalState>((set) => ({
  modalIds: [],
  openCount: 0,
  register: (id: string) =>
    set((state) => {
      if (state.modalIds.includes(id)) return state;
      return {
        modalIds: [...state.modalIds, id],
        openCount: state.openCount + 1,
      };
    }),
  unregister: (id: string) =>
    set((state) => {
      const idx = state.modalIds.indexOf(id);
      if (idx === -1) return state;
      return {
        modalIds: state.modalIds.filter((_, i) => i !== idx),
        openCount: Math.max(0, state.openCount - 1),
      };
    }),
}));
