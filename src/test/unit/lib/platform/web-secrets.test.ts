/**
 * The web Plugin secret store: session-only in memory by default, with a
 * per-Plugin opt-in "remember on this device" that persists that Plugin's
 * credentials in localStorage. A new store over the same storage sees only the
 * remembered Plugins' values; a storage that throws (private mode, quota) or
 * holds corrupt JSON degrades to session-only and never breaks a read.
 */
import { describe, expect, it } from "vitest";
import { createWebPluginSecretStore } from "@/lib/platform/web/secrets";

/** A minimal in-memory Storage stand-in. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length(): number {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

/** A Storage whose every access throws, like private mode or a full quota. */
function brokenStorage(): Storage {
  const fail = () => {
    throw new Error("storage unavailable");
  };
  return {
    get length(): number {
      return fail();
    },
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
}

const VALUES_KEY = "maibuk.pluginSecrets.v1";
const REMEMBER_KEY = "maibuk.pluginSecrets.remember.v1";

describe("createWebPluginSecretStore()", () => {
  it("keeps credentials for the session only by default", async () => {
    const storage = fakeStorage();
    const store = createWebPluginSecretStore(storage);
    await store.set("tracer", "token", "s3cr3t");

    const next = createWebPluginSecretStore(storage);

    await expect(next.listNames("tracer")).resolves.toEqual([]);
    await expect(next.read("tracer", "token")).resolves.toBeNull();
  });

  it("scopes values by Plugin and lists names sorted, never a value", async () => {
    const store = createWebPluginSecretStore(fakeStorage());
    await store.set("tracer", "zeta", "z");
    await store.set("tracer", "alpha", "a");
    await store.set("echoes", "token", "e");

    await expect(store.listNames("tracer")).resolves.toEqual(["alpha", "zeta"]);
    await expect(store.listNames("echoes")).resolves.toEqual(["token"]);
    await expect(store.read("tracer", "alpha")).resolves.toBe("a");
  });

  it("persists a remembered Plugin's values across a new store", async () => {
    const storage = fakeStorage();
    const store = createWebPluginSecretStore(storage);
    await store.set("tracer", "token", "s3cr3t");
    await store.setRemembered("tracer", true);

    const next = createWebPluginSecretStore(storage);

    expect(next.isRemembered("tracer")).toBe(true);
    await expect(next.listNames("tracer")).resolves.toEqual(["token"]);
    await expect(next.read("tracer", "token")).resolves.toBe("s3cr3t");
  });

  it("writes through to storage for a remembered Plugin after it is set", async () => {
    const storage = fakeStorage();
    const store = createWebPluginSecretStore(storage);
    await store.setRemembered("tracer", true);
    await store.set("tracer", "token", "first");
    await store.set("tracer", "token", "second");
    await store.set("tracer", "extra", "value");

    expect(JSON.parse(storage.getItem(VALUES_KEY) as string)).toEqual({
      tracer: { token: "second", extra: "value" },
    });

    await store.delete("tracer", "extra");
    expect(JSON.parse(storage.getItem(VALUES_KEY) as string)).toEqual({
      tracer: { token: "second" },
    });
    await expect(createWebPluginSecretStore(storage).listNames("tracer")).resolves.toEqual([
      "token",
    ]);
  });

  it("copies the current values into storage when remembering is turned on", async () => {
    const storage = fakeStorage();
    const store = createWebPluginSecretStore(storage);
    await store.set("tracer", "token", "s3cr3t");

    await store.setRemembered("tracer", true);

    expect(JSON.parse(storage.getItem(VALUES_KEY) as string)).toEqual({
      tracer: { token: "s3cr3t" },
    });
    expect(JSON.parse(storage.getItem(REMEMBER_KEY) as string)).toEqual(["tracer"]);
  });

  it("deletes the persisted copy but keeps memory when remembering is turned off", async () => {
    const storage = fakeStorage();
    const store = createWebPluginSecretStore(storage);
    await store.set("tracer", "token", "s3cr3t");
    await store.set("echoes", "token", "kept");
    await store.setRemembered("tracer", true);
    await store.setRemembered("echoes", true);

    await store.setRemembered("tracer", false);

    // Memory keeps this session's value.
    await expect(store.read("tracer", "token")).resolves.toBe("s3cr3t");
    expect(store.isRemembered("tracer")).toBe(false);
    // The persisted copy is gone; another Plugin's is untouched.
    expect(JSON.parse(storage.getItem(VALUES_KEY) as string)).toEqual({
      echoes: { token: "kept" },
    });
    expect(JSON.parse(storage.getItem(REMEMBER_KEY) as string)).toEqual(["echoes"]);
    const next = createWebPluginSecretStore(storage);
    await expect(next.listNames("tracer")).resolves.toEqual([]);
    await expect(next.read("echoes", "token")).resolves.toBe("kept");
  });

  it("clearPlugin erases one Plugin's memory, persisted copy, and remember flag", async () => {
    const storage = fakeStorage();
    const store = createWebPluginSecretStore(storage);
    await store.set("tracer", "token", "tracer-token");
    await store.set("echoes", "token", "echoes-token");
    await store.setRemembered("tracer", true);
    await store.setRemembered("echoes", true);

    await store.clearPlugin("tracer");

    await expect(store.listNames("tracer")).resolves.toEqual([]);
    expect(store.isRemembered("tracer")).toBe(false);
    expect(JSON.parse(storage.getItem(VALUES_KEY) as string)).toEqual({
      echoes: { token: "echoes-token" },
    });
    expect(JSON.parse(storage.getItem(REMEMBER_KEY) as string)).toEqual(["echoes"]);

    const next = createWebPluginSecretStore(storage);
    await expect(next.listNames("tracer")).resolves.toEqual([]);
    await expect(next.read("echoes", "token")).resolves.toBe("echoes-token");
  });

  it("clearAll erases every memory value, persisted copy, and remember flag", async () => {
    const storage = fakeStorage();
    const store = createWebPluginSecretStore(storage);
    await store.set("tracer", "token", "tracer-token");
    await store.set("echoes", "token", "echoes-token");
    await store.setRemembered("tracer", true);
    await store.setRemembered("echoes", true);

    await store.clearAll();

    await expect(store.listNames("tracer")).resolves.toEqual([]);
    await expect(store.listNames("echoes")).resolves.toEqual([]);
    expect(store.isRemembered("tracer")).toBe(false);
    expect(storage.getItem(VALUES_KEY)).toBeNull();
    expect(storage.getItem(REMEMBER_KEY)).toBeNull();
  });

  it("degrades to session-only and never throws when storage fails", async () => {
    const store = createWebPluginSecretStore(brokenStorage());

    await expect(store.set("tracer", "token", "s3cr3t")).resolves.toBeUndefined();
    await expect(store.setRemembered("tracer", true)).resolves.toBeUndefined();
    await expect(store.listNames("tracer")).resolves.toEqual(["token"]);
    await expect(store.read("tracer", "token")).resolves.toBe("s3cr3t");
    await expect(store.delete("tracer", "token")).resolves.toBeUndefined();
    await expect(store.listNames("tracer")).resolves.toEqual([]);
    await expect(store.clearPlugin("tracer")).resolves.toBeUndefined();
    await expect(store.clearAll()).resolves.toBeUndefined();
    expect(store.isRemembered("tracer")).toBe(false);
  });

  it("treats corrupt JSON as empty and recovers on the next write", async () => {
    const storage = fakeStorage();
    storage.setItem(VALUES_KEY, "{not json");
    storage.setItem(REMEMBER_KEY, "[not json");

    const store = createWebPluginSecretStore(storage);

    expect(store.isRemembered("tracer")).toBe(false);
    await expect(store.listNames("tracer")).resolves.toEqual([]);
    await store.set("tracer", "token", "s3cr3t");
    await store.setRemembered("tracer", true);
    expect(JSON.parse(storage.getItem(VALUES_KEY) as string)).toEqual({
      tracer: { token: "s3cr3t" },
    });
  });
});
