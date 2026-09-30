import { create } from "zustand";

interface ModalState {
  modalIds: string[];
  openCount: number;
  closers: Record<string, () => void>;
  register: (id: string, close?: () => void) => void;
  unregister: (id: string) => void;
}

export const useModalStore = create<ModalState>((set) => ({
  modalIds: [],
  openCount: 0,
  closers: {},
  register: (id: string, close?: () => void) =>
    set((state) => {
      if (state.modalIds.includes(id)) {
        if (!close || state.closers[id] === close) return state;
        return { closers: { ...state.closers, [id]: close } };
      }
      return {
        modalIds: [...state.modalIds, id],
        openCount: state.openCount + 1,
        closers: close ? { ...state.closers, [id]: close } : state.closers,
      };
    }),
  unregister: (id: string) =>
    set((state) => {
      const idx = state.modalIds.indexOf(id);
      if (idx === -1) {
        if (!(id in state.closers)) return state;
        const { [id]: _removed, ...rest } = state.closers;
        return { closers: rest };
      }
      const { [id]: _removed, ...rest } = state.closers;
      return {
        modalIds: state.modalIds.filter((_, i) => i !== idx),
        openCount: Math.max(0, state.openCount - 1),
        closers: rest,
      };
    }),
}));
