import { afterEach, describe, expect, it, vi } from "vitest";

const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
  if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
  vi.resetModules();
});

describe("appLanguage()", () => {
  it("is the author's language setting", async () => {
    const { useSettingsStore } = await import("@/features/settings/store");
    const { appLanguage } = await import("@/features/settings/app-language");
    useSettingsStore.setState({ language: "es" });
    expect(appLanguage()).toBe("es");
  });

  it("falls back to English for a language Maibuk does not offer", async () => {
    const { useSettingsStore } = await import("@/features/settings/store");
    const { appLanguage } = await import("@/features/settings/app-language");
    useSettingsStore.setState({ language: "fr" as never });
    expect(appLanguage()).toBe("en");
  });

  // The E2E seed builder runs the write paths, and so this module, in Node.
  it("loads where there is no localStorage", async () => {
    vi.resetModules();
    // Node has no such global at all, which is not the same as one set to undefined.
    delete (globalThis as { localStorage?: Storage }).localStorage;
    const { appLanguage } = await import("@/features/settings/app-language");
    expect(["en", "es"]).toContain(appLanguage());
  });
});
