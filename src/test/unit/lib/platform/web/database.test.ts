import { describe, expect, it } from "vitest";
import { createDbWorkerHandler } from "@/lib/db/db-worker-handler";
import { AtomicStatementError } from "@/lib/db/atomic";
import { WebDatabaseAdapter } from "@/lib/platform/web/database";
import type { DbWorkerTransport } from "@/lib/platform/web/db-client";
import { createTestWebDatabase } from "@/test/support/db-worker";

async function openTestLibrary(): Promise<WebDatabaseAdapter> {
  const adapter = createTestWebDatabase(createDbWorkerHandler());
  await adapter.open({ mode: "memory", name: "library.sqlite3" });
  return adapter;
}

describe("WebDatabaseAdapter protocol client", () => {
  it("resolves execute only after the Worker replies", async () => {
    let reply: ((value: unknown) => void) | null = null;
    const transport: DbWorkerTransport = {
      request<T>(): Promise<T> {
        return new Promise<T>((resolve) => {
          reply = resolve as (value: unknown) => void;
        });
      },
      terminate() {},
    };
    const adapter = new WebDatabaseAdapter(transport);

    let settled = false;
    const pending = adapter.execute("INSERT INTO books VALUES (1)").then(() => {
      settled = true;
    });
    expect(settled).toBe(false);

    expect(reply).not.toBeNull();
    (reply as unknown as (value: unknown) => void)({ rowsAffected: 1 });
    await pending;
    expect(settled).toBe(true);
  });

  it("executes and selects through the Worker", async () => {
    const adapter = await openTestLibrary();

    await adapter.execute("CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT)");
    await adapter.execute("INSERT INTO books (id, title) VALUES ('b1', 'Saved')");

    expect(await adapter.select("SELECT title FROM books")).toEqual([{ title: "Saved" }]);
    await adapter.close();
  });

  it("rejects execute when the Worker reports a failure", async () => {
    const adapter = await openTestLibrary();

    await expect(adapter.execute("INSERT INTO missing_table (id) VALUES ('x')")).rejects.toThrow(
      /no such table/
    );
    await adapter.close();
  });

  it("a failed statement does not stop the next one", async () => {
    const adapter = await openTestLibrary();
    await adapter.execute("CREATE TABLE notes (id TEXT PRIMARY KEY)");

    await expect(adapter.execute("INSERT INTO missing_table (id) VALUES ('x')")).rejects.toThrow();
    await adapter.execute("INSERT INTO notes (id) VALUES ('next')");

    expect(await adapter.select("SELECT id FROM notes")).toEqual([{ id: "next" }]);
    await adapter.close();
  });

  it("a failed executeAtomic leaves every row as it was", async () => {
    const adapter = await openTestLibrary();
    await adapter.execute("CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT)");
    await adapter.execute("INSERT INTO notes (id, title) VALUES ('kept', 'Kept')");

    const error = await adapter
      .executeAtomic([
        "INSERT INTO notes (id, title) VALUES ('doomed', 'Doomed')",
        "INSERT INTO missing_table (id) VALUES ('x')",
      ])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AtomicStatementError);
    expect((error as AtomicStatementError).index).toBe(1);
    expect(await adapter.select("SELECT id FROM notes ORDER BY id")).toEqual([{ id: "kept" }]);

    await adapter.execute("INSERT INTO notes (id, title) VALUES ('marker', 'Marker')");
    expect(await adapter.select("SELECT id FROM notes ORDER BY id")).toEqual([
      { id: "kept" },
      { id: "marker" },
    ]);
    await adapter.close();
  });
});
