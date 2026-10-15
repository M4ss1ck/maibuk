/**
 * Echoes' editor highlight model (#451, unit 2): the pure step between
 * `findEchoes` output and `editor.setHighlights`. The labels, the host-kind
 * mapping, the enable filter, the dedupe, the ordered navigation list, the paint
 * window, the wrap around, and the announcement all run here with no host.
 *
 * Decision 7 splits the work: `buildEchoList` returns the full, label-free list,
 * `paintWindow` slices it around the caret, and `echoHighlightSets` labels only
 * that slice; `echoHighlightRanges` stays the combined, label-building entry.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ECHO_SETTINGS,
  type Echo,
  type EchoSettings,
  findEchoes,
} from "./find-echoes";
import * as en from "./fixtures/en";
import { tokenize } from "./language";
import {
  ECHO_HIGHLIGHTS_OFF_KEY,
  ECHO_NO_ECHOES_KEY,
  ECHO_PAINT_LIMIT,
  type EchoNavigationEntry,
  buildEchoList,
  createEchoTranslator,
  echoAnnouncement,
  echoHighlightRanges,
  echoHighlightSets,
  echoHighlightsOff,
  echoLabel,
  echoNoEchoes,
  paintWindow,
  stepEcho,
} from "./highlights";

function settings(overrides: Partial<EchoSettings>): EchoSettings {
  return { ...DEFAULT_ECHO_SETTINGS, ...overrides };
}

const t = createEchoTranslator("en");

/** Two occurrences of "door" four words apart, both lowercase. */
const DOOR_TEXT = "A door creaked. Then a door slammed.";

describe("echoHighlightRanges()", () => {
  it("maps each Echo kind to its host kind and paints a nearby echo's two words", () => {
    const echoes = findEchoes(DOOR_TEXT, "en", settings({ overused: false, phrases: false }));
    const sets = echoHighlightRanges(echoes, ["nearby"], t, DOOR_TEXT);

    const door = DOOR_TEXT.indexOf("door");
    const doorAgain = DOOR_TEXT.lastIndexOf("door");
    expect(sets.repetition).toEqual([
      { from: door, to: door + 4, label: "door, repeated 4 words later" },
      { from: doorAgain, to: doorAgain + 4, label: "door, repeated 4 words earlier" },
    ]);
    expect(sets.info).toEqual([]);
    expect(sets.warning).toEqual([]);
  });

  it("labels the first word of a longer nearby chain 'later' and the rest 'earlier'", () => {
    const echoes = findEchoes(en.nearbyChain, "en", settings({ overused: false, phrases: false }));
    const sets = echoHighlightRanges(echoes, ["nearby"], t, en.nearbyChain);
    expect(sets.repetition.map((range) => range.label)).toEqual([
      "harbor, repeated 4 words later",
      "harbor, repeated 4 words earlier",
      "harbor, repeated 5 words earlier",
    ]);
  });

  it("uses the singular for a distance of one word", () => {
    const text = "A door door creaked.";
    const echoes = findEchoes(text, "en", settings({ overused: false, phrases: false }));
    const sets = echoHighlightRanges(echoes, ["nearby"], t, text);
    expect(sets.repetition.map((range) => range.label)).toEqual([
      "door, repeated 1 word later",
      "door, repeated 1 word earlier",
    ]);
  });

  it("labels an overused word with its total count on every occurrence", () => {
    const text = "harbor harbor harbor harbor harbor";
    const echoes = findEchoes(text, "en", settings({ nearby: false, phrases: false }));
    const sets = echoHighlightRanges(echoes, ["overused"], t, text);
    expect(sets.info).toHaveLength(5);
    for (const range of sets.info) expect(range.label).toBe("harbor, used 5 times");
    expect(sets.repetition).toEqual([]);
    expect(sets.warning).toEqual([]);
  });

  it("quotes a repeated phrase and reports its count", () => {
    const echoes = findEchoes(en.phraseTwice, "en", settings({ nearby: false, overused: false }));
    const sets = echoHighlightRanges(echoes, ["phrase"], t, en.phraseTwice);
    expect(sets.warning).toHaveLength(2);
    expect(sets.warning[0].label).toBe('"The old lighthouse", repeated 2 times');
    expect(sets.warning[0].from).toBeLessThan(sets.warning[1].from);
  });

  it("keeps only the kinds it was told to enable", () => {
    const echoes = findEchoes(en.nearbyChain, "en", settings({}));
    const onlyOverused = echoHighlightRanges(echoes, ["overused", "phrase"], t, en.nearbyChain);
    expect(onlyOverused.repetition).toEqual([]);
    const nearbyOnly = echoHighlightRanges(echoes, ["nearby"], t, en.nearbyChain);
    expect(nearbyOnly.repetition.length).toBeGreaterThan(0);
    expect(nearbyOnly.info).toEqual([]);
    expect(nearbyOnly.warning).toEqual([]);
  });

  it("deduplicates identical ranges within one kind", () => {
    const duplicated: Echo[] = [
      { kind: "overused", normalized: "just", occurrences: [{ chapter: 0, from: 0, to: 4 }] },
      { kind: "overused", normalized: "just", occurrences: [{ chapter: 0, from: 0, to: 4 }] },
    ];
    const sets = echoHighlightRanges(duplicated, ["overused"], t, "just");
    expect(sets.info).toEqual([{ from: 0, to: 4, label: "just, used 1 time" }]);
  });

  it("counts an overused word across the whole Book and reads each Chapter's text", () => {
    const book: Echo[] = [
      {
        kind: "overused",
        normalized: "harbor",
        occurrences: [
          { chapter: 0, from: 0, to: 6 },
          { chapter: 1, from: 4, to: 10 },
        ],
      },
    ];
    const sets = echoHighlightRanges(book, ["overused"], t, ["harbor here", "and harbor"]);
    expect(sets.info).toEqual([
      { from: 0, to: 6, label: "harbor, used 2 times" },
      { from: 4, to: 10, label: "harbor, used 2 times" },
    ]);
  });

  it("localizes every label through the injected translator", () => {
    const es = createEchoTranslator("es");
    const echoes = findEchoes(DOOR_TEXT, "en", settings({ overused: false, phrases: false }));
    const sets = echoHighlightRanges(echoes, ["nearby"], es, DOOR_TEXT);
    expect(sets.repetition[0].label).toBe("door, se repite 4 palabras después");
    expect(sets.repetition[1].label).toBe("door, se repite 4 palabras antes");
  });
});

