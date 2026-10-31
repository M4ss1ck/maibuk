/**
 * usePluginSecrets (#453): the saved-credential state one Plugin row shows. The
 * remember flag is re-read inside the effect that refreshes the names, so a
 * store registered after the first render, or a row reopened later, shows the
 * true remembered state rather than the mount-time one.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPluginSecretStore, type PluginSecretStore } from "@/features/plugins/secret-store";
import { usePluginSecrets } from "@/hooks/usePluginSecrets";

/** A Plugin secret store whose overrides stand in for the registered one. */
function store(overrides: Partial<PluginSecretStore> = {}): PluginSecretStore {
  return {
    set: async () => {},
    delete: async () => {},
    listNames: async () => [],
    read: async () => null,
    clearPlugin: async () => {},
    clearAll: async () => {},
    ...overrides,
  };
}

afterEach(() => {
  registerPluginSecretStore(null);
});

describe("usePluginSecrets()", () => {
  it("reports whether the registered store can remember, from its capability", () => {
    registerPluginSecretStore(store());
    const without = renderHook(() => usePluginSecrets("tracer"));
    expect(without.result.current.canRemember).toBe(false);

    registerPluginSecretStore(store({ isRemembered: () => false, setRemembered: async () => {} }));
    const withRemember = renderHook(() => usePluginSecrets("tracer"));
    expect(withRemember.result.current.canRemember).toBe(true);
  });

  it("re-reads isRemembered once the row becomes active with a later store", async () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => usePluginSecrets("tracer", active),
      { initialProps: { active: false } }
    );
    expect(result.current.remembered).toBe(false);

    // The store registers after the first render, as it does on the web build.
    registerPluginSecretStore(store({ isRemembered: () => true, setRemembered: async () => {} }));
    rerender({ active: true });

    await waitFor(() => expect(result.current.remembered).toBe(true));
  });

  it("reflects a remembered Plugin on the first render when the store is present", () => {
    registerPluginSecretStore(store({ isRemembered: () => true, setRemembered: async () => {} }));
    const { result } = renderHook(() => usePluginSecrets("tracer"));
    expect(result.current.remembered).toBe(true);
  });

  it("refreshes the Plugin's secret names, and empties them when the read fails", async () => {
    registerPluginSecretStore(store({ listNames: async () => ["alpha", "zeta"] }));
    const { result } = renderHook(() => usePluginSecrets("tracer"));
    await waitFor(() => expect(result.current.names).toEqual(["alpha", "zeta"]));

    registerPluginSecretStore(
      store({
        listNames: async () => {
          throw new Error("boom");
        },
      })
    );
    const failing = renderHook(() => usePluginSecrets("other"));
    await waitFor(() => expect(failing.result.current.names).toEqual([]));
  });

  it("saves the remember choice through the store and toggles the flag", async () => {
    const setRemembered = vi.fn(async () => {});
    registerPluginSecretStore(store({ isRemembered: () => false, setRemembered }));
    const { result } = renderHook(() => usePluginSecrets("tracer"));
    expect(result.current.remembered).toBe(false);

    result.current.setRemembered(true);

    expect(setRemembered).toHaveBeenCalledWith("tracer", true);
    await waitFor(() => expect(result.current.remembered).toBe(true));
  });

  it("swallows a rejected remember write so the toggle still reflects the choice", async () => {
    registerPluginSecretStore(
      store({
        isRemembered: () => false,
        setRemembered: async () => {
          throw new Error("no store");
        },
      })
    );
    const { result } = renderHook(() => usePluginSecrets("tracer"));

    result.current.setRemembered(true);

    await waitFor(() => expect(result.current.remembered).toBe(true));
  });

  it("does nothing when the store cannot remember", () => {
    registerPluginSecretStore(store());
    const { result } = renderHook(() => usePluginSecrets("tracer"));

    expect(() => result.current.setRemembered(true)).not.toThrow();
  });
});
