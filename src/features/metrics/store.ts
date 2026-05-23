import { create } from "zustand";

interface MetricsState {
  isWorkerReady: boolean;
  lastFlushedAt: string | null;
  error: string | null;
  setWorkerReady: (ready: boolean) => void;
  setLastFlushedAt: (timestamp: string | null) => void;
  setError: (error: string | null) => void;
}

export const useMetricsStore = create<MetricsState>()((set) => ({
  isWorkerReady: false,
  lastFlushedAt: null,
  error: null,
  setWorkerReady: (isWorkerReady) => set({ isWorkerReady }),
  setLastFlushedAt: (lastFlushedAt) => set({ lastFlushedAt }),
  setError: (error) => set({ error }),
}));
