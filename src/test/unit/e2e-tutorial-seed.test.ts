// @vitest-environment node
//
// The frame-rate lane's desktop source has no init scripts (WebDriver), so it
// answers the Tutorial offer through `dismissTutorialOnLoadedPage` and reloads.
// This pins that the value it writes is one the real Tutorial store reads back
// as a dismissed offer, so the measured app boots without the offer dialog.
// Node, not jsdom: e2e/support/storage.ts loads esbuild, which jsdom breaks.
// The store binds localStorage when it is created, so the stub comes first.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const items = new Map<string, string>();
  globalThis.localStorage = {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
});

import { EMPTY_TUTORIAL_PROGRESS, useTutorialStore } from "@/features/tutorial/store";
import { dismissTutorialOnLoadedPage } from "../../../e2e/support/storage";

describe("dismissTutorialOnLoadedPage", () => {
  afterEach(() => {
    localStorage.clear();
    useTutorialStore.setState({ progress: EMPTY_TUTORIAL_PROGRESS });
  });

  it("writes Tutorial progress the store rehydrates as a dismissed offer", async () => {
    const page = {
      evaluate: async <R, A>(fn: (arg: A) => R | Promise<R>, arg?: A) => fn(arg as A),
    };

    await dismissTutorialOnLoadedPage(page);
    await useTutorialStore.persist.rehydrate();

    expect(useTutorialStore.getState().progress).toEqual({
      ...EMPTY_TUTORIAL_PROGRESS,
      dismissedAt: 1,
    });
  });
});
