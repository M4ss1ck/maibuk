import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const located = vi.hoisted(() => [] as string[]);

vi.mock("sql.js", async () => {
  const actual = await vi.importActual<typeof import("sql.js")>("sql.js");
  return {
    default: (config?: { locateFile?: (file: string) => string }) => {
      if (config?.locateFile) located.push(config.locateFile("sql-wasm.wasm"));
      return actual.default(config);
    },
  };
});

import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { createWebDatabase } from "@/lib/platform/web/database";

describe("createWebDatabase() wasm", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    located.length = 0;
  });

  // The sql.js glue and its wasm must come from the same release. A CDN that
  // serves the latest wasm broke every web Library when sql.js 1.15 shipped.
  it("loads the wasm bundled with the installed sql.js, never a remote one", async () => {
    const db = await createWebDatabase("maibuk.db");
    await db.close();

    expect(located.length).toBeGreaterThan(0);
    for (const url of located) {
      expect(url).toBe(sqlWasmUrl);
    }
  });
});
