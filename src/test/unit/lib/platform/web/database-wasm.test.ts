import { afterEach, describe, expect, it, vi } from "vitest";

const located = vi.hoisted(() => [] as string[]);

vi.mock("@sqlite.org/sqlite-wasm", () => ({
  default: (options?: { locateFile?: (file: string) => string }) => {
    if (options?.locateFile) located.push(options.locateFile("sqlite3.wasm"));
    return Promise.resolve({});
  },
}));

import sqlite3WasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";

describe("loadSqlite3() wasm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    located.length = 0;
  });

  // The JS glue and its wasm must come from the same release. A CDN that
  // served the latest sql.js wasm once broke every web Library (#645).
  it("loads the wasm bundled with the installed package, never a remote one", async () => {
    vi.stubGlobal("process", { ...process, versions: { ...process.versions, node: undefined } });
    const { loadSqlite3 } = await import("@/lib/db/sqlite-engine");

    await loadSqlite3();

    expect(located).toEqual([sqlite3WasmUrl]);
    expect(sqlite3WasmUrl).not.toMatch(/^https?:/);
  });
});
