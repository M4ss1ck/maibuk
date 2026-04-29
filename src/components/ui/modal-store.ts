import { create } from "zustand";

interface ModalState {
  openCount: number;
  register: () => void;
  unregister: () => void;
}

export const useModalStore = create<ModalState>((set) => ({
  openCount: 0,
  register: () => set((state) => ({ openCount: state.openCount + 1 })),
  unregister: () =>
    set((state) => ({ openCount: Math.max(0, state.openCount - 1) })),
}));
