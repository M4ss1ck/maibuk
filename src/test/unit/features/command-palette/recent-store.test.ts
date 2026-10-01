import { beforeEach, describe, expect, it } from "vitest";
import {
  PALETTE_RECENT_STORAGE_KEY,
  useCommandPaletteRecentStore,
} from "@/features/command-palette/recent-store";
import {
  resetLibrarySwitchForTests,
  setTutorialRunInProgress,
} from "@/features/tutorial/library-switch";

function keys(): string[] {
  return useCommandPaletteRecentStore.getState().keys;
}

beforeEach(() => {
  localStorage.clear();
  resetLibrarySwitchForTests();
  useCommandPaletteRecentStore.setState({ keys: [] });
});

describe("command palette recent", () => {
  it("starts empty", () => {
    expect(keys()).toEqual([]);
  });

  it("records the newest key first without duplicates, trimming to 10", () => {
    const record = useCommandPaletteRecentStore.getState().record;
    record("command:a");
    record("command:b");
    record("command:a");
    expect(keys()).toEqual(["command:a", "command:b"]);

    for (let n = 0; n < 12; n++) record(`command:n${n}`);
    expect(keys()).toHaveLength(10);
    expect(keys()[0]).toBe("command:n11");
    expect(keys()).not.toContain("command:a");
  });

  it("ignores records while a Tutorial run is in progress", () => {
    setTutorialRunInProgress(true);
    try {
      useCommandPaletteRecentStore.getState().record("command:a");
      expect(keys()).toEqual([]);
    } finally {
      resetLibrarySwitchForTests();
    }
  });

  it("removes a key", () => {
    const store = useCommandPaletteRecentStore.getState();
    store.record("command:a");
    store.record("command:b");
    useCommandPaletteRecentStore.getState().remove("command:b");
    expect(keys()).toEqual(["command:a"]);
  });

  it("prunes keys that resolve to nothing, keeping order", () => {
    useCommandPaletteRecentStore.setState({ keys: ["command:b", "note:ghost", "command:a"] });
    useCommandPaletteRecentStore.getState().prune(["command:a", "command:b"]);
    expect(keys()).toEqual(["command:b", "command:a"]);
  });

  it("writes nothing when pruning changes nothing", () => {
    useCommandPaletteRecentStore.setState({ keys: ["command:a"] });
    const before = localStorage.getItem(PALETTE_RECENT_STORAGE_KEY);
    useCommandPaletteRecentStore.getState().prune(["command:a", "command:b"]);
    expect(keys()).toEqual(["command:a"]);
    expect(localStorage.getItem(PALETTE_RECENT_STORAGE_KEY)).toBe(before);
  });

  it("normalizes stored keys on rehydrate", async () => {
    localStorage.setItem(
      PALETTE_RECENT_STORAGE_KEY,
      JSON.stringify({
        state: {
          keys: [
            "command:a",
            42,
            "command:a",
            "",
            ...Array.from({ length: 12 }, (_, n) => `command:n${n}`),
          ],
        },
        version: 1,
      })
    );
    await useCommandPaletteRecentStore.persist.rehydrate();
    expect(keys()).toEqual([
      "command:a",
      ...Array.from({ length: 9 }, (_, n) => `command:n${n}`),
    ]);
  });
});
