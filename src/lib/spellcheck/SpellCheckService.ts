import type { Language } from "../../features/settings/types";
import type { WorkerRequest, WorkerResponse } from "./types";

// Vite recognizes `new URL(..., import.meta.url)` and emits these as assets
const DICTIONARY_URLS: Record<Language, { aff: string; dic: string }> = {
  en: {
    aff: new URL("../../../node_modules/dictionary-en/index.aff", import.meta.url).href,
    dic: new URL("../../../node_modules/dictionary-en/index.dic", import.meta.url).href,
  },
  es: {
    aff: new URL("../../../node_modules/dictionary-es/index.aff", import.meta.url).href,
    dic: new URL("../../../node_modules/dictionary-es/index.dic", import.meta.url).href,
  },
};

type PendingRequest = {
  resolve: (value: WorkerResponse) => void;
};

class SpellCheckService {
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private readyPromise: Promise<void> | null = null;
  private currentLang: Language | null = null;

  async init(lang: Language): Promise<void> {
    // Skip if already initialized with the same language
    if (this.currentLang === lang && this.worker) {
      return;
    }

    this.destroy();

    this.worker = new Worker(
      new URL("./spellcheck.worker.ts", import.meta.url),
      { type: "module" }
    );

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleMessage(event.data);
    };

    const urls = DICTIONARY_URLS[lang];

    this.readyPromise = new Promise<void>((resolve, reject) => {
      const onReady = (msg: WorkerResponse) => {
        if (msg.type === "ready") {
          this.currentLang = lang;
          resolve();
        } else if (msg.type === "error") {
          reject(new Error(msg.message));
        }
      };

      // Temporarily override to catch the ready message
      const originalHandler = this.worker!.onmessage;
      this.worker!.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (msg.type === "ready" || msg.type === "error") {
          onReady(msg);
          // Restore normal handler
          this.worker!.onmessage = originalHandler;
        }
      };
    });

    this.send({ type: "init", lang, affUrl: urls.aff, dicUrl: urls.dic });
    return this.readyPromise;
  }

  async check(words: string[]): Promise<string[]> {
    if (!this.worker || !this.readyPromise) return [];
    await this.readyPromise;

    if (words.length === 0) return [];

    const id = ++this.requestId;
    this.send({ type: "check", id, words });

    const response = await this.waitForResponse(id);
    if (response.type === "checked") {
      return response.misspelled;
    }
    return [];
  }

  async suggest(word: string): Promise<string[]> {
    if (!this.worker || !this.readyPromise) return [];
    await this.readyPromise;

    const id = ++this.requestId;
    this.send({ type: "suggest", id, word });

    const response = await this.waitForResponse(id);
    if (response.type === "suggestions") {
      return response.suggestions;
    }
    return [];
  }

  addWord(word: string): void {
    if (this.worker) {
      this.send({ type: "addWord", word });
    }
  }

  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
    this.readyPromise = null;
    this.currentLang = null;
  }

  isReady(): boolean {
    return this.worker !== null && this.currentLang !== null;
  }

  private send(message: WorkerRequest): void {
    this.worker?.postMessage(message);
  }

  private handleMessage(msg: WorkerResponse): void {
    if ("id" in msg && typeof msg.id === "number") {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        pending.resolve(msg);
      }
    }
  }

  private waitForResponse(id: number): Promise<WorkerResponse> {
    return new Promise((resolve) => {
      this.pendingRequests.set(id, { resolve });
    });
  }
}

export const spellCheckService = new SpellCheckService();
