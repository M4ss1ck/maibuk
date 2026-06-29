import type { Language } from "@/features/settings/types";

// Main thread -> Worker
export type WorkerRequest =
  | { type: "init"; lang: Language; affUrl: string; dicUrl: string }
  | { type: "check"; id: number; words: string[] }
  | { type: "suggest"; id: number; word: string }
  | { type: "addWord"; word: string };

// Worker -> Main thread
export type WorkerResponse =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "checked"; id: number; misspelled: string[] }
  | { type: "suggestions"; id: number; word: string; suggestions: string[] };
