import { describe, expect, it } from "vitest";
import { pickModel } from "@/features/dictation/store";
import { MODEL_CATALOG } from "@/features/dictation/catalog";

const ids = (tier: string, lang: string) =>
  MODEL_CATALOG.find(
    (m) => m.tier === tier && m.languages.includes(lang as "en"),
  )!.id;

describe("pickModel()", () => {
  it("prefers the author's tier when installed", () => {
    const installed = [ids("fast", "es"), ids("accurate", "es")];
    expect(
      pickModel("es", MODEL_CATALOG, installed, { en: "fast", es: "accurate" })
        ?.id,
    ).toBe(ids("accurate", "es"));
  });

  it("falls back to any installed tier for the language", () => {
    expect(
      pickModel("es", MODEL_CATALOG, [ids("fast", "es")], {
        en: "fast",
        es: "accurate",
      })?.id,
    ).toBe(ids("fast", "es"));
  });

  it("returns null when nothing for the language is installed", () => {
    expect(
      pickModel("es", MODEL_CATALOG, [ids("fast", "en")], {
        en: "fast",
        es: "fast",
      }),
    ).toBeNull();
  });
});