describe("echoHighlightRanges() reusing findEchoes' tokens", () => {
  it("paints the same sets with the tokens handed over as with its own tokenization", () => {
    const text = "A door creaked. Then a door slammed, and a door shut.";
    const settingsHere = settings({ overused: false, phrases: false });
    const echoes = findEchoes(text, "en", settingsHere);
    const kinds = ["nearby"] as const;
    const own = echoHighlightRanges(echoes, kinds, t, text);
    const reused = echoHighlightRanges(echoes, kinds, t, text, [tokenize(text)]);
    expect(reused).toEqual(own);
  });
});

describe("buildEchoList()", () => {
  it("keeps from, to, kind, and a label spec (no label text)", () => {
    const text = "A door door creaked.";
    const echoes = findEchoes(text, "en", settings({ overused: false, phrases: false }));
    const list = buildEchoList(echoes, ["nearby"], text);
    expect(list).toEqual([
      {
        from: 2,
        to: 6,
        kind: "repetition",
        label: { key: "echo.label.nearbyLater", word: "door", count: 1 },
      },
      {
        from: 7,
        to: 11,
        kind: "repetition",
        label: { key: "echo.label.nearbyEarlier", word: "door", count: 1 },
      },
    ]);
  });

  it("orders entries by from then to", () => {
    const echoes: Echo[] = [
      { kind: "overused", normalized: "b", occurrences: [{ chapter: 0, from: 10, to: 14 }] },
      { kind: "overused", normalized: "a", occurrences: [{ chapter: 0, from: 2, to: 6 }] },
    ];
    const list = buildEchoList(echoes, ["overused"], "x".repeat(20));
    expect(list.map((entry) => entry.from)).toEqual([2, 10]);
    expect(list.map((entry) => entry.kind)).toEqual(["info", "info"]);
  });

  it("deduplicates identical entries by their label spec", () => {
    const duplicated: Echo[] = [
      { kind: "overused", normalized: "just", occurrences: [{ chapter: 0, from: 0, to: 4 }] },
      { kind: "overused", normalized: "just", occurrences: [{ chapter: 0, from: 0, to: 4 }] },
    ];
    const list = buildEchoList(duplicated, ["overused"], "just");
    expect(list).toEqual([
      { from: 0, to: 4, kind: "info", label: { key: "echo.label.overused", word: "just", count: 1 } },
    ]);
  });
});

