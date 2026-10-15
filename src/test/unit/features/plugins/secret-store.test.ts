/**
 * The Plugin secret store seam (#453, unit 1): the in-memory store the app
 * registers at startup. Every secret is scoped by Plugin id, `listNames`
 * returns names only (sorted, never a value), and removal/reset erase through
 * `clearPlugin`/`clearAll`. `read` is host-only (network header injection),
 * never an API a Plugin can call.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryPluginSecretStore,
  getPluginSecretStore,
  registerPluginSecretStore,
} from "@/features/plugins/secret-store";

afterEach(() => {
  registerPluginSecretStore(null);
});

describe("createMemoryPluginSecretStore", () => {
  it("scopes values by Plugin: two ids never see each other's secrets", async () => {
    const store = createMemoryPluginSecretStore();
    await store.set("tracer", "token", "tracer-token");
    await store.set("echoes", "token", "echoes-token");

    await expect(store.read("tracer", "token")).resolves.toBe("tracer-token");
    await expect(store.read("echoes", "token")).resolves.toBe("echoes-token");
    await expect(store.listNames("tracer")).resolves.toEqual(["token"]);
    await expect(store.listNames("echoes")).resolves.toEqual(["token"]);
  });

  it("read returns null for a name that was never set", async () => {
    const store = createMemoryPluginSecretStore();

    await expect(store.read("tracer", "missing")).resolves.toBeNull();
  });

  it("set overwrites the previous value for the same name", async () => {
    const store = createMemoryPluginSecretStore();
    await store.set("tracer", "token", "first");
    await store.set("tracer", "token", "second");

    await expect(store.read("tracer", "token")).resolves.toBe("second");
    await expect(store.listNames("tracer")).resolves.toEqual(["token"]);
  });

  it("listNames returns names only, sorted, never a value", async () => {
    const store = createMemoryPluginSecretStore();
    await store.set("tracer", "zeta", "z-value");
    await store.set("tracer", "alpha", "a-value");
    await store.set("tracer", "mu", "m-value");

    await expect(store.listNames("tracer")).resolves.toEqual(["alpha", "mu", "zeta"]);
  });

  it("delete removes one name and leaves the rest", async () => {
    const store = createMemoryPluginSecretStore();
    await store.set("tracer", "a", "1");
    await store.set("tracer", "b", "2");

    await store.delete("tracer", "a");

    await expect(store.listNames("tracer")).resolves.toEqual(["b"]);
    await expect(store.read("tracer", "a")).resolves.toBeNull();
    await expect(store.read("tracer", "b")).resolves.toBe("2");
  });

  it("clearPlugin erases one Plugin's secrets and leaves every other Plugin's", async () => {
    const store = createMemoryPluginSecretStore();
    await store.set("tracer", "token", "tracer-token");
    await store.set("echoes", "token", "echoes-token");

    await store.clearPlugin("tracer");

    await expect(store.listNames("tracer")).resolves.toEqual([]);
    await expect(store.read("tracer", "token")).resolves.toBeNull();
    await expect(store.read("echoes", "token")).resolves.toBe("echoes-token");
  });

  it("clearAll erases every Plugin's secrets", async () => {
    const store = createMemoryPluginSecretStore();
    await store.set("tracer", "token", "tracer-token");
    await store.set("echoes", "token", "echoes-token");

    await store.clearAll();

    await expect(store.listNames("tracer")).resolves.toEqual([]);
    await expect(store.listNames("echoes")).resolves.toEqual([]);
  });
});

describe("the registered store", () => {
  it("exposes the registered store and clears it with null", () => {
    const store = createMemoryPluginSecretStore();

    registerPluginSecretStore(store);
    expect(getPluginSecretStore()).toBe(store);

    registerPluginSecretStore(null);
    expect(getPluginSecretStore()).toBeNull();
  });
});
