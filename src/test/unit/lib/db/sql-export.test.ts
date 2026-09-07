import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportSqlDump } from "@/lib/db/sql-export";
import {
  assembleSqlDump,
  escapeSqlExportValue,
  formatExportInsertStatements,
} from "@/lib/db/sql-export-format";
import type { SqlExportRequest } from "@/lib/db/sql-export-format";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

const SECTION_COMMENTS = [
  "-- Books",
  "-- Chapters",
  "-- Book Versions",
  "-- Notes",
  "-- Sync Tombstones",
  "-- Cover Templates",
  "-- Settings",
];

function stubNoWorker(): void {
  vi.stubGlobal("Worker", undefined);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedTrickyRows(db: DatabaseAdapter): Promise<void> {
  const trickyTitle = `O'Brien; "quoted" -- tale\nnewline ❄ 中文 🎉`;
  await db.execute(
    "INSERT INTO books (id, title, author_name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["book-1", trickyTitle, "Auth'or", null, 1000, 1000],
  );
  await db.execute(
    'INSERT INTO chapters (id, book_id, title, content, "order", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ["ch-1", "book-1", "Ch; 1 'x'", "<p>say 'hi'; bye — ❄</p>", 0, 1000, 1000],
  );
  await db.execute(
    "INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ["ver-1", "book-1", "v'1;2", '{"title":"it\'s; fine ❄"}', 7, "abc123", "manual", 2000],
  );
  await db.execute(
    'INSERT INTO notes (id, title, content, "order", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ["note-1", "Note; 'n'", null, 0, 1000, 1000],
  );
  await db.execute(
    "INSERT INTO sync_tombstones (id, entity_type, entity_id, title, deleted_at, confirmed_at, pushed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["book:gone", "book", "gone", "Gone; 'book' ❄", 1000, null, null],
  );
  await db.execute(
    "INSERT INTO cover_templates (id, name, fabric_json, created_at) VALUES (?, ?, ?, ?)",
    ["tpl-1", "T; 'fancy'", '{"text":"it\'s; ❄"}', 1000],
  );
  await db.execute("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)", [
    "theme",
    "dark; 'mode' ❄",
    1000,
  ]);
}

describe("sql-export pure formatter (shared by worker and fallback)", () => {
  it("escapes values exactly like the legacy adapters", () => {
    expect(escapeSqlExportValue(null)).toBe("NULL");
    expect(escapeSqlExportValue(undefined)).toBe("NULL");
    expect(escapeSqlExportValue(42)).toBe("42");
    expect(escapeSqlExportValue("O'Brien")).toBe("'O''Brien'");
    expect(escapeSqlExportValue("a;b")).toBe("'a;b'");
    expect(escapeSqlExportValue(true)).toBe("'true'");
    expect(escapeSqlExportValue("❄ 中文 🎉")).toBe("'❄ 中文 🎉'");
  });

  it("formats insert statements with quoted identifiers and empty input", () => {
    expect(formatExportInsertStatements("books", [])).toBe("");
    const sql = formatExportInsertStatements("books", [
      { id: "b1", title: "O'Brien", word_count: 3, subtitle: null },
    ]);
    expect(sql).toBe(
      `INSERT OR REPLACE INTO "books" ("id", "title", "word_count", "subtitle") VALUES ('b1', 'O''Brien', 3, NULL);`,
    );
  });

  it("assembles the exact legacy header, section order, and blank lines", () => {
    const dump = assembleSqlDump("2026-01-02T03:04:05.000Z", {
      books: 'INSERT OR REPLACE INTO "books" ("id") VALUES (\'b\');',
    });
    expect(dump).toBe(
      [
        "-- Maibuk Database Export (SQL Dump)",
        "-- Exported at: 2026-01-02T03:04:05.000Z",
        "-- Import this file into a SQLite database after creating the schema",
        "",
        "-- Books",
        'INSERT OR REPLACE INTO "books" ("id") VALUES (\'b\');',
        "",
        "-- Chapters",
        "",
        "",
        "-- Book Versions",
        "",
        "",
        "-- Notes",
        "",
        "",
        "-- Sync Tombstones",
        "",
        "",
        "-- Cover Templates",
        "",
        "",
        "-- Settings",
        "",
      ].join("\n"),
    );
  });
});

describe("exportSqlDump fallback (Worker unavailable)", () => {
  it("round-trips escaped quotes/semicolons/NULL/Unicode via sql.js restore", async () => {
    stubNoWorker();
    const db = await createTestDatabase();
    await seedTrickyRows(db);

    const exported = await exportSqlDump(db);
    const sqlDump = new TextDecoder().decode(exported);

    expect(sqlDump).toContain("O''Brien");
    expect(sqlDump).toContain("NULL");
    expect(sqlDump).toContain("❄ 中文 🎉");
    const positions = SECTION_COMMENTS.map((comment) => sqlDump.indexOf(comment));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    const freshDb = await createTestDatabase();
    await freshDb.importData(sqlDump);

    const books = await freshDb.select<Record<string, unknown>[]>("SELECT * FROM books");
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe(`O'Brien; "quoted" -- tale\nnewline ❄ 中文 🎉`);
    expect(books[0].description).toBeNull();

    const chapters = await freshDb.select<Record<string, unknown>[]>("SELECT * FROM chapters");
    expect(chapters[0].content).toBe("<p>say 'hi'; bye — ❄</p>");

    const versions = await freshDb.select<Record<string, unknown>[]>(
      "SELECT * FROM book_versions",
    );
    expect(versions[0].snapshot).toBe('{"title":"it\'s; fine ❄"}');

    const notes = await freshDb.select<Record<string, unknown>[]>("SELECT * FROM notes");
    expect(notes[0].content).toBeNull();

    const tombstones = await freshDb.select<Record<string, unknown>[]>(
      "SELECT * FROM sync_tombstones",
    );
    expect(tombstones[0].title).toBe("Gone; 'book' ❄");

    const settings = await freshDb.select<Record<string, unknown>[]>("SELECT * FROM settings");
    expect(settings[0].value).toBe("dark; 'mode' ❄");
  });

  it("reads rows in bounded 100-row pages with a rowid cursor", async () => {
    stubNoWorker();
    const db = await createTestDatabase();
    for (let index = 0; index < 205; index += 1) {
      await db.execute(
        "INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [`book-${index}`, `Title ${index}`, "Author", 1000, 1000],
      );
    }

    const calls: { sql: string; params: unknown[] | undefined }[] = [];
    const reader = {
      select<T>(sql: string, params?: unknown[]): Promise<T> {
        calls.push({ sql, params });
        return db.select<T>(sql, params);
      },
    };

    const exported = await exportSqlDump(reader);
    const sqlDump = new TextDecoder().decode(exported);

    const bookCalls = calls.filter((call) => call.sql.includes('"books"'));
    expect(bookCalls.map((call) => call.params)).toEqual([
      [0, 100],
      [100, 100],
      [200, 100],
    ]);
    for (const call of calls) {
      expect(call.sql).toMatch(/WHERE rowid > \? ORDER BY rowid LIMIT \?/);
    }
    // Tables are read sequentially: every books page precedes the first chapters read.
    const firstChapters = calls.findIndex((call) => call.sql.includes('"chapters"'));
    const lastBooks = calls.reduce(
      (last, call, index) => (call.sql.includes('"books"') ? index : last),
      -1,
    );
    expect(firstChapters).toBeGreaterThan(lastBooks);

    const bookInserts = sqlDump
      .split("\n")
      .filter((line) => line.startsWith('INSERT OR REPLACE INTO "books"'));
    expect(bookInserts).toHaveLength(205);
    expect(sqlDump).toContain("Title 0");
    expect(sqlDump).toContain("Title 204");
  });

  it("does not skip later rows when an earlier row is deleted between pages", async () => {
    stubNoWorker();
    const db = await createTestDatabase();
    for (let index = 0; index < 205; index += 1) {
      await db.execute(
        "INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [`book-${index}`, `Title ${index}`, "Author", 1000, 1000],
      );
    }

    let bookPageCount = 0;
    const reader = {
      async select<T>(sql: string, params?: unknown[]): Promise<T> {
        const rows = await db.select<T>(sql, params);
        if (sql.includes('"books"')) {
          bookPageCount += 1;
          if (bookPageCount === 1) {
            await db.execute("DELETE FROM books WHERE id = ?", ["book-0"]);
          }
        }
        return rows;
      },
    };

    const sqlDump = new TextDecoder().decode(await exportSqlDump(reader));
    const bookInserts = sqlDump
      .split("\n")
      .filter((line) => line.startsWith('INSERT OR REPLACE INTO "books"'));

    expect(bookInserts).toHaveLength(205);
    expect(sqlDump).toContain("Title 100");
    expect(sqlDump).toContain("Title 204");
  });

  it("exports empty tables as header-only sections that re-import cleanly", async () => {
    stubNoWorker();
    const db = await createTestDatabase();

    const sqlDump = new TextDecoder().decode(await exportSqlDump(db));

    expect(sqlDump).toMatch(/-- Exported at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    for (const comment of SECTION_COMMENTS) {
      expect(sqlDump).toContain(comment);
    }
    expect(sqlDump).not.toContain("INSERT OR REPLACE");

    const freshDb = await createTestDatabase();
    await freshDb.importData(sqlDump);
    const books = await freshDb.select<Record<string, unknown>[]>("SELECT * FROM books");
    expect(books).toHaveLength(0);
  });
});

// Protocol-correct fake: formats with the same pure helpers the real worker
// uses, so these tests prove the main-thread orchestration (paging order,
// one-page-in-flight, error propagation, termination).
class FakeExportWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event | string) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  posted: SqlExportRequest[] = [];
  failOnPost: Error | null = null;
  errorOnNextAck: "error" | "messageerror" | null = null;
  terminated = false;
  unacked = 0;
  maxUnacked = 0;
  deferAcks = false;

  postMessage(message: SqlExportRequest): void {
    if (this.failOnPost) throw this.failOnPost;
    this.posted.push(message);
    this.unacked += 1;
    this.maxUnacked = Math.max(this.maxUnacked, this.unacked);
    const respond = (): void => {
      this.unacked -= 1;
      if (this.errorOnNextAck === "error") {
        this.errorOnNextAck = null;
        this.onerror?.("boom");
        return;
      }
      if (this.errorOnNextAck === "messageerror") {
        this.errorOnNextAck = null;
        this.onmessageerror?.({} as MessageEvent);
        return;
      }
      if (message.type === "finish") {
        const init = this.posted.find((posted) => posted.type === "init");
        const exportedAt = init && init.type === "init" ? init.exportedAt : "";
        const chunks = new Map<string, string[]>();
        for (const posted of this.posted) {
          if (posted.type === "page" && posted.rows.length > 0) {
            const list = chunks.get(posted.table) ?? [];
            list.push(formatExportInsertStatements(posted.table, posted.rows));
            chunks.set(posted.table, list);
          }
        }
        const sections = new Map<string, string>();
        for (const [name, list] of chunks) sections.set(name, list.join("\n"));
        const encoded = new TextEncoder().encode(assembleSqlDump(exportedAt, sections));
        const buffer = encoded.buffer.slice(
          encoded.byteOffset,
          encoded.byteOffset + encoded.byteLength,
        );
        this.emit({ type: "result", buffer });
        return;
      }
      this.emit({ type: "ack" });
    };
    if (this.deferAcks) setTimeout(respond, 0);
    else respond();
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("exportSqlDump worker path (injected worker)", () => {
  it("sends init/pages/finish in order and terminates after a transferable result", async () => {
    const db = await createTestDatabase();
    await seedTrickyRows(db);
    const worker = new FakeExportWorker();

    const exported = await exportSqlDump(db, {
      createWorker: () => worker as unknown as Worker,
    });
    const sqlDump = new TextDecoder().decode(exported);

    expect(worker.posted[0]).toEqual({
      type: "init",
      exportedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(worker.posted[worker.posted.length - 1]).toEqual({ type: "finish" });
    const pageTables = worker.posted
      .filter((posted) => posted.type === "page")
      .map((posted) => (posted.type === "page" ? posted.table : ""));
    expect(pageTables).toEqual([
      "books",
      "chapters",
      "book_versions",
      "notes",
      "sync_tombstones",
      "cover_templates",
      "settings",
    ]);
    expect(sqlDump).toContain("O''Brien");
    expect(sqlDump).toContain("❄ 中文 🎉");
    const positions = SECTION_COMMENTS.map((comment) => sqlDump.indexOf(comment));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(worker.terminated).toBe(true);
  });

  it("keeps at most one page in flight across multiple pages", async () => {
    const db = await createTestDatabase();
    for (let index = 0; index < 205; index += 1) {
      await db.execute(
        "INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [`book-${index}`, `Title ${index}`, "Author", 1000, 1000],
      );
    }
    const worker = new FakeExportWorker();
    worker.deferAcks = true;

    const exported = await exportSqlDump(db, {
      createWorker: () => worker as unknown as Worker,
    });

    const bookPages = worker.posted.filter(
      (posted) => posted.type === "page" && posted.table === "books",
    );
    expect(bookPages.map((posted) => (posted.type === "page" ? posted.rows.length : 0))).toEqual([
      100, 100, 5,
    ]);
    expect(worker.maxUnacked).toBeLessThanOrEqual(1);
    const inserts = new TextDecoder()
      .decode(exported)
      .split("\n")
      .filter((line) => line.startsWith('INSERT OR REPLACE INTO "books"'));
    expect(inserts).toHaveLength(205);
    expect(worker.terminated).toBe(true);
  });

  it("rejects and terminates when the worker errors instead of hanging", async () => {
    const db = await createTestDatabase();
    const worker = new FakeExportWorker();
    worker.errorOnNextAck = "error";

    await expect(
      exportSqlDump(db, { createWorker: () => worker as unknown as Worker }),
    ).rejects.toThrow("sql-export worker failed");
    expect(worker.terminated).toBe(true);
  });

  it("rejects and terminates on worker messageerror", async () => {
    const db = await createTestDatabase();
    const worker = new FakeExportWorker();
    worker.errorOnNextAck = "messageerror";

    await expect(
      exportSqlDump(db, { createWorker: () => worker as unknown as Worker }),
    ).rejects.toThrow("failed to deserialize");
    expect(worker.terminated).toBe(true);
  });

  it("rejects and terminates when postMessage throws", async () => {
    const db = await createTestDatabase();
    const worker = new FakeExportWorker();
    worker.failOnPost = new Error("postMessage failed");

    await expect(
      exportSqlDump(db, { createWorker: () => worker as unknown as Worker }),
    ).rejects.toThrow("postMessage failed");
    expect(worker.terminated).toBe(true);
  });

  it("rejects when the worker fails while a page read is in flight", async () => {
    const worker = new FakeExportWorker();
    let selectCalls = 0;
    let releaseSelect!: (rows: Record<string, unknown>[]) => void;
    const selectGate = new Promise<Record<string, unknown>[]>((resolve) => {
      releaseSelect = resolve;
    });
    const reader = {
      select<T>(): Promise<T> {
        selectCalls += 1;
        return selectGate as Promise<T>;
      },
    };

    const exportPromise = exportSqlDump(reader, {
      createWorker: () => worker as unknown as Worker,
    });
    // Wait until init is acknowledged and the first page read is pending,
    // so no worker request is in flight when the failure lands.
    await vi.waitFor(() => expect(selectCalls).toBe(1));
    expect(worker.posted[0].type).toBe("init");
    worker.onerror?.("boom");
    releaseSelect([]);
    await expect(exportPromise).rejects.toThrow("sql-export worker failed");
    expect(worker.terminated).toBe(true);
  });
});

describe("platform adapters share the exporter", () => {
  const sourceRoot = join(process.cwd(), "src", "lib");

  function readSource(relativePath: string): string {
    return readFileSync(join(sourceRoot, relativePath), "utf8");
  }

  it.each([
    "platform/tauri/database.ts",
    "platform/web/database.ts",
  ])("%s delegates exportData to the shared helper", (relativePath) => {
    const source = readSource(relativePath);
    expect(source).toContain("exportSqlDump");
    expect(source).toContain("lib/db/sql-export");
    expect(source).not.toContain("generateInsertStatements");
    expect(source).not.toContain("function escapeSQL");
  });

  it("uses the real module worker bundle path with paged rowid cursor reads", () => {
    const source = readSource("db/sql-export.ts");
    expect(source).toContain("./sql-export.worker.ts");
    expect(source).toContain("import.meta.url");
    expect(source).toContain('type: "module"');
    expect(source).toContain("WHERE rowid > ? ORDER BY rowid LIMIT ?");
  });

  it("keeps Tauri calls out of the worker and transfers the result buffer", () => {
    const source = readSource("db/sql-export.worker.ts");
    expect(source).toContain('from "@/lib/db/sql-export-format"');
    expect(source).not.toContain('db/sql-export"');
    expect(source).toContain("[buffer]");
    expect(source).not.toContain("Tauri");
    expect(source).not.toContain("plugin-sql");
    expect(source).not.toContain("getDatabase");
  });
});