describe("echoHighlightSets()", () => {
  it("splits entries into per-kind labelled ranges, keeping order", () => {
    const entries: EchoNavigationEntry[] = [
      { from: 2, to: 6, kind: "info", label: { key: "echo.label.overused", word: "a", count: 2 } },
      {
        from: 10,
        to: 14,
        kind: "repetition",
        label: { key: "echo.label.nearbyLater", word: "b", count: 4 },
      },
    ];
    const sets = echoHighlightSets(entries, t);
    expect(sets.info).toEqual([{ from: 2, to: 6, label: "a, used 2 times" }]);
    expect(sets.repetition).toEqual([{ from: 10, to: 14, label: "b, repeated 4 words later" }]);
    expect(sets.warning).toEqual([]);
  });
});

describe("echoLabel()", () => {
  it("builds the one label string from a spec", () => {
    expect(echoLabel({ key: "echo.label.nearbyEarlier", word: "door", count: 14 }, t)).toBe(
      "door, repeated 14 words earlier"
    );
    expect(echoLabel({ key: "echo.label.overused", word: "just", count: 1 }, t)).toBe(
      "just, used 1 time"
    );
  });
});

describe("paintWindow()", () => {
  // Entries 10 apart, so the caret's position names an index.
  const list = Array.from({ length: 100 }, (_, index) => ({ from: index * 10 }));

  it("centers the window on the caret", () => {
    expect(paintWindow(list, 500, 10)).toEqual({ start: 45, end: 55 });
  });

  it("clamps at the start", () => {
    expect(paintWindow(list, 0, 10)).toEqual({ start: 0, end: 10 });
  });

  it("clamps at the end", () => {
    expect(paintWindow(list, 990, 10)).toEqual({ start: 90, end: 100 });
  });

  it("keeps the whole list when it is shorter than the limit", () => {
    const small = [{ from: 0 }, { from: 5 }, { from: 9 }];
    expect(paintWindow(small, 5, ECHO_PAINT_LIMIT)).toEqual({ start: 0, end: 3 });
  });

  it("is empty for an empty list or a non-positive limit", () => {
    expect(paintWindow([], 0, ECHO_PAINT_LIMIT)).toEqual({ start: 0, end: 0 });
    expect(paintWindow(list, 500, 0)).toEqual({ start: 0, end: 0 });
  });

  it("is never longer than the limit and always exactly min(limit, length)", () => {
    const window = paintWindow(list, 250, 30);
    expect(window.end - window.start).toBe(30);
    expect(window).toEqual({ start: 10, end: 40 });
  });
});

describe("stepEcho()", () => {
  const list = [
    { from: 0, to: 1 },
    { from: 5, to: 6 },
    { from: 9, to: 10 },
  ];

  it("returns null for an empty list", () => {
    expect(stepEcho([], null, "next")).toBeNull();
    expect(stepEcho([], 0, "previous")).toBeNull();
  });

  it("enters the list at the first entry going next and the last going previous", () => {
    expect(stepEcho(list, null, "next")).toBe(0);
    expect(stepEcho(list, null, "previous")).toBe(list.length - 1);
  });

  it("wraps around at both ends", () => {
    expect(stepEcho(list, list.length - 1, "next")).toBe(0);
    expect(stepEcho(list, 0, "previous")).toBe(list.length - 1);
    expect(stepEcho(list, 0, "next")).toBe(1);
    expect(stepEcho(list, 1, "previous")).toBe(0);
  });
});

describe("echoAnnouncement()", () => {
  const list: EchoNavigationEntry[] = [
    {
      from: 0,
      to: 4,
      kind: "repetition",
      label: { key: "echo.label.nearbyEarlier", word: "door", count: 14 },
    },
    { from: 20, to: 28, kind: "info", label: { key: "echo.label.overused", word: "just", count: 23 } },
  ];

  it("announces the entry 1-based with its label", () => {
    expect(echoAnnouncement(list, 0, t)).toBe("Echo 1 of 2: door, repeated 14 words earlier");
    expect(echoAnnouncement(list, 1, t)).toBe("Echo 2 of 2: just, used 23 times");
  });

  it("says there are no echoes when the list or index is empty", () => {
    expect(echoAnnouncement([], 0, t)).toBe("No echoes found");
    expect(echoAnnouncement(list, 9, t)).toBe("No echoes found");
  });

  it("localizes its fixed strings and exposes their i18n keys", () => {
    const es = createEchoTranslator("es");
    expect(echoHighlightsOff(es)).toBe("Los resaltados de ecos están desactivados");
    expect(echoNoEchoes(es)).toBe("No se encontraron ecos");
    expect(ECHO_HIGHLIGHTS_OFF_KEY).toBe("echo.highlightsOff");
    expect(ECHO_NO_ECHOES_KEY).toBe("echo.none");
  });
});
