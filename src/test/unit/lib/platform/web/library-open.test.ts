import { describe, expect, it } from "vitest";
import { createDbWorkerHandler } from "@/lib/db/db-worker-handler";
import type { DbOpenValue } from "@/lib/db/worker-protocol";
import { createMemoryDatabase } from "@/lib/db/memory-database";
import { createTestWebDatabase } from "@/test/support/db-worker";
import {
  openWebLibrary,
  type LibraryClient,
  type LibraryLock,
  type LibraryOpenDeps,
} from "@/lib/platform/web/library-open";

type OpenOptions = Parameters<LibraryClient["open"]>[0];

interface FakeClientLog {
  opened: OpenOptions[];
  imported: Uint8Array[];
  terminated: number;
  selected: string[];
}

function fakeClient(
  log: string[],
  behavior: {
    open?: (options: OpenOptions) => Promise<DbOpenValue>;
    importBytes?: (bytes: Uint8Array) => Promise<void>;
    select?: (sql: string) => Promise<unknown>;
  } = {},
  state: FakeClientLog = { opened: [], imported: [], terminated: 0, selected: [] }
): LibraryClient & { fake: FakeClientLog } {
  const client: LibraryClient = {
    async open(options) {
      log.push(`open:${options.mode}:${options.bytes ? "bytes" : "empty"}`);
      state.opened.push(options);
      return behavior.open?.(options) ?? { mode: options.mode, existing: false };
    },
    async importBytes(bytes) {
      log.push("import");
      state.imported.push(bytes);
      await behavior.importBytes?.(bytes);
    },
    async select<T>(sql: string) {
      log.push(`select:${sql}`);
      state.selected.push(sql);
      return (behavior.select ? await behavior.select(sql) : []) as T;
    },
    async execute() {
      return { rowsAffected: 0 };
    },
    async executeAtomic() {},
    async exportData() {
      return new Uint8Array();
    },
    async close() {},
    terminate() {
      log.push("terminate");
      state.terminated += 1;
    },
  };
  return Object.assign(client, { fake: state });
}

interface DepsOptions {
  held?: boolean;
  legacy?: Uint8Array | null;
  loadError?: Error;
  clients: LibraryClient[];
}

function makeDeps(log: string[], options: DepsOptions): LibraryOpenDeps {
  let created = 0;
  return {
    async acquireLock(): Promise<LibraryLock> {
      log.push("lock");
      return { held: options.held ?? true, release: () => log.push("release") };
    },
    createClient() {
      log.push(`create:${created}`);
      const client = options.clients[created];
      created += 1;
      if (!client) throw new Error("no more fake clients");
      return client;
    },
    async loadLegacyBytes() {
      log.push("load");
      if (options.loadError) throw options.loadError;
      return options.legacy ?? null;
    },
    async deleteLegacyBytes() {
      log.push("delete");
    },
  };
}

const LEGACY = new Uint8Array([83, 81, 76, 105, 116, 101]);

