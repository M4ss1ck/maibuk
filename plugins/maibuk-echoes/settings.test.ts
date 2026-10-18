/**
 * Echoes' settings module (#450, unit 2): defaults for a missing or malformed
 * stored value, the nearby-window clamp, the ignore-list cleanup, the mapper to
 * `findEchoes`, and the storage round trip under the one key.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_ECHO_SETTINGS, NEARBY_WINDOW_MAX, NEARBY_WINDOW_MIN } from "./find-echoes";
import {
  DEFAULT_EDITOR_KINDS,
  ECHOES_COLOR_KEY,
  ECHOES_EDITOR_KEY,
  ECHOES_HIGHLIGHTS_KEY,
  ECHOES_SETTINGS_KEY,
  type EchoesStorage,
  clampNearbyWindow,
  ECHOES_PALETTE_KEY,
  parseColorByEcho,
  parseEchoesSettings,
  parseEditorKinds,
  readColorByEcho,
  readEchoPalette,
  readEchoesSettings,
  readEditorKinds,
  readHighlightsOn,
  writeColorByEcho,
  writeEchoPalette,
  toEditorFindOptions,
  toFindEchoesOptions,
  toggledEditorKind,
  writeEchoesSettings,
  writeEditorKinds,
  writeHighlightsOn,
} from "./settings";

/** A storage double over one Map, shaped like the SDK client's `storage`. */
function fakeStorage(data: Map<string, unknown>): EchoesStorage {
  return {
    storage: {
      async get({ key }) {
        return data.get(key) ?? null;
      },
      async set({ key, value }) {
        data.set(key, value);
        return null;
      },
      async delete({ key }) {
        data.delete(key);
        return null;
      },
      async keys() {
        return [...data.keys()];
      },
    },
  };
}

describe("Echoes settings", () => {
  it("falls back to every default for a missing or malformed stored value", () => {
    expect(parseEchoesSettings(null)).toEqual(DEFAULT_ECHO_SETTINGS);
    expect(parseEchoesSettings(undefined)).toEqual(DEFAULT_ECHO_SETTINGS);
    expect(parseEchoesSettings("not settings")).toEqual(DEFAULT_ECHO_SETTINGS);
    expect(parseEchoesSettings(42)).toEqual(DEFAULT_ECHO_SETTINGS);
  });

  it("keeps valid booleans and defaults the malformed ones field by field", () => {
    const parsed = parseEchoesSettings({ nearby: false, overused: "yes", stemming: 1 });
    expect(parsed.nearby).toBe(false);
    expect(parsed.overused).toBe(DEFAULT_ECHO_SETTINGS.overused);
    expect(parsed.stemming).toBe(DEFAULT_ECHO_SETTINGS.stemming);
  });

  it("clamps the nearby window to the accepted range", () => {
    expect(clampNearbyWindow(9999)).toBe(NEARBY_WINDOW_MAX);
    expect(clampNearbyWindow(2)).toBe(NEARBY_WINDOW_MIN);
    expect(clampNearbyWindow(50.4)).toBe(50);
    expect(clampNearbyWindow("120")).toBe(120);
    expect(clampNearbyWindow("abc")).toBe(DEFAULT_ECHO_SETTINGS.nearbyWindow);
    expect(clampNearbyWindow(undefined)).toBe(DEFAULT_ECHO_SETTINGS.nearbyWindow);
  });

  it("trims the ignore list to non-empty, unique words", () => {
    const parsed = parseEchoesSettings({ ignore: [" the ", "The", "", 7, "window"] });
    expect(parsed.ignore).toEqual(["the", "window"]);
    expect(parseEchoesSettings({ ignore: "the" }).ignore).toEqual([]);
  });

  it("maps settings to the options findEchoes takes, normalized", () => {
    const mapped = toFindEchoesOptions({
      ...DEFAULT_ECHO_SETTINGS,
      nearbyWindow: 9999,
      ignore: ["a", "a", " "],
    });
    expect(mapped.nearbyWindow).toBe(NEARBY_WINDOW_MAX);
    expect(mapped.ignore).toEqual(["a"]);
  });

  it("turns on only the kinds the editor paints (#451, decision 7)", () => {
    const stored = { ...DEFAULT_ECHO_SETTINGS, nearby: false, overused: false, phrases: false };
    const nearbyOnly = toEditorFindOptions(stored, ["nearby"]);
    expect(nearbyOnly).toMatchObject({ nearby: true, overused: false, phrases: false });

    const overusedAndPhrase = toEditorFindOptions(stored, ["overused", "phrase"]);
    expect(overusedAndPhrase).toMatchObject({ nearby: false, overused: true, phrases: true });

    // Detection's stemming, window, and ignore list still apply.
    const withStemming = toEditorFindOptions(
      { ...stored, stemming: false, nearbyWindow: 120, ignore: ["harbor"] },
      ["nearby"]
    );
    expect(withStemming).toMatchObject({
      stemming: false,
      nearbyWindow: 120,
      ignore: ["harbor"],
    });
  });

  it("round-trips through the storage API under the one key", async () => {
    const data = new Map<string, unknown>();
    const client = fakeStorage(data);

    await writeEchoesSettings(client, {
      ...DEFAULT_ECHO_SETTINGS,
      nearbyWindow: 120,
      ignore: ["harbor"],
    });

    expect(data.get(ECHOES_SETTINGS_KEY)).toMatchObject({ nearbyWindow: 120, ignore: ["harbor"] });
    expect(await readEchoesSettings(client)).toMatchObject({
      nearbyWindow: 120,
      ignore: ["harbor"],
    });
  });

  it("reads the defaults when storage refuses the read", async () => {
    const client: EchoesStorage = {
      storage: {
        async get() {
          throw new Error("refused");
        },
        async set() {
          return null;
        },
        async delete() {
          return null;
        },
        async keys() {
          return [];
        },
      },
    };
    expect(await readEchoesSettings(client)).toEqual(DEFAULT_ECHO_SETTINGS);
  });
});

