/**
 * Echoes' editor highlight model (#451, unit 2): the pure step between
 * `findEchoes` output and `editor.setHighlights`. The labels, the host-kind
 * mapping, the enable filter, the dedupe, the ordered navigation list, the wrap
 * around, and the announcement all run here with no host.
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
  type EchoHighlightSets,
  createEchoTranslator,
  echoAnnouncement,
  echoHighlightRanges,
  echoHighlightsOff,
  echoNavigationList,
  echoNoEchoes,
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

describe("echoNavigationList()", () => {
  it("merges every kind into one list ordered by from then to", () => {
    const sets: EchoHighlightSets = {
      repetition: [{ from: 10, to: 14, label: "b" }],
      info: [{ from: 2, to: 6, label: "a" }],
      warning: [
        { from: 2, to: 9, label: "c" },
        { from: 2, to: 5, label: "d" },
      ],
    };
    expect(echoNavigationList(sets).map((entry) => entry.label)).toEqual(["d", "a", "c", "b"]);
    expect(echoNavigationList(sets).map((entry) => entry.kind)).toEqual([
      "warning",
      "info",
      "warning",
      "repetition",
    ]);
  });
});

describe("stepEcho()", () => {
  const list = echoNavigationList({
    repetition: [{ from: 0, to: 1, label: "a" }],
    info: [{ from: 5, to: 6, label: "b" }],
    warning: [{ from: 9, to: 10, label: "c" }],
  });

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
  const list = echoNavigationList({
    repetition: [{ from: 0, to: 4, label: "door, repeated 14 words earlier" }],
    info: [{ from: 20, to: 28, label: "just, used 23 times" }],
    warning: [],
  });

  it("announces the entry 1-based with its label", () => {
    expect(echoAnnouncement(list, 0, t)).toBe(
      "Echo 1 of 2: door, repeated 14 words earlier"
    );
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
