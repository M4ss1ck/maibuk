import { dictionaryFor, dictionaryScript } from "@/features/spell-check-dictionaries/catalog";
import { readInstalledDictionary } from "@/features/spell-check-dictionaries/install";
import type { DictionaryScript } from "@/features/spell-check-dictionaries/types";
import type { WorkerRequest, WorkerResponse } from "@/lib/spellcheck/types";
import { getSpellCheckDictionaryFiles } from "@/lib/platform";
import { baseLanguage, type WritingLanguage } from "@/lib/writing-language";

// Vite recognizes `new URL(..., import.meta.url)` and emits these as assets
const DICTIONARY_URLS: Record<"en" | "es", { aff: string; dic: string }> = {
  en: {
    aff: new URL("../../../node_modules/dictionary-en/index.aff", import.meta.url).href,
    dic: new URL("../../../node_modules/dictionary-en/index.dic", import.meta.url).href,
  },
  es: {
    aff: new URL("../../../node_modules/dictionary-es/index.aff", import.meta.url).href,
    dic: new URL("../../../node_modules/dictionary-es/index.dic", import.meta.url).href,
  },
};

/** The two files a Spell Check Worker mounts, already fetched. */
export type DictionaryBytes = { aff: Uint8Array; dic: Uint8Array };

/** The bundled dictionary for a language, or null when it has none. */
async function loadBundledDictionary(lang: string): Promise<DictionaryBytes | null> {
  if (lang !== "en" && lang !== "es") return null;

  const urls = DICTIONARY_URLS[lang];
  const [aff, dic] = await Promise.all([
    fetch(urls.aff).then((response) => response.arrayBuffer()),
    fetch(urls.dic).then((response) => response.arrayBuffer()),
  ]);
  return { aff: new Uint8Array(aff), dic: new Uint8Array(dic) };
}

/** A bundled dictionary first, then a verified one installed from the catalog. */
async function loadDictionaryForLanguage(lang: string): Promise<DictionaryBytes | null> {
  const bundled = await loadBundledDictionary(lang);
  if (bundled !== null) return bundled;

  const entry = dictionaryFor(lang);
  if (!entry) return null;
  const files = await getSpellCheckDictionaryFiles();
  return readInstalledDictionary(entry, files);
}

type PendingRequest = {
  resolve: (value: WorkerResponse | null) => void;
};

/**
 * An idle Spell Check Worker is stopped after this long: a running one holds the
 * dictionary in WASM memory (86 MB peak for Spanish). The next check starts a
 * fresh one, off the main thread, with the same language and the words added
 * this session.
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
  private lang: string | null = null;
  private addedWords = new Set<string>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly createWorker: () => Worker = defaultCreateWorker,
    private readonly loadDictionary: (
      lang: string
    ) => Promise<DictionaryBytes | null> = loadDictionaryForLanguage
  ) {}

  async init(tag: WritingLanguage, options: { force?: boolean } = {}): Promise<void> {
    const lang = baseLanguage(tag);

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
    // ensureWorker clears the language when no dictionary loaded.
    if (this.lang === null) return [];

    if (words.length === 0) return [];

    const script = dictionaryScript(this.lang);
    const kept = script === null ? words : words.filter((word) => SCRIPT_WORDS[script].test(word));
    if (kept.length === 0) return [];

    // Dictionaries are NFC: one copy per word goes to the Worker, and the
    // caller's own strings come back so a decomposed accent is never flagged.
    const normalized = [...new Set(kept.map((word) => word.normalize("NFC")))];
    const response = await this.request({ type: "check", id: 0, words: normalized });
    if (response?.type === "checked") {
      const misspelled = new Set(response.misspelled);
      return kept.filter((word) => misspelled.has(word.normalize("NFC")));
    }
    return [];
  }

  async suggest(word: string): Promise<string[]> {
    if (this.lang === null) return [];
    await this.ensureWorker();
    if (this.lang === null) return [];

    const response = await this.request({
      type: "suggest",
      id: 0,
      word: word.normalize("NFC"),
    });
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
    // A stopped Worker never answers, so nothing else would settle these.
    for (const pending of this.pendingRequests.values()) pending.resolve(null);
    this.pendingRequests.clear();
    this.lang = null;
    this.addedWords.clear();
  }

  /** Stops the Worker when it holds `language`: a removed dictionary must stop marking. */
  releaseLanguage(language: string): void {
    if (this.lang === language) this.destroy();
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Starts the Worker for the current language, or returns the one starting. */
  private ensureWorker(): Promise<void> {
    if (this.readyPromise !== null) return this.readyPromise;
    if (this.lang === null) return Promise.resolve();

    const lang = this.lang;
    let readyPromise: Promise<void> | null = null;
    readyPromise = this.loadDictionary(lang).then((dictionary) => {
      // destroy() or a language change replaced this promise while it loaded.
      if (this.readyPromise !== readyPromise) return;
      if (dictionary === null) {
        this.lang = null;
        this.readyPromise = null;
        return;
      }
      return this.startWorker(lang, dictionary);
    });
    this.readyPromise = readyPromise;
    return readyPromise;
  }

  /** Creates the Worker and settles once it reports ready. */
  private startWorker(lang: string, dictionary: DictionaryBytes): Promise<void> {
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

    this.send({ type: "init", lang, aff: dictionary.aff, dic: dictionary.dic }, [
      dictionary.aff.buffer,
      dictionary.dic.buffer,
    ]);
    return readyPromise;
  }

  /** Sends one request; `null` when the Worker was stopped before it answered. */
  private request(
    message: Extract<WorkerRequest, { type: "check" } | { type: "suggest" }>
  ): Promise<WorkerResponse | null> {
    if (this.worker === null) return Promise.resolve(null);
    this.cancelIdleStop();
    const id = ++this.requestId;
    const response = new Promise<WorkerResponse | null>((resolve) => {
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

  private send(message: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
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

const SCRIPT_WORDS: Record<DictionaryScript, RegExp> = {
  Latin: /^[\p{Script=Latin}\p{M}'\u2019]+$/u,
  Cyrillic: /^[\p{Script=Cyrillic}\p{M}'\u2019]+$/u,
  Greek: /^[\p{Script=Greek}\p{M}'\u2019]+$/u,
};

export const spellCheckService = new SpellCheckService();
