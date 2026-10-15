/**
 * The desktop keychain Plugin secret store (#453): every operation goes through
 * a Rust command, arguments cross in camelCase, and a rejected command is
 * rethrown so Reset settings and Plugin removal can report the failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

import { createKeychainPluginSecretStore } from "@/lib/platform/tauri/secrets";

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("createKeychainPluginSecretStore()", () => {
  it("saves a value through the keychain command", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const store = createKeychainPluginSecretStore();

    await store.set("tracer", "token", "s3cr3t");

    expect(mockInvoke).toHaveBeenCalledWith("plugin_secret_set", {
      pluginId: "tracer",
      name: "token",
      value: "s3cr3t",
    });
  });

  it("deletes one secret through the keychain command", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const store = createKeychainPluginSecretStore();

    await store.delete("tracer", "token");

    expect(mockInvoke).toHaveBeenCalledWith("plugin_secret_delete", {
      pluginId: "tracer",
      name: "token",
    });
  });

  it("lists the Plugin's secret names through the keychain command", async () => {
    mockInvoke.mockResolvedValue(["alpha", "zeta"]);
    const store = createKeychainPluginSecretStore();

    await expect(store.listNames("tracer")).resolves.toEqual(["alpha", "zeta"]);
    expect(mockInvoke).toHaveBeenCalledWith("plugin_secret_list_names", { pluginId: "tracer" });
  });

  it("reads a value, and null for one that is not set", async () => {
    mockInvoke.mockResolvedValueOnce("s3cr3t").mockResolvedValueOnce(null);
    const store = createKeychainPluginSecretStore();

    await expect(store.read("tracer", "token")).resolves.toBe("s3cr3t");
    await expect(store.read("tracer", "missing")).resolves.toBeNull();
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "plugin_secret_read", {
      pluginId: "tracer",
      name: "missing",
    });
  });

  it("clears one Plugin's secrets through the keychain command", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const store = createKeychainPluginSecretStore();

    await store.clearPlugin("tracer");

    expect(mockInvoke).toHaveBeenCalledWith("plugin_secret_clear_plugin", { pluginId: "tracer" });
  });

  it("clears every secret through the keychain command", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const store = createKeychainPluginSecretStore();

    await store.clearAll();

    expect(mockInvoke).toHaveBeenCalledWith("plugin_secret_clear_all");
  });

  it("rethrows a rejected command so the caller sees the keychain failure", async () => {
    mockInvoke.mockRejectedValue(new Error("no Secret Service running"));
    const store = createKeychainPluginSecretStore();

    await expect(store.set("tracer", "token", "s3cr3t")).rejects.toThrow(
      "no Secret Service running"
    );
    await expect(store.clearAll()).rejects.toThrow("no Secret Service running");
  });
});