describe("openWebLibrary()", () => {
  it("does not open anything when another tab holds the Library", async () => {
    const log: string[] = [];
    const outcome = await openWebLibrary(
      makeDeps(log, { held: false, clients: [fakeClient(log)] })
    );

    expect(outcome.result).toEqual({ kind: "locked" });
    expect(outcome.adapter).toBeNull();
    expect(log).toEqual(["lock"]);
  });

  it("falls back to an in-memory Library when the VFS cannot be installed", async () => {
    const log: string[] = [];
    const pool = fakeClient(log, {
      open: async () => {
        throw new DOMException("The operation failed", "UnknownError");
      },
    });
    const memory = fakeClient(log);

    const outcome = await openWebLibrary(makeDeps(log, { legacy: null, clients: [pool, memory] }));

    expect(outcome.result).toEqual({ kind: "memory" });
    expect(outcome.adapter).toBe(memory);
    expect(log).toEqual([
      "lock",
      "create:0",
      "open:opfs:empty",
      "terminate",
      "load",
      "create:1",
      "open:memory:empty",
    ]);
  });

  it("opens the old data in memory when OPFS is unavailable", async () => {
    const log: string[] = [];
    const pool = fakeClient(log, {
      open: async () => {
        throw new DOMException("The operation failed", "UnknownError");
      },
    });
    const memory = fakeClient(log);

    await openWebLibrary(makeDeps(log, { legacy: LEGACY, clients: [pool, memory] }));

    expect(memory.fake.opened[0].bytes).toEqual(LEGACY);
  });

  it("opens an already-migrated Library without reading the old copy", async () => {
    const log: string[] = [];
    const pool = fakeClient(log, {
      open: async () => ({ mode: "opfs", existing: true }),
    });

    const outcome = await openWebLibrary(makeDeps(log, { legacy: LEGACY, clients: [pool] }));

    expect(outcome.result).toEqual({ kind: "opfs" });
    expect(outcome.adapter).toBe(pool);
    expect(log).not.toContain("load");
    expect(log).not.toContain("import");
  });

  it("opens a fresh pooled Library when nothing was ever saved", async () => {
    const log: string[] = [];
    const pool = fakeClient(log);

    const outcome = await openWebLibrary(makeDeps(log, { legacy: null, clients: [pool] }));

    expect(outcome.result).toEqual({ kind: "opfs" });
    expect(outcome.adapter).toBe(pool);
    expect(log).toContain("load");
    expect(log).not.toContain("import");
    expect(log).not.toContain("delete");
  });

  it("moves the old copy in, checks it, then deletes it", async () => {
    const log: string[] = [];
    const pool = fakeClient(log);

    const outcome = await openWebLibrary(makeDeps(log, { legacy: LEGACY, clients: [pool] }));

    expect(outcome.result).toEqual({ kind: "opfs" });
    expect(outcome.adapter).toBe(pool);
    expect(pool.fake.imported).toEqual([LEGACY]);
    expect(log).toEqual([
      "lock",
      "create:0",
      "open:opfs:empty",
      "load",
      "import",
      "select:PRAGMA schema_version",
      "select:SELECT count(*) AS count FROM books",
      "delete",
    ]);
  });

  it("keeps the old copy and opens it in memory when the move fails", async () => {
    const log: string[] = [];
    const failure = new Error("Input does not contain an SQLite3 database header.");
    const pool = fakeClient(log, {
      importBytes: async () => {
        throw failure;
      },
    });
    const memory = fakeClient(log);

    const outcome = await openWebLibrary(
      makeDeps(log, { legacy: LEGACY, clients: [pool, memory] })
    );

    expect(outcome.result).toEqual({
      kind: "migration-failed",
      error: { code: "migration-failed", message: failure.message },
    });
    expect(outcome.adapter).toBe(memory);
    expect(memory.fake.opened[0].bytes).toEqual(LEGACY);
    expect(log).not.toContain("delete");
  });

  it("shows the author's rows after a failed move, never an empty Library", async () => {
    const legacy = await createMemoryDatabase();
    await legacy.execute("CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT)");
    await legacy.execute("INSERT INTO books (id, title) VALUES ('b1', 'My Book')");
    const legacyBytes = legacy.exportBytes();
    await legacy.close();

    const log: string[] = [];
    const pool = fakeClient(log, {
      importBytes: async () => {
        throw new Error("Input does not contain an SQLite3 database header.");
      },
    });
    const memory = createTestWebDatabase(createDbWorkerHandler());

    const outcome = await openWebLibrary(
      makeDeps(log, { legacy: legacyBytes, clients: [pool, memory] })
    );

    expect(outcome.result.kind).toBe("migration-failed");
    const rows = await outcome.adapter?.select<{ title: string }[]>("SELECT title FROM books");
    expect(rows).toEqual([{ title: "My Book" }]);
    expect(log).not.toContain("delete");
  });

  it("gives a full quota its own error code and keeps the old copy", async () => {
    const log: string[] = [];
    const pool = fakeClient(log, {
      importBytes: async () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
    });
    const memory = fakeClient(log);

    const outcome = await openWebLibrary(
      makeDeps(log, { legacy: LEGACY, clients: [pool, memory] })
    );

    expect(outcome.result).toMatchObject({
      kind: "migration-failed",
      error: { code: "quota-exceeded" },
    });
    expect(log).not.toContain("delete");
  });

  it("treats a failed verification as a failed move", async () => {
    const log: string[] = [];
    const pool = fakeClient(log, {
      select: async (sql) => {
        if (sql.includes("count(*)")) throw new Error("no such table: books");
        return [];
      },
    });
    const memory = fakeClient(log);

    const outcome = await openWebLibrary(
      makeDeps(log, { legacy: LEGACY, clients: [pool, memory] })
    );

    expect(outcome.result.kind).toBe("migration-failed");
    expect(outcome.result).toMatchObject({
      error: { message: "no such table: books" },
    });
    expect(log).not.toContain("delete");
  });

  it("releases the session lock when the old copy cannot be read", async () => {
    const log: string[] = [];
    const pool = fakeClient(log, {
      open: async () => {
        throw new DOMException("The operation failed", "UnknownError");
      },
    });

    await expect(
      openWebLibrary(
        makeDeps(log, {
          loadError: new Error("Could not read the saved Library"),
          clients: [pool],
        })
      )
    ).rejects.toThrow("Could not read the saved Library");

    expect(log).toContain("release");
  });
});
