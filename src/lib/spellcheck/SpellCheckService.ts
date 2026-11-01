import type { Language } from "@/features/settings/types";
import type { WorkerRequest, WorkerResponse } from "@/lib/spellcheck/types";

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

/**
 * An idle Spell Check Worker is stopped after this long: the Spanish dictionary
 * alone holds about 50 MB of heap in nspell. The next check starts a fresh one,
 * off the main thread, with the same language and the words added this session.
 */
export const SPELLCHECK_IDLE_STOP_MS = 120_000;

function defaultCreateWorker(): Worker {
  return new Worker(new URL("./spellcheck.worker.ts", import.meta.url), { type: "module" });
}

export class SpellCheckService {
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private readyPromise: Promise<void> | null = null;
  private ready = false;
  private lang: Language | null = null;
  private addedWords = new Set<string>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly createWorker: () => Worker = defaultCreateWorker) {}

  async init(lang: Language, options: { force?: boolean } = {}): Promise<void> {
    // Skip if already initialized with the same language unless forced
    if (!options.force && this.lang === lang) {
      return this.ensureWorker();
    }

    this.destroy();
    this.lang = lang;
    return this.ensureWorker();
  }

  async check(words: string[]): Promise<string[]> {
    if (this.lang === null) return [];
    await this.ensureWorker();

    if (words.length === 0) return [];

    const response = await this.request({ type: "check", id: 0, words });
    if (response?.type === "checked") {
      return response.misspelled;
    }
    return [];
  }

  async suggest(word: string): Promise<string[]> {
    if (this.lang === null) return [];
    await this.ensureWorker();

    const response = await this.request({ type: "suggest", id: 0, word });
    if (response?.type === "suggestions") {
      return response.suggestions;
    }
    return [];
  }

  addWord(word: string): void {
    if (this.lang === null) return;
    this.addedWords.add(word);
    if (this.ready) this.send({ type: "addWord", word });
  }

  async loadCustomDictionary(words: string[]): Promise<void> {
    if (this.lang === null) return;

    for (const word of words.map((w) => w.trim())) {
      if (word.length > 0) this.addWord(word);
    }
  }

  destroy(): void {
    this.stopWorker();
    this.pendingRequests.clear();
    this.lang = null;
    this.addedWords.clear();
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Starts the Worker for the current language, or returns the one starting. */
  private ensureWorker(): Promise<void> {
    if (this.readyPromise !== null) return this.readyPromise;
    if (this.lang === null) return Promise.resolve();

    const lang = this.lang;
    const worker = this.createWorker();
    this.worker = worker;

    const readyPromise = new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (msg.type !== "ready" && msg.type !== "error") return;
        worker.onmessage = (next: MessageEvent<WorkerResponse>) => this.handleMessage(next.data);
        if (msg.type === "error") {
          reject(new Error(msg.message));
          return;
        }
        if (this.worker !== worker) return resolve();
        this.ready = true;
        // A restarted Worker gets back every word this session added.
        for (const word of this.addedWords) this.send({ type: "addWord", word });
        this.scheduleIdleStop();
        resolve();
      };
    });
    this.readyPromise = readyPromise;

    const urls = DICTIONARY_URLS[lang];
    this.send({ type: "init", lang, affUrl: urls.aff, dicUrl: urls.dic });
    return readyPromise;
  }

  /** Sends one request; `null` when the Worker was stopped before it answered. */
  private request(
    message: Extract<WorkerRequest, { type: "check" } | { type: "suggest" }>
  ): Promise<WorkerResponse | null> {
    if (this.worker === null) return Promise.resolve(null);
    this.cancelIdleStop();
    const id = ++this.requestId;
    const response = new Promise<WorkerResponse>((resolve) => {
      this.pendingRequests.set(id, { resolve });
    });
    this.send({ ...message, id });
    return response;
  }

  private stopWorker(): void {
    this.cancelIdleStop();
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.ready = false;
  }

  private cancelIdleStop(): void {
    if (this.idleTimer === null) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private scheduleIdleStop(): void {
    this.cancelIdleStop();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      // Every request cancels this timer, so nothing is pending here.
      this.stopWorker();
    }, SPELLCHECK_IDLE_STOP_MS);
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
    if (this.pendingRequests.size === 0 && this.ready) this.scheduleIdleStop();
  }
}

export const spellCheckService = new SpellCheckService();