/**
 * The editor highlight kinds (#451, unit 2): nearby only until the author turns
 * the others on, stored under their own key so they never inherit the detection
 * switches' on-by-default.
 */
describe("Echoes editor kinds", () => {
  it("defaults to nearby only for a missing or malformed value", () => {
    expect(DEFAULT_EDITOR_KINDS).toEqual(["nearby"]);
    expect(parseEditorKinds(null)).toEqual(["nearby"]);
    expect(parseEditorKinds(undefined)).toEqual(["nearby"]);
    expect(parseEditorKinds("nearby")).toEqual(["nearby"]);
    expect(parseEditorKinds(42)).toEqual(["nearby"]);
    expect(parseEditorKinds({ nearby: true })).toEqual(["nearby"]);
  });

  it("keeps the known kinds, drops unknown ones, and orders them", () => {
    expect(parseEditorKinds(["phrase", "nearby", "phrase", "nope", 7])).toEqual([
      "nearby",
      "phrase",
    ]);
    expect(parseEditorKinds(["overused"])).toEqual(["overused"]);
  });

  it("keeps an explicit empty list as the author turning every kind off", () => {
    expect(parseEditorKinds([])).toEqual([]);
  });

  it("round-trips through storage under its own key", async () => {
    const data = new Map<string, unknown>();
    const client = fakeStorage(data);

    await writeEditorKinds(client, ["nearby", "overused"]);

    expect(data.get(ECHOES_EDITOR_KEY)).toEqual(["nearby", "overused"]);
    expect(await readEditorKinds(client)).toEqual(["nearby", "overused"]);
  });

  it("reads nearby only when storage refuses the read", async () => {
    const client: EchoesStorage = {
      storage: {
        async get() {
          throw new Error("refused");
        },
        async set() {
          return null;
        },
        async delete() {
          return null;
        },
        async keys() {
          return [];
        },
      },
    };
    expect(await readEditorKinds(client)).toEqual(["nearby"]);
  });

  it("toggles one kind without disturbing the others, in order", () => {
    expect(toggledEditorKind(["nearby"], "overused")).toEqual(["nearby", "overused"]);
    expect(toggledEditorKind(["nearby", "overused"], "overused")).toEqual(["nearby"]);
    expect(toggledEditorKind(["overused", "nearby"], "overused")).toEqual(["nearby"]);
  });
});

