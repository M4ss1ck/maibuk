import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ECHO_WARMUP_KEYS,
  dispatchShortcut,
  dispatchTypingKey,
  echoWarmupText,
  findEchoElement,
  findEchoInput,
  matchEchoSamples,
  parseChord,
  pluginStartMeasure,
  pollFor,
  readMarkStart,
  readMeasureDuration,
} from "@/features/plugins/bench/measure";
import { isPluginsBenchSeed } from "@/features/plugins/bench/types";

function measure(name: string, startMark: string, endMark: string): void {
  performance.mark(startMark);
  performance.mark(endMark);
  performance.measure(name, startMark, endMark);
}

afterEach(() => {
  performance.clearMarks();
  performance.clearMeasures();
});

describe("parseChord", () => {
  it("maps a manifest chord to the host's KeyboardEvent init (Mod is Ctrl on Linux)", () => {
    expect(parseChord("Mod+Alt+e")).toEqual({
      key: "e",
      code: "KeyE",
      ctrlKey: true,
      altKey: true,
      metaKey: false,
      shiftKey: false,
    });
  });

  it("reads Ctrl/Meta/Shift and leaves an unmapped key's code empty", () => {
    expect(parseChord("Meta+Shift+ArrowDown")).toMatchObject({
      key: "ArrowDown",
      code: "",
      metaKey: true,
      shiftKey: true,
      ctrlKey: false,
    });
    expect(parseChord("Ctrl+,")).toMatchObject({ key: ",", code: "", ctrlKey: true });
  });
});

describe("dispatchShortcut", () => {
  it("dispatches a bubbling keydown carrying the chord's modifiers", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const listener = vi.fn();
    target.addEventListener("keydown", listener);
    dispatchShortcut(target, parseChord("Mod+Alt+e"));
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as KeyboardEvent;
    expect(event.key).toBe("e");
    expect(event.ctrlKey).toBe(true);
    expect(event.altKey).toBe(true);
    target.remove();
  });
});

describe("dispatchTypingKey", () => {
  it("sets the value through the native setter and fires keydown, input, keyup", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const events: string[] = [];
    for (const type of ["keydown", "input", "keyup"]) {
      input.addEventListener(type, () => events.push(type));
    }
    dispatchTypingKey(input, "a", "a");
    expect(events).toEqual(["keydown", "input", "keyup"]);
    expect(input.value).toBe("a");
    dispatchTypingKey(input, "b", "ab");
    expect(input.value).toBe("ab");
    input.remove();
  });
});

describe("findEchoElement / findEchoInput", () => {
  it("finds the echo Text and the labelled input", () => {
    document.body.innerHTML =
      '<div><p>echo:abc</p><input aria-label="Echo input" /></div>';
    expect(findEchoElement(document)?.textContent).toBe("echo:abc");
    expect(findEchoInput(document)?.tagName).toBe("INPUT");
    document.body.innerHTML = "";
  });

  it("resolves the input's name through aria-labelledby, as React Aria associates it", () => {
    document.body.innerHTML =
      '<label id="lbl">Echo input</label><input aria-labelledby="lbl" />';
    expect(findEchoInput(document)?.tagName).toBe("INPUT");
    document.body.innerHTML = "";
  });
});

describe("matchEchoSamples", () => {
  it("pairs each keystroke with the first echo containing its prefix", () => {
    const keys = [100, 200];
    const mutations = [
      { t: 150, text: "echo:a" },
      { t: 260, text: "echo:ab" },
    ];
    expect(matchEchoSamples(keys, mutations, "ab")).toEqual([50, 60]);
  });

  it("still yields one sample per key when a burst coalesces into one echo", () => {
    const keys = [100, 120, 140];
    const mutations = [{ t: 300, text: "echo:abc" }];
    expect(matchEchoSamples(keys, mutations, "abc")).toEqual([200, 180, 160]);
  });

  it("drops a key whose echo never arrived", () => {
    expect(matchEchoSamples([100, 200], [{ t: 150, text: "echo:a" }], "ab")).toEqual([50]);
  });

  it("dispatches the warm-up keys but excludes them from the samples", () => {
    // Two warm-up keydowns (10, 20) precede the measured ones; the samples cover
    // the measured text only, so their length is the measured text length, not +2.
    const keys = [10, 20, 110, 210, 310];
    const mutations = [
      { t: 160, text: "echo:a" },
      { t: 260, text: "echo:ab" },
      { t: 360, text: "echo:abc" },
    ];
    const samples = matchEchoSamples(keys, mutations, "abc", ECHO_WARMUP_KEYS);
    expect(samples).toEqual([50, 50, 50]);
    expect(samples).toHaveLength(3);
  });
});

describe("echoWarmupText", () => {
  it("types ECHO_WARMUP_KEYS characters, mirroring launch's two warm-up loads", () => {
    expect(ECHO_WARMUP_KEYS).toBe(2);
    expect(echoWarmupText()).toHaveLength(ECHO_WARMUP_KEYS);
    expect(echoWarmupText(3)).toHaveLength(3);
  });
});

describe("readMarkStart / readMeasureDuration", () => {
  it("reads the first User Timing entry's startTime and a measure's duration", () => {
    performance.mark("app.gallery.first-render");
    expect(readMarkStart("app.gallery.first-render")).toBeTypeOf("number");
    expect(readMarkStart("nope")).toBeNull();
    expect(readMeasureDuration(pluginStartMeasure("fixture-x"))).toBeNull();
    measure(pluginStartMeasure("fixture-x"), "s", "e");
    expect(readMeasureDuration(pluginStartMeasure("fixture-x"))).toBeTypeOf("number");
  });
});

describe("pollFor", () => {
  it("returns as soon as the reader yields a value", async () => {
    let reads = 0;
    const value = await pollFor(() => (++reads >= 3 ? "ready" : null), {
      timeoutMs: 1000,
      intervalMs: 1,
    });
    expect(value).toBe("ready");
    expect(reads).toBe(3);
  });

  it("throws when the value never arrives", async () => {
    await expect(
      pollFor(() => null, { timeoutMs: 5, intervalMs: 1 })
    ).rejects.toThrow(/timed out/);
  });
});

describe("isPluginsBenchSeed", () => {
  const valid = {
    mode: "launch",
    samples: 10,
    collectorUrl: "http://127.0.0.1:1",
    approvals: [],
  };

  it("accepts a well-formed seed and rejects a malformed one", () => {
    expect(isPluginsBenchSeed(valid)).toBe(true);
    expect(isPluginsBenchSeed({ ...valid, mode: "nope" })).toBe(false);
    expect(isPluginsBenchSeed({ ...valid, samples: 0 })).toBe(false);
    expect(isPluginsBenchSeed({ ...valid, approvals: undefined })).toBe(false);
    expect(isPluginsBenchSeed(null)).toBe(false);
  });
});
