/**
 * File Grants (ADR 0036): the in-memory store the app registers at startup and
 * Plugin tests use. A grant is a handle to one file, scoped by Plugin id, read
 * in ranges under the Plugin message cap. Grants end on release, on removal, on
 * revoking `files:pick`, and on Reset settings.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryPluginFileGrantStore,
  getPluginFileGrantStore,
  registerPluginFileGrantStore,
} from "@/features/plugins/file-grants";
import { PluginApiError } from "@/plugin-sdk/protocol";

afterEach(() => {
  registerPluginFileGrantStore(null);
});

const BYTES = new Uint8Array([10, 20, 30, 40, 50]);

function bytes(buffer: ArrayBuffer): number[] {
  return [...new Uint8Array(buffer)];
}

async function missing(promise: Promise<unknown>): Promise<PluginApiError> {
  const error = await promise.then(
    () => {
      throw new Error("expected the grant to be missing");
    },
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(PluginApiError);
  expect((error as PluginApiError).code).toBe("file-missing");
  return error as PluginApiError;
}

describe("createMemoryPluginFileGrantStore(): picking", () => {
  it("returns the next queued file, or null when the author cancels", async () => {
    const store = createMemoryPluginFileGrantStore();

    store.queuePick("tracer", null);
    await expect(store.pick("tracer", ["pdf"])).resolves.toBeNull();

    store.queuePick("tracer", { name: "a.pdf", bytes: BYTES });
    await expect(store.pick("tracer", ["pdf"])).resolves.toEqual({
      grant: expect.any(String),
      name: "a.pdf",
      size: BYTES.length,
    });
  });

  it("returns the same grant when the same file is picked again", async () => {
    const store = createMemoryPluginFileGrantStore();
    const file = { name: "a.pdf", bytes: BYTES };

    store.queuePick("tracer", file);
    store.queuePick("tracer", file);
    const first = await store.pick("tracer", ["pdf"]);
    const second = await store.pick("tracer", ["pdf"]);

    expect(second?.grant).toBe(first?.grant);
    await expect(store.list("tracer")).resolves.toHaveLength(1);
  });

  it("returns the same grant for a seeded file picked again", async () => {
    const store = createMemoryPluginFileGrantStore([
      { pluginId: "tracer", name: "a.pdf", bytes: BYTES },
    ]);
    const [seeded] = await store.list("tracer");

    store.queuePick("tracer", { name: "a.pdf", bytes: BYTES });
    await expect(store.pick("tracer", ["pdf"])).resolves.toMatchObject({ grant: seeded.grant });
  });
});

describe("createMemoryPluginFileGrantStore(): reading", () => {
  async function seededStore() {
    const store = createMemoryPluginFileGrantStore([
      { pluginId: "tracer", name: "a.pdf", bytes: BYTES, modified: 1_000 },
    ]);
    const [grant] = await store.list("tracer");
    return { store, grant: grant.grant };
  }

  it("reads the requested range as an ArrayBuffer", async () => {
    const { store, grant } = await seededStore();

    const buffer = await store.read("tracer", grant, 1, 3);

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(bytes(buffer)).toEqual([20, 30, 40]);
  });

  it("returns the bytes that exist for a range past the end, and empty at or past it", async () => {
    const { store, grant } = await seededStore();

    expect(bytes(await store.read("tracer", grant, 4, 10))).toEqual([50]);
    expect(bytes(await store.read("tracer", grant, 5, 10))).toEqual([]);
    expect(bytes(await store.read("tracer", grant, 99, 10))).toEqual([]);
  });

  it("refuses an unknown grant with file-missing", async () => {
    const { store } = await seededStore();

    await missing(store.read("tracer", "grant-unknown", 0, 1));
    await missing(store.stat("tracer", "grant-unknown"));
  });

  it("scopes grants by Plugin: another Plugin's grant is missing", async () => {
    const { store, grant } = await seededStore();

    await missing(store.read("echoes", grant, 0, 1));
    await missing(store.stat("echoes", grant));
  });

  it("stats a grant without reading its bytes", async () => {
    const { store, grant } = await seededStore();

    await expect(store.stat("tracer", grant)).resolves.toEqual({
      name: "a.pdf",
      size: BYTES.length,
      modified: 1_000,
    });
  });

  it("makes a missing file unreadable while the grant stays listed", async () => {
    const { store, grant } = await seededStore();

    store.setMissing(grant);

    await missing(store.read("tracer", grant, 0, 1));
    await missing(store.stat("tracer", grant));
    await expect(store.requestAccess("tracer", grant)).resolves.toBe(false);
    await expect(store.list("tracer")).resolves.toMatchObject([{ grant }]);
  });
});

describe("createMemoryPluginFileGrantStore(): grant lifetime", () => {
  async function seededStore() {
    const store = createMemoryPluginFileGrantStore([
      { pluginId: "tracer", name: "a.pdf", bytes: BYTES },
      { pluginId: "echoes", name: "b.pdf", bytes: BYTES },
    ]);
    const [tracer] = await store.list("tracer");
    return { store, grant: tracer.grant };
  }

  it("requests access to a live grant, and refuses an unknown one", async () => {
    const { store, grant } = await seededStore();

    await expect(store.requestAccess("tracer", grant)).resolves.toBe(true);
    await missing(store.requestAccess("tracer", "grant-unknown"));
  });

  it("release ends one grant and leaves the rest", async () => {
    const { store, grant } = await seededStore();

    await store.release("tracer", grant);

    await expect(store.list("tracer")).resolves.toEqual([]);
    await missing(store.read("tracer", grant, 0, 1));
    await expect(store.list("echoes")).resolves.toHaveLength(1);
  });

  it("release ends a grant whose file is missing", async () => {
    const { store, grant } = await seededStore();
    store.setMissing(grant);

    await store.release("tracer", grant);

    await expect(store.list("tracer")).resolves.toEqual([]);
  });

  it("clearPlugin ends one Plugin's grants and leaves every other Plugin's", async () => {
    const { store } = await seededStore();

    await store.clearPlugin("tracer");

    await expect(store.list("tracer")).resolves.toEqual([]);
    await expect(store.list("echoes")).resolves.toMatchObject([{ name: "b.pdf" }]);
  });

  it("clearAll ends every grant", async () => {
    const { store } = await seededStore();

    await store.clearAll();

    await expect(store.list("tracer")).resolves.toEqual([]);
    await expect(store.list("echoes")).resolves.toEqual([]);
  });
});

describe("the registered store", () => {
  it("exposes the registered store and clears it with null", () => {
    const store = createMemoryPluginFileGrantStore();

    registerPluginFileGrantStore(store);
    expect(getPluginFileGrantStore()).toBe(store);

    registerPluginFileGrantStore(null);
    expect(getPluginFileGrantStore()).toBeNull();
  });
});