describe("Echoes color by echo (#532)", () => {
  it("is off by default, for a missing or malformed value", () => {
    expect(parseColorByEcho(undefined)).toBe(false);
    expect(parseColorByEcho("yes")).toBe(false);
    expect(parseColorByEcho(null)).toBe(false);
  });

  it("keeps an explicit boolean", () => {
    expect(parseColorByEcho(true)).toBe(true);
    expect(parseColorByEcho(false)).toBe(false);
  });

  it("loads with coloring off when storage holds only 0.1.0 settings", async () => {
    const data = new Map<string, unknown>([
      [
        ECHOES_SETTINGS_KEY,
        {
          nearby: true,
          overused: false,
          phrases: true,
          stemming: true,
          nearbyWindow: 50,
          ignore: [],
        },
      ],
      [ECHOES_EDITOR_KEY, ["nearby"]],
    ]);
    expect(await readColorByEcho(fakeStorage(data))).toBe(false);
  });

  it("round-trips through storage under its own key", async () => {
    const data = new Map<string, unknown>();
    const client = fakeStorage(data);

    await writeColorByEcho(client, true);

    expect(data.get(ECHOES_COLOR_KEY)).toBe(true);
    expect(await readColorByEcho(client)).toBe(true);
  });

  it("reads off when storage refuses the read", async () => {
    const refusing: EchoesStorage = {
      storage: {
        async get() {
          throw new Error("refused");
        },
        async set() {
          throw new Error("refused");
        },
        async delete() {
          throw new Error("refused");
        },
        async keys() {
          throw new Error("refused");
        },
      },
    };
    expect(await readColorByEcho(refusing)).toBe(false);
  });

  it("reads the Okabe-Ito Palette when the Palette key is unset or unknown (#533)", async () => {
    expect(await readEchoPalette(fakeStorage(new Map()))).toBe("okabe-ito");
    expect(await readEchoPalette(fakeStorage(new Map([[ECHOES_PALETTE_KEY, "neon"]])))).toBe(
      "okabe-ito"
    );
  });

  it("round-trips the Palette through storage under its own key (#533)", async () => {
    const data = new Map<string, unknown>();
    const client = fakeStorage(data);

    await writeEchoPalette(client, "vivid");

    expect(data.get(ECHOES_PALETTE_KEY)).toBe("vivid");
    expect(await readEchoPalette(client)).toBe("vivid");
  });

  it("reads the default Palette when storage refuses the read (#533)", async () => {
    const refusing: EchoesStorage = {
      storage: {
        async get() {
          throw new Error("refused");
        },
        async set() {
          throw new Error("refused");
        },
        async delete() {
          throw new Error("refused");
        },
        async keys() {
          throw new Error("refused");
        },
      },
    };
    expect(await readEchoPalette(refusing)).toBe("okabe-ito");
    await expect(writeEchoPalette(refusing, "soft")).resolves.toBeUndefined();
  });
});

describe("Echoes highlights on (persisted switch)", () => {
  const refusing: EchoesStorage = {
    storage: {
      async get() {
        throw new Error("refused");
      },
      async set() {
        throw new Error("refused");
      },
      async delete() {
        throw new Error("refused");
      },
      async keys() {
        throw new Error("refused");
      },
    },
  };

  it("uses its own key", () => {
    expect(ECHOES_HIGHLIGHTS_KEY).toBe("highlights");
  });

  it("reads on only when the stored value is exactly true", async () => {
    expect(await readHighlightsOn(fakeStorage(new Map([[ECHOES_HIGHLIGHTS_KEY, true]])))).toBe(
      true
    );
  });

  it("reads off when the key is missing", async () => {
    expect(await readHighlightsOn(fakeStorage(new Map()))).toBe(false);
  });

  it("reads off for an explicit false", async () => {
    expect(await readHighlightsOn(fakeStorage(new Map([[ECHOES_HIGHLIGHTS_KEY, false]])))).toBe(
      false
    );
  });

  it("reads off for a malformed value, never a truthy one", async () => {
    for (const value of ["true", 1, "yes", {}, [true], null]) {
      expect(await readHighlightsOn(fakeStorage(new Map([[ECHOES_HIGHLIGHTS_KEY, value]])))).toBe(
        false
      );
    }
  });

  it("reads off when storage refuses the read", async () => {
    expect(await readHighlightsOn(refusing)).toBe(false);
  });

  it("writes the switch under its own key and reads it back", async () => {
    const data = new Map<string, unknown>();
    const client = fakeStorage(data);

    await writeHighlightsOn(client, true);
    expect(data.get(ECHOES_HIGHLIGHTS_KEY)).toBe(true);
    expect(await readHighlightsOn(client)).toBe(true);

    await writeHighlightsOn(client, false);
    expect(data.get(ECHOES_HIGHLIGHTS_KEY)).toBe(false);
    expect(await readHighlightsOn(client)).toBe(false);
  });

  it("swallows a refused write, so the switch never breaks on storage", async () => {
    await expect(writeHighlightsOn(refusing, true)).resolves.toBeUndefined();
  });
});
