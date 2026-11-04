import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DictionaryBytes,
  SPELLCHECK_IDLE_STOP_MS,
  SpellCheckService,
} from "@/lib/spellcheck/SpellCheckService";
import type { WorkerRequest, WorkerResponse } from "@/lib/spellcheck/types";

/** A Worker that knows "hola" plus every word added to it after init. */
class FakeSpellWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  terminated = false;
  readonly received: WorkerRequest[] = [];
  private readonly known = new Set(["hola"]);
  private initialized = false;

  postMessage(message: WorkerRequest): void {
    this.received.push(message);
    queueMicrotask(() => this.handle(message));
  }

  terminate(): void {
    this.terminated = true;
  }

  private reply(message: WorkerResponse): void {
    if (!this.terminated) this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }

  private handle(message: WorkerRequest): void {
    if (message.type === "init") {
      this.initialized = true;
      this.reply({ type: "ready" });
    } else if (message.type === "addWord") {
      if (this.initialized) this.known.add(message.word);
    } else if (message.type === "check") {
      const misspelled = message.words.filter((word) => !this.known.has(word));
      this.reply({ type: "checked", id: message.id, misspelled });
    } else {
      this.reply({ type: "suggestions", id: message.id, word: message.word, suggestions: [] });
    }
  }
}

const DICTIONARY: DictionaryBytes = { aff: new Uint8Array([1, 2, 3]), dic: new Uint8Array([4, 5]) };

describe("SpellCheckService idle stop", () => {
  let workers: FakeSpellWorker[];
  let loaded: string[];
  let service: SpellCheckService;

  const createWorker = () => {
    const worker = new FakeSpellWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
    loaded = [];
    service = new SpellCheckService(createWorker, async (lang) => {
      loaded.push(lang);
      return lang === "en" || lang === "es" ? DICTIONARY : null;
    });
  });

  afterEach(() => {
    service.destroy();
    vi.useRealTimers();
  });

  it("stops an idle Worker, and the next check starts a fresh one", async () => {
    await service.init("es");
    expect(await service.check(["hola", "ola"])).toEqual(["ola"]);

    await vi.advanceTimersByTimeAsync(SPELLCHECK_IDLE_STOP_MS);
    expect(workers[0]?.terminated).toBe(true);
    expect(service.isReady()).toBe(false);

    expect(await service.check(["ola"])).toEqual(["ola"]);
    expect(workers).toHaveLength(2);
    expect(workers[1]?.received[0]).toMatchObject({ type: "init", lang: "es" });
  });

  it("keeps the words added this session across a restart", async () => {
    await service.init("es");
    await service.loadCustomDictionary(["Maibuk"]);
    service.addWord("Ezequiel");

    await vi.advanceTimersByTimeAsync(SPELLCHECK_IDLE_STOP_MS);
    expect(await service.check(["Maibuk", "Ezequiel", "ola"])).toEqual(["ola"]);
  });

  it("stays alive while checks keep coming", async () => {
    await service.init("en");
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(SPELLCHECK_IDLE_STOP_MS - 1);
      await service.check(["hola"]);
    }
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminated).toBe(false);
  });

  it("a language change forgets the previous session's words", async () => {
    await service.init("es");
    service.addWord("Maibuk");
    await service.init("en");
    expect(await service.check(["Maibuk"])).toEqual(["Maibuk"]);
  });

  it("checks nothing and starts no Worker before init", async () => {
    expect(await service.check(["ola"])).toEqual([]);
    expect(await service.suggest("ola")).toEqual([]);
    expect(workers).toHaveLength(0);
  });

  it("opens the Spanish dictionary for an es-MX tag", async () => {
    await service.init("es-MX");

    expect(loaded).toEqual(["es"]);
    expect(workers[0]?.received[0]).toMatchObject({ type: "init", lang: "es" });
  });

  it("posts the dictionary bytes to the Worker", async () => {
    await service.init("en");

    const init = workers[0]?.received[0];
    if (init?.type !== "init") throw new Error("the Worker never got an init");
    expect(init.lang).toBe("en");
    expect(Array.from(init.aff)).toEqual([1, 2, 3]);
    expect(Array.from(init.dic)).toEqual([4, 5]);
  });

  it("starts no Worker and checks nothing for a language with no dictionary", async () => {
    await service.init("fr");

    expect(workers).toHaveLength(0);
    expect(await service.check(["bonjour"])).toEqual([]);
    expect(await service.check(["bonjour"])).toEqual([]);
    expect(loaded).toEqual(["fr"]);
  });

  it("starts no Worker when the dictionary is still loading at destroy()", async () => {
    let resolveLoad: (dictionary: DictionaryBytes | null) => void = () => undefined;
    const loading = new Promise<DictionaryBytes | null>((resolve) => {
      resolveLoad = resolve;
    });
    service = new SpellCheckService(createWorker, () => loading);

    const init = service.init("es");
    service.destroy();
    resolveLoad(DICTIONARY);
    await init;

    expect(workers).toHaveLength(0);
  });

  it("answers a check still waiting on the Worker when destroy() stops it", async () => {
    await service.init("es");
    workers[0].postMessage = () => undefined;

    const check = service.check(["hola"]);
    await vi.advanceTimersByTimeAsync(0);
    service.destroy();

    expect(await check).toEqual([]);
  });

  it("stops the Worker when moving to a language with no dictionary", async () => {
    await service.init("es");
    await service.check(["hola"]);

    await service.init("fr");

    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminated).toBe(true);
  });

  it("releaseLanguage stops the Worker only for the language it holds", async () => {
    await service.init("es");
    await service.check(["hola"]);

    service.releaseLanguage("en");
    expect(workers[0]?.terminated).toBe(false);

    service.releaseLanguage("es");
    expect(workers[0]?.terminated).toBe(true);
    expect(service.isReady()).toBe(false);
  });
});

describe("SpellCheckService script coverage and normalization", () => {
  let workers: FakeSpellWorker[];
  let service: SpellCheckService;

  const createWorker = () => {
    const worker = new FakeSpellWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  };

  beforeEach(() => {
    workers = [];
    service = new SpellCheckService(createWorker, async (lang) =>
      lang === "en" ? DICTIONARY : null
    );
  });

  afterEach(() => {
    service.destroy();
  });

  it("does not flag or send words outside the active script", async () => {
    await service.init("en");

    expect(await service.check(["привет", "ola"])).toEqual(["ola"]);

    const check = workers[0]?.received.find((message) => message.type === "check");
    expect(check).toMatchObject({ type: "check", words: ["ola"] });
  });

  it("sends an NFD word as NFC and returns the caller's original string", async () => {
    await service.init("en");
    const nfd = "cafe\u0301";

    expect(await service.check([nfd])).toEqual([nfd]);

    const check = workers[0]?.received.find((message) => message.type === "check");
    expect(check).toMatchObject({ type: "check", words: [nfd.normalize("NFC")] });
  });

  it("starts no Worker without a dictionary, then loads and drops one as it appears", async () => {
    let dictionary: DictionaryBytes | null = null;
    service = new SpellCheckService(createWorker, async () => dictionary);

    await service.init("fr");
    expect(await service.check(["bonjour"])).toEqual([]);
    expect(workers).toHaveLength(0);

    dictionary = DICTIONARY;
    await service.init("fr", { force: true });
    expect(workers).toHaveLength(1);
    expect(workers[0]?.received[0]).toMatchObject({ type: "init", lang: "fr" });

    dictionary = null;
    await service.init("fr", { force: true });
    expect(await service.check(["bonjour"])).toEqual([]);
    expect(workers[0]?.terminated).toBe(true);
  });
});
