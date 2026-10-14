/**
 * Echoes' settings module (#450, unit 2): defaults for a missing or malformed
 * stored value, the nearby-window clamp, the ignore-list cleanup, the mapper to
 * `findEchoes`, and the storage round trip under the one key.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_ECHO_SETTINGS, NEARBY_WINDOW_MAX, NEARBY_WINDOW_MIN } from "./find-echoes";
import {
  ECHOES_SETTINGS_KEY,
  type EchoesStorage,
  clampNearbyWindow,
  parseEchoesSettings,
  readEchoesSettings,
  toFindEchoesOptions,
  writeEchoesSettings,
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
