import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const mockClose = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());
const mockLoad = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    get: mockGet,
    load: mockLoad,
  },
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
      db.execute("UPDATE notes SET title = ? WHERE id = ?", ["hi", "n1"]),
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

  it("importData runs each statement in order, keeping quoted semicolons intact", async () => {
    const db = await createTauriDatabase("sqlite:maibuk.db");

    await db.importData(
      "INSERT INTO notes (id, title) VALUES ('a;b');\nINSERT INTO notes (id, title) VALUES ('c');",
    );

    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      "INSERT INTO notes (id, title) VALUES ('a;b')",
    );
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      "INSERT INTO notes (id, title) VALUES ('c')",
    );
  });

  it("close resolves without calling the plugin close", async () => {
    const db = await createTauriDatabase("sqlite:maibuk.db");

    await expect(db.close()).resolves.toBeUndefined();
    expect(mockClose).not.toHaveBeenCalled();
  });
});
