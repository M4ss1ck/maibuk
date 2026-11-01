import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPELLCHECK_IDLE_STOP_MS, SpellCheckService } from "@/lib/spellcheck/SpellCheckService";
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

describe("SpellCheckService idle stop", () => {
  let workers: FakeSpellWorker[];
  let service: SpellCheckService;

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
    service = new SpellCheckService(() => {
      const worker = new FakeSpellWorker();
      workers.push(worker);
      return worker as unknown as Worker;
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
});
