import { describe, expect, it } from "vitest";
import { COMMANDS } from "@/lib/shortcut-registry";
import type { CommandId } from "@/lib/shortcut-registry";
import { buildCommandItems } from "@/features/command-palette/command-items";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

type Snapshot = Map<CommandId, "runnable" | "disabled">;

function snapshotOf(entries: [CommandId, "runnable" | "disabled"][]): Snapshot {
  return new Map(entries);
}

const t = ((key: string, options?: Record<string, unknown>) => {
  if (options?.returnObjects === true) return [`${key} keyword one`, `${key} keyword two`];
  return `label:${key}`;
}) as Parameters<typeof buildCommandItems>[0]["t"];

describe("buildCommandItems", () => {
  it("lists bound Commands with key, kind, id, label, and snapshot state", () => {
    const items = buildCommandItems({
      snapshot: snapshotOf([
        ["global.toggleTheme", "runnable"],
        ["global.themeDark", "disabled"],
      ]),
      t,
      language: "en",
      customVoice: {},
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      key: "command:global.toggleTheme",
      kind: "command",
      id: "global.toggleTheme",
      label: `label:${COMMANDS["global.toggleTheme"].labelKey}`,
      state: "runnable",
    });
    expect(items[1]).toMatchObject({
      key: "command:global.themeDark",
      state: "disabled",
    });
  });

  it("leaves out focus Commands, Sealed Commands, the opener, and palette Commands", () => {
    const items = buildCommandItems({
      snapshot: snapshotOf([
        ["focus.next", "runnable"],
        ["bookList.openSelected", "runnable"],
        ["bookList.jumpBooks", "runnable"],
        ["dictation.stop", "runnable"],
        ["global.openCommandPalette", "runnable"],
        ["commandPalette.removeRecent", "runnable"],
        ["global.toggleTheme", "runnable"],
      ]),
      t,
      language: "en",
      customVoice: {},
    });

    expect(items.map((item) => item.id)).toEqual(["global.toggleTheme"]);
  });

  it("searches Voice Command phrases in the UI language", () => {
    const items = buildCommandItems({
      snapshot: snapshotOf([["global.themeDark", "runnable"]]),
      t,
      language: "en",
      customVoice: {},
    });

    expect(items[0].terms).toContain("dark theme");

    const spanish = buildCommandItems({
      snapshot: snapshotOf([["global.themeDark", "runnable"]]),
      t,
      language: "es",
      customVoice: {},
    });
    expect(spanish[0].terms).toContain("tema oscuro");
  });

  it("searches the author's own Voice Command phrases", () => {
    const items = buildCommandItems({
      snapshot: snapshotOf([["global.themeDark", "runnable"]]),
      t,
      language: "en",
      customVoice: { "global.themeDark": { en: ["gloomy mode on"] } },
    });

    expect(items[0].terms).toContain("gloomy mode on");
  });

  it("adds a Command's keywords when it declares any", () => {
    const definition = COMMANDS["global.toggleTheme"] as { keywordsKey?: string };
    const previous = definition.keywordsKey;
    definition.keywordsKey = "settings.keywords.theme";
    try {
      const items = buildCommandItems({
        snapshot: snapshotOf([["global.toggleTheme", "runnable"]]),
        t,
        language: "en",
        customVoice: {},
      });
      expect(items[0].terms).toContain("settings.keywords.theme keyword one");
      expect(items[0].terms).toContain("settings.keywords.theme keyword two");
    } finally {
      if (previous === undefined) delete definition.keywordsKey;
      else definition.keywordsKey = previous;
    }
  });

  it("finds Always on Top by 'pin' and the dictation toggle by 'microphone'", () => {
    function lookup(locale: Record<string, unknown>, key: string): unknown {
      return key
        .split(".")
        .reduce<unknown>(
          (node, part) =>
            node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
          locale
        );
    }
    const realT = (locale: Record<string, unknown>) =>
      ((key: string, options?: Record<string, unknown>) => {
        const value = lookup(locale, key);
        if (options?.returnObjects === true) return value as readonly string[];
        return typeof value === "string" ? value : key;
      }) as Parameters<typeof buildCommandItems>[0]["t"];

    const desktop = buildCommandItems({
      snapshot: snapshotOf([
        ["global.toggleAlwaysOnTop", "runnable"],
        ["dictation.toggle", "runnable"],
      ]),
      t: realT(en as unknown as Record<string, unknown>),
      language: "en",
      customVoice: {},
    });
    const alwaysOnTop = desktop.find((item) => item.id === "global.toggleAlwaysOnTop");
    expect(alwaysOnTop?.label).toBe("Toggle always on top");
    expect(alwaysOnTop?.terms).toContain("pin");
    const dictation = desktop.find((item) => item.id === "dictation.toggle");
    expect(dictation?.terms).toContain("microphone");

    const spanish = buildCommandItems({
      snapshot: snapshotOf([
        ["global.toggleAlwaysOnTop", "runnable"],
        ["dictation.toggle", "runnable"],
      ]),
      t: realT(es as unknown as Record<string, unknown>),
      language: "es",
      customVoice: {},
    });
    expect(spanish.find((item) => item.id === "global.toggleAlwaysOnTop")?.terms).toContain(
      "fijar"
    );
    expect(spanish.find((item) => item.id === "dictation.toggle")?.terms).toContain("micrófono");
  });
});
