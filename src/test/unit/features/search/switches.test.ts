import { beforeEach, describe, expect, it } from "vitest";
import { defaultWholeLinePhrases } from "@/features/dictation/voice-commands";
import {
  SEARCH_SWITCHES_STORAGE_KEY,
  useSearchSwitchesStore,
} from "@/features/search/switches";

beforeEach(() => {
  localStorage.clear();
  useSearchSwitchesStore.setState({ matchCase: false, wholeWord: false, regex: false });
});

function switches() {
  return useSearchSwitchesStore.getState();
}

describe("search switches", () => {
  it("starts with every switch off", () => {
    expect(switches().matchCase).toBe(false);
    expect(switches().wholeWord).toBe(false);
    expect(switches().regex).toBe(false);
  });

  it("toggles each switch without touching the others", () => {
    switches().toggleMatchCase();
    expect(switches().matchCase).toBe(true);
    expect(switches().wholeWord).toBe(false);
    expect(switches().regex).toBe(false);

    switches().toggleWholeWord();
    switches().toggleRegex();
    expect(switches().matchCase).toBe(true);
    expect(switches().wholeWord).toBe(true);
    expect(switches().regex).toBe(true);

    switches().toggleMatchCase();
    expect(switches().matchCase).toBe(false);
  });

  it("persists the switches on this device across a simulated reload", async () => {
    switches().toggleMatchCase();
    switches().toggleRegex();

    const saved = localStorage.getItem(SEARCH_SWITCHES_STORAGE_KEY) ?? "";
    expect(JSON.parse(saved).state).toMatchObject({
      matchCase: true,
      wholeWord: false,
      regex: true,
    });

    // A reload starts from memory defaults and reads the saved blob back.
    useSearchSwitchesStore.setState({ matchCase: false, wholeWord: false, regex: false });
    localStorage.setItem(SEARCH_SWITCHES_STORAGE_KEY, saved);
    await useSearchSwitchesStore.persist.rehydrate();

    expect(switches().matchCase).toBe(true);
    expect(switches().wholeWord).toBe(false);
    expect(switches().regex).toBe(true);
  });

  it("recovers from a corrupt saved blob with every switch off", async () => {
    localStorage.setItem(
      SEARCH_SWITCHES_STORAGE_KEY,
      JSON.stringify({ state: { matchCase: "yes", wholeWord: 1, regex: null }, version: 1 })
    );

    await useSearchSwitchesStore.persist.rehydrate();

    expect(switches().matchCase).toBe(false);
    expect(switches().wholeWord).toBe(false);
    expect(switches().regex).toBe(false);
  });

  it("answers Voice Commands with its labels", () => {
    expect(defaultWholeLinePhrases("common.matchCase", "en")).toEqual(["Match Case"]);
    expect(defaultWholeLinePhrases("common.wholeWord", "en")).toEqual(["Match Whole Word"]);
    expect(defaultWholeLinePhrases("common.useRegex", "en")).toEqual(["Use Regular Expression"]);
    expect(defaultWholeLinePhrases("common.matchCase", "es")).toEqual([
      "Coincidir Mayúsculas/Minúsculas",
    ]);
    expect(defaultWholeLinePhrases("common.wholeWord", "es")).toEqual([
      "Coincidir Palabra Completa",
    ]);
    expect(defaultWholeLinePhrases("common.useRegex", "es")).toEqual(["Usar Expresión Regular"]);
  });
});
