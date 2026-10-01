import { beforeEach, describe, expect, it, vi } from "vitest";
import { AtomicStatementError } from "@/lib/db/atomic";

const mockExecute = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const mockClose = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());
const mockLoad = vi.hoisted(() => vi.fn());
const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    get: mockGet,
    load: mockLoad,
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

const { createTauriDatabase } = await import("@/lib/platform/tauri/database");

describe("createTauriDatabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReturnValue({
      execute: mockExecute,
      select: mockSelect,
      close: mockClose,
    });
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 7 });
    mockSelect.mockResolvedValue([{ title: "hello" }]);
    mockInvoke.mockResolvedValue(undefined);
  });

  it("opens the Library through Database.get and never calls load", async () => {
    await createTauriDatabase("sqlite:maibuk.db");

    expect(mockGet).toHaveBeenCalledWith("sqlite:maibuk.db");
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it("forwards execute and maps rowsAffected", async () => {
    const db = await createTauriDatabase("sqlite:maibuk.db");
    mockExecute.mockResolvedValue({ rowsAffected: 3, lastInsertId: 9 });

    await expect(
      db.execute("UPDATE notes SET title = ? WHERE id = ?", ["hi", "n1"])
    ).resolves.toEqual({ rowsAffected: 3 });
    expect(mockExecute).toHaveBeenCalledWith("UPDATE notes SET title = ? WHERE id = ?", [
      "hi",
      "n1",
    ]);
  });

  it("forwards select with sql and params", async () => {
    const db = await createTauriDatabase("sqlite:maibuk.db");

    await expect(db.select("SELECT title FROM notes WHERE id = ?", ["n1"])).resolves.toEqual([
      { title: "hello" },
    ]);
    expect(mockSelect).toHaveBeenCalledWith("SELECT title FROM notes WHERE id = ?", ["n1"]);
  });

  it("executeAtomic invokes library_execute_atomic with the statements", async () => {
    const db = await createTauriDatabase("sqlite:maibuk.db");
    const statements = [
      "INSERT INTO notes (id, title) VALUES ('a;b')",
      "INSERT INTO notes (id, title) VALUES ('c')",
    ];

    await db.executeAtomic(statements);

    expect(mockInvoke).toHaveBeenCalledWith("library_execute_atomic", { statements });
  });

  it("maps a rejected invoke to AtomicStatementError with index and detail", async () => {
    const db = await createTauriDatabase("sqlite:maibuk.db");
    mockInvoke.mockRejectedValue({ index: 1, message: "no such table: x" });

    const error = await db
      .executeAtomic(["SELECT 1", "INSERT INTO x (id) VALUES ('1')"])
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AtomicStatementError);
    expect((error as AtomicStatementError).index).toBe(1);
    expect((error as AtomicStatementError).detail).toBe("no such table: x");
  });

  it("close resolves without calling the plugin close", async () => {
    const db = await createTauriDatabase("sqlite:maibuk.db");

    await expect(db.close()).resolves.toBeUndefined();
    expect(mockClose).not.toHaveBeenCalled();
  });
});
